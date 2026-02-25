/**
 * AI-powered episode generation for character social interactions.
 *
 * PRIVACY CONSTRAINTS:
 * - NEVER receives diary content as input
 * - NEVER references user activities, schedules, or emotions
 * - Only uses character metadata (name, species, personality) and
 *   public channel information (name, topic)
 * - All generated content is purely about the characters' fictional adventures
 */

import { google, type GoogleGenerativeAIProviderOptions } from '@ai-sdk/google'
import { generateObject } from 'ai'
import { z } from 'zod'
import type { ChannelLocation } from '~/services/channel-locations'
import { logAiCost } from './cost-logger'

// ============================================
// Privacy Constraints (included in all prompts)
// ============================================

const PRIVACY_RULES = `
## ルール
- キャラクター自身の冒険や気持ちだけを描写する
- 場面描写は架空の出来事のみ
- キャラクター同士の会話や行動に集中する
`.trim()

// ============================================
// Encounter Episode Generation
// ============================================

const encounterEpisodeSchema = z.object({
  episode: z
    .string()
    .describe('2-3文の短いエピソード。両方のキャラの特徴が出る描写'),
})

interface EncounterContext {
  characterA: {
    name: string
    species: string
    personality: string
    emoji: string
    ownerName?: string
  }
  characterB: {
    name: string
    species: string
    personality: string
    emoji: string
    ownerName?: string
  }
  location?: ChannelLocation
}

/**
 * Generate a short encounter episode between two characters.
 */
export async function generateEncounterEpisode(
  context: EncounterContext,
): Promise<string> {
  const model = google('gemini-3-flash-preview')
  const modelId = 'gemini-3-flash-preview'

  const locationContext = context.location
    ? `場所: 「${context.location.locationName}」${context.location.topic ? `（${context.location.topic}）` : ''}`
    : ''

  const { object, usage } = await generateObject({
    model,
    providerOptions: {
      google: {
        thinkingConfig: { thinkingLevel: 'low' },
      } satisfies GoogleGenerativeAIProviderOptions,
    },
    schema: encounterEpisodeSchema,
    system: `
## タスク
2匹のキャラクターが偶然出会った場面を描写する。

${PRIVACY_RULES}

## 入力
キャラクターA: ${context.characterA.name}（${context.characterA.species}、${context.characterA.personality}）
キャラクターB: ${context.characterB.name}（${context.characterB.species}、${context.characterB.personality}）

## 出力フォーマット
- 形式: 散文
- 長さ: 2-3文、100文字以内
- トーン: 温かく可愛らしい
- 両方のキャラの性格が表れる具体的な場面
    `.trim(),
    prompt: `
${locationContext}
${context.characterA.name}と${context.characterB.name}の偶然の出会いを描写してください。
    `.trim(),
  })

  logAiCost({
    operation: 'encounter_episode',
    model: modelId,
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    metadata: {
      characterA: context.characterA.name,
      characterB: context.characterB.name,
    },
  })

  return object.episode
}

// ============================================
// Adventure Episode Generation
// ============================================

/**
 * Schema for adventure generation — main episode + per-character highlights.
 */
function createAdventureSchema(participantUserIds: string[]) {
  const highlightsShape: Record<string, z.ZodString> = {}
  for (const userId of participantUserIds) {
    highlightsShape[userId] = z
      .string()
      .describe('このキャラクターの見せ場（1文）')
  }

  return z.object({
    mainEpisode: z.string().describe('冒険の全体エピソード（3-5文）'),
    highlights: z.object(highlightsShape),
  })
}

interface AdventureContext {
  theme: { id: string; name: string; emoji: string }
  participants: Array<{
    userId?: string
    name: string
    species: string
    personality: string
    emoji: string
    role: string
  }>
}

/**
 * Generate a group adventure episode with per-character highlights.
 */
export async function generateAdventureEpisode(
  context: AdventureContext,
): Promise<{ mainEpisode: string; highlights: Record<string, string> }> {
  const model = google('gemini-3-flash-preview')
  const modelId = 'gemini-3-flash-preview'

  const participantList = context.participants
    .map(
      (p) =>
        `- ${p.name}（${p.species}）: 性格=${p.personality}, 役割=${p.role}`,
    )
    .join('\n')

  const userIds = context.participants
    .map((p) => p.userId)
    .filter((id): id is string => id !== undefined)

  const schema = createAdventureSchema(userIds)

  const { object, usage } = await generateObject({
    model,
    providerOptions: {
      google: {
        thinkingConfig: { thinkingLevel: 'low' },
      } satisfies GoogleGenerativeAIProviderOptions,
    },
    schema,
    system: `
## タスク
キャラクターたちのグループ冒険のエピソードを生成する。

${PRIVACY_RULES}

## 入力
テーマ: ${context.theme.emoji} ${context.theme.name}
参加者:
${participantList}

## 出力フォーマット
- mainEpisode: 全体ストーリー（3-5文、全員が登場、温かく楽しいトーン）
- highlights: 各キャラの見せ場（1文、性格と役割が表れる）
    `.trim(),
    prompt: `
「${context.theme.name}」の冒険エピソードを書いてください。
    `.trim(),
  })

  logAiCost({
    operation: 'adventure_episode',
    model: modelId,
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    metadata: {
      theme: context.theme.id,
      participantCount: context.participants.length,
    },
  })

  return {
    mainEpisode: object.mainEpisode,
    highlights: object.highlights,
  }
}
