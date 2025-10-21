import type {
  ButtonAction,
  MessageBlockAction,
  SlackApp,
  SlackAppContext,
  SlackEdgeAppEnv,
} from 'slack-cloudflare-workers'
import dayjs from '~/lib/dayjs'
import { generateDiaryReply } from '~/services/ai'
import { db } from '~/services/db'
import { DIARY_MOOD_CHOICES, DIARY_PERSONA_NAME } from '../diary-constants'

export function registerButtonActionHandlers(app: SlackApp<SlackEdgeAppEnv>) {
  // 「話を聞いてもらう」ボタン
  app.action('diary_request_support', async ({ payload, context }) => {
    const action = payload as MessageBlockAction<ButtonAction>
    const entryId = action.actions[0].value
    const userId = action.user.id

    if (!entryId || !userId) {
      console.error('Missing entryId or userId', { entryId, userId })
      return
    }

    // エントリを取得
    const entry = await db
      .selectFrom('diaryEntries')
      .selectAll()
      .where('id', '=', entryId)
      .executeTakeFirst()

    if (!entry || entry.userId !== userId) {
      console.error('Entry not found or userId mismatch', {
        entryId,
        userId,
        entry,
      })
      return
    }

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
      personaName: DIARY_PERSONA_NAME,
      userId,
      moodLabel: entry.moodLabel ?? null,
      latestEntry: entry.detail ?? null,
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
    ],
  })
}
