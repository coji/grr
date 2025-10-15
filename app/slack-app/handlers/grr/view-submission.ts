import { nanoid } from 'nanoid'
import type { SlackApp, SlackEdgeAppEnv } from 'slack-cloudflare-workers'
import dayjs from '~/lib/dayjs'
import { db } from '~/services/db'

export function registerViewSubmissionHandler(app: SlackApp<SlackEdgeAppEnv>) {
  app.view(
    'grr_modal',
    async () => {
      return // ack only
    },
    async ({ context, payload: { view, user } }) => {
      const level = view.state.values.level_block.level.selected_option?.value
      const text = view.state.values.text_block.text.value
      const meta = JSON.parse(view.private_metadata ?? '{}')
      const channelId = meta.channelId

      const score = Number(level ?? '3') // fallback = 3

      await db
        .insertInto('irritations')
        .values({
          id: nanoid(),
          userId: user.id,
          channelId: channelId ?? null,
          rawText: text ?? '',
          score,
          createdAt: dayjs().utc().toISOString(),
          updatedAt: dayjs().utc().toISOString(),
          isPublic: 0,
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      await context.client.chat.postMessage({
        channel: channelId ?? user.id,
        text: `😇 ${user.name} さんがイライラ "${text}"を記録しました (イラ度: ${score})`,
      })
    },
  )
}
