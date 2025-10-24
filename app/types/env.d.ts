import type { SlackAppLogLevel } from 'slack-cloudflare-workers'

declare global {
  interface Env {
    SLACK_SIGNING_SECRET: string
    SLACK_BOT_TOKEN: string
    SLACK_LOGGING_LEVEL?: SlackAppLogLevel
    GOOGLE_GENERATIVE_AI_API_KEY: string
  }
}

export {}
