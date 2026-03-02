import { nanoid } from 'nanoid'
import type {
  ButtonAction,
  MessageBlockAction,
  SlackApp,
  SlackAppContext,
  SlackEdgeAppEnv,
} from 'slack-cloudflare-workers'
import dayjs from '~/lib/dayjs'
import { db } from '~/services/db'
import { clearReengagementHistory } from '~/services/proactive-messages'
import { DIARY_MOOD_CHOICES } from '../diary-constants'

export function registerButtonActionHandlers(app: SlackApp<SlackEdgeAppEnv>) {
  // クイック気分ボタン: ほっと安心
  app.action('diary_quick_mood_good', async ({ payload, context }) => {
    await handleQuickMoodAction(
      payload as MessageBlockAction<ButtonAction>,
      context,
      'smile',
    )
  })

  // クイック気分ボタン: ふつうの日
  app.action('diary_quick_mood_normal', async ({ payload, context }) => {
    await handleQuickMoodAction(
      payload as MessageBlockAction<ButtonAction>,
      context,
      'neutral_face',
    )
  })

  // クイック気分ボタン: おつかれさま
  app.action('diary_quick_mood_tired', async ({ payload, context }) => {
    await handleQuickMoodAction(
      payload as MessageBlockAction<ButtonAction>,
      context,
      'tired_face',
    )
  })

  // 今日はスキップボタン
  app.action('diary_skip_today', async ({ payload, context }) => {
    const action = payload as MessageBlockAction<ButtonAction>
    const userId = action.user.id
    const entryDate = action.actions[0].value

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

  // リエンゲージメントから日記を再開
  app.action('diary_resume_from_reengagement', async ({ payload, context }) => {
    const action = payload as MessageBlockAction<ButtonAction>
    const userId = action.user.id
    const channelId = action.channel?.id
    const entryDate = action.actions[0].value

    if (!channelId) return

    // 今日のエントリがあるか確認
    const existingEntry = await db
      .selectFrom('diaryEntries')
      .select(['id', 'moodRecordedAt'])
      .where('userId', '=', userId)
      .where('entryDate', '=', entryDate)
      .executeTakeFirst()

    // 既に気分を記録済みの場合はメッセージのみ更新
    if (existingEntry?.moodRecordedAt) {
      await context.client.chat.update({
        channel: channelId,
        ts: action.message?.ts,
        text: 'おかえり！今日はもう日記を書いてくれていたね。',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `<@${userId}> おかえり！今日はもう日記を書いてくれていたね。`,
            },
          },
        ],
      })
      return
    }

    // エントリがなければ作成
    if (!existingEntry) {
      await ensureDiaryEntryExists(
        userId,
        channelId,
        entryDate,
        action.message?.ts ?? '',
      )
    }

    // メッセージを気分選択ボタン付きで更新
    await context.client.chat.update({
      channel: channelId,
      ts: action.message?.ts,
      text: 'おかえり！今日の気分を教えてね。',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `<@${userId}> おかえり！今日の気分を教えてね。`,
          },
        },
        buildMoodSelectionActionsBlock(entryDate),
      ],
    })
  })

  // リマインダーを一時停止
  app.action('diary_pause_reminders', async ({ payload, context }) => {
    const action = payload as MessageBlockAction<ButtonAction>
    const userId = action.user.id
    const channelId = action.channel?.id

    if (!channelId) return

    const now = dayjs().utc().toISOString()

    // リマインダーを無効化
    await db
      .updateTable('userDiarySettings')
      .set({
        reminderEnabled: 0,
        updatedAt: now,
      })
      .where('userId', '=', userId)
      .execute()

    // メッセージを更新
    await context.client.chat.update({
      channel: channelId,
      ts: action.message?.ts,
      text: 'リマインダーをお休みしました。また書きたくなったらいつでも戻ってきてね！',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `<@${userId}> リマインダーをお休みしました。また書きたくなったらいつでも戻ってきてね！\n\n_再開するには \`/grr設定\` からできるよ_`,
          },
        },
      ],
    })
  })

  // 自動停止後にリマインダーを再開
  app.action('diary_restart_after_pause', async ({ payload, context }) => {
    const action = payload as MessageBlockAction<ButtonAction>
    const userId = action.user.id
    const channelId = action.channel?.id
    const entryDate = action.actions[0].value

    if (!channelId) return

    const now = dayjs().utc().toISOString()

    // リマインダーを再度有効化
    await db
      .updateTable('userDiarySettings')
      .set({
        reminderEnabled: 1,
        updatedAt: now,
      })
      .where('userId', '=', userId)
      .execute()

    // リエンゲージメント履歴をクリア（カウントリセット）
    await clearReengagementHistory(userId)

    // 今日のエントリを作成
    await ensureDiaryEntryExists(
      userId,
      channelId,
      entryDate,
      action.message?.ts ?? '',
    )

    // メッセージを気分選択ボタン付きで更新
    await context.client.chat.update({
      channel: channelId,
      ts: action.message?.ts,
      text: 'おかえりなさい！また一緒に日記を書いていこうね。今日の気分を教えてね。',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `<@${userId}> おかえりなさい！また一緒に日記を書いていこうね。今日の気分を教えてね。`,
          },
        },
        buildMoodSelectionActionsBlock(entryDate),
      ],
    })
  })
}

