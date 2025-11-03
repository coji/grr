import { env } from 'cloudflare:workers'
import { nanoid } from 'nanoid'
import type { SlackApp, SlackEdgeAppEnv } from 'slack-cloudflare-workers'
import { SlackAPIError } from 'slack-edge'
import dayjs from '~/lib/dayjs'
import { generateDiaryReply, generateSupportiveReaction } from '~/services/ai'
import type { ImageAttachment } from '~/services/ai/diary-reply'
import { getEntryAttachments, storeAttachments } from '~/services/attachments'
import { db } from '~/services/db'
import { downloadSlackFiles } from '~/services/slack-file-downloader'
import { DIARY_PERSONA_NAME, SUPPORTIVE_REACTIONS } from '../diary-constants'
import { filterSupportedFiles, type SlackFile } from './file-utils'
import { TOKYO_TZ, sanitizeText } from './utils'

export function registerAppMentionHandler(app: SlackApp<SlackEdgeAppEnv>) {
  app.event('app_mention', async ({ payload, context }) => {
    const event = payload
    if (!event.user) return

    // 処理中であることを控えめに伝える
    await context.client.reactions
      .add({
        channel: event.channel,
        timestamp: event.ts,
        name: 'eyes',
      })
      .catch(() => {}) // リアクション追加失敗は無視

    const cleaned = sanitizeText(event.text)
    const hasFiles = 'files' in event && event.files && event.files.length > 0
    const insertedAt = dayjs().utc().toISOString()
    const entryDate = dayjs().tz(TOKYO_TZ).format('YYYY-MM-DD')
    const mention = `<@${event.user}> さん`

    let entry =
      'thread_ts' in event && event.thread_ts
        ? await db
            .selectFrom('diaryEntries')
            .selectAll()
            .where('messageTs', '=', event.thread_ts)
            .executeTakeFirst()
        : await db
            .selectFrom('diaryEntries')
            .selectAll()
            .where('messageTs', '=', event.ts)
            .executeTakeFirst()

    if (!('thread_ts' in event) || !event.thread_ts) {
      if (!entry) {
        const detailRecordedAt = cleaned ? insertedAt : null
        const baseEntry = {
          id: nanoid(),
          userId: event.user,
          channelId: event.channel,
          messageTs: event.ts,
          entryDate,
          moodEmoji: null,
          moodValue: null,
          moodLabel: null,
          detail: cleaned || null,
          reminderSentAt: insertedAt,
          moodRecordedAt: null,
          detailRecordedAt,
          createdAt: insertedAt,
          updatedAt: insertedAt,
        }

        await db.insertInto('diaryEntries').values(baseEntry).execute()
        entry = baseEntry
      } else if (cleaned && !entry.detail) {
        await db
          .updateTable('diaryEntries')
          .set({
            detail: cleaned,
            detailRecordedAt: insertedAt,
            updatedAt: insertedAt,
          })
          .where('id', '=', entry.id)
          .execute()
        entry = {
          ...entry,
          detail: cleaned,
          detailRecordedAt: insertedAt,
          updatedAt: insertedAt,
        }
      }
    } else if (entry && cleaned) {
      const combined = entry.detail
        ? `${entry.detail}\n\n---\n${cleaned}`
        : cleaned
      await db
        .updateTable('diaryEntries')
        .set({
          detail: combined,
          detailRecordedAt: insertedAt,
          updatedAt: insertedAt,
        })
        .where('id', '=', entry.id)
        .execute()
      entry = {
        ...entry,
        detail: combined,
        detailRecordedAt: insertedAt,
        updatedAt: insertedAt,
      }
    }

    // Process file attachments if present
    if (entry && hasFiles) {
      const slackFiles = event.files as SlackFile[]
      const supportedFiles = filterSupportedFiles(slackFiles)

      if (supportedFiles.length > 0) {
        await storeAttachments(entry.id, supportedFiles)

        // Update entry timestamp if files were added
        await db
          .updateTable('diaryEntries')
          .set({
            updatedAt: insertedAt,
          })
          .where('id', '=', entry.id)
          .execute()
      }
    }

    // 前回のエントリを取得（当日より前の最新エントリ）
    const previousEntry = entry
      ? await db
          .selectFrom('diaryEntries')
          .selectAll()
          .where('userId', '=', event.user)
          .where('entryDate', '<', entry.entryDate)
          .orderBy('entryDate', 'desc')
          .limit(1)
          .executeTakeFirst()
      : null

    // スレッド全体をコンテキストとして使用
    const fullDetail = entry?.detail ?? null
    const previousDetail = previousEntry?.detail ?? null

    // Download image attachments for AI context (max 3 images)
    let imageAttachments: ImageAttachment[] | undefined
    if (entry) {
      const attachments = await getEntryAttachments(entry.id)
      const images = attachments
        .filter((a) => a.fileType === 'image')
        .slice(0, 3) // Limit to 3 images for memory safety

      if (images.length > 0) {
        const downloaded = await downloadSlackFiles(
          images.map((img) => ({
            urlPrivate: img.slackUrlPrivate,
            fileName: img.fileName,
          })),
          env.SLACK_BOT_TOKEN,
        )

        if (downloaded.length > 0) {
          imageAttachments = downloaded.map((d) => ({
            buffer: d.buffer,
            mimeType: d.mimeType,
            fileName: d.fileName,
          }))
        }
      }
    }

    const aiReply = await generateDiaryReply({
      personaName: DIARY_PERSONA_NAME,
      userId: event.user,
      moodLabel: entry?.moodLabel ?? null,
      latestEntry: fullDetail,
      previousEntry: previousDetail,
      mentionMessage: cleaned || null,
      imageAttachments,
    })

    const message = `${mention} ${aiReply}`.trim()

    await context.client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.thread_ts ?? event.ts,
      text: message,
    })

    // 処理中リアクションを削除
    await context.client.reactions
      .remove({
        channel: event.channel,
        timestamp: event.ts,
        name: 'eyes',
      })
      .catch(() => {}) // 削除失敗は無視

    const reactionName = await generateSupportiveReaction({
      personaName: DIARY_PERSONA_NAME,
      userId: event.user,
      messageText: cleaned,
      moodLabel: entry?.moodLabel ?? null,
      availableReactions: SUPPORTIVE_REACTIONS,
    })
    await context.client.reactions
      .add({
        channel: event.channel,
        timestamp: event.ts,
        name: reactionName,
      })
      .catch((error) => {
        if (error instanceof SlackAPIError && error.error === 'already_reacted')
          return
        console.error('Failed to add supportive reaction', error)
      })
  })
}
