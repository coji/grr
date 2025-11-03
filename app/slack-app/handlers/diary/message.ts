import type { SlackApp, SlackEdgeAppEnv } from 'slack-cloudflare-workers'
import { SlackAPIError } from 'slack-edge'
import dayjs from '~/lib/dayjs'
import { generateSupportiveReaction } from '~/services/ai'
import { storeAttachments } from '~/services/attachments'
import { db } from '~/services/db'
import { DIARY_PERSONA_NAME, SUPPORTIVE_REACTIONS } from '../diary-constants'
import { filterSupportedFiles, type SlackFile } from './file-utils'
import { sanitizeText } from './utils'

export function registerMessageHandler(app: SlackApp<SlackEdgeAppEnv>) {
  app.event('message', async ({ payload, context }) => {
    const event = payload
    if (
      'subtype' in event &&
      event.subtype &&
      event.subtype !== 'thread_broadcast'
    )
      return
    if (!('thread_ts' in event) || !event.thread_ts) return
    if (!event.user) return

    const entry = await db
      .selectFrom('diaryEntries')
      .selectAll()
      .where('messageTs', '=', event.thread_ts)
      .executeTakeFirst()

    if (!entry) return
    if (entry.userId !== event.user) return

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
    }

    // Process file attachments if present
    if (hasFiles) {
      const slackFiles = event.files as SlackFile[]
      const supportedFiles = filterSupportedFiles(slackFiles)

      if (supportedFiles.length > 0) {
        await storeAttachments(entry.id, supportedFiles)

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
