/**
 * Service for managing user memories
 *
 * This handles CRUD operations for user memories extracted from diary entries.
 * Memories are facts, preferences, patterns, relationships, goals, and emotion triggers
 * that the AI learns about users over time.
 */

import { env } from 'cloudflare:workers'
import { sql } from 'kysely'
import { nanoid } from 'nanoid'
import dayjs from '~/lib/dayjs'
import type { Database } from './db'
import { db } from './db'

export type UserMemory = Database['userMemories']
export type MemoryExtraction = Database['memoryExtractions']
export type MemoryContextCache = Database['memoryContextCache']

export type MemoryType = UserMemory['memoryType']
export type MemoryCategory = NonNullable<UserMemory['category']>

export const MEMORY_TYPES: MemoryType[] = [
  'fact',
  'preference',
  'pattern',
  'relationship',
  'goal',
  'emotion_trigger',
]

export const MEMORY_CATEGORIES: MemoryCategory[] = [
  'work',
  'health',
  'hobby',
  'family',
  'personal',
  'general',
]

export const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  work: '仕事',
  health: '健康',
  hobby: '趣味',
  family: '家族',
  personal: 'プライベート',
  general: 'その他',
}

// ============================================
// Memory CRUD Operations
// ============================================

/**
 * Create a new memory for a user
 */
export async function createMemory(input: {
  userId: string
  memoryType: MemoryType
  category?: MemoryCategory
  content: string
  sourceEntryIds?: string[]
  confidence?: number
  importance?: number
}): Promise<UserMemory> {
  const now = dayjs().utc().toISOString()

  const memory: UserMemory = {
    id: nanoid(),
    userId: input.userId,
    memoryType: input.memoryType,
    category: input.category ?? 'general',
    content: input.content,
    sourceEntryIds: input.sourceEntryIds
      ? JSON.stringify(input.sourceEntryIds)
      : null,
    confidence: input.confidence ?? 1.0,
    importance: input.importance ?? 5,
    firstObservedAt: now,
    lastConfirmedAt: now,
    mentionCount: 1,
    isActive: 1,
    supersededBy: null,
    userConfirmed: 0,
    createdAt: now,
    updatedAt: now,
  }

  await db.insertInto('userMemories').values(memory).execute()

  return memory
}

/**
 * Get all active memories for a user
 */
export async function getActiveMemories(userId: string): Promise<UserMemory[]> {
  return db
    .selectFrom('userMemories')
    .selectAll()
    .where('userId', '=', userId)
    .where('isActive', '=', 1)
    .orderBy('importance', 'desc')
    .orderBy('lastConfirmedAt', 'desc')
    .execute()
}

/**
 * Get memories by type
 */
export async function getMemoriesByType(
  userId: string,
  memoryType: MemoryType,
): Promise<UserMemory[]> {
  return db
    .selectFrom('userMemories')
    .selectAll()
    .where('userId', '=', userId)
    .where('memoryType', '=', memoryType)
    .where('isActive', '=', 1)
    .orderBy('importance', 'desc')
    .execute()
}

/**
 * Get memories by category
 */
export async function getMemoriesByCategory(
  userId: string,
  category: MemoryCategory,
): Promise<UserMemory[]> {
  return db
    .selectFrom('userMemories')
    .selectAll()
    .where('userId', '=', userId)
    .where('category', '=', category)
    .where('isActive', '=', 1)
    .orderBy('importance', 'desc')
    .execute()
}

/**
 * Get a single memory by ID
 */
export async function getMemoryById(
  memoryId: string,
): Promise<UserMemory | undefined> {
  return db
    .selectFrom('userMemories')
    .selectAll()
    .where('id', '=', memoryId)
    .executeTakeFirst()
}

/**
 * Update an existing memory
 */
export async function updateMemory(
  memoryId: string,
  updates: {
    content?: string
    confidence?: number
    importance?: number
    category?: MemoryCategory
    sourceEntryIds?: string[]
  },
): Promise<void> {
  const now = dayjs().utc().toISOString()

  await db
    .updateTable('userMemories')
    .set({
      ...(updates.content !== undefined && { content: updates.content }),
      ...(updates.confidence !== undefined && {
        confidence: updates.confidence,
      }),
      ...(updates.importance !== undefined && {
        importance: updates.importance,
      }),
      ...(updates.category !== undefined && { category: updates.category }),
      ...(updates.sourceEntryIds !== undefined && {
        sourceEntryIds: JSON.stringify(updates.sourceEntryIds),
      }),
      updatedAt: now,
    })
    .where('id', '=', memoryId)
    .execute()
}

