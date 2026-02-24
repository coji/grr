/**
 * Service for AI-powered character generation
 *
 * Generates unique character designs based on user memories and personalities.
 * All character images are generated via Gemini's native image generation
 * (gemini-3-pro-image-preview). No SVG pipeline.
 */

import { google, type GoogleGenerativeAIProviderOptions } from '@ai-sdk/google'
import { GoogleGenAI } from '@google/genai'
import { generateObject } from 'ai'
import { env } from 'cloudflare:workers'
import { z } from 'zod'
import type { UserMemory } from '~/services/memory'
import { getActiveMemories } from '~/services/memory'
import { logAiCost } from './cost-logger'
import type { Personality } from './personality'
import { getUserPersonality } from './personality'

// ============================================
// Character Concept Generation
// ============================================

const characterConceptSchema = z.object({
  name: z.string().max(20).describe('キャラクターの名前（ひらがな/カタカナ）'),
  species: z
    .string()
    .max(30)
    .describe(
      'キャラクターの種族/タイプ（例: ふわふわ雲の子、おにぎり妖精、本の精霊）',
    ),
  emoji: z.string().max(4).describe('キャラクターを表す絵文字1つ'),
  appearance: z.string().max(200).describe('外見の詳細（色、形、特徴）'),
  personality: z.string().max(100).describe('性格の特徴'),
  catchphrase: z.string().max(50).describe('口癖や決め台詞'),
})

export interface CharacterConcept {
  name: string
  species: string
  emoji: string
  appearance: string
  personality: string
  catchphrase: string
}

/**
 * Generate a unique character concept based on user's memories and personality
 */
export async function generateCharacterConcept(
  userId: string,
): Promise<CharacterConcept> {
  const memories = await getActiveMemories(userId)
  const personality = await getUserPersonality(userId)

  const model = google('gemini-3-flash-preview')

  const memoriesSummary = formatMemoriesForGeneration(memories)
  const personalitySummary = personality
    ? formatPersonalityForGeneration(personality)
    : ''

  const conceptModel = 'gemini-3-flash-preview'
  const { object, usage } = await generateObject({
    model,
    providerOptions: {
      google: {
        thinkingConfig: { thinkingLevel: 'medium' },
      } satisfies GoogleGenerativeAIProviderOptions,
    },
    schema: characterConceptSchema,
    system: `
ユーザーの日記から、その人だけのオリジナルキャラクターを創造する。

## 原則
- タイプや種族は完全に自由、独創的に
- ユーザーの趣味、感情、日常から着想を得る
- かわいくて愛着が湧くデザイン

## 着想の例
- 「コーヒー好き」→ コーヒー豆の妖精
- 「散歩好き」→ 道端の小さな冒険者
- 「プログラマー」→ キーボードの上で踊る子
- 「料理好き」→ おにぎりの妖精

## 出力フォーマット
- name: かわいい響きの名前（2-4文字、ひらがな/カタカナ）
- species: ユニークな種族名
- emoji: キャラを一番よく表す絵文字1つ
- appearance: 色、形、サイズ、特徴的なパーツを具体的に
- personality: 性格を2-3語で
- catchphrase: そのキャラらしい一言
    `.trim(),
    prompt: `
${memoriesSummary}

${personalitySummary}

この人の日記から、世界に一つだけのオリジナルキャラクターを創造してください。
    `.trim(),
  })

  logAiCost({
    userId,
    operation: 'character_concept',
    model: conceptModel,
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    metadata: { characterName: object.name, species: object.species },
  })

  return object
}

// ============================================
// Character Message Generation
// ============================================

const characterMessageSchema = z.object({
  message: z.string().max(100).describe('キャラクターからのメッセージ'),
})

// Extended schema for interactive reactions (pet/talk)
// Note: Remove strict max constraints to avoid validation failures
const characterReactionSchema = z.object({
  message: z.string().describe('キャラクターからのセリフ（50文字以内推奨）'),
  reactionTitle: z
    .string()
    .describe(
      '反応のタイトル（擬音語や短い表現、例: もふもふ、うっとり、わくわく）',
    ),
  reactionEmoji: z.string().describe('反応を表す絵文字1つ'),
  tierCelebration: z
    .string()
    .optional()
    .describe(
      '特別な反応時の祝福テキスト（大成功時のみ、例: やったね！、最高！、奇跡だ！）',
    ),
})

