import { nanoid } from 'nanoid'
import { SlackAPIClient } from 'slack-edge'
import dayjs from '~/lib/dayjs'
import type { DiaryReminderMoodOption } from '~/services/ai'
import { generateDiaryReminder } from '~/services/ai'
import { db } from '~/services/db'
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
      const reminderText = await generateDiaryReminder({
        personaName: DIARY_PERSONA_NAME,
        userId,
        moodOptions: REMINDER_MOOD_OPTIONS,
      })

      // ユーザーのチャンネルにメンション付き＆ボタン付きでメッセージを送信
      const message = await client.chat.postMessage({
        channel: channelId,
        text: `<@${userId}> ${reminderText}`,
        blocks: [
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
