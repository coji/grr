/**
 * AI service for extracting memories from diary entries
 *
 * This analyzes diary text and extracts facts, preferences, patterns,
 * relationships, goals, and emotion triggers about the user.
 */

import { google, type GoogleGenerativeAIProviderOptions } from '@ai-sdk/google'
import { generateObject } from 'ai'
import { z } from 'zod'
import type { UserMemory } from '~/services/memory'

export type MemoryAction = 'new' | 'update' | 'confirm'

export interface ExtractedMemory {
  type: UserMemory['memoryType']
  category: NonNullable<UserMemory['category']>
  content: string
  confidence: number
  importance: number
  action: MemoryAction
  relatedMemoryId?: string
}

export interface MemoryExtractionContext {
  currentEntry: {
    id: string
    entryDate: string
    detail: string | null
    moodLabel: string | null
  }
  recentEntries: Array<{
    entryDate: string
    detail: string | null
    moodLabel: string | null
  }>
  existingMemories: UserMemory[]
}

const extractedMemorySchema = z.object({
  memories: z.array(
    z.object({
      type: z
        .enum([
          'fact',
          'preference',
          'pattern',
          'relationship',
          'goal',
          'emotion_trigger',
        ])
        .describe('記憶の種類'),
      category: z
        .enum(['work', 'health', 'hobby', 'family', 'personal', 'general'])
        .describe('記憶のカテゴリ'),
      content: z
        .string()
        .min(1)
        .max(200)
        .describe('記憶の内容（日本語、簡潔に）'),
      confidence: z.number().min(0).max(1).describe('確信度（0.0-1.0）'),
      importance: z.number().int().min(1).max(10).describe('重要度（1-10）'),
      action: z
        .enum(['new', 'update', 'confirm'])
        .describe('アクション: new=新規, update=更新, confirm=確認'),
      relatedMemoryId: z
        .string()
        .optional()
        .describe('更新/確認する場合は既存の記憶ID'),
    }),
  ),
})

/**
 * Extract memories from a diary entry
 */
export async function extractMemoriesFromEntry(
  context: MemoryExtractionContext,
): Promise<ExtractedMemory[]> {
  const entryText = context.currentEntry.detail
  if (!entryText || entryText.trim().length < 10) {
    // Too short to extract meaningful memories
    return []
  }

  try {
    const model = google('gemini-3-flash-preview')

    const existingMemoriesSummary = formatExistingMemories(
      context.existingMemories,
    )
    const recentEntriesSummary = formatRecentEntries(context.recentEntries)

    const { object } = await generateObject({
      model,
      providerOptions: {
        google: {
          thinkingConfig: { thinkingLevel: 'minimal' },
        } satisfies GoogleGenerativeAIProviderOptions,
      },
      schema: extractedMemorySchema,
      system: `
あなたは日記から「記憶」を抽出するアシスタントです。

## タスク
日記からユーザーについての持続的な情報を抽出する。

## 記憶の種類
- fact: 事実（職業、住所、家族構成）
- preference: 好み（食べ物、趣味）
- pattern: 繰り返しパターン（月曜は疲れる等）
- relationship: 重要人物（同僚、家族、友人）
- goal: 目標・願望
- emotion_trigger: 感情トリガー

## カテゴリ
work / health / hobby / family / personal / general

## 抽出ルール
1. 明確に述べられていることを抽出（推測は控えめに）
2. 持続的な特性を優先（「今日は疲れた」→抽出しない）
3. 最大5件まで
4. 確信度: 推測=0.5-0.7、明言=0.8-1.0
5. 重要度: 日常的=1-4、中程度=5-7、重要=8-10

## 既存記憶との照合
- 同じ内容 → action="confirm" + relatedMemoryId
- 更新/修正 → action="update" + relatedMemoryId
- 新規 → action="new"
      `.trim(),
      prompt: `
以下の日記エントリから、ユーザーについての「記憶」を抽出してください。

## 今日の日記（${context.currentEntry.entryDate}）
気分: ${context.currentEntry.moodLabel || '記録なし'}
内容:
"""
${entryText}
"""

${recentEntriesSummary}

${existingMemoriesSummary}

記憶を抽出してください。何も抽出できない場合は空の配列を返してください。
      `.trim(),
    })

    return object.memories as ExtractedMemory[]
  } catch (error) {
    console.error('extractMemoriesFromEntry failed', error)
    return []
  }
}

/**
 * Format existing memories for the prompt
 */
function formatExistingMemories(memories: UserMemory[]): string {
  if (memories.length === 0) {
    return '## 既存の記憶\nなし'
  }

  const formatted = memories
    .slice(0, 15) // Limit to avoid prompt size issues
    .map((m) => `- [${m.id}] ${m.content} (${m.memoryType}, ${m.category})`)
    .join('\n')

  return `## 既存の記憶\n${formatted}`
}

/**
 * Format recent entries for context
 */
function formatRecentEntries(
  entries: MemoryExtractionContext['recentEntries'],
): string {
  if (entries.length === 0) {
    return ''
  }

  const formatted = entries
    .slice(0, 5) // Limit recent entries
    .map((e) => {
      const detail = e.detail ? e.detail.slice(0, 100) : '(詳細なし)'
      return `- ${e.entryDate}: ${detail}${e.detail && e.detail.length > 100 ? '...' : ''}`
    })
    .join('\n')

  return `## 最近の日記（参考）\n${formatted}`
}

/**
 * Validate extracted memory before storing
 */
export function validateExtractedMemory(memory: ExtractedMemory): boolean {
  // Content validation
  if (!memory.content || memory.content.trim().length < 3) {
    return false
  }

  // Confidence validation
  if (memory.confidence < 0 || memory.confidence > 1) {
    return false
  }

  // Importance validation
  if (memory.importance < 1 || memory.importance > 10) {
    return false
  }

  // If action is update/confirm, must have relatedMemoryId
  if (
    (memory.action === 'update' || memory.action === 'confirm') &&
    !memory.relatedMemoryId
  ) {
    return false
  }

  return true
}