/**
 * Rich context for character message generation
 */
export interface CharacterMessageContext {
  concept: CharacterConcept
  evolutionStage: number
  happiness: number
  energy: number
  context: 'greeting' | 'pet' | 'talk' | 'evolution' | 'diary_response'
  additionalContext?: string
  // Rich context for varied responses
  userId?: string
  timeOfDay?: 'morning' | 'afternoon' | 'evening' | 'night'
  recentMood?: string
  daysSinceLastInteraction?: number
  userMemories?: string[]
}

/**
 * Generate a message from the character to the user
 */
export async function generateCharacterMessage(
  input: CharacterMessageContext,
): Promise<string> {
  const messageModel = 'gemini-3-flash-preview'
  const model = google(messageModel)

  // Build rich context sections
  const contextSections: string[] = []

  if (input.timeOfDay) {
    const timeGreeting = {
      morning: '朝の時間帯',
      afternoon: '昼の時間帯',
      evening: '夕方の時間帯',
      night: '夜の時間帯',
    }[input.timeOfDay]
    contextSections.push(`時間帯: ${timeGreeting}`)
  }

  if (input.recentMood) {
    contextSections.push(`ユーザーの最近の気分: ${input.recentMood}`)
  }

  if (
    input.daysSinceLastInteraction !== undefined &&
    input.daysSinceLastInteraction > 0
  ) {
    if (input.daysSinceLastInteraction >= 3) {
      contextSections.push(
        `${input.daysSinceLastInteraction}日ぶりの再会！久しぶりで嬉しい`,
      )
    } else if (input.daysSinceLastInteraction === 1) {
      contextSections.push('昨日ぶりの再会')
    }
  }

  if (input.userMemories && input.userMemories.length > 0) {
    contextSections.push(
      `ユーザーについて知っていること:\n${input.userMemories.slice(0, 3).join('\n')}`,
    )
  }

  const richContext =
    contextSections.length > 0
      ? `\n\n## 追加コンテキスト\n${contextSections.join('\n')}`
      : ''

  const { object, usage } = await generateObject({
    model,
    providerOptions: {
      google: {
        thinkingConfig: { thinkingLevel: 'minimal' },
      } satisfies GoogleGenerativeAIProviderOptions,
    },
    schema: characterMessageSchema,
    system: `
「${input.concept.name}」（${input.concept.species}）としてメッセージを生成する。

## キャラクター
- 性格: ${input.concept.personality}
- 口癖: ${input.concept.catchphrase}
- 進化段階: ${input.evolutionStage}/5
- 幸福度: ${input.happiness}/100、元気度: ${input.energy}/100
${richContext}

## 出力フォーマット
- 長さ: 1-2文、50文字以内
- トーン: キャラクターの性格と口癖を反映
- 絵文字を1つ含める（${input.concept.emoji}など）
- 幸福度/元気度が低いほど寂しそうなトーンに
- 追加コンテキストがあれば自然に反映（無理に全部入れない）
- 毎回違う表現を使う、ワンパターンにならない
    `.trim(),
    prompt: `
状況: ${getContextDescription(input.context)}
${input.additionalContext ? `補足: ${input.additionalContext}` : ''}

この状況に合ったメッセージを生成してください。
    `.trim(),
  })

  logAiCost({
    operation: 'character_message',
    model: messageModel,
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    metadata: { context: input.context },
  })

  return object.message
}

// ============================================
// Character Reaction Generation (for pet/talk interactions)
// ============================================

export interface CharacterReaction {
  message: string
  reactionTitle: string
  reactionEmoji: string
  tierCelebration?: string
}

// Fallback reactions for when AI generation fails
const FALLBACK_PET_REACTIONS: CharacterReaction[] = [
  {
    message: 'きもちいい〜 ✨',
    reactionTitle: 'もふもふ',
    reactionEmoji: '😊',
  },
  {
    message: 'えへへ、くすぐったい 💕',
    reactionTitle: 'ふにふに',
    reactionEmoji: '🥰',
  },
  {
    message: 'もっとなでて〜 ✨',
    reactionTitle: 'ゴロゴロ',
    reactionEmoji: '😌',
  },
  { message: 'しあわせ〜 💖', reactionTitle: 'ぽかぽか', reactionEmoji: '☺️' },
]

