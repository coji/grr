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
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '今日の日記を書く',
              emoji: true,
            },
            style: 'primary',
            action_id: 'open_diary_modal',
            value: today,
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '設定',
              emoji: true,
            },
            action_id: 'open_settings_modal',
          },
        ],
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

  // ボタンアクションのハンドラー
  app.action('open_diary_modal', async ({ payload, context }) => {
    const action = payload as MessageBlockAction<ButtonAction>

    await context.client.views.open({
      trigger_id: action.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'diary_entry_modal',
        title: {
          type: 'plain_text',
          text: '日記を書く',
        },
        submit: {
          type: 'plain_text',
          text: '保存',
        },
        close: {
          type: 'plain_text',
          text: 'キャンセル',
        },
        blocks: [
          {
            type: 'input',
            block_id: 'entry_date',
            label: {
              type: 'plain_text',
              text: '日付',
            },
            element: {
              type: 'datepicker',
              action_id: 'date_value',
              initial_date: action.actions[0].value,
            },
          },
          {
            type: 'input',
            block_id: 'mood',
            label: {
              type: 'plain_text',
              text: '今日の気分',
            },
            element: {
              type: 'static_select',
              action_id: 'mood_value',
              placeholder: {
                type: 'plain_text',
                text: '気分を選択',
              },
              options: [
                {
                  text: {
                    type: 'plain_text',
                    text: '😄 ほっと安心',
                    emoji: true,
                  },
                  value: 'smile',
                },
                {
                  text: {
                    type: 'plain_text',
                    text: '😐 ふつうの日',
                    emoji: true,
                  },
                  value: 'neutral_face',
                },
                {
                  text: {
                    type: 'plain_text',
                    text: '😫 おつかれさま',
                    emoji: true,
                  },
                  value: 'tired_face',
                },
              ],
            },
          },
          {
            type: 'input',
            block_id: 'detail',
            label: {
              type: 'plain_text',
              text: '詳細',
            },
            element: {
              type: 'plain_text_input',
              action_id: 'detail_value',
              multiline: true,
              placeholder: {
                type: 'plain_text',
                text: '今日あったこと、感じたことを自由に書いてください',
              },
            },
            optional: true,
          },
        ],
      },
    })
  })

  app.action('open_settings_modal', async ({ payload, context }) => {
    const action = payload as MessageBlockAction<ButtonAction>
    const userId = action.user.id

    // 現在の設定を取得
    const settings = await db
      .selectFrom('userDiarySettings')
      .selectAll()
      .where('userId', '=', userId)
      .executeTakeFirst()

    const reminderHour = settings?.reminderHour ?? 13
    const reminderEnabled = settings?.reminderEnabled ?? 1
    const skipWeekends = settings?.skipWeekends ?? 0

    await context.client.views.open({
      trigger_id: action.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'diary_settings_modal',
        title: {
          type: 'plain_text',
          text: '日記設定',
        },
        submit: {
          type: 'plain_text',
          text: '保存',
        },
        close: {
          type: 'plain_text',
          text: 'キャンセル',
        },
        blocks: [
          {
            type: 'input',
            block_id: 'reminder_enabled',
            label: {
              type: 'plain_text',
              text: 'リマインダー',
            },
            element: {
              type: 'radio_buttons',
              action_id: 'reminder_enabled_value',
              initial_option: {
                text: {
                  type: 'plain_text',
                  text: reminderEnabled ? '有効' : '無効',
                },
                value: reminderEnabled.toString(),
              },
              options: [
                {
                  text: {
                    type: 'plain_text',
                    text: '有効',
                  },
                  value: '1',
                },
                {
                  text: {
                    type: 'plain_text',
                    text: '無効',
                  },
                  value: '0',
                },
              ],
            },
          },
          {
            type: 'input',
            block_id: 'reminder_hour',
            label: {
              type: 'plain_text',
              text: 'リマインダー時刻',
            },
            element: {
              type: 'static_select',
              action_id: 'reminder_hour_value',
              initial_option: {
                text: {
                  type: 'plain_text',
                  text: `${reminderHour}:00`,
                },
                value: reminderHour.toString(),
              },
              options: Array.from({ length: 24 }, (_, i) => ({
                text: {
                  type: 'plain_text',
                  text: `${i}:00`,
                },
                value: i.toString(),
              })),
            },
          },
          {
            type: 'input',
            block_id: 'skip_weekends',
            label: {
              type: 'plain_text',
              text: '週末スキップ',
            },
            element: {
              type: 'checkboxes',
              action_id: 'skip_weekends_value',
              initial_options: skipWeekends
                ? [
                    {
                      text: {
                        type: 'plain_text',
                        text: '土日はリマインダーを送らない',
                      },
                      value: '1',
                    },
                  ]
                : [],
              options: [
                {
                  text: {
                    type: 'plain_text',
                    text: '土日はリマインダーを送らない',
                  },
                  value: '1',
                },
              ],
            },
          },
        ],
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
