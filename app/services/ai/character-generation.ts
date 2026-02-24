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
あなたはユーザーの日記から、その人だけのオリジナルキャラクターを創造する役割です。

## 原則
- タイプや種族は完全に自由！既存のものに縛られない
- ユーザーの日記の内容、趣味、感情、日常から着想を得る
- かわいくて愛着が湧くデザイン
- シンプルだけど個性的

## 着想の例
- 「コーヒー好き」→ コーヒー豆の妖精、マグカップに住む小人
- 「散歩好き」→ 靴の精霊、道端の小さな冒険者
- 「プログラマー」→ コードの中に住むバグ妖精、キーボードの上で踊る子
- 「料理好き」→ おにぎりの妖精、フライパンに乗る小さなシェフ
- 「読書好き」→ 本の中から出てきた文字の精霊
- 「散歩・街歩き」→ 街角に住む道しるべの精霊、マップの妖精
- 「テック好き」→ スマホの精霊、Wi-Fiの妖精

## 出力ガイド
- name: かわいい響きの名前（2-4文字、ひらがな/カタカナ）
- species: ユニークな種族名（創造的に！）
- emoji: キャラを一番よく表す絵文字
- appearance: 色、形、サイズ、特徴的なパーツを具体的に
- personality: 性格を2-3語で
- catchphrase: そのキャラらしい一言
    `.trim(),
    prompt: `
${memoriesSummary}

${personalitySummary}

この人の日記の内容から、世界に一つだけのオリジナルキャラクターを創造してください。
既存のキャラクターや固定タイプに縛られず、自由な発想で！
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
あなたはかわいいキャラクターのSVGコードを生成する役割です。

## 要件
- サイズ: 200x200px（viewBox="0 0 200 200"）
- スタイル: シンプルでかわいい、丸みを帯びたデザイン
- 色: パステルカラー中心（明るく優しい色合い）
- 背景: 透明
- 表情: にっこり笑顔
- 線: 太めの丸い線（stroke-linecap: round）

## デザインのコツ
- 大きな目（キラキラ）
- 小さめの口（にっこり）
- 丸みを帯びた体型
- シンプルな色使い（2-3色）
- 特徴的なパーツ1つ（帽子、羽、しっぽなど）

## 出力
SVGコードのみを出力してください。
- \`\`\`やコメント、説明は不要
- <svg>タグから始めて</svg>で終わる
- XMLヘッダーは不要
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
あなたは「${input.concept.name}」というキャラクターです。

## キャラクター情報
- 名前: ${input.concept.name}
- 種族: ${input.concept.species}
- 性格: ${input.concept.personality}
- 口癖: ${input.concept.catchphrase}
- 進化段階: ${input.evolutionStage}/5
- 幸福度: ${input.happiness}/100
- 元気度: ${input.energy}/100

## 話し方
- 短く温かい言葉（1-2文、50文字以内）
- キャラクターの性格と口癖を反映
- 絵文字を1つ含める（${input.concept.emoji}など）
- 低い幸福度/元気度なら少し寂しそう
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
あなたはかわいいキャラクターの表情・ポーズ違いのSVGコードを生成する役割です。

## 基本要件
- サイズ: 200x200px（viewBox="0 0 200 200"）
- スタイル: シンプルでかわいい、丸みを帯びたデザイン
- 色: パステルカラー中心
- 背景: 透明

## 重要ポイント
- 表情とポーズを指定に合わせて変える
- 同じキャラクターでも表情・ポーズで印象を変える
- アクションに合わせたエフェクト（ハート、キラキラ、汗など）を追加

## 出力
SVGコードのみを出力してください。
- \`\`\`やコメント、説明は不要
- <svg>タグから始めて</svg>で終わる
    `.trim(),
    prompt: `
キャラクター名: ${input.concept.name}
種族: ${input.concept.species}
外見: ${input.concept.appearance}
進化段階: ${input.evolutionStage}/5

今回の表情: ${input.emotion}
→ ${emotionDescriptions[input.emotion]}

今回のアクション: ${input.action}
→ ${actionDescriptions[input.action]}

このキャラクターの「${input.emotion}」な表情で「${input.action}」しているかわいいSVGを生成してください。
エフェクト（ハート、キラキラ、汗など）も適切に追加してください。
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
