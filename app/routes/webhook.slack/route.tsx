import { createSlackApp } from '~/slack-app/app'
import type { Route } from './+types/route'

export const action = ({ request, context }: Route.ActionArgs) => {
  const slackApp = createSlackApp()
  return slackApp.run(request, context.cloudflare.ctx)
}
