/**
 * AI service for consolidating user memories
 *
 * When memories accumulate beyond a threshold, this service:
 * 1. Groups similar/overlapping memories
 * 2. Merges them into consolidated, richer memories
 * 3. Identifies memories that can be safely forgotten
 *
 * This mimics how human memory works: specific episodes gradually
 * merge into general impressions, and unimportant details fade.
 */

import { z } from 'zod'
import type { UserMemory } from '~/services/memory'
import { generateObject } from './genai'

/** Threshold: trigger consolidation when active memory count exceeds this */
export const CONSOLIDATION_THRESHOLD = 20

/** Target: aim to reduce memories to roughly this count after consolidation */
export const CONSOLIDATION_TARGET = 15

export interface ConsolidationPlan {
  /** Memories to keep as-is */
  keep: string[]
  /** Groups of memories to merge into a single consolidated memory */
  merge: Array<{
    sourceIds: string[]
    content: string
    memoryType: UserMemory['memoryType']
    category: NonNullable<UserMemory['category']>
    importance: number
  }>
  /** Memories to deactivate (low value, redundant, or outdated) */
  deactivate: string[]
}

const consolidationSchema = z.object({
  keep: z.array(z.string()).describe('そのまま残す記憶のID'),
  merge: z.array(
    z.object({
      sourceIds: z
        .array(z.string())
        .min(2)
        .describe('統合する記憶のID（2件以上）'),
      content: z
        .string()
        .min(1)
        .max(300)
        .describe('統合後の記憶内容（日本語、簡潔に）'),
      memoryType: z
        .enum([
          'fact',
          'preference',
          'pattern',
          'relationship',
          'goal',
          'emotion_trigger',
        ])
        .describe('統合後の記憶の種類'),
      category: z
        .enum(['work', 'health', 'hobby', 'family', 'personal', 'general'])
        .describe('統合後のカテゴリ'),
      importance: z.number().int().min(1).max(10).describe('統合後の重要度'),
    }),
  ),
  deactivate: z.array(z.string()).describe('削除する記憶のID'),
})

/**
 * Generate a consolidation plan for a user's memories
 */
export async function generateConsolidationPlan(
  memories: UserMemory[],
): Promise<ConsolidationPlan> {
  if (memories.length <= CONSOLIDATION_TARGET) {
    return { keep: memories.map((m) => m.id), merge: [], deactivate: [] }
  }

  const memoriesList = memories
    .map(
      (m) =>
        `- [${m.id}] (${m.memoryType}/${m.category}, 重要度:${m.importance}, 言及:${m.mentionCount}回, 最終確認:${m.lastConfirmedAt}) ${m.content}`,
    )
    .join('\n')

  const { object } = await generateObject({
    model: 'gemini-3-flash-preview',
    thinkingLevel: 'low',
    schema: consolidationSchema,
    system: `
## タスク
ユーザーについての記憶リストを整理・統合する。
人間の記憶のように、細かいエピソードを「印象」にまとめ、価値の低い記憶を忘れる。

## 整理ルール
1. 類似・重複する記憶をまとめて1つの豊かな記憶にする
2. ユーザー確認済み(user_confirmed)や高重要度の記憶を優先的に残す
3. 長期間言及されず重要度も低い記憶は削除候補にする
4. 統合後は${CONSOLIDATION_TARGET}件前後を目指す
5. 統合した記憶の内容は、元の記憶の情報を損なわず自然な文にする
6. 統合した記憶の重要度は、元の記憶の最大重要度を採用する

## 出力フォーマット
- keep: そのまま残す記憶のID
- merge: 統合グループ（sourceIds + 統合後の内容）
- deactivate: 削除する記憶のID

全ての記憶IDがkeep, merge.sourceIds, deactivateのいずれかに含まれること。
    `.trim(),
    prompt: `
以下の${memories.length}件の記憶を整理してください。

${memoriesList}
    `.trim(),
  })

  return object as ConsolidationPlan
}

/**
 * Validate that a consolidation plan is consistent
 * (all memory IDs accounted for, no duplicates)
 */
export function validateConsolidationPlan(
  plan: ConsolidationPlan,
  memories: UserMemory[],
): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  const memoryIds = new Set(memories.map((m) => m.id))
  const assignedIds = new Set<string>()

  // Check keep IDs
  for (const id of plan.keep) {
    if (!memoryIds.has(id)) {
      errors.push(`keep contains unknown ID: ${id}`)
    }
    if (assignedIds.has(id)) {
      errors.push(`Duplicate ID in plan: ${id}`)
    }
    assignedIds.add(id)
  }

  // Check merge groups
  for (const group of plan.merge) {
    if (group.sourceIds.length < 2) {
      errors.push(`Merge group must have at least 2 sources`)
    }
    for (const id of group.sourceIds) {
      if (!memoryIds.has(id)) {
        errors.push(`merge contains unknown ID: ${id}`)
      }
      if (assignedIds.has(id)) {
        errors.push(`Duplicate ID in plan: ${id}`)
      }
      assignedIds.add(id)
    }
    if (!group.content || group.content.trim().length < 3) {
      errors.push(`Merge group has empty content`)
    }
  }

  // Check deactivate IDs
  for (const id of plan.deactivate) {
    if (!memoryIds.has(id)) {
      errors.push(`deactivate contains unknown ID: ${id}`)
    }
    if (assignedIds.has(id)) {
      errors.push(`Duplicate ID in plan: ${id}`)
    }
    assignedIds.add(id)
  }

  // Check all memories are accounted for
  for (const id of memoryIds) {
    if (!assignedIds.has(id)) {
      errors.push(`Memory ${id} not assigned to any action`)
    }
  }

  return { valid: errors.length === 0, errors }
}
