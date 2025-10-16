import type { SlackApp, SlackEdgeAppEnv } from 'slack-cloudflare-workers'
import dayjs from '~/lib/dayjs'
import { generateDiaryReply } from '~/services/ai'
import { db } from '~/services/db'
import { DIARY_MOOD_CHOICES, DIARY_PERSONA_NAME } from '../diary-constants'

export function registerButtonActionHandlers(app: SlackApp<SlackEdgeAppEnv>) {
  // 「話を聞いてもらう」ボタン
  app.action('diary_request_support', async ({ payload, context }) => {
    const action = payload as any
    const entryId = action.value
    const userId = action.user?.id

    // エントリを取得
    const entry = await db
      .selectFrom('diaryEntries')
      .selectAll()
      .where('id', '=', entryId)
      .executeTakeFirst()

    if (!entry || entry.userId !== userId) return

    // 前回のエントリを取得
    const previousEntry = await db
      .selectFrom('diaryEntries')
      .selectAll()
      .where('userId', '=', userId)
      .where('entryDate', '<', entry.entryDate)
      .orderBy('entryDate', 'desc')
      .limit(1)
      .executeTakeFirst()

    // AI でフォローメッセージを生成
    const followUpMessage = await generateDiaryReply({
      env: app.env as Env,
      personaName: DIARY_PERSONA_NAME,
      userId,
      moodLabel: entry.moodLabel,
      latestEntry: entry.detail,
      previousEntry: previousEntry?.detail ?? null,
      mentionMessage: null,
    })

    // ボタンを削除してフォローメッセージに置き換え
    await context.client.chat.update({
      channel: action.channel?.id,
      ts: action.message?.ts,
      text: `<@${userId}> ${followUpMessage}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `<@${userId}> ${followUpMessage}`,
          },
        },
      ],
    })
  })

  // クイック気分ボタン: ほっと安心
  app.action('diary_quick_mood_good', async ({ payload, context }) => {
    await handleQuickMoodAction(payload as any, context, 'smile')
  })

  // クイック気分ボタン: ふつうの日
  app.action('diary_quick_mood_normal', async ({ payload, context }) => {
    await handleQuickMoodAction(payload as any, context, 'neutral_face')
  })

  // クイック気分ボタン: おつかれさま
  app.action('diary_quick_mood_tired', async ({ payload, context }) => {
    await handleQuickMoodAction(payload as any, context, 'tired_face')
  })

  // 詳細を書くボタン
  app.action('diary_open_detail_modal', async ({ payload, context }) => {
    const action = payload as any
    const entryDate = action.value

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
              initial_date: entryDate,
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

  // 今日はスキップボタン
  app.action('diary_skip_today', async ({ payload, context }) => {
    const action = payload as any
    const userId = action.user?.id
    const entryDate = action.value

    // エントリを削除（スキップマーク）
    await db
      .deleteFrom('diaryEntries')
      .where('userId', '=', userId)
      .where('entryDate', '=', entryDate)
      .execute()

    // メッセージを更新してボタンを削除
    await context.client.chat.update({
      channel: action.channel?.id,
      ts: action.message?.ts,
      text: '今日の日記はスキップしました。また明日！',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `<@${userId}> 今日の日記はスキップしました。また明日！`,
          },
        },
      ],
    })
  })
}

async function handleQuickMoodAction(
  action: any,
  context: any,
  moodReaction: string,
) {
  const userId = action.user?.id
  const entryDate = action.value

  // 気分の詳細を取得
  const moodChoice = DIARY_MOOD_CHOICES.find((c) => c.reaction === moodReaction)
  if (!moodChoice) {
    await context.ack()
    return
  }

  const now = dayjs().utc().toISOString()

  // エントリを更新
  await db
    .updateTable('diaryEntries')
    .set({
      moodEmoji: moodChoice.reaction,
      moodValue: moodChoice.value,
      moodLabel: moodChoice.label,
      moodRecordedAt: now,
      updatedAt: now,
    })
    .where('userId', '=', userId)
    .where('entryDate', '=', entryDate)
    .execute()

  // メッセージを更新して記録完了を表示
  await context.client.chat.update({
    channel: action.channel?.id,
    ts: action.message?.ts,
    text: `気分「${moodChoice.label}」を記録しました！`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `<@${userId}> 気分「${moodChoice.emoji} ${moodChoice.label}」を記録しました！\nスレッドに返信して詳細を追加できます。`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '詳細を書く',
              emoji: true,
            },
            action_id: 'diary_open_detail_modal',
            value: entryDate,
            style: 'primary',
          },
        ],
      },
    ],
  })
}
