import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./genai', () => ({
  generateObject: vi.fn(),
}))

import { generateObject } from './genai'
import { extractKeywordsWithAI } from './keyword-extraction'

const mockGenerateObject = vi.mocked(generateObject)

describe('extractKeywordsWithAI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return keywords from LLM response', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: { keywords: ['コメダ', '整体', 'React'] },
      usage: { inputTokens: 10, outputTokens: 5, thinkingTokens: 0 },
    })

    const result = await extractKeywordsWithAI(
      'コメダでモーニング食べてから整体行った。Reactの勉強もした。',
    )

    expect(result).toEqual(['コメダ', '整体', 'React'])
    expect(mockGenerateObject).toHaveBeenCalledOnce()
    expect(mockGenerateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3.1-flash-lite-preview',
        thinkingLevel: 'minimal',
      }),
    )
  })

  it('should return empty array for empty text', async () => {
    const result = await extractKeywordsWithAI('')
    expect(result).toEqual([])
    expect(mockGenerateObject).not.toHaveBeenCalled()
  })

  it('should return empty array for whitespace-only text', async () => {
    const result = await extractKeywordsWithAI('   ')
    expect(result).toEqual([])
    expect(mockGenerateObject).not.toHaveBeenCalled()
  })

  it('should respect maxKeywords limit', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        keywords: ['コメダ', '整体', 'React', 'TypeScript', 'Next.js'],
      },
      usage: { inputTokens: 10, outputTokens: 5, thinkingTokens: 0 },
    })

    const result = await extractKeywordsWithAI('some text', 3)
    expect(result).toEqual(['コメダ', '整体', 'React'])
  })

  it('should return empty array on LLM failure', async () => {
    mockGenerateObject.mockRejectedValueOnce(new Error('API error'))

    const result = await extractKeywordsWithAI('テスト')
    expect(result).toEqual([])
  })

  it('should handle empty keywords from LLM', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: { keywords: [] },
      usage: { inputTokens: 10, outputTokens: 5, thinkingTokens: 0 },
    })

    const result = await extractKeywordsWithAI('今日は普通の一日だった')
    expect(result).toEqual([])
  })
})
