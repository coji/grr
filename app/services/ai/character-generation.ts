/**
 * Service for AI-powered character generation
 *
 * Generates character types based on user memories and personalities,
 * and creates SVG artwork for characters using Gemini Flash.
 */

import { google, type GoogleGenerativeAIProviderOptions } from '@ai-sdk/google'
import { generateObject, generateText } from 'ai'
import { z } from 'zod'
import { CHARACTER_TYPES, type CharacterType } from '~/services/character'
import type { UserMemory } from '~/services/memory'
import { getActiveMemories } from '~/services/memory'
import type { Personality } from './personality'
import { getUserPersonality } from './personality'

// ============================================
// Character Type Selection
// ============================================

const characterTypeSchema = z.object({
  type: z
    .enum(['firefly', 'moon_rabbit', 'cloud_sprite', 'forest_spirit'])
    .describe('選んだキャラクタータイプ'),
  reason: z.string().max(100).describe('選んだ理由（1文）'),
})

/**
 * Generate a character type based on user's memories and personality
 */
export async function generateCharacterType(userId: string): Promise<{
  type: CharacterType
  reason: string
}> {
  const memories = await getActiveMemories(userId)
  const personality = await getUserPersonality(userId)

  const model = google('gemini-3-flash-preview')

  const memoriesSummary = formatMemoriesForTypeSelection(memories)
  const personalitySummary = personality
    ? formatPersonalityForTypeSelection(personality)
    : ''

  const { object } = await generateObject({
    model,
    providerOptions: {
      google: {
        thinkingConfig: { thinkingLevel: 'low' },
      } satisfies GoogleGenerativeAIProviderOptions,
    },
    schema: characterTypeSchema,
    system: `
あなたはユーザーに合ったキャラクタータイプを選ぶ役割です。

## キャラクタータイプ
- firefly（ほたる）: 静かで内省的な人向け。夜や静けさ、穏やかな時間を大切にする人
- moon_rabbit（つきうさぎ）: 好奇心旺盛で遊び心がある人向け。新しいことを試したり、探索が好きな人
- cloud_sprite（くもの精）: 自由で夢見がちな人向け。クリエイティブで想像力豊かな人
- forest_spirit（もりのこ）: 着実で成長を大切にする人向け。コツコツ努力したり、自然を愛する人

## 判断基準
- 記憶の傾向（仕事、趣味、感情パターン）
- パーソナリティ（性格特徴、興味）
- 日記の雰囲気

## 出力
最も合うタイプを1つ選び、理由を1文で説明してください。
    `.trim(),
    prompt: `
${memoriesSummary}

${personalitySummary}

この人に最も合うキャラクタータイプを選んでください。
    `.trim(),
  })

  return {
    type: object.type,
    reason: object.reason,
  }
}

// ============================================
// SVG Generation
// ============================================

/**
 * Generate SVG artwork for a character
 */
export async function generateCharacterSvg(input: {
  characterType: CharacterType
  evolutionStage: number
  traits?: string[]
}): Promise<string> {
  const model = google('gemini-3-flash-preview')
  const typeConfig = CHARACTER_TYPES[input.characterType]

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

## 出力
SVGコードのみを出力してください。
- \`\`\`やコメント、説明は不要
- <svg>タグから始めて</svg>で終わる
- XMLヘッダーは不要
    `.trim(),
    prompt: `
キャラクター: ${typeConfig.name}（${typeConfig.description}）
進化段階: ${input.evolutionStage}/5
性格: ${(input.traits ?? typeConfig.traits).join('、')}

進化段階に応じたデザイン:
- 段階1: シンプルな卵型、小さな目
- 段階2: 少し大きくなり、小さな口が見える
- 段階3: 手足や耳が生える、表情豊かに
- 段階4: アクセサリーや模様、特徴的な装飾
- 段階5: 光やオーラのエフェクト、完成形

このキャラクターの段階${input.evolutionStage}のSVGを生成してください。
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
  characterType: CharacterType
  characterName: string | null
  evolutionStage: number
  happiness: number
  energy: number
  context: 'greeting' | 'pet' | 'talk' | 'evolution' | 'diary_response'
  additionalContext?: string
}): Promise<string> {
  const model = google('gemini-3-flash-preview')
  const typeConfig = CHARACTER_TYPES[input.characterType]
  const name = input.characterName ?? typeConfig.name

  const { object } = await generateObject({
    model,
    providerOptions: {
      google: {
        thinkingConfig: { thinkingLevel: 'minimal' },
      } satisfies GoogleGenerativeAIProviderOptions,
    },
    schema: characterMessageSchema,
    system: `
あなたは「${name}」というキャラクターです。

## キャラクター情報
- 種類: ${typeConfig.name}（${typeConfig.description}）
- 性格: ${typeConfig.traits.join('、')}
- 進化段階: ${input.evolutionStage}/5
- 幸福度: ${input.happiness}/100
- 元気度: ${input.energy}/100

## 話し方
- 短く温かい言葉（1-2文、50文字以内）
- キャラクターの性格を反映
- 絵文字を1つ含める（typeに合ったもの）
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

function formatMemoriesForTypeSelection(memories: UserMemory[]): string {
  if (memories.length === 0) {
    return '## 記憶\nまだ記憶がありません。'
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

  const sections: string[] = ['## 記憶']
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

function formatPersonalityForTypeSelection(personality: Personality): string {
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
