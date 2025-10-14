import {
  SlackApp,
  type SlackAppLogLevel,
  type SlackEdgeAppEnv,
} from 'slack-cloudflare-workers'
import { registerDiaryHandlers } from './handlers/diary'
import { registerGrrHandlers } from './handlers/grr'

export function createSlackApp(bindings: Env) {
  const appEnv: SlackEdgeAppEnv = {
    ...bindings,
    SLACK_LOGGING_LEVEL:
      (bindings.SLACK_LOGGING_LEVEL as SlackAppLogLevel | undefined) ?? 'INFO',
  }

  const app = new SlackApp<SlackEdgeAppEnv>({
    env: appEnv,
  })

  registerHandlers(app)
  return app
}

function registerHandlers(app: SlackApp<SlackEdgeAppEnv>) {
  registerDiaryHandlers(app)
  registerGrrHandlers(app)
}
