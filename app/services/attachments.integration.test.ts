import { env } from 'cloudflare:test'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import dayjs from '~/lib/dayjs'
import type { SlackFile } from '~/slack-app/handlers/diary/file-utils'
import {
  getAttachmentCount,
  getAttachmentStats,
  getEntriesAttachments,
  getEntryAttachments,
  storeAttachments,
} from './attachments'
import { createDb } from './db'

describe('attachments service (integration)', () => {
  const db = createDb(env.DB)

  // Helper to create a test diary entry
  const createTestEntry = async (userId = 'U123', entryDate = '2024-01-01') => {
    const entryId = randomUUID()
    const now = dayjs().utc().toISOString()
    await db
      .insertInto('diaryEntries')
      .values({
        id: entryId,
        userId,
        channelId: 'C123',
        messageTs: `${Date.now()}`,
        entryDate,
        moodEmoji: null,
        moodValue: null,
        moodLabel: null,
        detail: 'Test entry',
        reminderSentAt: now,
        moodRecordedAt: null,
        detailRecordedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .execute()
    return entryId
  }

  describe('storeAttachments', () => {
    it('should store image attachments', async () => {
      const entryId = await createTestEntry()
      const slackFiles: SlackFile[] = [
        {
          id: 'F123',
          name: 'photo.jpg',
          mimetype: 'image/jpeg',
          size: 12345,
          url_private: 'https://files.slack.com/files-pri/xxx/photo.jpg',
          permalink: 'https://example.slack.com/files/xxx',
          thumb_360: 'https://files.slack.com/files-tmb/xxx/photo_360.jpg',
          original_w: 1920,
          original_h: 1080,
        },
      ]

      const attachments = await storeAttachments(entryId, slackFiles)

      expect(attachments).toHaveLength(1)
      expect(attachments[0].entryId).toBe(entryId)
      expect(attachments[0].fileType).toBe('image')
      expect(attachments[0].fileName).toBe('photo.jpg')
      expect(attachments[0].slackFileId).toBe('F123')
      expect(attachments[0].width).toBe(1920)
      expect(attachments[0].height).toBe(1080)
    })

    it('should store multiple attachments in order', async () => {
      const entryId = await createTestEntry()
      const slackFiles: SlackFile[] = [
        {
          id: 'F1',
          name: 'photo1.jpg',
          mimetype: 'image/jpeg',
          url_private: 'https://files.slack.com/files-pri/xxx/photo1.jpg',
        },
        {
          id: 'F2',
          name: 'video.mp4',
          mimetype: 'video/mp4',
          url_private: 'https://files.slack.com/files-pri/xxx/video.mp4',
        },
        {
          id: 'F3',
          name: 'document.pdf',
          mimetype: 'application/pdf',
          url_private: 'https://files.slack.com/files-pri/xxx/document.pdf',
        },
      ]

      const attachments = await storeAttachments(entryId, slackFiles)

      expect(attachments).toHaveLength(3)
      expect(attachments[0].displayOrder).toBe(0)
      expect(attachments[1].displayOrder).toBe(1)
      expect(attachments[2].displayOrder).toBe(2)
      expect(attachments[0].fileType).toBe('image')
      expect(attachments[1].fileType).toBe('video')
      expect(attachments[2].fileType).toBe('document')
    })

    it('should skip unsupported file types', async () => {
      const entryId = await createTestEntry()
      const slackFiles: SlackFile[] = [
        {
          id: 'F1',
          name: 'photo.jpg',
          mimetype: 'image/jpeg',
          url_private: 'https://files.slack.com/files-pri/xxx/photo.jpg',
        },
        {
          id: 'F2',
          name: 'audio.mp3',
          mimetype: 'audio/mpeg', // audio not supported
          url_private: 'https://files.slack.com/files-pri/xxx/audio.mp3',
        },
      ]

      const attachments = await storeAttachments(entryId, slackFiles)

      expect(attachments).toHaveLength(1)
      expect(attachments[0].fileName).toBe('photo.jpg')
    })

    it('should return empty array for no files', async () => {
      const entryId = await createTestEntry()
      const attachments = await storeAttachments(entryId, [])
      expect(attachments).toHaveLength(0)
    })
  })

  describe('getEntryAttachments', () => {
    it('should retrieve attachments for an entry', async () => {
      const entryId = await createTestEntry()
      const slackFiles: SlackFile[] = [
        {
          id: 'F1',
          name: 'photo.jpg',
          mimetype: 'image/jpeg',
          url_private: 'https://files.slack.com/files-pri/xxx/photo.jpg',
        },
      ]

      await storeAttachments(entryId, slackFiles)
      const attachments = await getEntryAttachments(entryId)

      expect(attachments).toHaveLength(1)
      expect(attachments[0].fileName).toBe('photo.jpg')
    })

    it('should return empty array for entry with no attachments', async () => {
      const entryId = await createTestEntry()
      const attachments = await getEntryAttachments(entryId)
      expect(attachments).toHaveLength(0)
    })

    it('should return attachments ordered by display_order', async () => {
      const entryId = await createTestEntry()
      const slackFiles: SlackFile[] = [
        {
          id: 'F1',
          name: 'first.jpg',
          mimetype: 'image/jpeg',
          url_private: 'https://files.slack.com/files-pri/xxx/first.jpg',
        },
        {
          id: 'F2',
          name: 'second.jpg',
          mimetype: 'image/jpeg',
          url_private: 'https://files.slack.com/files-pri/xxx/second.jpg',
        },
        {
          id: 'F3',
          name: 'third.jpg',
          mimetype: 'image/jpeg',
          url_private: 'https://files.slack.com/files-pri/xxx/third.jpg',
        },
      ]

      await storeAttachments(entryId, slackFiles)
      const attachments = await getEntryAttachments(entryId)

      expect(attachments).toHaveLength(3)
      expect(attachments[0].fileName).toBe('first.jpg')
      expect(attachments[1].fileName).toBe('second.jpg')
      expect(attachments[2].fileName).toBe('third.jpg')
    })
  })

  describe('getEntriesAttachments', () => {
    it('should retrieve attachments for multiple entries', async () => {
      const entryId1 = await createTestEntry('U123', '2024-01-01')
      const entryId2 = await createTestEntry('U123', '2024-01-02')

      await storeAttachments(entryId1, [
        {
          id: 'F1',
          name: 'photo1.jpg',
          mimetype: 'image/jpeg',
          url_private: 'https://files.slack.com/files-pri/xxx/photo1.jpg',
        },
      ])

      await storeAttachments(entryId2, [
        {
          id: 'F2',
          name: 'photo2.jpg',
          mimetype: 'image/jpeg',
          url_private: 'https://files.slack.com/files-pri/xxx/photo2.jpg',
        },
        {
          id: 'F3',
          name: 'photo3.jpg',
          mimetype: 'image/jpeg',
          url_private: 'https://files.slack.com/files-pri/xxx/photo3.jpg',
        },
      ])

      const attachmentMap = await getEntriesAttachments([entryId1, entryId2])

      expect(attachmentMap.size).toBe(2)
      expect(attachmentMap.get(entryId1)).toHaveLength(1)
      expect(attachmentMap.get(entryId2)).toHaveLength(2)
    })

    it('should return empty map for no entry IDs', async () => {
      const attachmentMap = await getEntriesAttachments([])
      expect(attachmentMap.size).toBe(0)
    })
  })

  describe('getAttachmentCount', () => {
    it('should return correct count of attachments', async () => {
      const entryId = await createTestEntry()
      const slackFiles: SlackFile[] = [
        {
          id: 'F1',
          name: 'photo1.jpg',
          mimetype: 'image/jpeg',
          url_private: 'https://files.slack.com/files-pri/xxx/photo1.jpg',
        },
        {
          id: 'F2',
          name: 'photo2.jpg',
          mimetype: 'image/jpeg',
          url_private: 'https://files.slack.com/files-pri/xxx/photo2.jpg',
        },
      ]

      await storeAttachments(entryId, slackFiles)
      const count = await getAttachmentCount(entryId)

      expect(count).toBe(2)
    })

    it('should return 0 for entry with no attachments', async () => {
      const entryId = await createTestEntry()
      const count = await getAttachmentCount(entryId)
      expect(count).toBe(0)
    })
  })

  describe('getAttachmentStats', () => {
    it('should return correct statistics', async () => {
      const entryId = await createTestEntry()
      const slackFiles: SlackFile[] = [
        {
          id: 'F1',
          name: 'photo1.jpg',
          mimetype: 'image/jpeg',
          url_private: 'https://files.slack.com/files-pri/xxx/photo1.jpg',
        },
        {
          id: 'F2',
          name: 'photo2.jpg',
          mimetype: 'image/jpeg',
          url_private: 'https://files.slack.com/files-pri/xxx/photo2.jpg',
        },
        {
          id: 'F3',
          name: 'video.mp4',
          mimetype: 'video/mp4',
          url_private: 'https://files.slack.com/files-pri/xxx/video.mp4',
        },
        {
          id: 'F4',
          name: 'document.pdf',
          mimetype: 'application/pdf',
          url_private: 'https://files.slack.com/files-pri/xxx/document.pdf',
        },
      ]

      await storeAttachments(entryId, slackFiles)
      const stats = await getAttachmentStats(entryId)

      expect(stats.images).toBe(2)
      expect(stats.videos).toBe(1)
      expect(stats.documents).toBe(1)
      expect(stats.total).toBe(4)
    })

    it('should return zero stats for entry with no attachments', async () => {
      const entryId = await createTestEntry()
      const stats = await getAttachmentStats(entryId)

      expect(stats.images).toBe(0)
      expect(stats.videos).toBe(0)
      expect(stats.documents).toBe(0)
      expect(stats.total).toBe(0)
    })
  })
})
