/**
 * Service for retrieving and formatting user memories for AI context
 *
 * This handles:
 * - Scoring and prioritizing memories for retrieval
 * - Building formatted context summaries for AI prompts
 * - Managing the context cache for performance
 */

import { sql } from 'kysely'
import type { Database } from './db'
import { db } from './db'
import {
  type MemoryCategory,
  type UserMemory,
  CATEGORY_LABELS,
  getCachedContext,
  updateContextCache,
} from './memory'

export interface RetrievedMemoryContext {
  /** Pre-formatted summary for AI prompt */
  summary: string
  /** Raw memories for programmatic use */
  memories: UserMemory[]
  /** Approximate token count */
  tokenEstimate: number
}

/**
 * Get memory context for AI reply generation
 *
 * Uses a hybrid scoring approach since D1 lacks vector search:
 * - Importance: Higher importance = more relevant
 * - Mention frequency: Frequently mentioned = more central to user
 * - Recency: Recently confirmed = more current
 * - User confirmation: Explicitly confirmed by user
 */
export async function getMemoryContextForReply(
  userId: string,
  maxTokens: number = 500,
): Promise<RetrievedMemoryContext> {
  // Try cache first
  const cached = await getCachedContext(userId)
  if (cached && !cached.invalidatedAt) {
    const memories: UserMemory[] = JSON.parse(cached.memorySnapshot)
    return {
      summary: cached.contextSummary,
      memories,
      tokenEstimate: estimateTokens(cached.contextSummary),
    }
  }

  // Fetch memories with hybrid scoring
  const memories = await db
    .selectFrom('userMemories')
    .selectAll()
    .where('userId', '=', userId)
    .where('isActive', '=', 1)
    .orderBy(
      sql`
        (importance * 0.4) +
        (mention_count * 0.3) +
        (CASE WHEN last_confirmed_at > datetime('now', '-7 days') THEN 2 ELSE 0 END) +
        (CASE WHEN user_confirmed = 1 THEN 1 ELSE 0 END)
      `,
      'desc',
    )
    .limit(20)
    .execute()

  if (memories.length === 0) {
    return {
      summary: '',
      memories: [],
      tokenEstimate: 0,
    }
  }

  // Build context string
  const summary = buildMemorySummary(memories, maxTokens)

  // Update cache
  await updateContextCache(userId, summary, memories)

  return {
    summary,
    memories,
    tokenEstimate: estimateTokens(summary),
  }
}

/**
 * Get memories of specific types for targeted context
 */
export async function getMemoriesForType(
  userId: string,
  types: Database['userMemories']['memoryType'][],
  limit: number = 10,
): Promise<UserMemory[]> {
  return db
    .selectFrom('userMemories')
    .selectAll()
    .where('userId', '=', userId)
    .where('memoryType', 'in', types)
    .where('isActive', '=', 1)
    .orderBy('importance', 'desc')
    .orderBy('lastConfirmedAt', 'desc')
    .limit(limit)
    .execute()
}

/**
 * Get goal-related memories for progress check-ins
 */
export async function getGoalMemories(userId: string): Promise<UserMemory[]> {
  return db
    .selectFrom('userMemories')
    .selectAll()
    .where('userId', '=', userId)
    .where('memoryType', '=', 'goal')
    .where('isActive', '=', 1)
    .orderBy('importance', 'desc')
    .execute()
}

/**
 * Get pattern memories for proactive support
 */
export async function getPatternMemories(
  userId: string,
): Promise<UserMemory[]> {
  return db
    .selectFrom('userMemories')
    .selectAll()
    .where('userId', '=', userId)
    .where('memoryType', 'in', ['pattern', 'emotion_trigger'])
    .where('isActive', '=', 1)
    .orderBy('importance', 'desc')
    .execute()
}

/**
 * Get relationship memories for personalized interactions
 */
export async function getRelationshipMemories(
  userId: string,
): Promise<UserMemory[]> {
  return db
    .selectFrom('userMemories')
    .selectAll()
    .where('userId', '=', userId)
    .where('memoryType', '=', 'relationship')
    .where('isActive', '=', 1)
    .orderBy('mentionCount', 'desc')
    .execute()
}

/**
 * Search memories by content (simple keyword matching)
 */
export async function searchMemories(
  userId: string,
  query: string,
  limit: number = 10,
): Promise<UserMemory[]> {
  const searchPattern = `%${query}%`

  return db
    .selectFrom('userMemories')
    .selectAll()
    .where('userId', '=', userId)
    .where('isActive', '=', 1)
    .where('content', 'like', searchPattern)
    .orderBy('importance', 'desc')
    .limit(limit)
    .execute()
}

/**
 * Get memories grouped by category for display
 */
