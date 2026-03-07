/**
 * Full-text search service for diary entries
 *
 * Uses FTS5 with trigram tokenizer for Japanese text search.
 * Provides search functions for both user-facing search and AI context retrieval.
 */

import { sql } from 'kysely'
import { db } from './db'

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

  // FTS5 search with BM25 ranking using raw SQL
  // FTS5 virtual tables require special MATCH syntax that Kysely doesn't natively support
  const results = await sql<DiarySearchResult>`
    SELECT
      entry_id as "entryId",
      user_id as "userId",
      entry_date as "entryDate",
      detail,
      bm25(diary_entries_fts) as rank
    FROM diary_entries_fts
    WHERE user_id = ${userId}
      AND diary_entries_fts MATCH ${query}
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
  if (searchTerms.length === 0) {
    return []
  }

  // Search for each term and collect results
  const allResults: Map<string, DiarySearchResult> = new Map()

  for (const term of searchTerms) {
    if (term.length < 2) continue // Skip very short terms

    const results = await searchDiaryEntries(userId, term, maxEntries * 2)
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
 * Extract search keywords from text
 *
 * Extracts meaningful keywords from diary text or mentions for search.
 * Focuses on nouns, proper nouns, and meaningful phrases.
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

  // Remove common Japanese particles, conjunctions, and filler words
  const stopWords = new Set([
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

  // Extract potential keywords
  // 1. Quoted phrases (「」or "")
  const quotedPhrases =
    text.match(/[「『""]([^」』""]+)[」』""]/g)?.map((m) => m.slice(1, -1)) ||
    []

  // 2. Capitalized words (likely proper nouns)
  const capitalizedWords =
    text.match(/[A-Z][a-zA-Z0-9]+/g)?.filter((w) => w.length > 2) || []

  // 3. Japanese katakana words (often proper nouns or technical terms)
  const katakanaWords =
    text.match(/[ァ-ヴー]{3,}/g)?.filter((w) => w.length >= 3) || []

  // 4. Numbers with context (dates, amounts)
  const numbersWithContext =
    text.match(/\d+[年月日時分秒円個回%％]/g)?.slice(0, 2) || []

  // 5. Compound nouns (sequences of kanji)
  const kanjiCompounds =
    text.match(/[一-龯]{2,}/g)?.filter((w) => !stopWords.has(w)) || []

  // Combine and deduplicate
  const allKeywords = [
    ...quotedPhrases,
    ...capitalizedWords,
    ...katakanaWords,
    ...numbersWithContext,
    ...kanjiCompounds,
  ]

  // Deduplicate and limit
  const seen = new Set<string>()
  const keywords: string[] = []

  for (const keyword of allKeywords) {
    const normalized = keyword.toLowerCase()
    if (!seen.has(normalized) && keyword.length >= 2) {
      seen.add(normalized)
      keywords.push(keyword)
      if (keywords.length >= maxKeywords) break
    }
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
 * This can be used to gracefully fall back to LIKE search
 * if FTS is not available.
 */
export async function isFtsAvailable(): Promise<boolean> {
  try {
    await sql`SELECT 1 FROM diary_entries_fts LIMIT 1`.execute(db)
    return true
  } catch {
    return false
  }
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
