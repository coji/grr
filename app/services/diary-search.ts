/**
 * Full-text search service for diary entries
 *
 * Uses FTS5 with Intl.Segmenter for Japanese text search.
 * Based on: https://zenn.dev/coji/articles/cloudflare-d1-fts5-japanese-search-api
 */

import { sql } from 'kysely'
import { db } from './db'

// ============================================
// Module-level Constants & Segmenter
// ============================================

/** Cached FTS availability status (null = not checked yet) */
let ftsAvailableCache: boolean | null = null

/** Japanese word segmenter using V8's built-in Intl.Segmenter */
const segmenter = new Intl.Segmenter('ja', { granularity: 'word' })

/**
 * Tokenize text for FTS5 storage and search
 * Uses Intl.Segmenter for accurate Japanese word segmentation
 */
export function tokenize(text: string): string {
  return [...segmenter.segment(text)]
    .filter((s) => s.isWordLike)
    .map((s) => s.segment)
    .join(' ')
}

/**
 * Build FTS5 MATCH query from tokenized text
 * Wraps each token in double quotes for exact matching
 */
export function buildMatchQuery(text: string): string {
  const tokens = tokenize(text)
  return tokens
    .split(' ')
    .filter(Boolean)
    .map((t) => `"${t.replaceAll('"', '""')}"`)
    .join(' ')
}

/** Common Japanese and English stop words for keyword extraction */
const STOP_WORDS = new Set([
  // Japanese particles and conjunctions
  'の',
  'に',
  'は',
  'を',
  'が',
  'と',
  'で',
  'た',
  'て',
  'も',
  'です',
  'ます',
  'した',
  'する',
  'ない',
  'いる',
  'ある',
  'これ',
  'それ',
  'あれ',
  'この',
  'その',
  'あの',
  'から',
  'まで',
  'より',
  'など',
  'けど',
  'でも',
  'だけ',
  'ので',
  'という',
  'って',
  'ちょっと',
  'すごく',
  'とても',
  'かなり',
  'やっぱり',
  'なんか',
  'ちゃんと',
  'しっかり',
  'きちんと',
  // English common words
  'the',
  'a',
  'an',
  'is',
  'are',
  'was',
  'were',
  'and',
  'or',
  'but',
  'in',
  'on',
  'at',
  'to',
  'for',
])

export interface DiarySearchResult {
  entryId: string
  userId: string
  entryDate: string
  detail: string
  /** BM25 relevance score (lower is more relevant) */
  rank: number
}

export interface SearchContextEntry {
  entryDate: string
  detail: string
  relevance: 'high' | 'medium' | 'low'
}

/**
 * Search diary entries using FTS5 full-text search
 *
 * @param userId - User ID to search within
 * @param query - Search query (supports Japanese text)
 * @param limit - Maximum number of results
 * @returns Search results ordered by relevance
 */
export async function searchDiaryEntries(
  userId: string,
  query: string,
  limit: number = 10,
): Promise<DiarySearchResult[]> {
  if (!query.trim()) {
    return []
  }

  // Build match query with tokenized and quoted terms
  const matchQuery = buildMatchQuery(query)
  if (!matchQuery) {
    return []
  }

  // FTS5 search with BM25 ranking using raw SQL
  const results = await sql<DiarySearchResult>`
    SELECT
      entry_id as "entryId",
      user_id as "userId",
      entry_date as "entryDate",
      detail,
      bm25(diary_entries_fts) as rank
    FROM diary_entries_fts
    WHERE user_id = ${userId}
      AND diary_entries_fts MATCH ${matchQuery}
    ORDER BY bm25(diary_entries_fts)
    LIMIT ${limit}
  `.execute(db)

  return results.rows
}

