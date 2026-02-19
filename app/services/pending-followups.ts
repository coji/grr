/**
 * Service for managing pending follow-up reminders (Heartbeat feature)
 *
 * When a user mentions a future event in their diary (e.g., "明日プレゼンがある"),
 * we store a pending follow-up to ask about it later.
 */

import { nanoid } from 'nanoid'
import dayjs from '~/lib/dayjs'
import { detectFutureEvents } from './ai'
import type { Database } from './db'
import { db } from './db'

export type PendingFollowup = Database['pendingFollowups']

export interface CreateFollowupInput {
  entryId: string
  userId: string
  channelId: string
  eventDescription: string
  eventDate: string
  followUpDate: string
  followUpType?: 'how_did_it_go' | 'reminder'
}

/**
 * Create a pending follow-up
 */
export async function createPendingFollowup(
  input: CreateFollowupInput,
): Promise<PendingFollowup> {
  const now = dayjs().utc().toISOString()

  const followup: PendingFollowup = {
    id: nanoid(),
    entryId: input.entryId,
    userId: input.userId,
    channelId: input.channelId,
    eventDescription: input.eventDescription,
    eventDate: input.eventDate,
    followUpDate: input.followUpDate,
    followUpType: input.followUpType || 'how_did_it_go',
    messageTs: null,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  }

  await db.insertInto('pendingFollowups').values(followup).execute()

  return followup
}

/**
 * Detect future events in entry text and create pending follow-ups
 */
export async function detectAndStoreFutureEvents(
  entryId: string,
  userId: string,
  channelId: string,
  entryText: string,
  currentDate?: string,
): Promise<PendingFollowup[]> {
  if (!entryText || entryText.trim().length === 0) {
    return []
  }

  // Detect future events using AI
  const futureEvents = await detectFutureEvents({
    entryText,
    currentDate,
  })

  if (futureEvents.length === 0) {
    return []
  }

  // Check for existing pending follow-ups to avoid duplicates
  const existingFollowups = await getPendingFollowupsForUser(userId)
  const existingDescriptions = new Set(
    existingFollowups
      .filter((f) => f.status === 'pending')
      .map((f) => f.eventDescription.toLowerCase()),
  )

  const followups: PendingFollowup[] = []

  for (const event of futureEvents) {
    // Skip if similar event already exists
    if (existingDescriptions.has(event.description.toLowerCase())) {
      console.log(
        `Skipping duplicate follow-up for "${event.description}" (user: ${userId})`,
      )
      continue
    }

    const followup = await createPendingFollowup({
      entryId,
      userId,
      channelId,
      eventDescription: event.description,
      eventDate: event.eventDate,
      followUpDate: event.followUpDate,
    })

    followups.push(followup)
    console.log(
      `Created pending follow-up: "${event.description}" on ${event.followUpDate} (user: ${userId})`,
    )
  }

  return followups
}

/**
 * Get all pending follow-ups for a specific date
 */
export async function getPendingFollowupsForDate(
  date: string,
): Promise<PendingFollowup[]> {
  return db
    .selectFrom('pendingFollowups')
    .selectAll()
    .where('followUpDate', '=', date)
    .where('status', '=', 'pending')
    .orderBy('createdAt', 'asc')
    .execute()
}

/**
 * Get all pending follow-ups for a user
 */
export async function getPendingFollowupsForUser(
  userId: string,
): Promise<PendingFollowup[]> {
  return db
    .selectFrom('pendingFollowups')
    .selectAll()
    .where('userId', '=', userId)
    .orderBy('followUpDate', 'asc')
    .execute()
}

/**
 * Get pending follow-up by message timestamp (to detect replies)
 */
export async function getFollowupByMessageTs(
  messageTs: string,
): Promise<PendingFollowup | undefined> {
  return db
    .selectFrom('pendingFollowups')
    .selectAll()
    .where('messageTs', '=', messageTs)
    .executeTakeFirst()
}

/**
 * Mark a follow-up as sent with the message timestamp
 */
export async function markFollowupAsSent(
  followupId: string,
  messageTs: string,
): Promise<void> {
  const now = dayjs().utc().toISOString()

  await db
    .updateTable('pendingFollowups')
    .set({
      status: 'sent',
      messageTs,
      updatedAt: now,
    })
    .where('id', '=', followupId)
    .execute()
}

/**
 * Mark a follow-up as answered
 */
export async function markFollowupAsAnswered(
  followupId: string,
): Promise<void> {
  const now = dayjs().utc().toISOString()

  await db
    .updateTable('pendingFollowups')
    .set({
      status: 'answered',
      updatedAt: now,
    })
    .where('id', '=', followupId)
    .execute()
}

/**
 * Mark old pending follow-ups as expired
 * Should be called periodically to clean up
 */
export async function expireOldFollowups(
  olderThanDays: number = 7,
): Promise<number> {
  const now = dayjs().utc().toISOString()
  const cutoffDate = dayjs()
    .tz('Asia/Tokyo')
    .subtract(olderThanDays, 'day')
    .format('YYYY-MM-DD')

  const result = await db
    .updateTable('pendingFollowups')
    .set({
      status: 'expired',
      updatedAt: now,
    })
    .where('status', '=', 'pending')
    .where('followUpDate', '<', cutoffDate)
    .execute()

  return Number(result[0]?.numUpdatedRows || 0)
}

/**
 * Get follow-up statistics for a user
 */
export async function getFollowupStats(userId: string): Promise<{
  pending: number
  sent: number
  answered: number
  expired: number
  total: number
}> {
  const followups = await getPendingFollowupsForUser(userId)

  const stats = {
    pending: 0,
    sent: 0,
    answered: 0,
    expired: 0,
    total: followups.length,
  }

  for (const followup of followups) {
    if (followup.status === 'pending') stats.pending++
    else if (followup.status === 'sent') stats.sent++
    else if (followup.status === 'answered') stats.answered++
    else if (followup.status === 'expired') stats.expired++
  }

  return stats
}

/**
 * Get the original diary entry for a follow-up
 */
export async function getFollowupWithEntry(followupId: string): Promise<{
  followup: PendingFollowup
  entryDetail: string | null
} | null> {
  const result = await db
    .selectFrom('pendingFollowups')
    .leftJoin('diaryEntries', 'pendingFollowups.entryId', 'diaryEntries.id')
    .select([
      'pendingFollowups.id',
      'pendingFollowups.entryId',
      'pendingFollowups.userId',
      'pendingFollowups.channelId',
      'pendingFollowups.eventDescription',
      'pendingFollowups.eventDate',
      'pendingFollowups.followUpDate',
      'pendingFollowups.followUpType',
      'pendingFollowups.messageTs',
      'pendingFollowups.status',
      'pendingFollowups.createdAt',
      'pendingFollowups.updatedAt',
      'diaryEntries.detail as entryDetail',
    ])
    .where('pendingFollowups.id', '=', followupId)
    .executeTakeFirst()

  if (!result) {
    return null
  }

  return {
    followup: {
      id: result.id,
      entryId: result.entryId,
      userId: result.userId,
      channelId: result.channelId,
      eventDescription: result.eventDescription,
      eventDate: result.eventDate,
      followUpDate: result.followUpDate,
      followUpType: result.followUpType as 'how_did_it_go' | 'reminder',
      messageTs: result.messageTs,
      status: result.status as 'pending' | 'sent' | 'answered' | 'expired',
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
    },
    entryDetail: result.entryDetail,
  }
}
