import { createRequestHandler } from 'react-router'
import { sendDailyDiaryReminders } from '~/slack-app/reminders'

declare module 'react-router' {
  export interface AppLoadContext {
    cloudflare: {
      env: Env
      ctx: ExecutionContext
    }
  }
}

const requestHandler = createRequestHandler(
  () => import('virtual:react-router/server-build'),
  import.meta.env.MODE,
)

export default {
  async fetch(request, env, ctx) {
    return requestHandler(request, {
      cloudflare: { env, ctx },
    })
  },
  async scheduled(_controller, env) {
    await sendDailyDiaryReminders(env)
  },
} satisfies ExportedHandler<Env>