const FALLBACK_TALK_REACTIONS: CharacterReaction[] = [
  {
    message: '今日はどんな日だった？ ✨',
    reactionTitle: 'わくわく',
    reactionEmoji: '😊',
  },
  {
    message: 'お話しよう！ 💬',
    reactionTitle: 'にこにこ',
    reactionEmoji: '🙂',
  },
  {
    message: '会えてうれしいな 💕',
    reactionTitle: 'きらきら',
    reactionEmoji: '✨',
  },
  { message: 'なになに？ 🎵', reactionTitle: 'ふむふむ', reactionEmoji: '🤔' },
]

/**
 * Generate a full reaction for pet/talk interactions.
 * Returns both the character's message and a creative reaction title.
 * Has fallback reactions in case AI generation fails.
 */
export async function generateCharacterReaction(
  input: CharacterMessageContext & {
    reactionIntensity: 'normal' | 'good' | 'great' | 'legendary'
  },
): Promise<CharacterReaction> {
  const reactionModel = 'gemini-3-flash-preview'

  // Build rich context sections
  const contextSections: string[] = []

  if (input.timeOfDay) {
    const timeGreeting = {
      morning: '朝',
      afternoon: '昼',
      evening: '夕方',
      night: '夜',
    }[input.timeOfDay]
    contextSections.push(`時間: ${timeGreeting}`)
  }

  if (input.recentMood) {
    contextSections.push(`最近の気分: ${input.recentMood}`)
  }

  if (input.userMemories && input.userMemories.length > 0) {
    contextSections.push(
      `ユーザーの情報: ${input.userMemories.slice(0, 2).join('、')}`,
    )
  }

  const richContext =
    contextSections.length > 0 ? contextSections.join(' / ') : ''

  const intensityHint = {
    normal: '',
    good: '嬉しさが伝わる反応',
    great: 'とても嬉しい！テンション高め',
    legendary: '最高に嬉しい特別な瞬間！',
  }[input.reactionIntensity]

  // Only request tierCelebration for special reactions
  const needsCelebration = input.reactionIntensity !== 'normal'

  // Build context-specific prompts
  const isPet = input.context === 'pet'
  const systemPrompt = isPet
    ? `
「${input.concept.name}」（${input.concept.species}）が撫でられた時の反応。
性格: ${input.concept.personality}
${richContext}

## 反応のバリエーション
- 触られた場所によって反応が変わる（頭→気持ちいい、ほっぺ→照れる、おなか→くすぐったい）
- 擬音語を積極的に使う（もふもふ、ふにふに、ゴロゴロ、すりすり、ぽかぽか）
- 身体的な反応を描写（目を細める、しっぽを振る、ごろんとする）
    `.trim()
    : `
「${input.concept.name}」（${input.concept.species}）との会話。
性格: ${input.concept.personality}
口癖: ${input.concept.catchphrase}
${richContext}

## 会話のバリエーション
- 挨拶：時間帯に合わせた声かけ
- 質問：ユーザーの今日のこと、好きなものについて聞く
- シェア：自分が見つけたこと、考えたことを話す
- 応援：ユーザーの頑張りを認める、元気づける
- 遊び：なぞなぞ、しりとり、クイズを提案
- 思い出：ユーザーの過去の日記に触れる
    `.trim()

  const promptText = isPet
    ? `
${input.additionalContext || '撫でられている'}
${intensityHint}

## 出力（JSON形式で返す）
- reactionTitle: 触感や状態を表す擬音語（もふもふ、ふにふに、ゴロゴロ、ほわほわ、ぽかぽか、とろーん、むにゅむにゅ等、12文字以内）
- message: 撫でられた反応のセリフ（${input.concept.emoji}を含む、感覚的な表現で、50文字以内）
- reactionEmoji: 反応に合う絵文字（1つだけ）
${needsCelebration ? '- tierCelebration: 特別な喜びを表す短い言葉（10文字以内）' : ''}
    `.trim()
    : `
${input.additionalContext || '話しかけられた'}
${intensityHint}

## 出力（JSON形式で返す）
- reactionTitle: 会話の雰囲気を表す言葉（わくわく、ふむふむ、にこにこ、そわそわ、きらきら、うんうん等、12文字以内）
- message: 会話のセリフ（${input.concept.emoji}を含む。質問、感想、提案など会話らしく、50文字以内）
- reactionEmoji: 会話の雰囲気に合う絵文字（1つだけ）
${needsCelebration ? '- tierCelebration: 嬉しさを表す短い言葉（10文字以内）' : ''}
    `.trim()

  try {
    const model = google(reactionModel)
    const { object, usage } = await generateObject({
      model,
      providerOptions: {
        google: {
          thinkingConfig: { thinkingLevel: 'low' },
        } satisfies GoogleGenerativeAIProviderOptions,
      },
      schema: characterReactionSchema,
      system: systemPrompt,
      prompt: promptText,
    })

    logAiCost({
      operation: 'character_reaction',
      model: reactionModel,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      metadata: {
        context: input.context,
        intensity: input.reactionIntensity,
      },
    })

    // Truncate fields if too long (for Slack modal title limit)
    return {
      message: object.message.slice(0, 100),
      reactionTitle: object.reactionTitle.slice(0, 12),
      reactionEmoji: object.reactionEmoji.slice(0, 4),
      tierCelebration: object.tierCelebration?.slice(0, 20),
    }
  } catch (error) {
    // Log the error but return a fallback reaction
    console.error(
      'Character reaction generation failed, using fallback:',
      error,
    )

    // Pick a random fallback reaction based on context
    const fallbacks = isPet ? FALLBACK_PET_REACTIONS : FALLBACK_TALK_REACTIONS
    const fallback = fallbacks[Math.floor(Math.random() * fallbacks.length)]

    // Add character emoji to the fallback message if we have it
    const messageWithEmoji = input.concept.emoji
      ? fallback.message.replace('✨', input.concept.emoji)
      : fallback.message

    return {
      ...fallback,
      message: messageWithEmoji,
      tierCelebration:
        input.reactionIntensity !== 'normal' ? 'やったね！' : undefined,
    }
  }
}

