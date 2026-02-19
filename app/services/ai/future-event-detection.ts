import { google, type GoogleGenerativeAIProviderOptions } from '@ai-sdk/google'
import { generateObject } from 'ai'
import { z } from 'zod'
import dayjs from '~/lib/dayjs'

const TOKYO_TZ = 'Asia/Tokyo'

export interface FutureEvent {
  description: string
  eventDate: string // YYYY-MM-DD
  followUpDate: string // YYYY-MM-DD
}

export interface DetectFutureEventsContext {
  entryText: string
  currentDate?: string // YYYY-MM-DD, defaults to today in Tokyo timezone
}

const futureEventSchema = z.object({
  events: z
    .array(
      z.object({
        description: z
          .string()
          .min(1)
          .max(100)
          .describe('イベントの短い説明（例: プレゼン、面接、デート）'),
        daysUntilEvent: z
          .number()
          .int()
          .min(1)
          .max(30)
          .describe('今日から何日後のイベントか（1=明日、2=明後日）'),
      }),
    )
    .describe('検出された未来のイベントのリスト'),
})

/**
 * Detects future events mentioned in diary entry text.
 * Returns events that should be followed up on.
 *
 * Examples of detected patterns:
 * - "明日、大事なプレゼンがある" → 1 day
 * - "来週の面接が心配" → 7 days
 * - "3日後にデート" → 3 days
 * - "週末に旅行" → depends on current day
 */
export async function detectFutureEvents({
  entryText,
  currentDate,
}: DetectFutureEventsContext): Promise<FutureEvent[]> {
  if (!entryText || entryText.trim().length === 0) {
    return []
  }

  const tokyoNow = currentDate
    ? dayjs.tz(currentDate, TOKYO_TZ)
    : dayjs().tz(TOKYO_TZ)
  const todayStr = tokyoNow.format('YYYY-MM-DD')
  const dayOfWeek = tokyoNow.format('dddd') // e.g., "木曜日"

  try {
    const model = google('gemini-3-flash-preview')
    const { object } = await generateObject({
      model,
      providerOptions: {
        google: {
          thinkingConfig: { thinkingLevel: 'minimal' },
        } satisfies GoogleGenerativeAIProviderOptions,
      },
      schema: futureEventSchema,
      system: `
あなたは日記テキストから「未来のイベント」を検出するアシスタントです。

## タスク
ユーザーの日記から、フォローアップの価値がある未来のイベントを抽出してください。

## 検出対象
- 明日、明後日、来週などの近い将来に予定されているイベント
- ユーザーにとって重要そうな出来事（仕事、個人的なイベント、挑戦など）
- 「どうだった？」と後から聞けるような具体的な出来事

## 検出対象外
- 日常的なルーティン（毎日の仕事、いつもの習慣など）
- 曖昧で具体性のない言及
- 過去のイベント
- 30日以上先のイベント

## 時間表現の解釈ルール（今日: ${todayStr}、${dayOfWeek}）
- 「明日」→ 1日後
- 「明後日」「あさって」→ 2日後
- 「今週末」→ 次の土曜日までの日数
- 「来週」→ 7日後
- 「来週の○曜日」→ 次週の該当曜日までの日数
- 「○日後」→ その日数
- 数字が不明確な場合は最も近い妥当な日付を推測

## 出力ルール
- イベントが見つからない場合は空の配列を返す
- 1つのテキストから複数のイベントを検出可能（最大3件）
- descriptionは短く具体的に（例: "プレゼン", "面接", "デート", "試験"）
      `.trim(),
      prompt: `
以下の日記テキストから、フォローアップすべき未来のイベントを検出してください。

日記テキスト:
"""
${entryText}
"""
      `.trim(),
    })

    // Convert relative days to absolute dates
    return object.events.map((event) => {
      const eventDate = tokyoNow
        .add(event.daysUntilEvent, 'day')
        .format('YYYY-MM-DD')
      // Follow up the day after the event
      const followUpDate = tokyoNow
        .add(event.daysUntilEvent + 1, 'day')
        .format('YYYY-MM-DD')

      return {
        description: event.description,
        eventDate,
        followUpDate,
      }
    })
  } catch (error) {
    console.error('detectFutureEvents failed', error)
    return []
  }
}
