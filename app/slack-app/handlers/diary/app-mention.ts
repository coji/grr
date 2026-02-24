import { env } from 'cloudflare:workers'
import { nanoid } from 'nanoid'
import type { SlackApp, SlackEdgeAppEnv } from 'slack-cloudflare-workers'
import dayjs from '~/lib/dayjs'
import { storeAttachments } from '~/services/attachments'
import { updateCharacterOnDiaryEntry } from '~/services/character'
import { db } from '~/services/db'
import { triggerImmediateMemoryExtraction } from '~/services/memory'
import { handleDiaryEntryMilestone } from '~/services/milestone-handler'
import { detectAndStoreFutureEvents } from '~/services/pending-followups'
import { DIARY_PERSONA_NAME } from '../diary-constants'
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
      console.log(
        `Received ${slackFiles.length} files in app_mention event:`,
        slackFiles.map((f) => ({
          id: f.id,
          name: f.name,
          mimetype: f.mimetype,
          url_private: f.url_private
            ? `${f.url_private.substring(0, 50)}...`
            : undefined,
        })),
      )

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

    // 未来のイベントを検出してフォローアップをスケジュール (Heartbeat機能)
    // Note: This runs async but we don't await it to avoid blocking the response
    if (entry && cleaned) {
      detectAndStoreFutureEvents(
        entry.id,
        event.user,
        event.channel,
        cleaned,
        entryDate,
      ).catch((error) => {
        console.error('Failed to detect future events:', error)
      })
    }

    // メモリ抽出を即時実行 (Workflowで非同期処理)
    // channel/message info is passed so the workflow can fetch unfurl data
    if (entry && cleaned) {
      triggerImmediateMemoryExtraction(event.user, entry.id, {
        channelId: event.channel,
        messageTs: event.ts,
        threadTs: 'thread_ts' in event ? event.thread_ts : undefined,
      }).catch((error) => {
        console.error('Failed to trigger memory extraction:', error)
      })
    }

    // マイルストーン追跡と祝いメッセージ (非同期で実行)
    if (entry) {
      handleDiaryEntryMilestone(
        event.user,
        event.channel,
        entryDate,
        DIARY_PERSONA_NAME,
      ).catch((error) => {
        console.error('Failed to handle milestone:', error)
      })
    }

    // キャラクター状態更新 (非同期で実行)
    // 日記を書くとキャラクターが喜び、ポイントが貯まる
    if (entry) {
      updateCharacterOnDiaryEntry(event.user, entry.moodValue).catch(
        (error) => {
          console.error('Failed to update character:', error)
        },
      )
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

    // Start Cloudflare Workflow for AI reply processing
    // This handles the time-intensive image download + AI processing (can take 30+ seconds)
    try {
      const instance = await env.AI_DIARY_REPLY_WORKFLOW.create({
        params: {
          entryId: entry?.id || '',
          userId: event.user,
          channel: event.channel,
          messageTs: event.ts,
          threadTs: event.thread_ts,
          moodLabel: entry?.moodLabel ?? null,
          latestEntry: fullDetail,
          previousEntry: previousDetail,
          mentionMessage: cleaned || null,
          mention,
        },
      })

      console.log(`Started AI reply workflow: ${instance.id}`)
    } catch (error) {
      console.error('Failed to start AI reply workflow:', error)
      // Remove "processing" reaction on error
      await context.client.reactions
        .remove({
          channel: event.channel,
          timestamp: event.ts,
          name: 'eyes',
        })
        .catch(() => {})
    }
  })
}
