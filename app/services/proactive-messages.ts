/**
 * Service for managing proactive messages (HEARTBEAT feature)
 *
 * This handles all types of proactive messages:
 * - Anniversary reminders (1年前の日記)
 * - Milestone celebrations (投稿数、連続投稿)
 * - Weekly insights (週イチ気づき)
 * - Seasonal greetings (季節の挨拶)
 * - Random check-ins (ランダムな一言)
 * - Monthly reports (月次レポート)
 * - Question interventions (問いかけ型介入)
 * - Brief entry follow-ups (続きを聞かせて)
 */

import { nanoid } from 'nanoid'
import dayjs from '~/lib/dayjs'
import type { Database } from './db'
import { db } from './db'

export type ProactiveMessage = Database['proactiveMessages']
export type UserMilestone = Database['userMilestones']

export type ProactiveMessageType = ProactiveMessage['messageType']

const TOKYO_TZ = 'Asia/Tokyo'

/**
 * Record a sent proactive message
 */
export async function recordProactiveMessage(input: {
  userId: string
  channelId: string
  messageType: ProactiveMessageType
  messageKey?: string
  metadata?: Record<string, unknown>
  messageTs?: string
}): Promise<ProactiveMessage> {
  const now = dayjs().utc().toISOString()

  const message: ProactiveMessage = {
    id: nanoid(),
    userId: input.userId,
    channelId: input.channelId,
    messageType: input.messageType,
    messageKey: input.messageKey ?? null,
    metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    messageTs: input.messageTs ?? null,
    sentAt: now,
    createdAt: now,
  }

  await db.insertInto('proactiveMessages').values(message).execute()

  return message
}

/**
 * Check if a proactive message with this key was already sent
 */
export async function wasMessageSent(
  userId: string,
  messageType: ProactiveMessageType,
  messageKey: string,
): Promise<boolean> {
  const existing = await db
    .selectFrom('proactiveMessages')
    .select('id')
    .where('userId', '=', userId)
    .where('messageType', '=', messageType)
    .where('messageKey', '=', messageKey)
    .executeTakeFirst()

  return !!existing
}

/**
 * Get the last time a message of this type was sent to a user
 */
export async function getLastMessageOfType(
  userId: string,
  messageType: ProactiveMessageType,
): Promise<ProactiveMessage | undefined> {
  return db
    .selectFrom('proactiveMessages')
    .selectAll()
    .where('userId', '=', userId)
    .where('messageType', '=', messageType)
    .orderBy('sentAt', 'desc')
    .limit(1)
    .executeTakeFirst()
}

/**
 * Get user milestones, creating if not exists
 */
export async function getUserMilestones(
  userId: string,
): Promise<UserMilestone | undefined> {
  return db
    .selectFrom('userMilestones')
    .selectAll()
    .where('userId', '=', userId)
    .executeTakeFirst()
}

/**
 * Update user milestones after a new entry
 */
export async function updateUserMilestones(
  userId: string,
  entryDate: string,
): Promise<UserMilestone> {
  const now = dayjs().utc().toISOString()
  const existing = await getUserMilestones(userId)

  if (!existing) {
    // Create new milestone record
    const milestone: UserMilestone = {
      userId,
      totalEntries: 1,
      currentStreak: 1,
      longestStreak: 1,
      lastEntryDate: entryDate,
      firstEntryDate: entryDate,
      lastMilestoneCelebrated: null,
      createdAt: now,
      updatedAt: now,
    }

    await db.insertInto('userMilestones').values(milestone).execute()
    return milestone
  }

  // Calculate streak
  const lastEntry = existing.lastEntryDate
    ? dayjs(existing.lastEntryDate).tz(TOKYO_TZ)
    : null
  const currentEntry = dayjs(entryDate).tz(TOKYO_TZ)

  let newStreak = existing.currentStreak

  if (lastEntry) {
    const daysDiff = currentEntry.diff(lastEntry, 'day')
    if (daysDiff === 1) {
      // Consecutive day - increment streak
      newStreak = existing.currentStreak + 1
    } else if (daysDiff > 1) {
      // Gap - reset streak
      newStreak = 1
    }
    // If daysDiff === 0 (same day), keep the same streak
  }

  const newLongestStreak = Math.max(existing.longestStreak, newStreak)

  await db
    .updateTable('userMilestones')
    .set({
      totalEntries: existing.totalEntries + 1,
      currentStreak: newStreak,
      longestStreak: newLongestStreak,
      lastEntryDate: entryDate,
      updatedAt: now,
    })
    .where('userId', '=', userId)
    .execute()

  return {
    ...existing,
    totalEntries: existing.totalEntries + 1,
    currentStreak: newStreak,
    longestStreak: newLongestStreak,
    lastEntryDate: entryDate,
    updatedAt: now,
  }
}

