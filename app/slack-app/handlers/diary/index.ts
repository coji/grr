import type { SlackApp, SlackEdgeAppEnv } from 'slack-cloudflare-workers'
import { registerAppMentionHandler } from './app-mention'
import { registerButtonActionHandlers } from './button-actions'
import { registerHomeTabHandler } from './home-tab'
import { registerLinkUnfurlHandler } from './link-unfurl'
import { registerMessageHandler } from './message'
import { registerModalSubmissionHandlers } from './modal-submission'
import { registerOnboardingHandlers } from './onboarding'
import { registerReactionAddedHandler } from './reaction-added'
import { registerReactionRemovedHandler } from './reaction-removed'
import { registerShortcutsHandler } from './shortcuts'
import { registerSlashCommandHandler } from './slash-command'
import { registerSocialActionHandlers } from './social-actions'

export const registerDiaryHandlers = (app: SlackApp<SlackEdgeAppEnv>) => {
  registerReactionAddedHandler(app)
  registerReactionRemovedHandler(app)
  registerMessageHandler(app)
  registerAppMentionHandler(app)
  registerHomeTabHandler(app)
  registerModalSubmissionHandlers(app)
  registerOnboardingHandlers(app)
  registerSlashCommandHandler(app)
  registerShortcutsHandler(app)
  registerButtonActionHandlers(app)
  registerLinkUnfurlHandler(app)
  registerSocialActionHandlers(app)
}
