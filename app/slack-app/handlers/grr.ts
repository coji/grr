import { nanoid } from 'nanoid'
import type { SlackApp, SlackEdgeAppEnv } from 'slack-cloudflare-workers'
import { db } from '~/services/db'
import dayjs from '~/utils/dayjs'
import { buildGrrModal } from './views/grr-modal'

export const registerGrrHandlers = (app: SlackApp<SlackEdgeAppEnv>) => {
  app.command(
    '/grr',
    async (req) => {},
    async ({ context, payload }) => {
      await context.client.views.open({
        trigger_id: payload.trigger_id,
        view: buildGrrModal(payload.channel_id),
      })
    },
  )
  app.shortcut(
    'grr_shortcut',
    async (req) => {},
    async ({ context, payload }) => {
      const message =
        payload.type === 'message_action' ? payload.message.text : undefined
      await context.client.views.open({
        trigger_id: payload.trigger_id,
        view: buildGrrModal(context.channelId, message),
      })
    },
  )
  app.view(
    'grr_modal',
    async (req) => {
      return // ack only
    },
    async ({ context, payload: { view, user }, body }) => {
      const level = view.state.values.level_block.level.selected_option?.value
      const text = view.state.values.text_block.text.value
      const meta = JSON.parse(view.private_metadata ?? '{}')
      const channelId = meta.channelId

      const score = Number(level ?? '3') // fallback = 3

      // ここに保存ロジック (D1 INSERT / UPSERT など)
      const ret = await db
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
        text: `😤 ${user.name} さんがイライラ "${text}"を記録しました (イラ度: ${score})`,
      })
    },
  )
}
