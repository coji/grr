import type { SlackApp, SlackEdgeAppEnv } from 'slack-cloudflare-workers'
import dayjs from '~/lib/dayjs'
import { db } from '~/services/db'
import { DIARY_MOOD_CHOICES, DIARY_PERSONA_NAME } from '../diary-constants'

export function registerReactionAddedHandler(app: SlackApp<SlackEdgeAppEnv>) {
  app.event('reaction_added', async ({ payload, context }) => {
    const event = payload
    if (event.item.type !== 'message') return
    const messageTs = event.item.ts
    const channelId = event.item.channel
    if (!messageTs || !channelId) return

    const entry = await db
      .selectFrom('diaryEntries')
      .selectAll()
      .where('messageTs', '=', messageTs)
      .executeTakeFirst()

    if (!entry) return
    if (entry.userId !== event.user) return

    const choice = DIARY_MOOD_CHOICES.find(
      (item) => item.reaction === event.reaction,
    )
    const now = dayjs().utc().toISOString()
    const moodEmoji = choice?.emoji ?? `:${event.reaction}:`
    const moodLabel = choice?.label ?? 'custom'
    const moodValue = choice?.value ?? null

    await db
      .updateTable('diaryEntries')
      .set({
        moodEmoji,
        moodLabel,
        moodValue,
        moodRecordedAt: now,
        updatedAt: now,
      })
      .where('id', '=', entry.id)
      .execute()

    if (!entry.moodRecordedAt) {
      const label = choice ? `「${choice.label}」` : `「:${event.reaction}:」`
      await context.client.chat
        .postMessage({
          channel: channelId,
          thread_ts: messageTs,
          text: `${DIARY_PERSONA_NAME}が今日のきもち${label}をそっと受け取ったよ。いつもおつかれさま。`,
        })
        .catch(() => {})
    }
  })
}
