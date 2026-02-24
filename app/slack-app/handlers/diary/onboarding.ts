import type {
  AnyHomeTabBlock,
  ButtonAction,
  MessageBlockAction,
  SlackApp,
  SlackEdgeAppEnv,
} from 'slack-cloudflare-workers'
import dayjs from '~/lib/dayjs'
import { db } from '~/services/db'

/**
 * オンボーディング用の Home Tab ブロックを構築
 */
export function buildOnboardingBlocks(): AnyHomeTabBlock[] {
  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '📔 ようこそ！Hotaru Diary へ',
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'こんにちは！私は *ほたる* 🌸\nあなたの毎日に寄り添う日記アシスタントです。',
      },
    },
    {
      type: 'divider',
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*✨ ほたるができること*',
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '📝 *日記を記録*\n毎日の出来事や気持ちを、チャットするように記録できます。画像や動画も添付OK！',
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '💬 *温かいお返事*\nあなたの日記を読んで、共感したり、ちょっとしたコメントを返します。',
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '🐣 *キャラクターが育つ*\n日記を続けると、あなただけのキャラクターが成長していきます！',
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '🔒 *プライベート空間*\n専用チャンネルで、誰にも見られない安心な場所で日記が書けます。',
      },
    },
    {
      type: 'divider',
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*🚀 はじめよう！*\n\n日記を始めるには、専用のプライベートチャンネルを作成します。\nチャンネル名は後から変更できるので、気軽に決めてね！',
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '🎉 日記チャンネルを作成する',
            emoji: true,
          },
          style: 'primary',
          action_id: 'onboarding_create_channel',
        },
      ],
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: '💡 既存のチャンネルを使いたい場合は、そのチャンネルで私にメンションしてね！自動的に設定されます。',
        },
      ],
    },
  ]
}

/**
 * オンボーディングのアクションハンドラーを登録
 */
export function registerOnboardingHandlers(app: SlackApp<SlackEdgeAppEnv>) {
  // チャンネル作成ボタン
  app.action('onboarding_create_channel', async ({ payload, context }) => {
    const action = payload as MessageBlockAction<ButtonAction>

    await context.client.views.open({
      trigger_id: action.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'onboarding_channel_modal',
        title: {
          type: 'plain_text',
          text: '日記チャンネル作成',
        },
        submit: {
          type: 'plain_text',
          text: '作成する',
        },
        close: {
          type: 'plain_text',
          text: 'キャンセル',
        },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: 'あなた専用の日記チャンネルを作成します。\nプライベートチャンネルなので、他の人には見えません。',
            },
          },
          {
            type: 'input',
            block_id: 'channel_name',
            label: {
              type: 'plain_text',
              text: 'チャンネル名',
            },
            element: {
              type: 'plain_text_input',
              action_id: 'channel_name_value',
              placeholder: {
                type: 'plain_text',
                text: '例: diary-taro',
              },
              initial_value: `diary-${Date.now().toString(36)}`,
            },
            hint: {
              type: 'plain_text',
              text: '英数字、ハイフン、アンダースコアが使えます',
            },
          },
        ],
      },
    })
  })

  // チャンネル作成モーダルの送信処理
  app.view('onboarding_channel_modal', async ({ payload, context }) => {
    const values = payload.view.state.values
    const channelName =
      values.channel_name.channel_name_value.value ||
      `diary-${Date.now().toString(36)}`
    const userId = payload.user.id
    const now = dayjs().utc().toISOString()

    // チャンネル名のバリデーション（Slackの制約に従う）
    const sanitizedName = channelName
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '-')
      .replace(/--+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80)

    if (!sanitizedName) {
      return {
        response_action: 'errors' as const,
        errors: {
          channel_name: '有効なチャンネル名を入力してください',
        },
      }
    }

    try {
      // プライベートチャンネルを作成
      const createResult = await context.client.conversations.create({
        name: sanitizedName,
        is_private: true,
      })

      if (!createResult.ok || !createResult.channel?.id) {
        return {
          response_action: 'errors' as const,
          errors: {
            channel_name:
              createResult.error === 'name_taken'
                ? 'このチャンネル名は既に使われています'
                : `チャンネル作成に失敗しました: ${createResult.error}`,
          },
        }
      }

      const channelId = createResult.channel.id

      // ユーザー設定を更新または作成
      const existingSettings = await db
        .selectFrom('userDiarySettings')
        .selectAll()
        .where('userId', '=', userId)
        .executeTakeFirst()

      if (existingSettings) {
        await db
          .updateTable('userDiarySettings')
          .set({
            diaryChannelId: channelId,
            updatedAt: now,
          })
          .where('userId', '=', userId)
          .execute()
      } else {
        await db
          .insertInto('userDiarySettings')
          .values({
            userId,
            reminderEnabled: 1,
            reminderHour: 21, // デフォルトは21時
            skipWeekends: 0,
            diaryChannelId: channelId,
            personalityChangePending: 0,
            createdAt: now,
            updatedAt: now,
          })
          .execute()
      }

      // ウェルカムメッセージを投稿
      await context.client.chat.postMessage({
        channel: channelId,
        text: 'ようこそ！ここがあなたの日記スペースです 📔',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*🎉 日記チャンネルができました！*\n\nここがあなた専用の日記スペースです。\n何でも自由に書いてみてね！',
            },
          },
          {
            type: 'divider',
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*💡 使い方ヒント*\n• 私にメンションして話しかけてね（例: `@ほたる 今日はいい天気だった`）\n• 気分の絵文字リアクションで、今日の調子を記録できます\n• 画像や動画を添付すると、一緒に保存されます',
            },
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: '✨ さあ、最初の日記を書いてみましょう！',
              },
            ],
          },
        ],
      })

      // Home Tab を更新
      await updateHomeTabAfterOnboarding(userId, context.client)

      return {
        response_action: 'clear' as const,
      }
    } catch (error) {
      console.error('Failed to create channel:', error)
      return {
        response_action: 'errors' as const,
        errors: {
          channel_name:
            'チャンネル作成中にエラーが発生しました。もう一度お試しください。',
        },
      }
    }
  })
}

/**
 * オンボーディング完了後に Home Tab を更新
 */
async function updateHomeTabAfterOnboarding(
  userId: string,
  // biome-ignore lint/suspicious/noExplicitAny: Slack client type
  client: any,
): Promise<void> {
  // Home Tab にオンボーディング完了メッセージを表示
  await client.views.publish({
    user_id: userId,
    view: {
      type: 'home',
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '✨ 準備完了！',
            emoji: true,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '日記チャンネルが作成されました！\n\n早速チャンネルに行って、最初の日記を書いてみましょう 📝',
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '💡 このページを再度開くと、日記の一覧が表示されます',
            },
          ],
        },
      ],
    },
  })
}