export async function getMemoriesGroupedByCategory(
  userId: string,
): Promise<Record<MemoryCategory, UserMemory[]>> {
  const memories = await db
    .selectFrom('userMemories')
    .selectAll()
    .where('userId', '=', userId)
    .where('isActive', '=', 1)
    .orderBy('category', 'asc')
    .orderBy('importance', 'desc')
    .execute()

  const grouped: Record<MemoryCategory, UserMemory[]> = {
    work: [],
    health: [],
    hobby: [],
    family: [],
    personal: [],
    general: [],
  }

  for (const memory of memories) {
    const category = (memory.category ?? 'general') as MemoryCategory
    grouped[category].push(memory)
  }

  return grouped
}

// ============================================
// Helper Functions
// ============================================

/**
 * Build a formatted memory summary for AI prompts
 */
function buildMemorySummary(memories: UserMemory[], maxTokens: number): string {
  if (memories.length === 0) return ''

  // Group by category
  const grouped: Record<string, UserMemory[]> = {}

  for (const memory of memories) {
    const category = memory.category ?? 'general'
    if (!grouped[category]) grouped[category] = []
    grouped[category].push(memory)
  }

  // Build formatted summary
  let summary = '## このユーザーについて知っていること\n'

  // Priority order for categories
  const categoryOrder: MemoryCategory[] = [
    'work',
    'family',
    'personal',
    'health',
    'hobby',
    'general',
  ]

  for (const category of categoryOrder) {
    const categoryMemories = grouped[category]
    if (!categoryMemories || categoryMemories.length === 0) continue

    const label = CATEGORY_LABELS[category]
    summary += `\n### ${label}\n`

    for (const memory of categoryMemories) {
      summary += `- ${memory.content}\n`
    }
  }

  // Truncate if exceeds token budget
  return truncateToTokens(summary, maxTokens)
}

/**
 * Estimate token count for a string (rough approximation)
 * Japanese characters are roughly 1-2 tokens each
 */
function estimateTokens(text: string): number {
  // Count Japanese characters (hiragana, katakana, kanji)
  const japaneseChars = (
    text.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g) || []
  ).length
  // Count other characters
  const otherChars = text.length - japaneseChars

  // Japanese characters average about 1.5 tokens each
  // Other characters average about 0.25 tokens each (4 chars per token for English)
  return Math.ceil(japaneseChars * 1.5 + otherChars * 0.25)
}

/**
 * Truncate text to fit within token budget
 */
function truncateToTokens(text: string, maxTokens: number): string {
  const currentTokens = estimateTokens(text)
  if (currentTokens <= maxTokens) return text

  // Binary search for the right length
  const lines = text.split('\n')
  let result = ''
  let tokens = 0

  for (const line of lines) {
    const lineTokens = estimateTokens(line + '\n')
    if (tokens + lineTokens > maxTokens) break
    result += line + '\n'
    tokens += lineTokens
  }

  return result.trimEnd()
}

/**
 * Format a memory for display (includes metadata)
 */
export function formatMemoryForDisplay(memory: UserMemory): string {
  const typeLabels: Record<UserMemory['memoryType'], string> = {
    fact: '事実',
    preference: '好み',
    pattern: 'パターン',
    relationship: '関係',
    goal: '目標',
    emotion_trigger: '感情トリガー',
  }

  const typeLabel = typeLabels[memory.memoryType]
  const categoryLabel = memory.category
    ? CATEGORY_LABELS[memory.category as MemoryCategory]
    : ''

  const parts = [memory.content]
  if (typeLabel) parts.push(`[${typeLabel}]`)
  if (categoryLabel) parts.push(`[${categoryLabel}]`)

  return parts.join(' ')
}

/**
 * Get a brief summary of user's memory profile
 */
export async function getMemoryStats(userId: string): Promise<{
  totalCount: number
  byType: Record<string, number>
  byCategory: Record<string, number>
  oldestMemory: string | null
  newestMemory: string | null
}> {
  const memories = await db
    .selectFrom('userMemories')
    .selectAll()
    .where('userId', '=', userId)
    .where('isActive', '=', 1)
    .execute()

  const byType: Record<string, number> = {}
  const byCategory: Record<string, number> = {}
  let oldest: string | null = null
  let newest: string | null = null

  for (const memory of memories) {
    // Count by type
    byType[memory.memoryType] = (byType[memory.memoryType] || 0) + 1

    // Count by category
    const cat = memory.category ?? 'general'
    byCategory[cat] = (byCategory[cat] || 0) + 1

    // Track oldest/newest
    if (!oldest || memory.firstObservedAt < oldest) {
      oldest = memory.firstObservedAt
    }
    if (!newest || memory.lastConfirmedAt > newest) {
      newest = memory.lastConfirmedAt
    }
  }

  return {
    totalCount: memories.length,
    byType,
    byCategory,
    oldestMemory: oldest,
    newestMemory: newest,
  }
}
