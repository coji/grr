import type { SlackApp, SlackEdgeAppEnv } from 'slack-cloudflare-workers'
import { SlackAPIError } from 'slack-edge'
import dayjs from '~/lib/dayjs'
import { generateSupportiveReaction } from '~/services/ai'
import { db } from '~/services/db'
import { DIARY_PERSONA_NAME, SUPPORTIVE_REACTIONS } from '../diary-constants'
import { sanitizeText } from './utils'

export function registerMessageHandler(app: SlackApp<SlackEdgeAppEnv>) {
  app.event('message', async ({ payload, context }) => {
    const event = payload
    if (
      'subtype' in event &&
      event.subtype &&
      event.subtype !== 'thread_broadcast'
    )
      return
    if (!('thread_ts' in event) || !event.thread_ts) return
    if (!event.user) return

    const entry = await db
      .selectFrom('diaryEntries')
      .selectAll()
      .where('messageTs', '=', event.thread_ts)
      .executeTakeFirst()

    if (!entry) return
    if (entry.userId !== event.user) return

    const text = sanitizeText(event.text)
    if (!text) return

    const now = dayjs().utc().toISOString()
    const combined = entry.detail ? `${entry.detail}\n\n---\n${text}` : text

    await db
      .updateTable('diaryEntries')
      .set({
        detail: combined,
        detailRecordedAt: now,
        updatedAt: now,
      })
      .where('id', '=', entry.id)
      .execute()

    // リアクション + ボタンを追加（35%の確率）
    if (Math.random() < 0.35) {
      const reaction = await generateSupportiveReaction({
        personaName: DIARY_PERSONA_NAME,
        userId: entry.userId,
        messageText: text,
        moodLabel: entry.moodLabel,
        availableReactions: SUPPORTIVE_REACTIONS,
      })
      await context.client.reactions
        .add({ channel: entry.channelId, timestamp: event.ts, name: reaction })
        .catch((error) => {
          if (
            error instanceof SlackAPIError &&
            error.error === 'already_reacted'
          ) {
            return
          }
          console.error('Failed to add supportive reaction', error)
        })

      // 「話を聞いてもらう」ボタンを追加
      await context.client.chat
        .postMessage({
          channel: entry.channelId,
          thread_ts: event.thread_ts,
          text: '',
          blocks: [
            {
              type: 'actions',
              elements: [
                {
                  type: 'button',
                  text: {
                    type: 'plain_text',
                    text: '💬 ほたるに話を聞いてもらう',
                    emoji: true,
                  },
                  action_id: 'diary_request_support',
                  value: entry.id,
                },
              ],
            },
          ],
        })
        .catch((error) => {
          console.error('Failed to post support button', error)
        })
    }
  })
}
