import { describe, expect, it, vi } from 'vitest'

// Mock the db module to avoid cloudflare:workers import
vi.mock('./db', () => ({
  db: {},
  createDb: vi.fn(),
}))

import {
  buildMatchQuery,
  extractSearchKeywords,
  formatSearchContextForPrompt,
  tokenize,
  type SearchContextEntry,
} from './diary-search'

describe('diary-search', () => {
  describe('tokenize', () => {
    it('should tokenize Japanese text into space-separated words', () => {
      const text = 'コメダでモーニングを食べた'
      const tokens = tokenize(text)

      // Should contain word-like tokens separated by spaces
      expect(tokens).toContain('コメダ')
      expect(tokens).toContain('モーニング')
      // Intl.Segmenter may segment 食べた as 食 + べた or differently
      expect(tokens.length).toBeGreaterThan(0)
    })

    it('should handle mixed Japanese and English text', () => {
      const text = 'Reactでアプリを作った'
      const tokens = tokenize(text)

      expect(tokens).toContain('React')
      expect(tokens).toContain('アプリ')
    })

    it('should return space-separated string', () => {
      const text = 'テスト文章です'
      const tokens = tokenize(text)

      // Result should be space-separated
      expect(tokens.includes(' ')).toBe(true)
    })

    it('should filter non-word-like segments', () => {
      const text = '今日は、天気が良い。'
      const tokens = tokenize(text)

      // Punctuation should be filtered out
      expect(tokens).not.toContain('、')
      expect(tokens).not.toContain('。')
    })
  })

  describe('buildMatchQuery', () => {
    it('should wrap tokens in double quotes', () => {
      const query = 'コメダ モーニング'
      const matchQuery = buildMatchQuery(query)

      expect(matchQuery).toContain('"コメダ"')
      expect(matchQuery).toContain('"モーニング"')
    })

    it('should tokenize input before quoting', () => {
      const query = 'コメダでモーニング'
      const matchQuery = buildMatchQuery(query)

      // Should be tokenized and quoted
      expect(matchQuery).toContain('"コメダ"')
    })

    it('should produce non-empty result for valid input', () => {
      const query = 'テスト検索'
      const matchQuery = buildMatchQuery(query)

      expect(matchQuery.length).toBeGreaterThan(0)
      // Should have quotes
      expect(matchQuery).toContain('"')
    })
  })

  describe('extractSearchKeywords', () => {
    it('should extract meaningful words using Intl.Segmenter', () => {
      const text = 'コメダでモーニングを食べた。パスタも美味しかった。'
      const keywords = extractSearchKeywords(text)

      expect(keywords).toContain('コメダ')
      expect(keywords).toContain('モーニング')
      expect(keywords).toContain('パスタ')
    })

    it('should extract English and Japanese words', () => {
      const text = 'GoogleのAPIを使ってReactアプリを作った'
      const keywords = extractSearchKeywords(text)

      expect(keywords).toContain('Google')
      expect(keywords).toContain('API')
      expect(keywords).toContain('React')
      expect(keywords).toContain('アプリ')
    })

    it('should extract kanji words', () => {
      const text = '整体に行って腰痛が楽になった。開発も順調。'
      const keywords = extractSearchKeywords(text)

      expect(keywords).toContain('整体')
      expect(keywords).toContain('腰痛')
      expect(keywords).toContain('開発')
      expect(keywords).toContain('順調')
    })

    it('should respect maxKeywords limit', () => {
      const text =
        'コメダでモーニング食べて、パスタも食べて、ラーメンも食べた。アーティゾンにも行った。'
      const keywords = extractSearchKeywords(text, 3)

      expect(keywords.length).toBeLessThanOrEqual(3)
    })

    it('should deduplicate keywords', () => {
      const text = 'コメダでコーヒー飲んでコメダでパン食べた'
      const keywords = extractSearchKeywords(text)

      const komedaCount = keywords.filter(
        (k) => k.toLowerCase() === 'コメダ'.toLowerCase(),
      ).length
      expect(komedaCount).toBe(1)
    })

    it('should return empty array for empty text', () => {
      expect(extractSearchKeywords('')).toEqual([])
      expect(extractSearchKeywords('   ')).toEqual([])
    })

    it('should skip stop words', () => {
      const text = 'の は を に'
      const keywords = extractSearchKeywords(text)

      // These are stop words and should be filtered
      expect(keywords.length).toBe(0)
    })

    it('should skip short keywords', () => {
      const text = 'a b c'
      const keywords = extractSearchKeywords(text)

      // Single characters should be filtered
      expect(keywords.length).toBe(0)
    })
  })

  describe('formatSearchContextForPrompt', () => {
    it('should format search context entries', () => {
      const entries: SearchContextEntry[] = [
        {
          entryDate: '2024-01-15',
          detail: 'コメダでモーニングを食べた',
          relevance: 'high',
        },
        {
          entryDate: '2024-01-10',
          detail: '整体に行った',
          relevance: 'medium',
        },
      ]

      const result = formatSearchContextForPrompt(entries)

      expect(result).toContain('## 関連する過去の日記')
      expect(result).toContain('2024-01-15')
      expect(result).toContain('コメダでモーニングを食べた')
      expect(result).toContain('2024-01-10')
      expect(result).toContain('整体に行った')
      expect(result).toContain('過去の記録を自然に参照')
    })

    it('should return empty string for no entries', () => {
      const result = formatSearchContextForPrompt([])
      expect(result).toBe('')
    })

    it('should include all entries', () => {
      const entries: SearchContextEntry[] = [
        { entryDate: '2024-01-15', detail: 'Entry 1', relevance: 'high' },
        { entryDate: '2024-01-14', detail: 'Entry 2', relevance: 'medium' },
        { entryDate: '2024-01-13', detail: 'Entry 3', relevance: 'low' },
      ]

      const result = formatSearchContextForPrompt(entries)

      expect(result).toContain('Entry 1')
      expect(result).toContain('Entry 2')
      expect(result).toContain('Entry 3')
    })
  })
})