async function handleQuickMoodAction(
  action: MessageBlockAction<ButtonAction>,
  context: SlackAppContext,
  moodReaction: string,
) {
  const userId = action.user.id
  const entryDate = action.actions[0].value

  // 気分の詳細を取得
  const moodChoice = DIARY_MOOD_CHOICES.find((c) => c.reaction === moodReaction)
  if (!moodChoice) {
    return
  }

  const now = dayjs().utc().toISOString()
  const formattedEntryDate = dayjs(entryDate).format('YYYY年M月D日(ddd)')

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

  const streakCount = await calculateMoodStreak(userId, entryDate)

  const messageLines = [
    `<@${userId}> ${formattedEntryDate}の気分「${moodChoice.emoji} ${moodChoice.label}」を記録しました！`,
  ]
  const fallbackLines = [
    `${formattedEntryDate}の気分「${moodChoice.label}」を記録しました！`,
  ]

  if (streakCount >= 2) {
    messageLines.push(`これで${streakCount}日連続で記録できています。`)
    fallbackLines.push(`これで${streakCount}日連続で記録できています。`)
  }

  messageLines.push('スレッドに返信して詳細を追加できます。')
  fallbackLines.push('スレッドに返信して詳細を追加できます。')

  const responseText = messageLines.join('\n')
  const fallbackText = fallbackLines.join('\n')

  // メッセージを更新して記録完了を表示
  await context.client.chat.update({
    channel: action.channel?.id,
    ts: action.message?.ts,
    text: fallbackText,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: responseText,
        },
      },
    ],
  })
}

// biome-ignore lint/suspicious/noExplicitAny: Slack Block Kit dynamic types
function buildMoodSelectionActionsBlock(entryDate: string): any {
  return {
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: '😄 ほっと安心', emoji: true },
        action_id: 'diary_quick_mood_good',
        value: entryDate,
        style: 'primary',
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '😐 ふつうの日', emoji: true },
        action_id: 'diary_quick_mood_normal',
        value: entryDate,
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '😫 おつかれさま', emoji: true },
        action_id: 'diary_quick_mood_tired',
        value: entryDate,
      },
    ],
  }
}

async function ensureDiaryEntryExists(
  userId: string,
  channelId: string,
  entryDate: string,
  messageTs: string,
): Promise<void> {
  const existing = await db
    .selectFrom('diaryEntries')
    .select('id')
    .where('userId', '=', userId)
    .where('entryDate', '=', entryDate)
    .executeTakeFirst()

  if (existing) return

  const now = dayjs().utc().toISOString()
  await db
    .insertInto('diaryEntries')
    .values({
      id: nanoid(),
      userId,
      channelId,
      messageTs,
      entryDate,
      moodEmoji: null,
      moodValue: null,
      moodLabel: null,
      detail: null,
      reminderSentAt: now,
      moodRecordedAt: null,
      detailRecordedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .execute()
}

async function calculateMoodStreak(userId: string, entryDate: string) {
  const rows = await db
    .selectFrom('diaryEntries')
    .select(['entryDate', 'moodRecordedAt'])
    .where('userId', '=', userId)
    .where('entryDate', '<=', entryDate)
    .orderBy('entryDate', 'desc')
    .limit(30)
    .execute()

  let streak = 0
  let expectedDate = dayjs(entryDate)

  for (const row of rows) {
    const expectedDateString = expectedDate.format('YYYY-MM-DD')

    if (row.entryDate !== expectedDateString) {
      break
    }

    if (!row.moodRecordedAt) {
      break
    }

    streak += 1
    expectedDate = expectedDate.subtract(1, 'day')
  }

  return streak
}