/**
 * Confirm a memory (increment mention count and update timestamp)
 */
export async function confirmMemory(memoryId: string): Promise<void> {
  const now = dayjs().utc().toISOString()

  await db
    .updateTable('userMemories')
    .set({
      lastConfirmedAt: now,
      mentionCount: sql`mention_count + 1`,
      updatedAt: now,
    })
    .where('id', '=', memoryId)
    .execute()
}

/**
 * Soft delete a memory (mark as inactive)
 */
export async function deleteMemory(memoryId: string): Promise<void> {
  const now = dayjs().utc().toISOString()

  await db
    .updateTable('userMemories')
    .set({
      isActive: 0,
      updatedAt: now,
    })
    .where('id', '=', memoryId)
    .execute()
}

/**
 * Supersede a memory with a newer version
 */
export async function supersedeMemory(
  oldMemoryId: string,
  newMemoryId: string,
): Promise<void> {
  const now = dayjs().utc().toISOString()

  await db
    .updateTable('userMemories')
    .set({
      isActive: 0,
      supersededBy: newMemoryId,
      updatedAt: now,
    })
    .where('id', '=', oldMemoryId)
    .execute()
}

/**
 * Delete all memories for a user (for privacy/clear all feature)
 */
export async function clearAllMemories(userId: string): Promise<number> {
  const result = await db
    .deleteFrom('userMemories')
    .where('userId', '=', userId)
    .execute()

  // Also clear the context cache
  await db
    .deleteFrom('memoryContextCache')
    .where('userId', '=', userId)
    .execute()

  return Number(result[0]?.numDeletedRows ?? 0)
}

/**
 * Mark a memory as user-confirmed
 */
export async function markMemoryAsUserConfirmed(
  memoryId: string,
): Promise<void> {
  const now = dayjs().utc().toISOString()

  await db
    .updateTable('userMemories')
    .set({
      userConfirmed: 1,
      updatedAt: now,
    })
    .where('id', '=', memoryId)
    .execute()
}

/**
 * Get memory count for a user
 */
export async function getMemoryCount(userId: string): Promise<number> {
  const result = await db
    .selectFrom('userMemories')
    .select(sql<number>`count(*)`.as('count'))
    .where('userId', '=', userId)
    .where('isActive', '=', 1)
    .executeTakeFirst()

  return result?.count ?? 0
}

// ============================================
// Memory Extraction Job Operations
// ============================================

/**
 * Trigger immediate memory extraction via Cloudflare Workflow
 *
 * Unlike queueMemoryExtraction (which waits for HEARTBEAT), this function
 * immediately starts a Workflow to extract memories from the diary entry.
 * Cloudflare Workflows run independently once create() is called.
 */
export async function triggerImmediateMemoryExtraction(
  userId: string,
  entryId: string,
  options?: {
    channelId?: string
    messageTs?: string
    threadTs?: string
  },
): Promise<void> {
  const now = dayjs().utc().toISOString()

  // Check if already processing
  const existing = await db
    .selectFrom('memoryExtractions')
    .select('id')
    .where('entryId', '=', entryId)
    .where('status', 'in', ['pending', 'processing'])
    .executeTakeFirst()

  if (existing) {
    console.log(
      `[Memory] Extraction already in progress for entry ${entryId}, skipping`,
    )
    return
  }

  const extractionId = nanoid()
  const extraction: MemoryExtraction = {
    id: extractionId,
    userId,
    entryId,
    status: 'processing', // Mark as processing immediately
    extractedMemories: null,
    processingNotes: null,
    createdAt: now,
    processedAt: null,
  }

  await db.insertInto('memoryExtractions').values(extraction).execute()

  // Start the workflow immediately (Cloudflare Workflows run independently)
  try {
    await env.MEMORY_EXTRACTION_WORKFLOW.create({
      params: {
        extractionId,
        entryId,
        userId,
        channelId: options?.channelId,
        messageTs: options?.messageTs,
        threadTs: options?.threadTs,
      },
    })
    console.log(
      `[Memory] Started immediate extraction workflow for entry ${entryId}`,
    )
  } catch (error) {
    console.error(
      `[Memory] Failed to start extraction workflow for entry ${entryId}:`,
      error,
    )
    // Mark as failed if workflow creation fails
    await markExtractionFailed(extractionId, String(error))
  }
}

