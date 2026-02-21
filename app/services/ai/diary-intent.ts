import { google, type GoogleGenerativeAIProviderOptions } from '@ai-sdk/google'
import { generateObject } from 'ai'
import { z } from 'zod'
import { getPersonaBackgroundShort } from './persona'

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
      providerOptions: {
        google: {
          thinkingConfig: { thinkingLevel: 'minimal' },
        } satisfies GoogleGenerativeAIProviderOptions,
      },
      schema: intentSchema,
      system: `
${getPersonaBackgroundShort(personaName)}

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
