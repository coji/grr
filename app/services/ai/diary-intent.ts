import { google } from '@ai-sdk/google'
import { generateObject } from 'ai'
import { z } from 'zod'
import { getPersonaBackground } from './persona'

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
  personaName: string
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
  userId,
  latestEntry,
  mentionMessage,
}: DiaryReplyIntentContext): Promise<DiaryReplyIntentResult> {
  const contextLines = [
    latestEntry ? `日記の本文: """${latestEntry}"""` : undefined,
    mentionMessage ? `最新のメッセージ: """${mentionMessage}"""` : undefined,
  ].filter(Boolean)

  if (contextLines.length === 0) return fallbackResult

  try {
    const model = google('gemini-3-flash-preview')
    const { object } = await generateObject({
      model,
      schema: intentSchema,
      system: `
${getPersonaBackground(personaName)}

## 今回のタスク
ユーザーがどのような返答を望んでいるかを分類してください。
利用可能な分類は次の4つです。
- comfort: 寄り添って穏やかに話を聞いてほしい
- praise: 頑張りや良い点をしっかり褒めてほしい
- tough_feedback: 成長のために率直で厳しめの意見がほしい
- reprimand: 自分を鼓舞するために軽く叱ってほしい

### 判定ルール
- 明確な希望があれば必ず尊重する
- 希望が曖昧な場合はcomfortを選ぶ
- ネガティブな自己評価で励ましを求めているときはpraiseを優先する
- 分類が難しい場合でも必ず上記のいずれかを選ぶ
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
