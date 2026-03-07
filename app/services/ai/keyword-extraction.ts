/**
 * LLM-based keyword extraction for diary search context
 *
 * Uses Gemini Flash Lite for accurate Japanese keyword extraction,
 * replacing the Intl.Segmenter heuristic approach.
 */

import { z } from 'zod'
import { generateObject } from './genai'

const keywordsSchema = z.object({
  keywords: z.array(z.string()).max(5),
})

/**
 * Extract search keywords from diary text using LLM
 *
 * @param text - Diary entry text or mention message
 * @param maxKeywords - Maximum number of keywords to return (default: 5)
 * @returns Array of extracted keywords
 */
export async function extractKeywordsWithAI(
  text: string,
  maxKeywords: number = 5,
): Promise<string[]> {
  if (!text.trim()) return []

  try {
    const { object } = await generateObject({
      model: 'gemini-3.1-flash-lite-preview',
      thinkingLevel: 'minimal',
      schema: keywordsSchema,
      system: `日記から検索用キーワードを最大${maxKeywords}個抽出。固有名詞・具体的活動を優先。一般語・助詞は除外。なければ空配列。`,
      prompt: text,
    })

    return object.keywords.slice(0, maxKeywords)
  } catch (error) {
    console.warn('extractKeywordsWithAI failed, returning empty:', error)
    return []
  }
}
