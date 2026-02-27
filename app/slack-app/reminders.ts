import { nanoid } from 'nanoid'
import { SlackAPIClient } from 'slack-edge'
import dayjs from '~/lib/dayjs'
import type { DiaryReminderMoodOption } from '~/services/ai'
import { generateDiaryReminder } from '~/services/ai'
import { getCharacter } from '~/services/character'
import { extractImageId, pickRandomPoolKey } from '~/services/character-image'
import { db } from '~/services/db'
import { getUserMilestones } from '~/services/proactive-messages'
import { buildCharacterImageBlockFromPoolId } from './character-blocks'
import {
  DIARY_MOOD_CHOICES,
  DIARY_PERSONA_NAME,
} from './handlers/diary-constants'

const TOKYO_TZ = 'Asia/Tokyo'

const REMINDER_MOOD_OPTIONS: ReadonlyArray<DiaryReminderMoodOption> =
  DIARY_MOOD_CHOICES.map(({ emoji, label }) => ({
    emoji,
    label,
  }))

type SlackUser = {
  id?: string
  is_bot?: boolean
  is_app_user?: boolean
  deleted?: boolean
  profile?: {
    real_name?: string
    display_name?: string
  }
}

const isHuman = (user: SlackUser, botUserId: string | undefined) => {
  if (!user.id) return false
  if (user.id === 'USLACKBOT') return false
  if (botUserId && user.id === botUserId) return false
  if (user.is_bot || user.is_app_user) return false
  if (user.deleted) return false
  return true
}

const fetchAllWorkspaceUsers = async (client: SlackAPIClient) => {
  const members: SlackUser[] = []
  let cursor: string | undefined
  do {
    const response = await client.users.list({ cursor, limit: 200 })
    if (!response.ok) {
      throw new Error(`Failed to fetch users: ${response.error}`)
    }
    members.push(...(response.members ?? []))
    cursor = response.response_metadata?.next_cursor
    if (!cursor) break
  } while (cursor)
  return members
}

/**
 * Get context for personalized reminder variations
 */
async function getReminderContext(
  userId: string,
  tokyoNow: dayjs.Dayjs,
): Promise<{
  daysSinceLastEntry?: number
  currentStreak?: number
  isWeekStart?: boolean
  isWeekEnd?: boolean
  recentMoodTrend?: 'positive' | 'negative' | 'neutral'
}> {
  const context: {
    daysSinceLastEntry?: number
    currentStreak?: number
    isWeekStart?: boolean
    isWeekEnd?: boolean
    recentMoodTrend?: 'positive' | 'negative' | 'neutral'
  } = {}

  // Day of week context
  const dayOfWeek = tokyoNow.day()
  context.isWeekStart = dayOfWeek === 1 // Monday
  context.isWeekEnd = dayOfWeek === 5 || dayOfWeek === 6 // Friday or Saturday

  try {
    // Get milestone data for streak info
    const milestones = await getUserMilestones(userId)
    if (milestones) {
      context.currentStreak = milestones.currentStreak

      if (milestones.lastEntryDate) {
        const lastEntry = dayjs(milestones.lastEntryDate).tz(TOKYO_TZ)
        context.daysSinceLastEntry = tokyoNow.diff(lastEntry, 'day')
      }
    }

    // Get recent mood trend (last 5 entries)
    const recentEntries = await db
      .selectFrom('diaryEntries')
      .select('moodLabel')
      .where('userId', '=', userId)
      .where('moodLabel', 'is not', null)
      .orderBy('entryDate', 'desc')
      .limit(5)
      .execute()

    if (recentEntries.length >= 3) {
      const positiveMoods = ['ほっと安心', 'いい感じ', 'うれしい']
      const negativeMoods = ['おつかれさま', 'もやもや', 'うーん']

      let positiveCount = 0
      let negativeCount = 0

      for (const entry of recentEntries) {
        if (entry.moodLabel && positiveMoods.includes(entry.moodLabel)) {
          positiveCount++
        } else if (entry.moodLabel && negativeMoods.includes(entry.moodLabel)) {
          negativeCount++
        }
      }

      if (positiveCount >= 3) {
        context.recentMoodTrend = 'positive'
      } else if (negativeCount >= 3) {
        context.recentMoodTrend = 'negative'
      } else {
        context.recentMoodTrend = 'neutral'
      }
    }
  } catch (error) {
    console.error('Failed to get reminder context:', error)
  }

  return context
}

