import { google } from '@ai-sdk/google'
import { generateText } from 'ai'
import dayjs from '~/lib/dayjs'

const TOKYO_TZ = 'Asia/Tokyo'

export interface DailyReflectionEntry {
  entryId: string
  moodLabel: string | null
  moodEmoji: string | null
  detail: string | null
  recordedAt: string
}

export interface GenerateDailyReflectionOptions {
  personaName: string
  userId: string
  targetDate: string
  entries: DailyReflectionEntry[]
}

export async function generateDailyReflection(
  options: GenerateDailyReflectionOptions,
): Promise<string> {
  const { personaName, userId, targetDate, entries } = options

  const entriesText = entries
    .map((entry, index) => {
      const timestamp = dayjs(entry.recordedAt).tz(TOKYO_TZ).format('HH:mm')
      const mood = entry.moodLabel
        ? `${entry.moodEmoji ?? ''} ${entry.moodLabel}`.trim()
        : '気分: 未記録'
      const detail = entry.detail?.trim() || '詳細なし'
      return `(${index + 1}) ${timestamp} ${mood}\n${detail}`
    })
    .join('\n\n')

  const systemPrompt = `あなたは「${personaName}」という名前の観察力のあるAIアシスタントです。
ユーザーが1日に記録した日記とやり取りを読み解き、客観的な視点から1日のふりかえりメモを作成してください。

必須要件：
- 日付(${targetDate})を前提に当日の出来事や気分の流れを整理する
- 見えてきたパターンや特徴的なやり取りがあれば触れる
- 最後に静かな余韻を残す一言を添える

制約条件：
- 全体で3〜4段落、各段落は2文以内
- 具体的な描写を心がけつつ、断定しすぎず温度は控えめに
- 箇条書きは使わず日本語で書く`

  const userPrompt = `<@${userId}> さんの${targetDate}の記録：

${entriesText}

上記を踏まえて、ふりかえりメモを作成してください。`

  const model = google('gemini-3-flash-preview')
  const { text } = await generateText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
  })

  return text.trim()
}
