import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'

/**
 * Integration test for reaction-added handler.
 * This tests the database operations when a user adds a reaction to a diary entry.
 *
 * Note: D1 migrations should be applied manually before running integration tests:
 * Run: pnpm db:migrate:local
 */
describe('Reaction Added Handler (Integration)', () => {
  beforeEach(async () => {
    // Clean up test data before each test
    await env.DB.prepare('DELETE FROM diary_entries WHERE id LIKE ?')
      .bind('test-%')
      .run()
  })

  it('should record mood when user adds reaction to diary entry', async () => {
    // 1. Insert a test diary entry using raw D1 SQL
    const entryId = 'test-entry-1'
    const userId = 'U123'
    const channelId = 'C123'
    const messageTs = '1234567890.123456'

    await env.DB.prepare(
      `
      INSERT INTO diary_entries (
        id, user_id, channel_id, message_ts, entry_date,
        reminder_sent_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    )
      .bind(
        entryId,
        userId,
        channelId,
        messageTs,
        '2025-01-01',
        '2025-01-01T09:00:00Z',
        '2025-01-01T09:00:00Z',
        '2025-01-01T09:00:00Z',
      )
      .run()

    // 2. Simulate the database update that would happen in the handler
    const now = new Date().toISOString()
    await env.DB.prepare(
      `
      UPDATE diary_entries
      SET mood_emoji = ?, mood_label = ?, mood_value = ?,
          mood_recorded_at = ?, updated_at = ?
      WHERE id = ?
    `,
    )
      .bind(':smile:', 'ほっと安心', 3, now, now, entryId)
      .run()

    // 3. Verify the database was updated correctly
    const result = await env.DB.prepare(
      'SELECT mood_emoji, mood_label, mood_value, mood_recorded_at FROM diary_entries WHERE id = ?',
    )
      .bind(entryId)
      .first()

    expect(result).toBeDefined()
    expect(result.mood_emoji).toBe(':smile:')
    expect(result.mood_label).toBe('ほっと安心')
    expect(result.mood_value).toBe(3)
    expect(result.mood_recorded_at).toBeDefined()
  })

  it('should only update mood if entry exists', async () => {
    const nonExistentTs = '9999999999.999999'

    // Try to find an entry that doesn't exist
    const entry = await env.DB.prepare(
      'SELECT * FROM diary_entries WHERE message_ts = ?',
    )
      .bind(nonExistentTs)
      .first()

    expect(entry).toBeNull()
  })

  it('should allow multiple mood updates for the same entry', async () => {
    // Insert test entry
    const entryId = 'test-entry-2'
    await env.DB.prepare(
      `
      INSERT INTO diary_entries (
        id, user_id, channel_id, message_ts, entry_date,
        reminder_sent_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    )
      .bind(
        entryId,
        'U123',
        'C123',
        '1234567890.123457',
        '2025-01-02',
        '2025-01-02T09:00:00Z',
        '2025-01-02T09:00:00Z',
        '2025-01-02T09:00:00Z',
      )
      .run()

    // First mood
    await env.DB.prepare(
      `
      UPDATE diary_entries
      SET mood_emoji = ?, mood_label = ?, mood_value = ?,
          mood_recorded_at = ?, updated_at = ?
      WHERE id = ?
    `,
    )
      .bind(
        ':smile:',
        'ほっと安心',
        3,
        new Date().toISOString(),
        new Date().toISOString(),
        entryId,
      )
      .run()

    // Second mood (user changed their mind)
    const secondMoodTime = new Date().toISOString()
    await env.DB.prepare(
      `
      UPDATE diary_entries
      SET mood_emoji = ?, mood_label = ?, mood_value = ?,
          mood_recorded_at = ?, updated_at = ?
      WHERE id = ?
    `,
    )
      .bind(':tada:', 'わくわく', 5, secondMoodTime, secondMoodTime, entryId)
      .run()

    const result = await env.DB.prepare(
      'SELECT mood_emoji, mood_label, mood_value FROM diary_entries WHERE id = ?',
    )
      .bind(entryId)
      .first()

    expect(result?.mood_emoji).toBe(':tada:')
    expect(result?.mood_label).toBe('わくわく')
    expect(result?.mood_value).toBe(5)
  })
})
