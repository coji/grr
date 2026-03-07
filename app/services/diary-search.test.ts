import { describe, expect, it, vi } from 'vitest'

// Mock the db module to avoid cloudflare:workers import
vi.mock('./db', () => ({
  db: {},
  createDb: vi.fn(),
}))

import {
  extractSearchKeywords,
  formatSearchContextForPrompt,
  type SearchContextEntry,
} from './diary-search'

describe('diary-search', () => {
  describe('extractSearchKeywords', () => {
    it('should extract katakana words', () => {
      const text = 'コメダでモーニングを食べた。パスタも美味しかった。'
      const keywords = extractSearchKeywords(text)

      expect(keywords).toContain('コメダ')
      expect(keywords).toContain('モーニング')
      expect(keywords).toContain('パスタ')
    })

    it('should extract quoted phrases', () => {
      const text = '「水沢うどん」を食べに行った'
      const keywords = extractSearchKeywords(text)

      expect(keywords).toContain('水沢うどん')
    })

    it('should extract capitalized words', () => {
      const text = 'GoogleのAPIを使ってReactアプリを作った'
      const keywords = extractSearchKeywords(text)

      expect(keywords).toContain('Google')
      expect(keywords).toContain('React')
    })

    it('should extract kanji compounds', () => {
      const text = '整体に行って腰痛が楽になった。開発も順調。'
      const keywords = extractSearchKeywords(text)

      expect(keywords).toContain('整体')
      expect(keywords).toContain('腰痛')
      expect(keywords).toContain('開発')
      expect(keywords).toContain('順調')
    })

    it('should extract numbers with context', () => {
      const text = '2024年3月15日に面接があった'
      const keywords = extractSearchKeywords(text)

      // Numbers with context should be included
      expect(keywords.some((k) => k.includes('2024年'))).toBe(true)
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

    it('should skip short keywords', () => {
      const text = 'a は の を'
      const keywords = extractSearchKeywords(text)

      // These are too short
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
