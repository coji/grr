import type { SlackApp, SlackEdgeAppEnv } from 'slack-cloudflare-workers'
import dayjs from '~/lib/dayjs'
import { db } from '~/services/db'
import { DIARY_MOOD_CHOICES } from '../diary-constants'

export function registerReactionRemovedHandler(app: SlackApp<SlackEdgeAppEnv>) {
  app.event('reaction_removed', async ({ payload }) => {
    const event = payload
    if (event.item.type !== 'message') return
    const messageTs = event.item.ts
    if (!messageTs) return

    const entry = await db
      .selectFrom('diaryEntries')
      .selectAll()
      .where('messageTs', '=', messageTs)
      .executeTakeFirst()

    if (!entry) return
    if (entry.userId !== event.user) return

    const normalized =
      DIARY_MOOD_CHOICES.find((item) => item.reaction === event.reaction)
        ?.emoji ?? `:${event.reaction}:`

    if (entry.moodEmoji !== normalized) return

    const now = dayjs().utc().toISOString()

    await db
      .updateTable('diaryEntries')
      .set({
        moodEmoji: null,
        moodLabel: null,
        moodValue: null,
        moodRecordedAt: null,
        updatedAt: now,
      })
      .where('id', '=', entry.id)
      .execute()
  })
}
