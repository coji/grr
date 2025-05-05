import { env } from 'cloudflare:workers'
import {
  SlackApp,
  type SlackAppLogLevel,
  type SlackEdgeAppEnv,
} from 'slack-cloudflare-workers'
import { registerGrrHandlers } from './handlers/grr'

export function createSlackApp() {
  const app = new SlackApp<SlackEdgeAppEnv>({
    env: {
      ...env,
      SLACK_LOGGING_LEVEL: env.SLACK_LOGGING_LEVEL as SlackAppLogLevel,
    },
  })

  registerHandlers(app)
  return app
}

function registerHandlers(app: SlackApp<SlackEdgeAppEnv>) {
  registerGrrHandlers(app)
}
