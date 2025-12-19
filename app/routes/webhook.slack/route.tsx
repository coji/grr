import { env } from 'cloudflare:workers'
import { createSlackApp } from '~/slack-app/app'
import type { Route } from './+types/route'

export const action = ({ request, context }: Route.ActionArgs) => {
  const slackApp = createSlackApp(env)
  return slackApp.run(request, context.cloudflare.ctx)
}
