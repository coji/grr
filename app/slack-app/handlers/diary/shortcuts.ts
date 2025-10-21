import { nanoid } from 'nanoid'
import type {
  MessageShortcut,
  SlackApp,
  SlackEdgeAppEnv,
} from 'slack-cloudflare-workers'
import dayjs from '~/lib/dayjs'
import { db } from '~/services/db'
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
    } else {
      // 新規エントリを作成
      const channelId = shortcut.channel.id

      await db
        .insertInto('diaryEntries')
        .values({
          id: nanoid(),
          userId,
          channelId,
          messageTs: `shortcut_${Date.now()}`,
          entryDate: today,
          moodEmoji: null,
          moodValue: null,
          moodLabel: null,
          detail: `[引用]\n${messageText}`,
          reminderSentAt: now,
          moodRecordedAt: null,
          detailRecordedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .execute()
    }

    // 完了メッセージを表示
    await context.client.chat.postEphemeral({
      channel: shortcut.channel.id,
      user: userId,
      text: '日記に追加しました！',
    })
  })
}