export const sendDailyDiaryReminders = async (env: Env) => {
  console.log('sendDailyDiaryReminders started')
  const client = new SlackAPIClient(env.SLACK_BOT_TOKEN)
  const auth = await client.auth.test()
  if (!auth.ok) {
    console.error('Slack auth.test failed', auth.error)
    return
  }

  const botUserId = auth.user_id
  const allUsers = await fetchAllWorkspaceUsers(client)
  const tokyoNow = dayjs().tz(TOKYO_TZ)
  const entryDate = tokyoNow.format('YYYY-MM-DD')

  for (const member of allUsers) {
    try {
      if (!isHuman(member, botUserId)) continue
      if (!member.id) continue
      const userId = member.id

      const existing = await db
        .selectFrom('diaryEntries')
        .select('id')
        .where('userId', '=', userId)
        .where('entryDate', '=', entryDate)
        .executeTakeFirst()

      if (existing) continue

      // ユーザーの過去のエントリから最新のチャンネルIDを取得
      const previousEntry = await db
        .selectFrom('diaryEntries')
        .select('channelId')
        .where('userId', '=', userId)
        .orderBy('entryDate', 'desc')
        .limit(1)
        .executeTakeFirst()

      if (!previousEntry?.channelId) {
        // 過去のエントリがない場合はスキップ（初回ユーザーは手動で開始する必要がある）
        console.log(
          `Skipping reminder for user ${userId}: no previous channel found`,
        )
        continue
      }

      const channelId = previousEntry.channelId

      // Get context for reminder variations
      const reminderContext = await getReminderContext(userId, tokyoNow)

      const reminderText = await generateDiaryReminder({
        personaName: DIARY_PERSONA_NAME,
        userId,
        moodOptions: REMINDER_MOOD_OPTIONS,
        context: reminderContext,
      })

      // Build character image block if user has a character
      const character = await getCharacter(userId)
      // biome-ignore lint/suspicious/noExplicitAny: Slack Block Kit dynamic types
      let characterBlocks: any[] = []
      if (character) {
        const poolKey = await pickRandomPoolKey(
          userId,
          character.evolutionStage,
        )
        const imageId = poolKey ? extractImageId(poolKey) : null
        characterBlocks = [buildCharacterImageBlockFromPoolId(userId, imageId)]
      }

      // ユーザーのチャンネルにメンション付き＆ボタン付きでメッセージを送信
      const message = await client.chat.postMessage({
        channel: channelId,
        text: `<@${userId}> ${reminderText}`,
        blocks: [
          ...characterBlocks,
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `<@${userId}> ${reminderText}`,
            },
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: '😄 ほっと安心',
                  emoji: true,
                },
                action_id: 'diary_quick_mood_good',
                value: entryDate,
                style: 'primary',
              },
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: '😐 ふつうの日',
                  emoji: true,
                },
                action_id: 'diary_quick_mood_normal',
                value: entryDate,
              },
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: '😫 おつかれさま',
                  emoji: true,
                },
                action_id: 'diary_quick_mood_tired',
                value: entryDate,
              },
            ],
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: '今日はスキップ',
                  emoji: true,
                },
                action_id: 'diary_skip_today',
                value: entryDate,
              },
            ],
          },
        ],
      })

      if (!message.ok || !message.ts) {
        console.warn('Failed to send reminder message', message.error)
        continue
      }

      const insertedAt = dayjs().utc().toISOString()

      await db
        .insertInto('diaryEntries')
        .values({
          id: nanoid(),
          userId,
          channelId,
          messageTs: message.ts,
          entryDate,
          moodEmoji: null,
          moodValue: null,
          moodLabel: null,
          detail: null,
          reminderSentAt: insertedAt,
          moodRecordedAt: null,
          detailRecordedAt: null,
          createdAt: insertedAt,
          updatedAt: insertedAt,
        })
        .execute()
    } catch (error) {
      console.error(
        'Failed to process diary reminder for user',
        member.id,
        error,
      )
    }
  }
}