/**
 * Get pending memory extractions (for HEARTBEAT processing)
 */
export async function getPendingExtractions(
  limit: number = 10,
): Promise<MemoryExtraction[]> {
  return db
    .selectFrom('memoryExtractions')
    .selectAll()
    .where('status', '=', 'pending')
    .orderBy('createdAt', 'asc')
    .limit(limit)
    .execute()
}

/**
 * Mark extraction as processing
 */
export async function markExtractionProcessing(
  extractionId: string,
): Promise<void> {
  await db
    .updateTable('memoryExtractions')
    .set({ status: 'processing' })
    .where('id', '=', extractionId)
    .execute()
}

/**
 * Mark extraction as completed
 */
export async function markExtractionCompleted(
  extractionId: string,
  extractedMemories: unknown[],
  notes?: string,
): Promise<void> {
  const now = dayjs().utc().toISOString()

  await db
    .updateTable('memoryExtractions')
    .set({
      status: 'completed',
      extractedMemories: JSON.stringify(extractedMemories),
      processingNotes: notes ?? null,
      processedAt: now,
    })
    .where('id', '=', extractionId)
    .execute()
}

/**
 * Mark extraction as failed
 */
export async function markExtractionFailed(
  extractionId: string,
  error: string,
): Promise<void> {
  const now = dayjs().utc().toISOString()

  await db
    .updateTable('memoryExtractions')
    .set({
      status: 'failed',
      processingNotes: error,
      processedAt: now,
    })
    .where('id', '=', extractionId)
    .execute()
}

/**
 * Clean up old extraction records (older than 30 days)
 */
export async function cleanupOldExtractions(): Promise<number> {
  const cutoffDate = dayjs().utc().subtract(30, 'day').toISOString()

  const result = await db
    .deleteFrom('memoryExtractions')
    .where('status', 'in', ['completed', 'failed'])
    .where('createdAt', '<', cutoffDate)
    .execute()

  return Number(result[0]?.numDeletedRows ?? 0)
}

// ============================================
// Context Cache Operations
// ============================================

/**
 * Get cached memory context for a user
 */
export async function getCachedContext(
  userId: string,
): Promise<MemoryContextCache | undefined> {
  return db
    .selectFrom('memoryContextCache')
    .selectAll()
    .where('userId', '=', userId)
    .executeTakeFirst()
}

/**
 * Update the memory context cache
 */
export async function updateContextCache(
  userId: string,
  contextSummary: string,
  memorySnapshot: unknown,
): Promise<void> {
  const now = dayjs().utc().toISOString()

  const existing = await getCachedContext(userId)

  if (existing) {
    await db
      .updateTable('memoryContextCache')
      .set({
        contextSummary,
        memorySnapshot: JSON.stringify(memorySnapshot),
        lastUpdatedAt: now,
        invalidatedAt: null,
      })
      .where('userId', '=', userId)
      .execute()
  } else {
    const cache: MemoryContextCache = {
      userId,
      contextSummary,
      memorySnapshot: JSON.stringify(memorySnapshot),
      lastUpdatedAt: now,
      invalidatedAt: null,
    }
    await db.insertInto('memoryContextCache').values(cache).execute()
  }
}

/**
 * Invalidate the context cache (when new memories are added)
 */
export async function invalidateContextCache(userId: string): Promise<void> {
  const now = dayjs().utc().toISOString()

  await db
    .updateTable('memoryContextCache')
    .set({ invalidatedAt: now })
    .where('userId', '=', userId)
    .execute()
}

/**
 * Check if context cache is valid
 */
export async function isContextCacheValid(userId: string): Promise<boolean> {
  const cache = await getCachedContext(userId)
  return cache !== undefined && cache.invalidatedAt === null
}
