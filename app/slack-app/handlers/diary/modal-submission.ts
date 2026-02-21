import { nanoid } from 'nanoid'
import type { SlackApp, SlackEdgeAppEnv } from 'slack-cloudflare-workers'
import dayjs from '~/lib/dayjs'
import { db } from '~/services/db'
import { DIARY_MOOD_CHOICES } from '../diary-constants'

export function registerModalSubmissionHandlers(
  app: SlackApp<SlackEdgeAppEnv>,
) {
  // 日記エントリモーダルの送信処理
  app.view('diary_entry_modal', async ({ payload }) => {
    const values = payload.view.state.values

    const entryDate = values.entry_date.date_value.selected_date
    const moodValue = values.mood.mood_value.selected_option?.value
    const detail = values.detail.detail_value.value

    const errors: Record<string, string> = {}
    if (!entryDate) {
      errors.entry_date = '日付を選択してください'
    }
    if (!moodValue) {
      errors.mood = '気分を選択してください'
    }
    if (Object.keys(errors).length > 0) {
      return {
        response_action: 'errors',
        errors,
      }
    }

    const userId = payload.user.id
    const now = dayjs().utc().toISOString()

    // 気分の詳細を取得
    const moodChoice = DIARY_MOOD_CHOICES.find(
      (choice: { reaction: string }) => choice.reaction === moodValue,
    )
    if (!moodChoice) {
      throw new Error('Invalid mood value')
    }

    // 既存のエントリを確認
    const existingEntry = entryDate
      ? await db
          .selectFrom('diaryEntries')
          .selectAll()
          .where('userId', '=', userId)
          .where('entryDate', '=', entryDate)
          .executeTakeFirst()
      : null

    if (existingEntry) {
      // 既存エントリを更新
      await db
        .updateTable('diaryEntries')
        .set({
          moodEmoji: moodChoice.reaction,
          moodValue: moodChoice.value,
          moodLabel: moodChoice.label,
          detail: detail || null,
          moodRecordedAt: now,
          detailRecordedAt: detail ? now : null,
          updatedAt: now,
        })
        .where('id', '=', existingEntry.id)
        .execute()
    } else {
      // 新規エントリを作成
      const channelId = await getUserDiaryChannel(userId)

      if (!entryDate) {
        throw new Error('Entry date is required')
      }

      await db
        .insertInto('diaryEntries')
        .values({
          id: nanoid(),
          userId,
          channelId,
          messageTs: `home_tab_${Date.now()}`,
          entryDate,
          moodEmoji: moodChoice.reaction,
          moodValue: moodChoice.value,
          moodLabel: moodChoice.label,
          detail: detail || null,
          reminderSentAt: now,
          moodRecordedAt: now,
          detailRecordedAt: detail ? now : null,
          createdAt: now,
          updatedAt: now,
        })
        .execute()
    }

    // Home Tab を更新するために app_home_opened イベントをトリガー
    // （実際にはユーザーが Home Tab を再訪問したときに更新される）

    return {
      response_action: 'clear',
    }
  })

  // 設定モーダルの送信処理
  app.view('diary_settings_modal', async ({ payload }) => {
    const values = payload.view.state.values

    const reminderEnabled =
      values.reminder_enabled.reminder_enabled_value.selected_option?.value ===
      '1'
        ? 1
        : 0
    const reminderHour = Number(
      values.reminder_hour.reminder_hour_value.selected_option?.value || 13,
    )
    const skipWeekends =
      (values.skip_weekends.skip_weekends_value.selected_options?.length ?? 0) >
      0
        ? 1
        : 0

    const userId = payload.user.id
    const now = dayjs().utc().toISOString()

    // 既存の設定を確認
    const existingSettings = await db
      .selectFrom('userDiarySettings')
      .selectAll()
      .where('userId', '=', userId)
      .executeTakeFirst()

    if (existingSettings) {
      // 設定を更新
      await db
        .updateTable('userDiarySettings')
        .set({
          reminderEnabled,
          reminderHour,
          skipWeekends,
          updatedAt: now,
        })
        .where('userId', '=', userId)
        .execute()
    } else {
      // 新規設定を作成
      await db
        .insertInto('userDiarySettings')
        .values({
          userId,
          reminderEnabled,
          reminderHour,
          skipWeekends,
          diaryChannelId: null,
          personalityChangePending: 0,
          createdAt: now,
          updatedAt: now,
        })
        .execute()
    }

    return {
      response_action: 'clear',
    }
  })
}

/**
 * ユーザーの日記チャンネルIDを取得（存在しない場合はDMを開く）
 */
async function getUserDiaryChannel(userId: string): Promise<string> {
  // 既存の設定からチャンネルIDを取得
  const settings = await db
    .selectFrom('userDiarySettings')
    .select('diaryChannelId')
    .where('userId', '=', userId)
    .executeTakeFirst()

  if (settings?.diaryChannelId) {
    return settings.diaryChannelId
  }

  // 既存のエントリからチャンネルIDを取得
  const existingEntry = await db
    .selectFrom('diaryEntries')
    .select('channelId')
    .where('userId', '=', userId)
    .executeTakeFirst()

  if (existingEntry?.channelId) {
    return existingEntry.channelId
  }

  // デフォルトとしてユーザーIDを返す（DMチャンネル）
  return userId
}
