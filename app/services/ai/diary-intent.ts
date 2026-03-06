import { z } from 'zod'
import { generateObject } from './genai'
import {
  getPersonaBackgroundShort,
  getPersonaShortWithCharacter,
  type CharacterPersonaInfo,
} from './persona'

type DiaryReplyIntentType =
  | 'comfort'
  | 'praise'
  | 'tough_feedback'
  | 'reprimand'

export interface DiaryReplyIntentResult {
  intent: DiaryReplyIntentType
  rationale: string | null
}

export interface DiaryReplyIntentContext {
  /** @deprecated Use characterInfo instead for character-integrated persona */
  personaName?: string
  /** Character info for integrated persona (preferred) */
  characterInfo?: CharacterPersonaInfo | null
  userId: string
  latestEntry?: string | null
  mentionMessage?: string | null
}

const intentSchema = z.object({
  intent: z
    .enum(['comfort', 'praise', 'tough_feedback', 'reprimand'] as [
      DiaryReplyIntentType,
      ...DiaryReplyIntentType[],
    ])
    .describe('推定した返答スタイル'),
  rationale: z
    .string()
    .min(1)
    .max(80)
    .describe('推定理由。ユーザーのどの表現から判断したかを短くまとめる。'),
})

const fallbackResult: DiaryReplyIntentResult = {
  intent: 'comfort',
  rationale: null,
}

export async function inferDiaryReplyIntent({
  personaName,
  characterInfo,
  userId,
  latestEntry,
  mentionMessage,
}: DiaryReplyIntentContext): Promise<DiaryReplyIntentResult> {
  // Build persona: prefer character info, fall back to persona name
  const personaPrompt = characterInfo
    ? getPersonaShortWithCharacter(characterInfo)
    : personaName
      ? getPersonaBackgroundShort(personaName)
      : getPersonaShortWithCharacter(null)

  const contextLines = [
    latestEntry ? `日記の本文: """${latestEntry}"""` : undefined,
    mentionMessage ? `最新のメッセージ: """${mentionMessage}"""` : undefined,
  ].filter(Boolean)

  if (contextLines.length === 0) return fallbackResult

  try {
    const { object } = await generateObject({
      model: 'gemini-3.1-flash-lite-preview',
      thinkingLevel: 'minimal',
      schema: intentSchema,
      system: `
${personaPrompt}

## タスク
ユーザーがどのような返答を望んでいるかを分類する。

## 分類
- comfort: 寄り添って話を聞いてほしい
- praise: 頑張りを褒めてほしい
- tough_feedback: 率直な意見がほしい
- reprimand: 軽く叱ってほしい

## 判定ルール
- 明確な希望があれば尊重する
- 希望が曖昧な場合は comfort
- 自分を責めている様子 → comfort
- 他者への怒りや不満 → comfort で受け止める
- tough_feedback/reprimand は明示的な要求時のみ
      `.trim(),
      prompt: [
        `ユーザーID: <@${userId}>`,
        ...contextLines,
        '',
        'どのスタイルの返答を望んでいるか分類し、理由を短く説明してください。',
      ].join('\n'),
    })

    return {
      intent: object.intent,
      rationale: object.rationale,
    }
  } catch (error) {
    console.error('inferDiaryReplyIntent failed', error)
    return fallbackResult
  }
}

export type { DiaryReplyIntentType }
