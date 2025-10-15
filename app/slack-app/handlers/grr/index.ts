import type { SlackApp, SlackEdgeAppEnv } from 'slack-cloudflare-workers'
import { registerShortcutHandler } from './shortcut'
import { registerSlashCommandHandler } from './slash-command'
import { registerViewSubmissionHandler } from './view-submission'

export const registerGrrHandlers = (app: SlackApp<SlackEdgeAppEnv>) => {
  registerSlashCommandHandler(app)
  registerShortcutHandler(app)
  registerViewSubmissionHandler(app)
}
