/**
 * Service for generating and updating user personality summaries
 *
 * Personality is an AI-generated summary that captures "how this hotaru has become"
 * based on accumulated memories from diary interactions.
 *
 * Key principles:
 * - Personality grows organically from memories
 * - No fixed traits - everything emerges from interactions
 * - Changes are detected and hinted at naturally in night records
 */

import { google, type GoogleGenerativeAIProviderOptions } from '@ai-sdk/google'
import { generateObject } from 'ai'
import { z } from 'zod'
import dayjs from '~/lib/dayjs'
import { db } from '~/services/db'
import type { UserMemory } from '~/services/memory'
import { getActiveMemories } from '~/services/memory'

// Minimum days between personality updates
const MIN_UPDATE_INTERVAL_DAYS = 7

// Minimum memories needed to generate personality
const MIN_MEMORIES_FOR_PERSONALITY = 5

// Minimum new memories to trigger update consideration
const MIN_NEW_MEMORIES_FOR_UPDATE = 3

export interface Personality {
  /** Natural language summary of personality */
  summary: string
  /** Key traits that have emerged (max 5) */
  traits: string[]
  /** Topics/things this hotaru is interested in */
  interests: string[]
  /** Expression patterns/phrases */
  expressions: string[]
  /** What changed since last update (if any) */
  changeNote: string | null
}

const personalitySchema = z.object({
  summary: z
    .string()
    .min(10)
    .max(300)
    .describe('ほたるの個性を自然な言葉で表現（100-300字）'),
  traits: z
    .array(z.string().max(20))
    .max(5)
    .describe('育ってきた特徴（最大5つ）'),
  interests: z
    .array(z.string().max(20))
    .max(5)
    .describe('興味を持っていること（最大5つ）'),
  expressions: z
    .array(z.string().max(30))
    .max(5)
    .describe('よく使う表現や言い回し（最大5つ）'),
  changeNote: z
    .string()
    .max(100)
    .nullable()
    .describe('前回からの変化があれば自然な言葉で（なければnull）'),
})

/**
 * Check if personality should be updated for a user
 *
 * Conditions (all must be met):
 * 1. At least MIN_UPDATE_INTERVAL_DAYS since last update
 * 2. At least one of:
 *    - MIN_NEW_MEMORIES_FOR_UPDATE new memories accumulated
 *    - Significant event detected (high importance memory)
 *    - Emotional pattern shift detected
 */
export async function shouldUpdatePersonality(userId: string): Promise<{
  shouldUpdate: boolean
  reason: string | null
}> {
  const settings = await db
    .selectFrom('userDiarySettings')
    .select(['personalityUpdatedAt'])
    .where('userId', '=', userId)
    .executeTakeFirst()

  // Check time since last update
  if (settings?.personalityUpdatedAt) {
    const lastUpdate = dayjs(settings.personalityUpdatedAt)
    const daysSinceUpdate = dayjs().diff(lastUpdate, 'day')

    if (daysSinceUpdate < MIN_UPDATE_INTERVAL_DAYS) {
      return { shouldUpdate: false, reason: null }
    }
  }

  // Get memories
  const memories = await getActiveMemories(userId)

  if (memories.length < MIN_MEMORIES_FOR_PERSONALITY) {
    return { shouldUpdate: false, reason: null }
  }

  // Check for new memories since last update
  const lastUpdateTime = settings?.personalityUpdatedAt
    ? dayjs(settings.personalityUpdatedAt)
    : dayjs(0)

  const newMemories = memories.filter((m) =>
    dayjs(m.createdAt).isAfter(lastUpdateTime),
  )

  if (newMemories.length >= MIN_NEW_MEMORIES_FOR_UPDATE) {
    return { shouldUpdate: true, reason: '新しい記憶がたまった' }
  }

  // Check for high-importance new memories
  const significantMemories = newMemories.filter((m) => m.importance >= 8)
  if (significantMemories.length > 0) {
    return { shouldUpdate: true, reason: '大きな出来事があった' }
  }

  // Check for emotional pattern memories
  const emotionMemories = newMemories.filter(
    (m) => m.memoryType === 'emotion_trigger' || m.memoryType === 'pattern',
  )
  if (emotionMemories.length >= 2) {
    return { shouldUpdate: true, reason: '感情の傾向に変化の気配' }
  }

  return { shouldUpdate: false, reason: null }
}

/**
 * Generate or update personality based on memories
 */