/**
 * Get relevant past diary entries for AI context
 *
 * This function searches for diary entries related to the current entry
 * or mention, providing context for more personalized AI responses.
 *
 * @param userId - User ID
 * @param searchTerms - Keywords or phrases to search for
 * @param maxEntries - Maximum number of entries to return
 * @param excludeDate - Date to exclude (usually today's entry)
 * @returns Formatted search context for AI prompts
 */
export async function getSearchContextForAI(
  userId: string,
  searchTerms: string[],
  maxEntries: number = 5,
  excludeDate?: string,
): Promise<SearchContextEntry[]> {
  // Filter valid terms first
  const validTerms = searchTerms.filter((term) => term.length >= 2)
  if (validTerms.length === 0) {
    return []
  }

  // Check FTS availability (uses cache)
  const ftsAvailable = await isFtsAvailable()
  if (!ftsAvailable) {
    return []
  }

  // Search for all terms in parallel
  const searchPromises = validTerms.map((term) =>
    searchDiaryEntries(userId, term, maxEntries * 2),
  )
  const resultsArrays = await Promise.all(searchPromises)

  // Collect and deduplicate results, keeping best rank for each entry
  const allResults: Map<string, DiarySearchResult> = new Map()
  for (const results of resultsArrays) {
    for (const result of results) {
      // Skip excluded date
      if (excludeDate && result.entryDate === excludeDate) continue

      // Keep the best rank for each entry
      const existing = allResults.get(result.entryId)
      if (!existing || result.rank < existing.rank) {
        allResults.set(result.entryId, result)
      }
    }
  }

  // Sort by rank and take top entries
  const sorted = Array.from(allResults.values())
    .sort((a, b) => a.rank - b.rank)
    .slice(0, maxEntries)

  // Convert to SearchContextEntry with relevance levels
  return sorted.map((result, index) => ({
    entryDate: result.entryDate,
    detail: truncateText(result.detail, 200),
    relevance: getRelevanceLevel(index, sorted.length),
  }))
}

/**
 * Extract search keywords from text using Intl.Segmenter
 *
 * Uses V8's built-in word segmentation for accurate Japanese tokenization.
 * Filters out stop words and short tokens.
 *
 * @param text - Input text to extract keywords from
 * @param maxKeywords - Maximum number of keywords to extract
 * @returns Array of keywords
 */
export function extractSearchKeywords(
  text: string,
  maxKeywords: number = 5,
): string[] {
  if (!text.trim()) return []

  // Use Intl.Segmenter for word segmentation
  const segments = [...segmenter.segment(text)]
    .filter((s) => s.isWordLike)
    .map((s) => s.segment)

  // Filter and deduplicate
  const seen = new Set<string>()
  const keywords: string[] = []

  for (const word of segments) {
    const normalized = word.toLowerCase()
    // Skip stop words, short words, and duplicates
    if (
      STOP_WORDS.has(word) ||
      STOP_WORDS.has(normalized) ||
      word.length < 2 ||
      seen.has(normalized)
    ) {
      continue
    }

    seen.add(normalized)
    keywords.push(word)

    if (keywords.length >= maxKeywords) break
  }

  return keywords
}

/**
 * Format search context for AI prompts
 *
 * @param entries - Search context entries
 * @returns Formatted string for AI prompt
 */
export function formatSearchContextForPrompt(
  entries: SearchContextEntry[],
): string {
  if (entries.length === 0) return ''

  const lines = ['## 関連する過去の日記']

  for (const entry of entries) {
    const dateLabel = entry.entryDate
    lines.push(`- ${dateLabel}: ${entry.detail}`)
  }

  lines.push('')
  lines.push(
    '_上記の過去の記録を自然に参照して、ユーザーの話を覚えていることを示してください。_',
  )

  return lines.join('\n')
}

/**
 * Check if FTS table is available
 *
 * Uses cached result to avoid repeated DB queries.
 * This can be used to gracefully fall back to LIKE search
 * if FTS is not available.
 */
