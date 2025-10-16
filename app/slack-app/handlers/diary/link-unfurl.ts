import type { SlackApp, SlackEdgeAppEnv } from 'slack-cloudflare-workers'
import dayjs from '~/lib/dayjs'
import { db } from '~/services/db'

/**
 * 日記リンクの展開ハンドラー
 * diary://YYYY-MM-DD 形式のリンクを展開
 */
export function registerLinkUnfurlHandler(app: SlackApp<SlackEdgeAppEnv>) {
  app.event('link_shared', async ({ payload, context }) => {
    const event = payload

    // biome-ignore lint/suspicious/noExplicitAny: dynamic unfurl structure
    const unfurls: Record<string, any> = {}

    for (const link of event.links) {
      // diary://YYYY-MM-DD 形式のリンクをチェック
      const match = link.url.match(/^diary:\/\/(\d{4}-\d{2}-\d{2})$/)
      if (!match) continue

      const entryDate = match[1]
      const userId = event.user

      // エントリを取得
      const entry = await db
        .selectFrom('diaryEntries')
        .selectAll()
        .where('userId', '=', userId)
        .where('entryDate', '=', entryDate)
        .executeTakeFirst()

      if (!entry) {
        unfurls[link.url] = {
          color: '#cccccc',
          title: '日記エントリ',
          text: `${entryDate} の日記は見つかりませんでした`,
        }
        continue
      }

      const date = dayjs(entry.entryDate).format('YYYY年M月D日(ddd)')
      const mood = entry.moodLabel || '未記録'
      const moodEmoji = entry.moodEmoji || '😶'
      const detail = entry.detail
        ? entry.detail.length > 200
          ? `${entry.detail.slice(0, 200)}...`
          : entry.detail
        : '_詳細なし_'

      unfurls[link.url] = {
        color: '#4A90E2',
        title: `📔 ${date} の日記`,
        text: `${moodEmoji} *${mood}*\n\n${detail}`,
        footer: 'ほたるの日記',
        ts: dayjs(entry.createdAt).unix(),
      }
    }

    if (Object.keys(unfurls).length > 0) {
      await context.client.chat.unfurl({
        channel: event.channel,
        ts: event.message_ts,
        unfurls,
      })
    }
  })
}
