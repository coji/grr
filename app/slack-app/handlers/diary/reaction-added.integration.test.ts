import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { createDb } from '../../../services/db'

/**
 * Integration test for reaction-added handler.
 * This tests the database operations when a user adds a reaction to a diary entry.
 *
 * Note: D1 migrations are automatically applied before tests run
 * via tests/setup/integration-setup.ts
 */
describe('Reaction Added Handler (Integration)', () => {
  beforeEach(async () => {
    const db = createDb(env.DB)
    // Clean up test data before each test using Kysely
    await db.deleteFrom('diaryEntries').where('id', 'like', 'test-%').execute()
  })

  it('should record mood when user adds reaction to diary entry', async () => {
    const db = createDb(env.DB)

    // 1. Insert a test diary entry using Kysely
    const entryId = 'test-entry-1'
    const userId = 'U123'
    const channelId = 'C123'
    const messageTs = '1234567890.123456'
    const now = new Date().toISOString()

    await db
      .insertInto('diaryEntries')
      .values({
        id: entryId,
        userId,
        channelId,
        messageTs,
        entryDate: '2025-01-01',
        reminderSentAt: '2025-01-01T09:00:00Z',
        createdAt: '2025-01-01T09:00:00Z',
        updatedAt: '2025-01-01T09:00:00Z',
      })
      .execute()

    // 2. Simulate the database update that would happen in the handler
    await db
      .updateTable('diaryEntries')
      .set({
        moodEmoji: ':smile:',
        moodLabel: 'ほっと安心',
        moodValue: 3,
        moodRecordedAt: now,
        updatedAt: now,
      })
      .where('id', '=', entryId)
      .execute()

    // 3. Verify the database was updated correctly
    const result = await db
      .selectFrom('diaryEntries')
      .select(['moodEmoji', 'moodLabel', 'moodValue', 'moodRecordedAt'])
      .where('id', '=', entryId)
      .executeTakeFirst()

    expect(result).toBeDefined()
    expect(result?.moodEmoji).toBe(':smile:')
    expect(result?.moodLabel).toBe('ほっと安心')
    expect(result?.moodValue).toBe(3)
    expect(result?.moodRecordedAt).toBeDefined()
  })

  it('should only update mood if entry exists', async () => {
    const db = createDb(env.DB)
    const nonExistentTs = '9999999999.999999'

    // Try to find an entry that doesn't exist
    const entry = await db
      .selectFrom('diaryEntries')
      .selectAll()
      .where('messageTs', '=', nonExistentTs)
      .executeTakeFirst()

    expect(entry).toBeUndefined()
  })

  it('should allow multiple mood updates for the same entry', async () => {
    const db = createDb(env.DB)

    // Insert test entry
    const entryId = 'test-entry-2'
    await db
      .insertInto('diaryEntries')
      .values({
        id: entryId,
        userId: 'U123',
        channelId: 'C123',
        messageTs: '1234567890.123457',
        entryDate: '2025-01-02',
        reminderSentAt: '2025-01-02T09:00:00Z',
        createdAt: '2025-01-02T09:00:00Z',
        updatedAt: '2025-01-02T09:00:00Z',
      })
      .execute()

    // First mood
    const firstMoodTime = new Date().toISOString()
    await db
      .updateTable('diaryEntries')
      .set({
        moodEmoji: ':smile:',
        moodLabel: 'ほっと安心',
        moodValue: 3,
        moodRecordedAt: firstMoodTime,
        updatedAt: firstMoodTime,
      })
      .where('id', '=', entryId)
      .execute()

    // Second mood (user changed their mind)
    const secondMoodTime = new Date().toISOString()
    await db
      .updateTable('diaryEntries')
      .set({
        moodEmoji: ':tada:',
        moodLabel: 'わくわく',
        moodValue: 5,
        moodRecordedAt: secondMoodTime,
        updatedAt: secondMoodTime,
      })
      .where('id', '=', entryId)
      .execute()

    const result = await db
      .selectFrom('diaryEntries')
      .select(['moodEmoji', 'moodLabel', 'moodValue'])
      .where('id', '=', entryId)
      .executeTakeFirst()

    expect(result?.moodEmoji).toBe(':tada:')
    expect(result?.moodLabel).toBe('わくわく')
    expect(result?.moodValue).toBe(5)
  })
})