export async function isFtsAvailable(): Promise<boolean> {
  if (ftsAvailableCache !== null) {
    return ftsAvailableCache
  }

  try {
    await sql`SELECT 1 FROM diary_entries_fts LIMIT 1`.execute(db)
    ftsAvailableCache = true
  } catch {
    ftsAvailableCache = false
  }

  return ftsAvailableCache
}

/**
 * Fallback search using LIKE (for when FTS is not available)
 */
export async function searchDiaryEntriesFallback(
  userId: string,
  query: string,
  limit: number = 10,
): Promise<DiarySearchResult[]> {
  if (!query.trim()) {
    return []
  }

  const results = await db
    .selectFrom('diaryEntries')
    .select(['id', 'userId', 'entryDate', 'detail'])
    .where('userId', '=', userId)
    .where('detail', 'like', `%${query}%`)
    .orderBy('entryDate', 'desc')
    .limit(limit)
    .execute()

  return results.map((r, index) => ({
    entryId: r.id,
    userId: r.userId,
    entryDate: r.entryDate,
    detail: r.detail ?? '',
    rank: index, // Fake rank based on position
  }))
}

// ============================================
// Helper Functions
// ============================================

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}...`
}

function getRelevanceLevel(
  index: number,
  total: number,
): 'high' | 'medium' | 'low' {
  if (index === 0) return 'high'
  if (index < total / 2) return 'medium'
  return 'low'
}

// ============================================
// FTS Index Management
// ============================================

/**
 * Index a diary entry in FTS
 * Call this when a diary entry is created
 */
export async function indexDiaryEntry(
  entryId: string,
  userId: string,
  entryDate: string,
  detail: string,
): Promise<void> {
  if (!detail.trim()) return

  const tokenizedDetail = tokenize(detail)
  await sql`
    INSERT INTO diary_entries_fts (entry_id, user_id, entry_date, detail)
    VALUES (${entryId}, ${userId}, ${entryDate}, ${tokenizedDetail})
  `.execute(db)
}

/**
 * Update a diary entry in FTS
 * Call this when a diary entry's detail is updated
 */
export async function updateDiaryEntryIndex(
  entryId: string,
  userId: string,
  entryDate: string,
  detail: string | null,
): Promise<void> {
  // Delete existing entry first
  await sql`
    DELETE FROM diary_entries_fts WHERE entry_id = ${entryId}
  `.execute(db)

  // Re-insert if detail is not empty
  if (detail?.trim()) {
    const tokenizedDetail = tokenize(detail)
    await sql`
      INSERT INTO diary_entries_fts (entry_id, user_id, entry_date, detail)
      VALUES (${entryId}, ${userId}, ${entryDate}, ${tokenizedDetail})
    `.execute(db)
  }
}

/**
 * Remove a diary entry from FTS
 * Call this when a diary entry is deleted
 */
export async function removeDiaryEntryIndex(entryId: string): Promise<void> {
  await sql`
    DELETE FROM diary_entries_fts WHERE entry_id = ${entryId}
  `.execute(db)
}

/**
 * Rebuild FTS index for all diary entries
 * Use this to populate FTS after migration or to repair the index
 */
export async function rebuildFtsIndex(): Promise<number> {
  // Clear existing index
  await sql`DELETE FROM diary_entries_fts`.execute(db)

  // Get all diary entries with detail
  const entries = await db
    .selectFrom('diaryEntries')
    .select(['id', 'userId', 'entryDate', 'detail'])
    .where('detail', 'is not', null)
    .where('detail', '!=', '')
    .execute()

  // Insert tokenized entries
  let indexed = 0
  for (const entry of entries) {
    if (entry.detail) {
      const tokenizedDetail = tokenize(entry.detail)
      await sql`
        INSERT INTO diary_entries_fts (entry_id, user_id, entry_date, detail)
        VALUES (${entry.id}, ${entry.userId}, ${entry.entryDate}, ${tokenizedDetail})
      `.execute(db)
      indexed++
    }
  }

  return indexed
}
