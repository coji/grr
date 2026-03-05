import { SlackAPIClient } from 'slack-edge'
import dayjs from '~/lib/dayjs'
import { generateFollowupMessage } from '~/services/ai'
import { CONSOLIDATION_THRESHOLD } from '~/services/ai/memory-consolidation'
import { getCharacter, getCharacterPersonaInfo } from '~/services/character'
import { extractImageId, pickRandomPoolKey } from '~/services/character-image'
import { db } from '~/services/db'
import {
  evaluateAnniversaryMessages,
  evaluateAutoPauseReminders,
  evaluateBriefFollowupMessages,
  evaluateGentleReengagementMessages,
  evaluateQuestionMessages,
  evaluateRandomCheckinMessages,
  evaluateSeasonalMessages,
  evaluateWeeklyInsightMessages,
  recordMessageSent,
  type ProactiveMessageResult,
} from '~/services/heartbeat-evaluators'
import {
  cleanupOldExtractions,
  getMemoryCount,
  getUserIdsWithMemories,
} from '~/services/memory'
import {
  expireOldFollowups,
  getFollowupWithEntry,
  markFollowupAsSent,
} from '~/services/pending-followups'
import { buildCharacterImageBlockFromPoolId } from './character-blocks'

const TOKYO_TZ = 'Asia/Tokyo'

// HEARTBEAT configuration
const HEARTBEAT_CONFIG = {
  // Only send during these hours (JST)
  activeHoursStart: 9, // 9:00 AM
  activeHoursEnd: 21, // 9:00 PM
  // User must have been active within this many days to receive follow-ups
  userActivityWindowDays: 3,
  // Minimum hours between ANY proactive messages to the same user
  minHoursBetweenMessages: 24,
}

/**
 * HEARTBEAT: Periodically wake up and check if there are meaningful messages to send.
 *
 * This is NOT a blind cron job. It evaluates multiple types of proactive messages:
 * 1. Event follow-ups (from pending_followups table)
 * 2. Anniversary reminders (1年前の日記)
 * 3. Seasonal greetings (季節の挨拶)
 * 4. Weekly insights (週イチ気づき)
 * 5. Random check-ins (ランダムな一言)
 * 6. Question interventions (問いかけ型介入)
 * 7. Brief entry follow-ups (続きを聞かせて)
 *
 * Conditions checked:
 * - Is it a reasonable hour for the user?
 * - Has the user been active recently?
 * - Haven't we already sent a message recently?
 */
export const heartbeatFollowups = async (env: Env) => {
  const tokyoNow = dayjs().tz(TOKYO_TZ)
  const currentHour = tokyoNow.hour()
  const todayDate = tokyoNow.format('YYYY-MM-DD')

  console.log(
    `[HEARTBEAT] Starting at ${tokyoNow.format('YYYY-MM-DD HH:mm')} JST`,
  )

  // Check 1: Is it within active hours?
  if (
    currentHour < HEARTBEAT_CONFIG.activeHoursStart ||
    currentHour >= HEARTBEAT_CONFIG.activeHoursEnd
  ) {
    console.log(
      `[HEARTBEAT] Outside active hours (${HEARTBEAT_CONFIG.activeHoursStart}:00-${HEARTBEAT_CONFIG.activeHoursEnd}:00 JST). Sleeping.`,
    )
    return
  }

  const client = new SlackAPIClient(env.SLACK_BOT_TOKEN)

  // Track which users already received a message in this heartbeat
  const sentToUsers = new Set<string>()

  // ============================================
  // Phase 1: Process pending event follow-ups
  // ============================================
  await processEventFollowups(client, todayDate, sentToUsers)

  // ============================================
  // Phase 2: Evaluate and send proactive messages
  // ============================================
  await processProactiveMessages(client, sentToUsers)

  // ============================================
  // Phase 3: Cleanup
  // ============================================
  try {
    const expiredCount = await expireOldFollowups(7)
    if (expiredCount > 0) {
      console.log(`[HEARTBEAT] Expired ${expiredCount} old follow-ups`)
    }
  } catch (error) {
    console.error('[HEARTBEAT] Failed to expire old follow-ups:', error)
  }

  try {
    const cleanedCount = await cleanupOldExtractions()
    if (cleanedCount > 0) {
      console.log(
        `[HEARTBEAT] Cleaned up ${cleanedCount} old memory extractions`,
      )
    }
  } catch (error) {
    console.error('[HEARTBEAT] Failed to cleanup old extractions:', error)
  }

  // ============================================
  // Phase 4: Memory maintenance (consolidation + decay)
  // ============================================
  try {
    await processMemoryMaintenance(env)
  } catch (error) {
    console.error('[HEARTBEAT] Failed memory maintenance:', error)
  }

  console.log('[HEARTBEAT] Complete')
}

/**
 * Process pending event follow-ups from the pendingFollowups table
 */
