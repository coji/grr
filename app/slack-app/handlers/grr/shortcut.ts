import type { SlackApp, SlackEdgeAppEnv } from 'slack-cloudflare-workers'
import { buildGrrModal } from './views/grr-modal'

export function registerShortcutHandler(app: SlackApp<SlackEdgeAppEnv>) {
  app.shortcut(
    'grr_shortcut',
    async () => {},
    async ({ context, payload }) => {
      const message =
        payload.type === 'message_action' ? payload.message.text : undefined
      await context.client.views.open({
        trigger_id: payload.trigger_id,
        view: buildGrrModal(context.channelId, message),
      })
    },
  )
}
