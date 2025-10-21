import type {
  ButtonAction,
  MessageBlockAction,
  SlackApp,
  SlackEdgeAppEnv,
} from 'slack-cloudflare-workers'
import dayjs from '~/lib/dayjs'
import { db } from '~/services/db'
import { TOKYO_TZ } from './utils'

export function registerHomeTabHandler(app: SlackApp<SlackEdgeAppEnv>) {
  app.event('app_home_opened', async ({ payload, context }) => {
    const event = payload
    if (event.tab !== 'home') return

    const userId = event.user

    // 今日の日付
    const today = dayjs().tz(TOKYO_TZ).format('YYYY-MM-DD')

    // 最近7日分のエントリを取得
    const recentEntries = await db
      .selectFrom('diaryEntries')
      .selectAll()
      .where('userId', '=', userId)
      .orderBy('entryDate', 'desc')
      .limit(7)
      .execute()

    // 今週の気分統計
    const weekStart = dayjs().tz(TOKYO_TZ).startOf('week').format('YYYY-MM-DD')
    const weekEntries = recentEntries.filter(
      (entry) => entry.entryDate >= weekStart,
    )

    const moodCounts = weekEntries.reduce(
      (acc, entry) => {
        if (entry.moodValue) {
          acc[entry.moodValue] = (acc[entry.moodValue] || 0) + 1
        }
        return acc
      },
      {} as Record<number, number>,
    )

    const moodStats =
      Object.keys(moodCounts).length > 0
        ? Object.entries(moodCounts)
            .map(([value, count]) => {
              const label =
                value === '3'
                  ? 'ほっと安心'
                  : value === '2'
                    ? 'ふつうの日'
                    : 'おつかれさま'
              return `${label}: ${count}日`
            })
            .join(' | ')
        : '今週はまだ記録がありません'

    // Home Tab のビューを構築
    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '📔 あなたの日記',
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `こんにちは！\n今週の気分: ${moodStats}`,
        },
      },
      {
        type: 'divider',
      },
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '最近のエントリ',
          emoji: true,
        },
      },
    ]

    // 最近のエントリをリスト表示
    if (recentEntries.length === 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '_まだエントリがありません。日記を書き始めましょう！_',
        },
      })
    } else {
      for (const entry of recentEntries) {
        const date = dayjs(entry.entryDate).format('M月D日(ddd)')
        const mood = entry.moodEmoji || '😶'
        const preview =
          entry.detail && entry.detail.length > 100
            ? `${entry.detail.slice(0, 100)}...`
            : entry.detail || '_詳細なし_'

        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${date} ${mood}*\n${preview}`,
          },
        })
        blocks.push({
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: '見る',
                emoji: true,
              },
              action_id: 'view_diary_entry',
              value: entry.id,
              style: 'primary',
            },
          ],
        })
      }
    }

    await context.client.views.publish({
      user_id: userId,
      view: {
        type: 'home',
        // biome-ignore lint/suspicious/noExplicitAny: dynamic block types
        blocks: blocks as any,
      },
    })
  })

  app.action('view_diary_entry', async ({ payload, context }) => {
    const action = payload as MessageBlockAction<ButtonAction>
    const entryId = action.actions[0].value

    const entry = await db
      .selectFrom('diaryEntries')
      .selectAll()
      .where('id', '=', entryId)
      .executeTakeFirst()

    if (!entry) return

    const date = dayjs(entry.entryDate).format('YYYY年M月D日(ddd)')
    const mood = entry.moodLabel || '未記録'
    const detail = entry.detail || '_詳細なし_'

    await context.client.views.open({
      trigger_id: action.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'view_diary_entry_modal',
        title: {
          type: 'plain_text',
          text: '日記を見る',
        },
        close: {
          type: 'plain_text',
          text: '閉じる',
        },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*日付:* ${date}\n*気分:* ${mood}\n\n${detail}`,
            },
          },
        ],
      },
    })
  })
}
