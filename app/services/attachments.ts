/**
 * Service for managing diary entry file attachments
 */

import { randomUUID } from 'node:crypto'
import dayjs from '~/lib/dayjs'
import {
  type SlackFile,
  categorizeFileType,
} from '~/slack-app/handlers/diary/file-utils'
import type { Database } from './db'
import { db } from './db'

export type DiaryAttachment = Database['diaryAttachments']

/**
 * Store attachments for a diary entry
 * @param entryId - The diary entry ID
 * @param slackFiles - Array of Slack file objects
 * @returns Array of created attachment records
 */
export async function storeAttachments(
  entryId: string,
  slackFiles: SlackFile[],
): Promise<DiaryAttachment[]> {
  if (slackFiles.length === 0) {
    return []
  }

  const now = dayjs().utc().toISOString()
  const attachments: DiaryAttachment[] = []

  // Get existing attachments to avoid duplicates
  const existingAttachments = await getEntryAttachments(entryId)
  const existingFileIds = new Set(existingAttachments.map((a) => a.slackFileId))

  // Create attachment records (skip duplicates)
  let displayOrder = existingAttachments.length
  for (const file of slackFiles) {
    // Skip if already stored
    if (existingFileIds.has(file.id)) {
      console.log(`Skipping duplicate file: ${file.id} (${file.name})`)
      continue
    }

    const fileType = categorizeFileType(file)

    if (!fileType) {
      continue // Skip unsupported files
    }

    const attachment: DiaryAttachment = {
      id: randomUUID(),
      entryId,
      fileType,
      fileName: file.name,
      mimeType: file.mimetype || null,
      fileSize: file.size || null,
      slackFileId: file.id,
      slackUrlPrivate: file.url_private || '',
      slackPermalink: file.permalink || null,
      slackThumb360: file.thumb_360 || null,
      slackThumbvideo: file.thumb_video || null,
      width: file.original_w || null,
      height: file.original_h || null,
      displayOrder: displayOrder++,
      createdAt: now,
    }

    attachments.push(attachment)
  }

  // Insert all attachments in a single transaction
  if (attachments.length > 0) {
    await db.insertInto('diaryAttachments').values(attachments).execute()
  }

  return attachments
}

/**
 * Get all attachments for a diary entry
 * @param entryId - The diary entry ID
 * @returns Array of attachment records, ordered by display_order
 */
export async function getEntryAttachments(
  entryId: string,
): Promise<DiaryAttachment[]> {
  return db
    .selectFrom('diaryAttachments')
    .selectAll()
    .where('entryId', '=', entryId)
    .orderBy('displayOrder', 'asc')
    .execute()
}

/**
 * Get attachments for multiple diary entries
 * @param entryIds - Array of diary entry IDs
 * @returns Map of entry ID to array of attachments
 */
export async function getEntriesAttachments(
  entryIds: string[],
): Promise<Map<string, DiaryAttachment[]>> {
  if (entryIds.length === 0) {
    return new Map()
  }

  const attachments = await db
    .selectFrom('diaryAttachments')
    .selectAll()
    .where('entryId', 'in', entryIds)
    .orderBy('displayOrder', 'asc')
    .execute()

  // Group attachments by entry ID
  const attachmentsByEntry = new Map<string, DiaryAttachment[]>()
  for (const attachment of attachments) {
    const existing = attachmentsByEntry.get(attachment.entryId) || []
    existing.push(attachment)
    attachmentsByEntry.set(attachment.entryId, existing)
  }

  return attachmentsByEntry
}

/**
 * Get attachment count for a diary entry
 * @param entryId - The diary entry ID
 * @returns Number of attachments
 */
export async function getAttachmentCount(entryId: string): Promise<number> {
  const result = await db
    .selectFrom('diaryAttachments')
    .select((eb) => eb.fn.count<number>('id').as('count'))
    .where('entryId', '=', entryId)
    .executeTakeFirst()

  return result?.count || 0
}

/**
 * Delete all attachments for a diary entry
 * Note: This is called automatically via CASCADE DELETE when an entry is deleted
 * @param entryId - The diary entry ID
 */
export async function deleteEntryAttachments(entryId: string): Promise<void> {
  await db
    .deleteFrom('diaryAttachments')
    .where('entryId', '=', entryId)
    .execute()
}

/**
 * Get statistics about file types in attachments
 * @param entryId - The diary entry ID
 * @returns Object with counts for each file type
 */
export async function getAttachmentStats(entryId: string): Promise<{
  images: number
  videos: number
  documents: number
  total: number
}> {
  const attachments = await getEntryAttachments(entryId)

  const stats = {
    images: 0,
    videos: 0,
    documents: 0,
    total: attachments.length,
  }

  for (const attachment of attachments) {
    if (attachment.fileType === 'image') stats.images++
    else if (attachment.fileType === 'video') stats.videos++
    else if (attachment.fileType === 'document') stats.documents++
  }

  return stats
}
