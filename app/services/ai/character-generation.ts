/**
 * Service for AI-powered character generation
 *
 * Generates unique character designs based on user memories and personalities.
 * Characters are completely free-form - no fixed types, each one is unique!
 */

import { google, type GoogleGenerativeAIProviderOptions } from '@ai-sdk/google'
import { generateObject, generateText } from 'ai'
import { z } from 'zod'
import type { UserMemory } from '~/services/memory'
import { getActiveMemories } from '~/services/memory'
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

  const { object } = await generateObject({
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

  return object
}

// ============================================
// SVG Generation
// ============================================

/**
 * Generate SVG artwork for a character based on its concept
 */
export async function generateCharacterSvg(input: {
  concept: CharacterConcept
  evolutionStage: number
}): Promise<string> {
  const model = google('gemini-3-flash-preview')

  const { text } = await generateText({
    model,
    providerOptions: {
      google: {
        thinkingConfig: { thinkingLevel: 'low' },
      } satisfies GoogleGenerativeAIProviderOptions,
    },
    system: `
かわいいキャラクターのSVGコードを生成する。

## 要件
- サイズ: 200x200px（viewBox="0 0 200 200"）
- スタイル: シンプルでかわいい、丸みを帯びたデザイン
- 色: パステルカラー中心
- 背景: 透明
- 表情: にっこり笑顔
- 線: 太めの丸い線（stroke-linecap: round）

## デザインのコツ
- 大きな目（キラキラ）と小さめの口（にっこり）
- 丸みを帯びた体型、シンプルな色使い（2-3色）
- 特徴的なパーツ1つ（帽子、羽、しっぽなど）

## 出力フォーマット
SVGコードのみ（<svg>タグから</svg>まで）
    `.trim(),
    prompt: `
キャラクター名: ${input.concept.name}
種族: ${input.concept.species}
外見: ${input.concept.appearance}
性格: ${input.concept.personality}
進化段階: ${input.evolutionStage}/5

進化段階に応じたデザイン:
- 段階1: シンプルで小さい、基本形
- 段階2: 少し大きく、表情がはっきり
- 段階3: 特徴的なパーツが生える（手足、耳、羽など）
- 段階4: アクセサリーや模様が追加、より個性的に
- 段階5: 光やオーラのエフェクト、完成形、最もかわいい

このキャラクターの段階${input.evolutionStage}のかわいいSVGを生成してください。
    `.trim(),
  })

  // Clean up the SVG output
  let svg = text.trim()

  // Remove markdown code blocks if present
  if (svg.startsWith('```')) {
    svg = svg.replace(/^```(?:svg|xml)?\n?/, '').replace(/\n?```$/, '')
  }

  // Ensure it starts with <svg
  if (!svg.startsWith('<svg')) {
    const svgStart = svg.indexOf('<svg')
    if (svgStart >= 0) {
      svg = svg.substring(svgStart)
    }
  }

  // Ensure it ends with </svg>
  const svgEnd = svg.lastIndexOf('</svg>')
  if (svgEnd >= 0) {
    svg = svg.substring(0, svgEnd + 6)
  }

  return svg
}

// ============================================
// Character Message Generation
// ============================================

const characterMessageSchema = z.object({
  message: z.string().max(100).describe('キャラクターからのメッセージ'),
})

/**
 * Generate a message from the character to the user
 */
export async function generateCharacterMessage(input: {
  concept: CharacterConcept
  evolutionStage: number
  happiness: number
  energy: number
  context: 'greeting' | 'pet' | 'talk' | 'evolution' | 'diary_response'
  additionalContext?: string
}): Promise<string> {
  const model = google('gemini-3-flash-preview')

  const { object } = await generateObject({
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

## 出力フォーマット
- 長さ: 1-2文、50文字以内
- トーン: キャラクターの性格と口癖を反映
- 絵文字を1つ含める（${input.concept.emoji}など）
- 幸福度/元気度が低いほど寂しそうなトーンに
    `.trim(),
    prompt: `
状況: ${getContextDescription(input.context)}
${input.additionalContext ? `補足: ${input.additionalContext}` : ''}

この状況に合ったメッセージを生成してください。
    `.trim(),
  })

  return object.message
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
// Dynamic Message SVG Generation
// ============================================

export type CharacterEmotion = 'happy' | 'excited' | 'shy' | 'sleepy' | 'love'
export type CharacterAction = 'pet' | 'talk' | 'wave' | 'dance' | 'sparkle'

/**
 * Generate a dynamic SVG for a character message
 * This creates a unique SVG based on the current emotion and action
 */
export async function generateMessageSvg(input: {
  concept: CharacterConcept
  evolutionStage: number
  emotion: CharacterEmotion
  action: CharacterAction
}): Promise<string> {
  const model = google('gemini-3-flash-preview')

  const emotionDescriptions: Record<CharacterEmotion, string> = {
    happy: '嬉しそうにニコニコ笑っている、目がキラキラ',
    excited: 'ワクワクして目を輝かせている、少しジャンプしている感じ',
    shy: '照れて頬を赤らめている、少し恥ずかしそう',
    sleepy: '眠そうに目を細めている、あくびしている',
    love: 'ハートの目をしている、ラブラブな表情',
  }

  const actionDescriptions: Record<CharacterAction, string> = {
    pet: '撫でられて気持ちよさそう、目を閉じている',
    talk: '話を聞いている、首を傾げている',
    wave: '手を振っている、挨拶している',
    dance: '楽しそうに踊っている、体を揺らしている',
    sparkle: 'キラキラ輝いている、光のエフェクト付き',
  }

  const { text } = await generateText({
    model,
    providerOptions: {
      google: {
        thinkingConfig: { thinkingLevel: 'minimal' },
      } satisfies GoogleGenerativeAIProviderOptions,
    },
    system: `
かわいいキャラクターの表情・ポーズ違いのSVGコードを生成する。

## 要件
- サイズ: 200x200px（viewBox="0 0 200 200"）
- スタイル: シンプルでかわいい、丸みを帯びたデザイン
- 色: パステルカラー中心、背景は透明
- 表情とポーズを指定に合わせて変える
- アクションに合わせたエフェクト（ハート、キラキラ、汗など）を追加

## 出力フォーマット
SVGコードのみ（<svg>タグから</svg>まで）
    `.trim(),
    prompt: `
キャラクター: ${input.concept.name}（${input.concept.species}）
外見: ${input.concept.appearance}
進化段階: ${input.evolutionStage}/5

表情: ${emotionDescriptions[input.emotion]}
アクション: ${actionDescriptions[input.action]}
    `.trim(),
  })

  // Clean up the SVG output
  let svg = text.trim()

  // Remove markdown code blocks if present
  if (svg.startsWith('```')) {
    svg = svg.replace(/^```(?:svg|xml)?\n?/, '').replace(/\n?```$/, '')
  }

  // Ensure it starts with <svg
  if (!svg.startsWith('<svg')) {
    const svgStart = svg.indexOf('<svg')
    if (svgStart >= 0) {
      svg = svg.substring(svgStart)
    }
  }

  // Ensure it ends with </svg>
  const svgEnd = svg.lastIndexOf('</svg>')
  if (svgEnd >= 0) {
    svg = svg.substring(0, svgEnd + 6)
  }

  return svg
}
