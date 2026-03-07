import { nanoid } from 'nanoid'
import type {
  GlobalShortcut,
  MessageShortcut,
  SlackApp,
  SlackEdgeAppEnv,
} from 'slack-cloudflare-workers'
import dayjs from '~/lib/dayjs'
import { db } from '~/services/db'
import { indexDiaryEntry, updateDiaryEntryIndex } from '~/services/diary-search'
import { TOKYO_TZ } from './utils'

export function registerShortcutsHandler(app: SlackApp<SlackEdgeAppEnv>) {
  // メッセージショートカット: メッセージを日記に追加
  app.shortcut('add_to_diary', async ({ payload, context }) => {
    const shortcut = payload as MessageShortcut
    const userId = shortcut.user.id
    const messageText = shortcut.message.text || ''
    const today = dayjs().tz(TOKYO_TZ).format('YYYY-MM-DD')

    // 既存のエントリを取得
    const entry = await db
      .selectFrom('diaryEntries')
      .selectAll()
      .where('userId', '=', userId)
      .where('entryDate', '=', today)
      .executeTakeFirst()

    const now = dayjs().utc().toISOString()

    if (entry) {
      // 既存のエントリに追加
      const newDetail = entry.detail
        ? `${entry.detail}\n\n[引用]\n${messageText}`
        : `[引用]\n${messageText}`

      await db
        .updateTable('diaryEntries')
        .set({
          detail: newDetail,
          detailRecordedAt: now,
          updatedAt: now,
        })
        .where('id', '=', entry.id)
        .execute()
      await updateDiaryEntryIndex(entry.id, userId, today, newDetail)
    } else {
      // 新規エントリを作成
      const channelId = shortcut.channel.id
      const entryId = nanoid()
      const detail = `[引用]\n${messageText}`

      await db
        .insertInto('diaryEntries')
        .values({
          id: entryId,
          userId,
          channelId,
          messageTs: `shortcut_${Date.now()}`,
          entryDate: today,
          moodEmoji: null,
          moodValue: null,
          moodLabel: null,
          detail,
          reminderSentAt: now,
          moodRecordedAt: null,
          detailRecordedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .execute()
      await indexDiaryEntry(entryId, userId, today, detail)
    }

    // 完了メッセージを表示
    await context.client.chat.postEphemeral({
      channel: shortcut.channel.id,
      user: userId,
      text: '日記に追加しました！',
    })
  })

  // グローバルショートカット: 日記を書く
  app.shortcut('write_diary', async ({ payload, context }) => {
    const shortcut = payload as GlobalShortcut
    const today = dayjs().tz(TOKYO_TZ).format('YYYY-MM-DD')

    await context.client.views.open({
      trigger_id: shortcut.trigger_id,
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
              initial_date: today,
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
}
