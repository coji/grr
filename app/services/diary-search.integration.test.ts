import { env } from 'cloudflare:test'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import dayjs from '~/lib/dayjs'
import { createDb } from './db'
import {
  getSearchContextForAI,
  isFtsAvailable,
  searchDiaryEntries,
  searchDiaryEntriesFallback,
} from './diary-search'

describe('diary-search (integration)', () => {
  const db = createDb(env.DB)

  // Helper to create a test diary entry
  const createTestEntry = async (
    userId: string,
    entryDate: string,
    detail: string,
  ) => {
    const entryId = randomUUID()
    const now = dayjs().utc().toISOString()
    await db
      .insertInto('diaryEntries')
      .values({
        id: entryId,
        userId,
        channelId: 'C123',
        messageTs: `${Date.now()}.${Math.random()}`,
        entryDate,
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
    return entryId
  }

  describe('isFtsAvailable', () => {
    it('should return true when FTS table exists', async () => {
      const available = await isFtsAvailable()
      expect(available).toBe(true)
    })
  })

  describe('searchDiaryEntries (FTS5)', () => {
    it('should find entries matching the query', async () => {
      const userId = `U${randomUUID().slice(0, 8)}`
      await createTestEntry(userId, '2024-01-15', 'コメダでモーニングを食べた')
      await createTestEntry(userId, '2024-01-16', 'スタバでコーヒーを飲んだ')

      const results = await searchDiaryEntries(userId, 'コメダ')

      expect(results.length).toBe(1)
      expect(results[0].detail).toContain('コメダ')
    })

    it('should return results ordered by relevance', async () => {
      const userId = `U${randomUUID().slice(0, 8)}`
      await createTestEntry(userId, '2024-01-15', 'コメダでモーニング')
      await createTestEntry(
        userId,
        '2024-01-16',
        'コメダでランチしてコメダでお茶した',
      )

      const results = await searchDiaryEntries(userId, 'コメダ')

      expect(results.length).toBe(2)
      // The entry with more mentions of コメダ should rank higher (lower rank value)
      expect(results[0].rank).toBeLessThanOrEqual(results[1].rank)
    })

    it('should only return entries for the specified user', async () => {
      const userId1 = `U${randomUUID().slice(0, 8)}`
      const userId2 = `U${randomUUID().slice(0, 8)}`
      await createTestEntry(userId1, '2024-01-15', 'コメダでモーニング')
      await createTestEntry(userId2, '2024-01-15', 'コメダでランチ')

      const results = await searchDiaryEntries(userId1, 'コメダ')

      expect(results.length).toBe(1)
      expect(results[0].userId).toBe(userId1)
    })

    it('should return empty array for no matches', async () => {
      const userId = `U${randomUUID().slice(0, 8)}`
      await createTestEntry(userId, '2024-01-15', 'スタバでコーヒー')

      const results = await searchDiaryEntries(userId, 'コメダ')

      expect(results.length).toBe(0)
    })

    it('should return empty array for empty query', async () => {
      const userId = `U${randomUUID().slice(0, 8)}`
      const results = await searchDiaryEntries(userId, '')
      expect(results.length).toBe(0)
    })

    it('should respect limit parameter', async () => {
      const userId = `U${randomUUID().slice(0, 8)}`
      for (let i = 0; i < 5; i++) {
        await createTestEntry(
          userId,
          `2024-01-${10 + i}`,
          `コーヒー飲んだ ${i}`,
        )
      }

      const results = await searchDiaryEntries(userId, 'コーヒー', 3)

      expect(results.length).toBe(3)
    })
  })

  describe('searchDiaryEntriesFallback', () => {
    it('should find entries using LIKE query', async () => {
      const userId = `U${randomUUID().slice(0, 8)}`
      await createTestEntry(userId, '2024-01-15', 'コメダでモーニングを食べた')

      const results = await searchDiaryEntriesFallback(userId, 'コメダ')

      expect(results.length).toBe(1)
      expect(results[0].detail).toContain('コメダ')
    })

    it('should return empty array for empty query', async () => {
      const userId = `U${randomUUID().slice(0, 8)}`
      const results = await searchDiaryEntriesFallback(userId, '')
      expect(results.length).toBe(0)
    })
  })

  describe('getSearchContextForAI', () => {
    it('should return search context entries for multiple terms', async () => {
      const userId = `U${randomUUID().slice(0, 8)}`
      await createTestEntry(userId, '2024-01-10', 'コメダでモーニング食べた')
      await createTestEntry(
        userId,
        '2024-01-11',
        '整体に行って腰痛が楽になった',
      )
      await createTestEntry(userId, '2024-01-12', 'ラーメン食べた')

      const context = await getSearchContextForAI(userId, ['コメダ', '整体'], 5)

      expect(context.length).toBe(2)
      const dates = context.map((c) => c.entryDate)
      expect(dates).toContain('2024-01-10')
      expect(dates).toContain('2024-01-11')
    })

    it('should exclude specified date', async () => {
      const userId = `U${randomUUID().slice(0, 8)}`
      await createTestEntry(userId, '2024-01-10', 'コメダでモーニング')
      await createTestEntry(userId, '2024-01-15', 'コメダでランチ')

      const context = await getSearchContextForAI(
        userId,
        ['コメダ'],
        5,
        '2024-01-15', // Exclude this date
      )

      expect(context.length).toBe(1)
      expect(context[0].entryDate).toBe('2024-01-10')
    })

    it('should return empty array for empty search terms', async () => {
      const userId = `U${randomUUID().slice(0, 8)}`
      const context = await getSearchContextForAI(userId, [])
      expect(context.length).toBe(0)
    })

    it('should skip very short terms', async () => {
      const userId = `U${randomUUID().slice(0, 8)}`
      await createTestEntry(userId, '2024-01-10', 'a b c')

      const context = await getSearchContextForAI(userId, ['a', 'b'])

      expect(context.length).toBe(0)
    })

    it('should respect maxEntries limit', async () => {
      const userId = `U${randomUUID().slice(0, 8)}`
      for (let i = 0; i < 10; i++) {
        await createTestEntry(
          userId,
          `2024-01-${10 + i}`,
          `コーヒー飲んだ ${i}`,
        )
      }

      const context = await getSearchContextForAI(userId, ['コーヒー'], 3)

      expect(context.length).toBeLessThanOrEqual(3)
    })

    it('should assign relevance levels correctly', async () => {
      const userId = `U${randomUUID().slice(0, 8)}`
      await createTestEntry(
        userId,
        '2024-01-10',
        'コーヒーコーヒーコーヒー飲んだ',
      )
      await createTestEntry(userId, '2024-01-11', 'コーヒー飲んだ')
      await createTestEntry(userId, '2024-01-12', 'コーヒーを少し')

      const context = await getSearchContextForAI(userId, ['コーヒー'], 3)

      // First entry should be high relevance
      expect(context[0].relevance).toBe('high')
    })
  })
})