// ============================================
// Helper Functions
// ============================================

function formatMemoriesForGeneration(memories: UserMemory[]): string {
  if (memories.length === 0) {
    return '## 記憶\nまだ記憶がありません。デフォルトでかわいいキャラを作ってください。'
  }

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
    emotion_trigger: '感情',
  }

  const sections: string[] = ['## この人について']
  for (const [type, typeMemories] of Object.entries(byType)) {
    const label = typeLabels[type] || type
    const items = typeMemories
      .slice(0, 5)
      .map((m) => `- ${m.content}`)
      .join('\n')
    sections.push(`### ${label}\n${items}`)
  }

  return sections.join('\n\n')
}

/**
 * Extract concise memory highlights for visual incorporation in SVG.
 * Picks the most visually inspiring memories (preferences, hobbies, work).
 */
function extractMemoryHighlights(memories: UserMemory[]): string {
  if (memories.length === 0) return '- No memories yet'

  const highlights = memories
    .filter((m) =>
      ['preference', 'fact', 'pattern', 'goal'].includes(m.memoryType),
    )
    .slice(0, 8)
    .map((m) => `- ${m.content}`)
    .join('\n')

  return highlights || '- No specific highlights'
}

function formatPersonalityForGeneration(personality: Personality): string {
  return `
## パーソナリティ
${personality.summary}

特徴: ${personality.traits.join('、')}
興味: ${personality.interests.join('、')}
  `.trim()
}

function getContextDescription(
  context: 'greeting' | 'pet' | 'talk' | 'evolution' | 'diary_response',
): string {
  switch (context) {
    case 'greeting':
      return 'ユーザーがホームタブを開いた時の挨拶'
    case 'pet':
      return 'ユーザーに撫でられた時の反応'
    case 'talk':
      return 'ユーザーが話しかけてくれた時'
    case 'evolution':
      return '進化した時のお祝いメッセージ'
    case 'diary_response':
      return 'ユーザーが日記を書いてくれた時のお礼'
  }
}

