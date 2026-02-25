import type { SlackApp, SlackEdgeAppEnv } from 'slack-cloudflare-workers'
import { SlackAPIError } from 'slack-edge'
import dayjs from '~/lib/dayjs'
import { generateSupportiveReaction } from '~/services/ai'
import { storeAttachments } from '~/services/attachments'
import { ensureWorkspaceId } from '~/services/character-social'
import { db } from '~/services/db'
import { triggerImmediateMemoryExtraction } from '~/services/memory'
import { detectAndStoreFutureEvents } from '~/services/pending-followups'
import { DIARY_PERSONA_NAME, SUPPORTIVE_REACTIONS } from '../diary-constants'
import { filterSupportedFiles, type SlackFile } from './file-utils'
import { sanitizeText, TOKYO_TZ } from './utils'

export function registerMessageHandler(app: SlackApp<SlackEdgeAppEnv>) {
  app.event('message', async ({ payload, context }) => {
    const event = payload
    // メッセージの削除などのsubtypeは無視
    // thread_broadcastは処理する（スレッド内のメッセージがチャンネルにも投稿される場合）
    // file_shareも処理する（ファイル付きメッセージ）
    if (
      'subtype' in event &&
      event.subtype &&
      event.subtype !== 'thread_broadcast' &&
      event.subtype !== 'file_share'
    ) {
      console.log(`[message] Skipping message with subtype: ${event.subtype}`)
      return
    }

    if (!('thread_ts' in event) || !event.thread_ts) {
      console.log('[message] Skipping non-thread message')
      return
    }

    if (!event.user) {
      console.log('[message] Skipping message without user')
      return
    }

    // Track workspace ID for social features (fire-and-forget)
    const teamId = (payload as unknown as { team_id?: string }).team_id
    if (teamId) {
      ensureWorkspaceId(event.user, teamId).catch((err) =>
        console.error('Failed to update workspace ID:', err),
      )
    }

    const entry = await db
      .selectFrom('diaryEntries')
      .selectAll()
      .where('messageTs', '=', event.thread_ts)
      .executeTakeFirst()

    if (!entry) {
      console.log(
        `[message] No diary entry found for thread_ts: ${event.thread_ts}`,
      )
      return
    }

    if (entry.userId !== event.user) {
      console.log(
        `[message] User mismatch: entry.userId=${entry.userId}, event.user=${event.user}`,
      )
      return
    }

    const text = sanitizeText(event.text)
    const hasFiles = 'files' in event && event.files && event.files.length > 0

    // Need either text or files to proceed
    if (!text && !hasFiles) return

    const now = dayjs().utc().toISOString()

    // Update diary entry text if present
    if (text) {
      const combined = entry.detail ? `${entry.detail}\n\n---\n${text}` : text

      await db
        .updateTable('diaryEntries')
        .set({
          detail: combined,
          detailRecordedAt: now,
          updatedAt: now,
        })
        .where('id', '=', entry.id)
        .execute()

      // 未来のイベントを検出してフォローアップをスケジュール (Heartbeat機能)
      // Note: This runs async but we don't await it to avoid blocking the response
      const entryDate = dayjs().tz(TOKYO_TZ).format('YYYY-MM-DD')
      detectAndStoreFutureEvents(
        entry.id,
        event.user,
        entry.channelId,
        text, // 新しく追加されたテキストのみを解析
        entryDate,
      ).catch((error) => {
        console.error('Failed to detect future events:', error)
      })

      // メモリ抽出を即時実行 (Workflowで非同期処理)
      // channel/message info is passed so the workflow can fetch unfurl data
      triggerImmediateMemoryExtraction(event.user, entry.id, {
        channelId: entry.channelId,
        messageTs: event.ts,
        threadTs: event.thread_ts,
      }).catch((error) => {
        console.error('Failed to trigger memory extraction:', error)
      })
    }

    // Process file attachments if present
    if (hasFiles) {
      const slackFiles = event.files as SlackFile[]
      console.log(
        `[message] Received ${slackFiles.length} files:`,
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
      console.log(
        `[message] ${supportedFiles.length} supported files after filtering`,
      )

      if (supportedFiles.length > 0) {
        await storeAttachments(entry.id, supportedFiles)
        console.log(
          `[message] Stored ${supportedFiles.length} attachments for entry ${entry.id}`,
        )

        // Update entry timestamp even if no text was added
        if (!text) {
          await db
            .updateTable('diaryEntries')
            .set({
              updatedAt: now,
            })
            .where('id', '=', entry.id)
            .execute()
        }
      }
    }

    // リアクションを追加（35%の確率）
    if (Math.random() < 0.35) {
      const reaction = await generateSupportiveReaction({
        personaName: DIARY_PERSONA_NAME,
        userId: entry.userId,
        messageText: text,
        moodLabel: entry.moodLabel,
        availableReactions: SUPPORTIVE_REACTIONS,
      })
      await context.client.reactions
        .add({ channel: entry.channelId, timestamp: event.ts, name: reaction })
        .catch((error) => {
          if (
            error instanceof SlackAPIError &&
            error.error === 'already_reacted'
          ) {
            return
          }
          console.error('Failed to add supportive reaction', error)
        })
    }
  })
}
