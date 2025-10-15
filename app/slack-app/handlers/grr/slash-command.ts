import type { SlackApp, SlackEdgeAppEnv } from 'slack-cloudflare-workers'
import { buildGrrModal } from './views/grr-modal'

export function registerSlashCommandHandler(app: SlackApp<SlackEdgeAppEnv>) {
  app.command(
    '/grr',
    async () => {},
    async ({ context, payload }) => {
      await context.client.views.open({
        trigger_id: payload.trigger_id,
        view: buildGrrModal(payload.channel_id, payload.text),
      })
    },
  )
}