// ============================================
// Character Image Generation (Gemini Pro Image)
// ============================================

export type CharacterEmotion = 'happy' | 'excited' | 'shy' | 'sleepy' | 'love'
export type CharacterAction = 'pet' | 'talk' | 'wave' | 'dance' | 'sparkle'

const CHARACTER_IMAGE_MODEL = 'gemini-3-pro-image-preview'

/**
 * Generate a character PNG image using Gemini's native image generation.
 * When baseImage is provided, it's used as a visual reference to maintain
 * character consistency across multiple generations.
 * Returns a PNG ArrayBuffer.
 */
export async function generateCharacterImage(input: {
  userId: string
  concept: CharacterConcept
  evolutionStage: number
  emotion?: CharacterEmotion
  action?: CharacterAction
  baseImage?: ArrayBuffer
}): Promise<ArrayBuffer> {
  const memories = await getActiveMemories(input.userId)
  const memoryHighlights = extractMemoryHighlights(memories)

  const emotionDesc = input.emotion
    ? {
        happy: 'smiling cheerfully',
        excited: 'eyes shining with excitement',
        shy: 'blushing, bashful',
        sleepy: 'drowsy, yawning',
        love: 'heart eyes, lovestruck',
      }[input.emotion]
    : 'gentle smile'

  const actionDesc = input.action
    ? {
        pet: 'being petted contentedly',
        talk: 'listening, head tilted',
        wave: 'waving, greeting',
        dance: 'dancing joyfully',
        sparkle: 'glowing with sparkle effects',
      }[input.action]
    : 'standing naturally'

  const isVariant = !!input.baseImage

  const prompt = isVariant
    ? `
Same character as the reference image. Keep the exact same appearance,
colors, art style, proportions, and design details.
Change only the expression and pose.

Expression: ${emotionDesc}
Pose: ${actionDesc}
    `.trim()
    : `
Small character icon, simple flat illustration, 64x64 pixel size.
Soft pastel background color that matches the character's theme.

Character: ${input.concept.name} (${input.concept.species})
Appearance: ${input.concept.appearance}
Personality: ${input.concept.personality}
Evolution stage: ${input.evolutionStage}/5
Expression: ${emotionDesc}
Pose: ${actionDesc}

User's life details to weave in as small visual details:
${memoryHighlights}

Style: Compact, expressive, with personality. Not generic cute.
One surprising detail that gives character.
    `.trim()

  // Build contents: reference image (if variant) + text prompt
  // biome-ignore lint/suspicious/noExplicitAny: Google GenAI SDK content types
  const contents: any[] = []
  if (input.baseImage) {
    const base64 = btoa(String.fromCharCode(...new Uint8Array(input.baseImage)))
    contents.push({
      inlineData: { mimeType: 'image/png', data: base64 },
    })
  }
  contents.push(prompt)

  const genai = new GoogleGenAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY })
  const response = await genai.models.generateContent({
    model: CHARACTER_IMAGE_MODEL,
    contents,
    config: {
      responseModalities: ['image', 'text'],
    },
  })

  const parts = response.candidates?.[0]?.content?.parts
  if (!parts) throw new Error('No response from image generation model')

  for (const part of parts) {
    if (part.inlineData?.data) {
      const buffer = Uint8Array.from(atob(part.inlineData.data), (c) =>
        c.charCodeAt(0),
      )

      // Log cost (fire-and-forget)
      const usage = response.usageMetadata
      logAiCost({
        userId: input.userId,
        operation: 'character_image',
        model: CHARACTER_IMAGE_MODEL,
        inputTokens: usage?.promptTokenCount ?? 0,
        outputTokens: usage?.candidatesTokenCount ?? 0,
        thinkingTokens: usage?.thoughtsTokenCount ?? 0,
        metadata: {
          variant: isVariant,
          emotion: input.emotion,
          action: input.action,
          evolutionStage: input.evolutionStage,
          imageBytes: buffer.byteLength,
        },
      })

      return buffer.buffer as ArrayBuffer
    }
  }

  throw new Error('No image data in response')
}