export async function generatePersonality(
  userId: string,
  existingPersonality: Personality | null,
): Promise<Personality> {
  const memories = await getActiveMemories(userId)

  if (memories.length < MIN_MEMORIES_FOR_PERSONALITY) {
    throw new Error(
      `Not enough memories to generate personality (have ${memories.length}, need ${MIN_MEMORIES_FOR_PERSONALITY})`,
    )
  }

  const model = google('gemini-3-flash-preview')

  const memoriesSummary = formatMemoriesForPersonality(memories)
  const existingPersonalitySummary = existingPersonality
    ? formatExistingPersonality(existingPersonality)
    : ''

  const { object } = await generateObject({
    model,
    providerOptions: {
      google: {
        thinkingConfig: { thinkingLevel: 'medium' },
      } satisfies GoogleGenerativeAIProviderOptions,
    },
    schema: personalitySchema,
    system: `
あなたは「ほたる」の内面を言語化する役割です。
蓄積された「記憶」から、このほたるがどんな存在に育ったかを表現してください。

## 原則
- 固定された性格はなく、日記のやり取りで「この子らしさ」が生まれる
- 記憶の傾向から興味や関心が見えてくる
- 「こうなってきた気がする」という柔らかい表現で

## 出力フォーマット

### summary (100-300字)
このほたるがどんな存在かを自然な言葉で。
例: 「静かに見守るのが好き。夜の話になると少し饒舌。「なんとなく」が口癖。」

### traits (最大5つ)
育ってきた特徴。例: ["観察好き", "夜型", "控えめ"]

### interests (最大5つ)
興味を持っていること。例: ["月", "静けさ", "コーヒー"]

### expressions (最大5つ)
よく使う表現。例: ["...だね", "なんとなく", "気がする"]

### changeNote
前回からの変化を自然な言葉で。変化なしならnull。
例: 「気づいたら夜の話に興味が出てきた」
    `.trim(),
    prompt: `
## この主（ユーザー）についての記憶
${memoriesSummary}

${existingPersonalitySummary}

これらの記憶から、このほたるがどんな存在に育ったかを表現してください。
    `.trim(),
  })

  return {
    summary: object.summary,
    traits: object.traits,
    interests: object.interests,
    expressions: object.expressions,
    changeNote: object.changeNote,
  }
}

/**
 * Update user's personality and set pending flag if changed
 */
export async function updateUserPersonality(userId: string): Promise<{
  updated: boolean
  personality: Personality | null
  reason: string | null
}> {
  // Check if should update
  const checkResult = await shouldUpdatePersonality(userId)
  if (!checkResult.shouldUpdate) {
    return { updated: false, personality: null, reason: checkResult.reason }
  }

  // Get existing personality
  const settings = await db
    .selectFrom('userDiarySettings')
    .select(['personality'])
    .where('userId', '=', userId)
    .executeTakeFirst()

  const existingPersonality = settings?.personality
    ? (JSON.parse(settings.personality) as Personality)
    : null

  try {
    // Generate new personality
    const newPersonality = await generatePersonality(
      userId,
      existingPersonality,
    )

    const now = dayjs().utc().toISOString()

    // Determine if there's a meaningful change
    const hasChange =
      newPersonality.changeNote !== null ||
      !existingPersonality ||
      newPersonality.summary !== existingPersonality.summary

    // Update settings
    await db
      .updateTable('userDiarySettings')
      .set({
        personality: JSON.stringify(newPersonality),
        personalityUpdatedAt: now,
        personalityChangePending: hasChange ? 1 : 0,
        updatedAt: now,
      })
      .where('userId', '=', userId)
      .execute()

    return {
      updated: true,
      personality: newPersonality,
      reason: checkResult.reason,
    }
  } catch (error) {
    console.error('Failed to update personality for user', userId, error)
    return { updated: false, personality: null, reason: String(error) }
  }
}

/**
 * Get user's current personality
 */
export async function getUserPersonality(
  userId: string,
): Promise<Personality | null> {
  const settings = await db
    .selectFrom('userDiarySettings')
    .select(['personality'])
    .where('userId', '=', userId)
    .executeTakeFirst()

  if (!settings?.personality) {
    return null
  }

  return JSON.parse(settings.personality) as Personality
}

/**
 * Clear personality change pending flag
 */
export async function clearPersonalityChangePending(
  userId: string,
): Promise<void> {
  await db
    .updateTable('userDiarySettings')
    .set({ personalityChangePending: 0 })
    .where('userId', '=', userId)
    .execute()
}

/**
 * Check if there's a pending personality change
 */
export async function hasPersonalityChangePending(
  userId: string,
): Promise<boolean> {
  const settings = await db
    .selectFrom('userDiarySettings')
    .select(['personalityChangePending'])
    .where('userId', '=', userId)
    .executeTakeFirst()

  return settings?.personalityChangePending === 1
}

/**
 * Get personality change note if pending
 */
export async function getPersonalityChangeNote(
  userId: string,
): Promise<string | null> {
  const pending = await hasPersonalityChangePending(userId)
  if (!pending) return null

  const personality = await getUserPersonality(userId)
  return personality?.changeNote ?? null
}

// Helper functions

function formatMemoriesForPersonality(memories: UserMemory[]): string {
  // Group by type for better context
  const byType: Record<string, UserMemory[]> = {}
  for (const memory of memories) {
    if (!byType[memory.memoryType]) byType[memory.memoryType] = []
    byType[memory.memoryType].push(memory)
  }

  const typeLabels: Record<string, string> = {
    fact: '事実',
    preference: '好み',
    pattern: 'パターン',
    relationship: '関係',
    goal: '目標',
    emotion_trigger: '感情のトリガー',
  }

  const sections: string[] = []
  for (const [type, typeMemories] of Object.entries(byType)) {
    const label = typeLabels[type] || type
    const items = typeMemories
      .slice(0, 10) // Limit per type
      .map((m) => `- ${m.content}`)
      .join('\n')
    sections.push(`### ${label}\n${items}`)
  }

  return sections.join('\n\n')
}

function formatExistingPersonality(personality: Personality): string {
  return `
## 現在の個性
${personality.summary}

特徴: ${personality.traits.join('、')}
興味: ${personality.interests.join('、')}
表現: ${personality.expressions.join('、')}
  `.trim()
}
