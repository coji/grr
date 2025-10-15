import type { SlackApp, SlackEdgeAppEnv } from 'slack-cloudflare-workers'
import { registerAppMentionHandler } from './app-mention'
import { registerMessageHandler } from './message'
import { registerReactionAddedHandler } from './reaction-added'
import { registerReactionRemovedHandler } from './reaction-removed'

export const registerDiaryHandlers = (app: SlackApp<SlackEdgeAppEnv>) => {
  registerReactionAddedHandler(app)
  registerReactionRemovedHandler(app)
  registerMessageHandler(app)
  registerAppMentionHandler(app)
}