async function processEventFollowups(
  client: SlackAPIClient,
  todayDate: string,
  sentToUsers: Set<string>,
): Promise<void> {
  const pendingFollowups = await db
    .selectFrom('pendingFollowups')
    .selectAll()
    .where('status', '=', 'pending')
    .where('followUpDate', '<=', todayDate)
    .orderBy('followUpDate', 'asc')
    .execute()

  if (pendingFollowups.length === 0) {
    console.log('[HEARTBEAT] No pending event follow-ups')
    return
  }

  console.log(
    `[HEARTBEAT] Found ${pendingFollowups.length} pending event follow-ups`,
  )

  let sentCount = 0
  let skippedCount = 0

  for (const followup of pendingFollowups) {
    // Skip if we already sent to this user
    if (sentToUsers.has(followup.userId)) {
      skippedCount++
      continue
    }

    // Check if user has reminders disabled
    const userSettings = await db
      .selectFrom('userDiarySettings')
      .select('reminderEnabled')
      .where('userId', '=', followup.userId)
      .executeTakeFirst()

    if (userSettings && userSettings.reminderEnabled === 0) {
      console.log(
        `[HEARTBEAT] Skipping follow-up for ${followup.userId}: reminders disabled`,
      )
      skippedCount++
      continue
    }

    const shouldSend = await evaluateFollowup(followup.userId, followup.id)

    if (!shouldSend.send) {
      console.log(
        `[HEARTBEAT] Skipping follow-up for ${followup.userId}: ${shouldSend.reason}`,
      )
      skippedCount++
      continue
    }

    try {
      const followupWithEntry = await getFollowupWithEntry(followup.id)
      const originalEntry = followupWithEntry?.entryDetail ?? null

      const characterInfo = await getCharacterPersonaInfo(followup.userId)
      const followupText = await generateFollowupMessage({
        characterInfo,
        userId: followup.userId,
        eventDescription: followup.eventDescription,
        originalEntryText: originalEntry,
      })

      const result = await client.chat.postMessage({
        channel: followup.channelId,
        text: `<@${followup.userId}> ${followupText}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `<@${followup.userId}> ${followupText}`,
            },
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `💭 _${dayjs(followup.eventDate).format('M/D')}の日記から_`,
              },
            ],
          },
        ],
      })

      if (result.ok && result.ts) {
        await markFollowupAsSent(followup.id, result.ts)
        sentToUsers.add(followup.userId)
        sentCount++
        console.log(
          `[HEARTBEAT] Sent follow-up to ${followup.userId}: "${followup.eventDescription}"`,
        )
      }
    } catch (error) {
      console.error(
        `[HEARTBEAT] Failed to send follow-up to ${followup.userId}:`,
        error,
      )
    }
  }

  console.log(
    `[HEARTBEAT] Event follow-ups: Sent ${sentCount}, Skipped ${skippedCount}`,
  )
}

/**
 * Process all types of proactive messages
 */
async function processProactiveMessages(
  client: SlackAPIClient,
  sentToUsers: Set<string>,
): Promise<void> {
  const allMessages: ProactiveMessageResult[] = []

  // Evaluate all types of proactive messages
  try {
    // Anniversary messages (1年前リマインド)
    const anniversaryMessages = await evaluateAnniversaryMessages()
    allMessages.push(...anniversaryMessages)
    if (anniversaryMessages.length > 0) {
      console.log(
        `[HEARTBEAT] Found ${anniversaryMessages.length} anniversary messages`,
      )
    }
  } catch (error) {
    console.error('[HEARTBEAT] Failed to evaluate anniversary messages:', error)
  }

  try {
    // Seasonal messages (季節の挨拶)
    const seasonalMessages = await evaluateSeasonalMessages()
    allMessages.push(...seasonalMessages)
    if (seasonalMessages.length > 0) {
      console.log(
        `[HEARTBEAT] Found ${seasonalMessages.length} seasonal messages`,
      )
    }
  } catch (error) {
    console.error('[HEARTBEAT] Failed to evaluate seasonal messages:', error)
  }

  try {
    // Weekly insight messages (週イチ気づき)
    const weeklyMessages = await evaluateWeeklyInsightMessages()
    allMessages.push(...weeklyMessages)
    if (weeklyMessages.length > 0) {
      console.log(
        `[HEARTBEAT] Found ${weeklyMessages.length} weekly insight messages`,
      )
    }
  } catch (error) {
    console.error(
      '[HEARTBEAT] Failed to evaluate weekly insight messages:',
      error,
    )
  }

  try {
    // Question intervention messages (問いかけ型介入)
    const questionMessages = await evaluateQuestionMessages()
    allMessages.push(...questionMessages)
    if (questionMessages.length > 0) {
      console.log(
        `[HEARTBEAT] Found ${questionMessages.length} question messages`,
      )
    }
  } catch (error) {
    console.error('[HEARTBEAT] Failed to evaluate question messages:', error)
  }

  try {
    // Brief entry follow-up messages (続きを聞かせて)
    const briefMessages = await evaluateBriefFollowupMessages()
    allMessages.push(...briefMessages)
    if (briefMessages.length > 0) {
      console.log(
        `[HEARTBEAT] Found ${briefMessages.length} brief follow-up messages`,
      )
    }
  } catch (error) {
    console.error(
      '[HEARTBEAT] Failed to evaluate brief follow-up messages:',
      error,
    )
  }

  try {
    // Random check-in messages (ランダムな一言) - evaluated last due to low probability
    const randomMessages = await evaluateRandomCheckinMessages()
    allMessages.push(...randomMessages)
    if (randomMessages.length > 0) {
      console.log(
        `[HEARTBEAT] Found ${randomMessages.length} random check-in messages`,
      )
    }
  } catch (error) {
    console.error(
      '[HEARTBEAT] Failed to evaluate random check-in messages:',
      error,
    )
  }

  try {
    // Gentle re-engagement messages (無反応フォローアップ)
    const reengagementMessages = await evaluateGentleReengagementMessages()
    allMessages.push(...reengagementMessages)
    if (reengagementMessages.length > 0) {
      console.log(
        `[HEARTBEAT] Found ${reengagementMessages.length} gentle re-engagement messages`,
      )
    }
  } catch (error) {
    console.error(
      '[HEARTBEAT] Failed to evaluate gentle re-engagement messages:',
      error,
    )
  }

  try {
    // Auto-pause reminders (リマインダー自動停止)
    const autoPauseMessages = await evaluateAutoPauseReminders()
    allMessages.push(...autoPauseMessages)
    if (autoPauseMessages.length > 0) {
      console.log(
        `[HEARTBEAT] Found ${autoPauseMessages.length} auto-pause messages`,
      )
    }
  } catch (error) {
    console.error('[HEARTBEAT] Failed to evaluate auto-pause messages:', error)
  }

  if (allMessages.length === 0) {
    console.log('[HEARTBEAT] No proactive messages to send')
    return
  }

  console.log(
    `[HEARTBEAT] Total ${allMessages.length} proactive messages to evaluate`,
  )

  // Send proactive messages
  let sentCount = 0

  for (const message of allMessages) {
    // Skip if we already sent to this user
    if (sentToUsers.has(message.userId)) {
      continue
    }

    // Check if user received any proactive message recently
    const canSend = await canSendProactiveMessage(message.userId)
    if (!canSend) {
      console.log(
        `[HEARTBEAT] Skipping ${message.messageType} for ${message.userId}: sent recently`,
      )
      continue
    }

    try {
      const character = await getCharacter(message.userId)
      let poolImageId: string | null = null
      if (character) {
        const poolKey = await pickRandomPoolKey(
          message.userId,
          character.evolutionStage,
        )
        poolImageId = poolKey ? extractImageId(poolKey) : null
      }
      const result = await client.chat.postMessage({
        channel: message.channelId,
        text: `<@${message.userId}> ${message.text}`,
        blocks: buildProactiveMessageBlocks(message, {
          hasCharacter: !!character,
          poolImageId,
        }),
      })

      if (result.ok && result.ts) {
        await recordMessageSent(message, result.ts)

        // For auto_pause, disable reminders only after successful send
        if (message.messageType === 'auto_pause') {
          await db
            .updateTable('userDiarySettings')
            .set({
              reminderEnabled: 0,
              updatedAt: dayjs().utc().toISOString(),
            })
            .where('userId', '=', message.userId)
            .execute()
        }

        sentToUsers.add(message.userId)
        sentCount++
        console.log(
          `[HEARTBEAT] Sent ${message.messageType} to ${message.userId}`,
        )
      }
    } catch (error) {
      console.error(
        `[HEARTBEAT] Failed to send ${message.messageType} to ${message.userId}:`,
        error,
      )
    }
  }

  console.log(`[HEARTBEAT] Sent ${sentCount} proactive messages`)
}

/**
 * Build Block Kit blocks for different proactive message types
 */
function buildProactiveMessageBlocks(
  message: ProactiveMessageResult,
  characterImage: { hasCharacter: boolean; poolImageId: string | null },
  // biome-ignore lint/suspicious/noExplicitAny: Slack Block Kit dynamic types
): any[] {
  // biome-ignore lint/suspicious/noExplicitAny: Slack Block Kit dynamic types
  const blocks: any[] = []

  // Skip character image for gentle_reengagement and auto_pause (keep it simple)
  const skipImage =
    message.messageType === 'gentle_reengagement' ||
    message.messageType === 'auto_pause'

  // Add character image if user has a character
  if (characterImage.hasCharacter && !skipImage) {
    blocks.push(
      buildCharacterImageBlockFromPoolId(
        message.userId,
        characterImage.poolImageId,
      ),
    )
  }

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `<@${message.userId}> ${message.text}`,
    },
  })

  // Add action buttons for gentle_reengagement
  if (message.messageType === 'gentle_reengagement') {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '✏️ また日記書く', emoji: true },
          action_id: 'diary_resume_from_reengagement',
          // Use 'today' sentinel - the handler computes the actual date at click time
          value: 'today',
          style: 'primary',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '💤 しばらくお休み', emoji: true },
          action_id: 'diary_pause_reminders',
        },
      ],
    })
  }

  // Add action button for auto_pause
  if (message.messageType === 'auto_pause') {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '🌸 また始める', emoji: true },
          action_id: 'diary_restart_after_pause',
          // Use 'today' sentinel - the handler computes the actual date at click time
          value: 'today',
          style: 'primary',
        },
      ],
    })
  }

  // Add context based on message type
  const contextMap: Record<string, string> = {
    anniversary: '📅 _1年前の今日の日記から_',
    seasonal: '🌸 _季節のご挨拶_',
    weekly_insight: '📝 _今週の日記から_',
    random_checkin: '💭 _ふと思い出して_',
    question: '🤔 _最近の日記を読んで_',
    brief_followup: '✏️ _日記の続き_',
  }

  const contextText = contextMap[message.messageType]
  if (contextText) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: contextText,
        },
      ],
    })
  }

  return blocks
}

/**
 * Check if we can send a proactive message to a user
 */
async function canSendProactiveMessage(userId: string): Promise<boolean> {
  const tokyoNow = dayjs().tz(TOKYO_TZ)
  const cutoff = tokyoNow
    .subtract(HEARTBEAT_CONFIG.minHoursBetweenMessages, 'hour')
    .utc()
    .toISOString()

  // Check proactive_messages table
  const recentProactive = await db
    .selectFrom('proactiveMessages')
    .select('id')
    .where('userId', '=', userId)
    .where('sentAt', '>=', cutoff)
    .limit(1)
    .executeTakeFirst()

  if (recentProactive) {
    return false
  }

  // Check pending_followups table
  const recentFollowup = await db
    .selectFrom('pendingFollowups')
    .select('id')
    .where('userId', '=', userId)
    .where('status', '=', 'sent')
    .where('updatedAt', '>=', cutoff)
    .limit(1)
    .executeTakeFirst()

  return !recentFollowup
}

/**
 * Evaluate whether we should send an event follow-up to a user right now.
 */
async function evaluateFollowup(
  userId: string,
  _followupId: string,
): Promise<{ send: boolean; reason?: string }> {
  const tokyoNow = dayjs().tz(TOKYO_TZ)

  // Check: Has the user been active recently?
  const activityCutoff = tokyoNow
    .subtract(HEARTBEAT_CONFIG.userActivityWindowDays, 'day')
    .format('YYYY-MM-DD')

  const recentActivity = await db
    .selectFrom('diaryEntries')
    .select('id')
    .where('userId', '=', userId)
    .where('entryDate', '>=', activityCutoff)
    .limit(1)
    .executeTakeFirst()

  if (!recentActivity) {
    return {
      send: false,
      reason: `User inactive for ${HEARTBEAT_CONFIG.userActivityWindowDays}+ days`,
    }
  }

  // Check: Have we sent any message to this user recently?
  const canSend = await canSendProactiveMessage(userId)
  if (!canSend) {
    return {
      send: false,
      reason: `Already sent message within ${HEARTBEAT_CONFIG.minHoursBetweenMessages}h`,
    }
  }

  // All checks passed
  return { send: true }
}

/**
 * Memory maintenance: trigger consolidation for users with too many memories.
 * Decay happens inside the consolidation workflow as its first step.
 */
async function processMemoryMaintenance(env: Env): Promise<void> {
  const userIds = await getUserIdsWithMemories()
  let triggeredCount = 0

  for (const userId of userIds) {
    const count = await getMemoryCount(userId)
    if (count > CONSOLIDATION_THRESHOLD) {
      try {
        await env.MEMORY_CONSOLIDATION_WORKFLOW.create({
          params: { userId },
        })
        triggeredCount++
        console.log(
          `[HEARTBEAT] Triggered memory consolidation for user ${userId} (${count} memories)`,
        )
      } catch (error) {
        console.error(
          `[HEARTBEAT] Failed to trigger consolidation for ${userId}:`,
          error,
        )
      }
    }
  }

  if (triggeredCount > 0) {
    console.log(
      `[HEARTBEAT] Triggered ${triggeredCount} memory consolidation workflows`,
    )
  }
}

// Keep the old function name as an alias for backwards compatibility
export const sendFollowupReminders = heartbeatFollowups
