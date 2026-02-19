import { createRequestHandler } from 'react-router'
import { generateDailyDiaryReflections } from '~/slack-app/daily-reflection'
import { sendMonthlyReport } from '~/slack-app/monthly-report'
import { sendDailyDiaryReminders } from '~/slack-app/reminders'
import { heartbeatFollowups } from '~/slack-app/send-followup-reminders'
import { sendWeeklyDigest } from '~/slack-app/weekly-digest'
import { AiDiaryReplyWorkflow } from '~/workflows/ai-diary-reply'

export { AiDiaryReplyWorkflow }

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
  async scheduled(controller, env) {
    // 毎日13時(UTC) = JST 22時: 日記リマインダー
    if (controller.cron === '0 13 * * *') {
      await sendDailyDiaryReminders(env)
    }

    // 毎日15時(UTC) = JST 0時: 前日分のふりかえり生成
    if (controller.cron === '0 15 * * *') {
      await generateDailyDiaryReflections()
    }

    // 毎週土曜日1時(UTC) = JST 10時: 週次ダイジェスト
    if (controller.cron === '0 1 * * 6') {
      await sendWeeklyDigest(env)
    }

    // 3時間ごと: HEARTBEAT - フォローアップの評価と送信
    // 9-21時JST以外は自動でスリープする
    if (controller.cron === '0 */3 * * *') {
      await heartbeatFollowups(env)
      // 月次レポート (月初1-7日の土曜日のみ実行される)
      await sendMonthlyReport(env)
    }
  },
} satisfies ExportedHandler<Env>
