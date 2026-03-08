import { env } from 'cloudflare:workers'
import { nanoid } from 'nanoid'
import type { SlackApp, SlackEdgeAppEnv } from 'slack-cloudflare-workers'
import { SlackAPIError } from 'slack-edge'
import dayjs from '~/lib/dayjs'
import { generateSupportiveReaction } from '~/services/ai'
import { storeAttachments } from '~/services/attachments'
import {
  getCharacterPersonaInfo,
  updateCharacterOnDiaryEntry,
} from '~/services/character'
import { ensureWorkspaceId } from '~/services/character-social'
import { db } from '~/services/db'
import { indexDiaryEntry } from '~/services/diary-search'
import { triggerImmediateMemoryExtraction } from '~/services/memory'
import {
  detectAndStoreFutureEvents,
  getFollowupByMessageTs,
  markFollowupAsAnswered,
} from '~/services/pending-followups'
import { getProactiveMessageByMessageTs } from '~/services/proactive-messages'
import { SUPPORTIVE_REACTIONS } from '../diary-constants'
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

    let entry = await db
      .selectFrom('diaryEntries')
      .selectAll()
      .where('messageTs', '=', event.thread_ts)
      .executeTakeFirst()

    // If no diary entry found, check if this is a reply to a bot-initiated message
    // (proactive message or pending followup)
    let proactiveMessage: Awaited<
      ReturnType<typeof getProactiveMessageByMessageTs>
    >
    let pendingFollowup: Awaited<ReturnType<typeof getFollowupByMessageTs>>

    if (!entry) {
      // Check both tables in parallel since they are independent lookups
      const [proactiveResult, followupResult] = await Promise.all([
        getProactiveMessageByMessageTs(event.thread_ts),
        getFollowupByMessageTs(event.thread_ts),
      ])

      // Only accept results that belong to this user
      if (proactiveResult?.userId === event.user) {
        proactiveMessage = proactiveResult
        console.log(
          `[message] Reply to proactive message (${proactiveMessage.messageType}) from user ${event.user}`,
        )
      } else if (followupResult?.userId === event.user) {
        pendingFollowup = followupResult
        console.log(
          `[message] Reply to pending followup from user ${event.user}`,
        )
      }

      // If not a bot message reply, skip processing
      if (!proactiveMessage && !pendingFollowup) {
        console.log(
          `[message] No diary entry or bot message found for thread_ts: ${event.thread_ts}`,
        )
        return
      }
    }

    // For existing diary entries, verify user ownership
    if (entry && entry.userId !== event.user) {
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
    const entryDate = dayjs().tz(TOKYO_TZ).format('YYYY-MM-DD')

    const isBotMessageReply = !!(proactiveMessage || pendingFollowup)

    // If this is a reply to a bot message and no entry exists, create one
    if (isBotMessageReply && !entry) {
      // channelId is required — both proactiveMessage and pendingFollowup always have it set
      // when recorded via sendFollowupReminders / heartbeatFollowups
      const channelId =
        proactiveMessage?.channelId ?? pendingFollowup?.channelId
      if (!channelId) {
        console.error(
          `[message] Bot message reply missing channelId for thread_ts: ${event.thread_ts}`,
        )
        return
      }
      const newEntry = {
        id: nanoid(),
        userId: event.user,
        channelId,
        messageTs: event.thread_ts,
        entryDate,
        moodEmoji: null,
        moodValue: null,
        moodLabel: null,
        detail: text || null,
        reminderSentAt: now, // Bot message was the reminder
        moodRecordedAt: null,
        detailRecordedAt: text ? now : null,
        createdAt: now,
        updatedAt: now,
      }

      await db.insertInto('diaryEntries').values(newEntry).execute()
      if (text) {
        await indexDiaryEntry(newEntry.id, newEntry.userId, entryDate, text)
      }
      entry = newEntry

      console.log(
        `[message] Created new diary entry ${entry.id} for bot message reply`,
      )

      // Mark pending followup as answered if applicable
      if (pendingFollowup) {
        await markFollowupAsAnswered(pendingFollowup.id)
        console.log(
          `[message] Marked followup ${pendingFollowup.id} as answered`,
        )
      }
    } else if (entry && text) {
      // Update existing diary entry text
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
      entry = {
        ...entry,
        detail: combined,
        detailRecordedAt: now,
        updatedAt: now,
      }
    }

    // Sanity check: entry should exist at this point
    if (!entry) {
      console.error('[message] Unexpected: entry is null after processing')
      return
    }

    // 未来のイベントを検出してフォローアップをスケジュール (Heartbeat機能)
    // Note: This runs async but we don't await it to avoid blocking the response
    if (text) {
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

    // For replies to bot messages, trigger AI reply workflow
    // For regular diary replies, just add a reaction (existing behavior)
    if (isBotMessageReply) {
      // Update character state (diary entry interaction)
      try {
        await updateCharacterOnDiaryEntry(event.user, null, teamId)
      } catch (error) {
        console.error('Failed to update character:', error)
      }

      // Get previous entry for context
      const previousEntry = await db
        .selectFrom('diaryEntries')
        .selectAll()
        .where('userId', '=', event.user)
        .where('entryDate', '<', entry.entryDate)
        .orderBy('entryDate', 'desc')
        .limit(1)
        .executeTakeFirst()

      // Start AI reply workflow
      try {
        const instance = await env.AI_DIARY_REPLY_WORKFLOW.create({
          params: {
            entryId: entry.id,
            userId: event.user,
            channel: entry.channelId,
            messageTs: event.ts,
            threadTs: event.thread_ts,
            moodLabel: entry.moodLabel,
            latestEntry: entry.detail,
            previousEntry: previousEntry?.detail ?? null,
            mentionMessage: text || null,
            mention: `<@${event.user}> さん`,
            isFirstDiary: false,
          },
        })
        console.log(
          `[message] Started AI reply workflow for bot message reply: ${instance.id}`,
        )
      } catch (error) {
        console.error('[message] Failed to start AI reply workflow:', error)
      }
    } else {
      // Existing behavior: add supportive reaction (35% chance)
      if (Math.random() < 0.35) {
        const characterInfo = await getCharacterPersonaInfo(entry.userId)
        const reaction = await generateSupportiveReaction({
          characterInfo,
          userId: entry.userId,
          messageText: text,
          moodLabel: entry.moodLabel,
          availableReactions: SUPPORTIVE_REACTIONS,
        })
        await context.client.reactions
          .add({
            channel: entry.channelId,
            timestamp: event.ts,
            name: reaction,
          })
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
    }
  })
}
