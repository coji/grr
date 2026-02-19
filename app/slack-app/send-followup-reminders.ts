import { SlackAPIClient } from 'slack-edge'
import dayjs from '~/lib/dayjs'
import { generateFollowupMessage } from '~/services/ai'
import { db } from '~/services/db'
import {
  expireOldFollowups,
  getFollowupWithEntry,
  markFollowupAsSent,
} from '~/services/pending-followups'
import { DIARY_PERSONA_NAME } from './handlers/diary-constants'

const TOKYO_TZ = 'Asia/Tokyo'

// HEARTBEAT configuration
const HEARTBEAT_CONFIG = {
  // Only send during these hours (JST)
  activeHoursStart: 9, // 9:00 AM
  activeHoursEnd: 21, // 9:00 PM
  // User must have been active within this many days to receive follow-ups
  userActivityWindowDays: 3,
  // Minimum hours between follow-ups to the same user
  minHoursBetweenFollowups: 24,
}

/**
 * HEARTBEAT: Periodically wake up and check if there are meaningful follow-ups to send.
 *
 * This is NOT a blind cron job. It checks:
 * 1. Is it a reasonable hour for the user?
 * 2. Has the user been active recently?
 * 3. Is the follow-up ready to send? (event date has passed)
 * 4. Haven't we already sent a follow-up recently?
 *
 * If conditions aren't met, we just return and wait for the next heartbeat.
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

  // Expire old follow-ups
  try {
    const expiredCount = await expireOldFollowups(7)
    if (expiredCount > 0) {
      console.log(`[HEARTBEAT] Expired ${expiredCount} old follow-ups`)
    }
  } catch (error) {
    console.error('[HEARTBEAT] Failed to expire old follow-ups:', error)
  }

  // Get all pending follow-ups that are ready (follow-up date <= today)
  const pendingFollowups = await db
    .selectFrom('pendingFollowups')
    .selectAll()
    .where('status', '=', 'pending')
    .where('followUpDate', '<=', todayDate)
    .orderBy('followUpDate', 'asc')
    .execute()

  if (pendingFollowups.length === 0) {
    console.log('[HEARTBEAT] No pending follow-ups ready. Sleeping.')
    return
  }

  console.log(
    `[HEARTBEAT] Found ${pendingFollowups.length} pending follow-ups to evaluate`,
  )

  const client = new SlackAPIClient(env.SLACK_BOT_TOKEN)
  let sentCount = 0
  let skippedCount = 0

  for (const followup of pendingFollowups) {
    const shouldSend = await evaluateFollowup(followup.userId, followup.id)

    if (!shouldSend.send) {
      console.log(
        `[HEARTBEAT] Skipping follow-up for ${followup.userId}: ${shouldSend.reason}`,
      )
      skippedCount++
      continue
    }

    // All conditions met - send the follow-up
    try {
      const followupWithEntry = await getFollowupWithEntry(followup.id)
      const originalEntry = followupWithEntry?.entryDetail ?? null

      const followupText = await generateFollowupMessage({
        personaName: DIARY_PERSONA_NAME,
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
    `[HEARTBEAT] Complete. Sent: ${sentCount}, Skipped: ${skippedCount}`,
  )
}

/**
 * Evaluate whether we should send a follow-up to a user right now.
 */
async function evaluateFollowup(
  userId: string,
  followupId: string,
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

  // Check: Have we sent a follow-up to this user recently?
  const recentFollowupCutoff = tokyoNow
    .subtract(HEARTBEAT_CONFIG.minHoursBetweenFollowups, 'hour')
    .utc()
    .toISOString()

  const recentFollowup = await db
    .selectFrom('pendingFollowups')
    .select('id')
    .where('userId', '=', userId)
    .where('status', '=', 'sent')
    .where('updatedAt', '>=', recentFollowupCutoff)
    .where('id', '!=', followupId)
    .limit(1)
    .executeTakeFirst()

  if (recentFollowup) {
    return {
      send: false,
      reason: `Already sent follow-up within ${HEARTBEAT_CONFIG.minHoursBetweenFollowups}h`,
    }
  }

  // All checks passed
  return { send: true }
}

// Keep the old function name as an alias for backwards compatibility
export const sendFollowupReminders = heartbeatFollowups
