import type { SlackApp, SlackEdgeAppEnv } from 'slack-cloudflare-workers'

export const registerAppMentionHandler = (app: SlackApp<SlackEdgeAppEnv>) => {
  app.event('app_mention', async ({ context, payload }) => {
    console.log('app_mention', { payload })
    await context.say({
      text: `<@${context.userId}> さん、何かご用ですか？`,
    })
  })
}