/**
 * Mark a milestone as celebrated
 */
export async function markMilestoneCelebrated(
  userId: string,
  milestoneKey: string,
): Promise<void> {
  const now = dayjs().utc().toISOString()
  const existing = await getUserMilestones(userId)

  if (!existing) return

  const celebrated: string[] = existing.lastMilestoneCelebrated
    ? JSON.parse(existing.lastMilestoneCelebrated)
    : []

  celebrated.push(milestoneKey)

  await db
    .updateTable('userMilestones')
    .set({
      lastMilestoneCelebrated: JSON.stringify(celebrated),
      updatedAt: now,
    })
    .where('userId', '=', userId)
    .execute()
}

/**
 * Check if a milestone was already celebrated
 */
export async function wasMilestoneCelebrated(
  userId: string,
  milestoneKey: string,
): Promise<boolean> {
  const existing = await getUserMilestones(userId)
  if (!existing?.lastMilestoneCelebrated) return false

  const celebrated: string[] = JSON.parse(existing.lastMilestoneCelebrated)
  return celebrated.includes(milestoneKey)
}

/**
 * Get users who have diary settings configured
 */
export async function getActiveUsers(): Promise<
  Array<{ userId: string; channelId: string }>
> {
  const users = await db
    .selectFrom('userDiarySettings')
    .select(['userId', 'diaryChannelId'])
    .where('reminderEnabled', '=', 1)
    .where('diaryChannelId', 'is not', null)
    .execute()

  return users
    .filter((u) => u.diaryChannelId !== null)
    .map((u) => ({
      userId: u.userId,
      channelId: u.diaryChannelId as string,
    }))
}

/**
 * Get diary entry from exactly 1 year ago
 */
export async function getAnniversaryEntry(
  userId: string,
  targetDate: string,
): Promise<
  { id: string; detail: string | null; moodLabel: string | null } | undefined
> {
  return db
    .selectFrom('diaryEntries')
    .select(['id', 'detail', 'moodLabel'])
    .where('userId', '=', userId)
    .where('entryDate', '=', targetDate)
    .executeTakeFirst()
}

/**
 * Get recent diary entries for pattern analysis
 */
export async function getRecentEntries(
  userId: string,
  days: number = 7,
): Promise<
  Array<{ entryDate: string; detail: string | null; moodLabel: string | null }>
> {
  const cutoffDate = dayjs()
    .tz(TOKYO_TZ)
    .subtract(days, 'day')
    .format('YYYY-MM-DD')

  return db
    .selectFrom('diaryEntries')
    .select(['entryDate', 'detail', 'moodLabel'])
    .where('userId', '=', userId)
    .where('entryDate', '>=', cutoffDate)
    .orderBy('entryDate', 'desc')
    .execute()
}

/**
 * Get brief entries (short entries that might need follow-up)
 */
export async function getBriefEntries(
  userId: string,
  days: number = 3,
  maxLength: number = 30,
): Promise<Array<{ id: string; entryDate: string; detail: string }>> {
  const cutoffDate = dayjs()
    .tz(TOKYO_TZ)
    .subtract(days, 'day')
    .format('YYYY-MM-DD')

  const entries = await db
    .selectFrom('diaryEntries')
    .select(['id', 'entryDate', 'detail'])
    .where('userId', '=', userId)
    .where('entryDate', '>=', cutoffDate)
    .where('detail', 'is not', null)
    .orderBy('entryDate', 'desc')
    .execute()

  return entries
    .filter(
      (e) => e.detail && e.detail.length <= maxLength && e.detail.length > 0,
    )
    .map((e) => ({
      id: e.id,
      entryDate: e.entryDate,
      detail: e.detail as string,
    }))
}
