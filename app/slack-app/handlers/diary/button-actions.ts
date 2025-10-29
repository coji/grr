import type {
  ButtonAction,
  MessageBlockAction,
  SlackApp,
  SlackAppContext,
  SlackEdgeAppEnv,
} from 'slack-cloudflare-workers'
import dayjs from '~/lib/dayjs'
import { db } from '~/services/db'
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

  if (streakCount >= 2) {
    messageLines.push(
      `継続うれしいな〜。これで${streakCount}日連続で記録できています。`,
    )
  }

  messageLines.push('スレッドに返信して詳細を追加できます。')

  const responseText = messageLines.join('\n')

  // メッセージを更新して記録完了を表示
  await context.client.chat.update({
    channel: action.channel?.id,
    ts: action.message?.ts,
    text:
      streakCount >= 2
        ? `${formattedEntryDate}の気分「${moodChoice.label}」を記録しました！ これで${streakCount}日連続で記録できています。`
        : `${formattedEntryDate}の気分「${moodChoice.label}」を記録しました！`,
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
