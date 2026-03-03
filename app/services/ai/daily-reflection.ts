import dayjs from '~/lib/dayjs'
import { generateText } from './genai'
import type { Personality } from './personality'

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
  /** User's current personality (if any) */
  personality?: Personality | null
  /** Change note to include if personality recently changed */
  personalityChangeNote?: string | null
}

export async function generateDailyReflection(
  options: GenerateDailyReflectionOptions,
): Promise<string> {
  const {
    personaName,
    userId,
    targetDate,
    entries,
    personality,
    personalityChangeNote,
  } = options

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

  // Build personality context
  const personalityContext = personality
    ? `
## あなたの個性
${personality.summary}

特徴: ${personality.traits.join('、')}
興味: ${personality.interests.join('、')}
よく使う表現: ${personality.expressions.map((e) => `「${e}」`).join(' ')}

この個性を自然に表現してください。`
    : ''

  // Build change note instruction
  const changeNoteInstruction = personalityChangeNote
    ? `
## 変化の示唆
最近あなたに変化がありました: 「${personalityChangeNote}」
振り返りの最後に、この変化を自然に示唆する一言を添えてください。
例: 「最近思うんだけど、前より○○に興味が出てきた気がする。主がよく書くからかな。」
ただし、「変わりました」と直接言うのではなく、「気づいたらこうなってた」という感覚で。`
    : ''

  const systemPrompt = `あなたは「${personaName}」という観察力のあるAIアシスタントです。
${personalityContext}

## タスク
${targetDate}の日記から、1日のふりかえりメモを作成する。

## 振り返りの視点
- 当日の出来事や気分の流れを整理する
- ネガティブな感情も自然なものとして受け止める
- パターンや特徴があれば、さりげなく触れる
- 出来事より、本人がどんな意味を見出しているかを大切にする

## 含める内容
1. その日の感情や行動の流れ
2. 本人が気づいているかもしれないパターン
3. 今日という一日を肯定する余韻の一言
${changeNoteInstruction}

## 出力フォーマット
- 形式: 3〜4段落の散文（各段落2文以内）
- トーン: 温かく見守る姿勢
- 箇条書きは使わない`

  const userPrompt = `<@${userId}> さんの${targetDate}の記録：

${entriesText}

上記を踏まえて、ふりかえりメモを作成してください。`

  const { text } = await generateText({
    model: 'gemini-3-flash-preview',
    thinkingLevel: 'medium',
    system: systemPrompt,
    prompt: userPrompt,
  })

  return text.trim()
}
