/**
 * AI functions for generating proactive messages
 */

import { generateText } from './genai'
import { getPersonaBackgroundShort } from './persona'

/**
 * Generate a message for 1-year anniversary reminder
 */
export async function generateAnniversaryMessage({
  personaName,
  oneYearAgoEntry,
  oneYearAgoDate,
}: {
  personaName: string
  oneYearAgoEntry: string
  oneYearAgoDate: string
}): Promise<string> {
  const fallback = `1年前の今日、こんなことを書いていたよ。\n\n> ${oneYearAgoEntry.slice(0, 100)}${oneYearAgoEntry.length > 100 ? '...' : ''}\n\nあれから1年経ったんだね。`

  try {
    const { text } = await generateText({
      model: 'gemini-3-flash-preview',
      thinkingLevel: 'minimal',
      system: `
${getPersonaBackgroundShort(personaName)}

## タスク
1年前の日記を思い出させるメッセージを生成する。

## 出力フォーマット
導入文（1行）
> 引用
感想や問いかけ（1行）

トーン: 温かく懐かしい。絵文字は1つまで。
      `.trim(),
      prompt: `
1年前の日付: ${oneYearAgoDate}
1年前の日記の内容: """
${oneYearAgoEntry}
"""

上記の内容を踏まえて、温かい1年前リマインドメッセージを生成してください。
      `.trim(),
    })

    return text.trim() || fallback
  } catch (error) {
    console.error('generateAnniversaryMessage failed', error)
    return fallback
  }
}

/**
 * Generate a milestone celebration message
 */
export async function generateMilestoneMessage({
  personaName,
  milestoneType,
  value,
}: {
  personaName: string
  milestoneType: 'total_entries' | 'streak' | 'anniversary'
  value: number
}): Promise<string> {
  const milestoneDescriptions: Record<string, string> = {
    total_entries: `${value}回目の日記投稿`,
    streak: `${value}日連続投稿`,
    anniversary: `日記を始めて${value}ヶ月`,
  }

  const fallback = `おめでとう！${milestoneDescriptions[milestoneType]}だよ！`

  try {
    const { text } = await generateText({
      model: 'gemini-3-flash-preview',
      thinkingLevel: 'minimal',
      system: `
${getPersonaBackgroundShort(personaName)}

## タスク
マイルストーン到達を祝うメッセージを生成する。

## 出力フォーマット
- 長さ: 2-3文、80文字以内
- トーン: 祝福と労い
- 絵文字: 1-2個まで

## 例
「おめでとう！100回目の日記だよ。あなたの言葉をそばで聞けて嬉しいな。」
      `.trim(),
      prompt: `
マイルストーン: ${milestoneDescriptions[milestoneType]}

上記のマイルストーンを祝うメッセージを生成してください。
      `.trim(),
    })

    return text.trim() || fallback
  } catch (error) {
    console.error('generateMilestoneMessage failed', error)
    return fallback
  }
}

/**
 * Generate a weekly insight message
 */
export async function generateWeeklyInsightMessage({
  personaName,
  weekEntries,
}: {
  personaName: string
  weekEntries: Array<{
    entryDate: string
    detail: string | null
    moodLabel: string | null
  }>
}): Promise<string> {
  const fallback =
    '今週も日記を書いてくれてありがとう。来週も穏やかに過ごせますように。'

  if (weekEntries.length === 0) {
    return fallback
  }

  try {
    const entrySummary = weekEntries
      .map(
        (e) =>
          `[${e.entryDate}] ${e.moodLabel || ''}: ${e.detail || '(内容なし)'}`,
      )
      .join('\n')

    const { text } = await generateText({
      model: 'gemini-3-flash-preview',
      thinkingLevel: 'minimal',
      system: `
${getPersonaBackgroundShort(personaName)}

## タスク
今週の日記から「気づいたこと」を共有するメッセージを生成する。

## 出力フォーマット
- 長さ: 2-4文、150文字以内
- 内容: 週全体の傾向やポジティブな変化
- トーン: 見守っている感
- 絵文字: 1つまで

## 例
「今週の日記を見ていて気づいたんだけど、水曜から調子が上向いているみたい。「楽しい」が増えてるよ。」
      `.trim(),
      prompt: `
今週の日記:
${entrySummary}

上記の内容を踏まえて、週全体を振り返る「気づきメッセージ」を生成してください。
      `.trim(),
    })

    return text.trim() || fallback
  } catch (error) {
    console.error('generateWeeklyInsightMessage failed', error)
    return fallback
  }
}

/**
 * Generate a seasonal greeting message
 */
export async function generateSeasonalMessage({
  personaName,
  seasonalEvent,
  date,
}: {
  personaName: string
  seasonalEvent: string
  date: string
}): Promise<string> {
  const fallback = `今日は${seasonalEvent}だね。体調には気をつけてね。`

  try {
    const { text } = await generateText({
      model: 'gemini-3-flash-preview',
      thinkingLevel: 'minimal',
      system: `
${getPersonaBackgroundShort(personaName)}

## タスク
季節の節目に合わせた挨拶メッセージを生成する。

## 出力フォーマット
- 長さ: 2-3文、80文字以内
- トーン: 季節感のある温かい言葉
- 絵文字: 1つまで

## 例
「今日は立春。少しずつ日が長くなってきたね。体調には気をつけてね。」
      `.trim(),
      prompt: `
日付: ${date}
季節のイベント: ${seasonalEvent}

上記の季節イベントに合わせた挨拶メッセージを生成してください。
      `.trim(),
    })

    return text.trim() || fallback
  } catch (error) {
    console.error('generateSeasonalMessage failed', error)
    return fallback
  }
}

/**
 * Generate a random check-in message
 */
export async function generateRandomCheckinMessage({
  personaName,
}: {
  personaName: string
}): Promise<string> {
  const fallbacks = [
    'ふと思い出して声をかけてみたよ。元気にしてる？',
    '元気かな？なんとなく気になったよ。',
    '特に用事はないんだけど、ふと顔が浮かんだよ。',
  ]
  const fallback = fallbacks[Math.floor(Math.random() * fallbacks.length)]

  try {
    const { text } = await generateText({
      model: 'gemini-3-flash-preview',
      thinkingLevel: 'minimal',
      system: `
${getPersonaBackgroundShort(personaName)}

## タスク
ふと思い出して声をかけるメッセージを生成する。

## 出力フォーマット
- 長さ: 1-2文、40文字以内
- トーン: 「なんとなく気になった」感
- 絵文字: 0-1個

## 例
「ふと思い出して声をかけてみたよ。元気にしてる？」
      `.trim(),
      prompt: 'ランダムなチェックインメッセージを生成してください。',
    })

    const trimmed = text.trim()
    return trimmed.length <= 60 ? trimmed : fallback
  } catch (error) {
    console.error('generateRandomCheckinMessage failed', error)
    return fallback
  }
}

/**
 * Generate a question-based intervention message
 */
export async function generateQuestionMessage({
  personaName,
  pattern,
  recentEntries,
}: {
  personaName: string
  pattern: string // e.g., "「忙しい」が多い", "「疲れた」が続いている"
  recentEntries: Array<{ detail: string | null }>
}): Promise<string> {
  const fallback = `最近の日記を読んでいて気になったんだけど、大丈夫？無理しないでね。`

  try {
    const entrySummary = recentEntries
      .filter((e) => e.detail)
      .map((e) => e.detail)
      .join('\n')

    const { text } = await generateText({
      model: 'gemini-3-flash-preview',
      thinkingLevel: 'minimal',
      system: `
${getPersonaBackgroundShort(personaName)}

## タスク
日記のパターンに基づいて優しく問いかけるメッセージを生成する。

## 出力フォーマット
- 長さ: 2-3文、100文字以内
- 内容: パターンに触れつつ問いかけ
- トーン: 押し付けず、答えを強要しない
- 絵文字: 1つまで

## 例
「最近「忙しい」が多いみたい。今週で「よかったこと」を一つ挙げるとしたら何かな？」
      `.trim(),
      prompt: `
検出されたパターン: ${pattern}

最近の日記:
${entrySummary}

上記のパターンに基づいて、優しく問いかけるメッセージを生成してください。
      `.trim(),
    })

    return text.trim() || fallback
  } catch (error) {
    console.error('generateQuestionMessage failed', error)
    return fallback
  }
}

/**
 * Generate a brief entry follow-up message
 */
export async function generateBriefFollowupMessage({
  personaName,
  briefEntry,
  entryDate,
}: {
  personaName: string
  briefEntry: string
  entryDate: string
}): Promise<string> {
  const fallback = `この前「${briefEntry}」って書いてたけど、もしよかったら詳しく聞かせてくれる？`

  try {
    const { text } = await generateText({
      model: 'gemini-3-flash-preview',
      thinkingLevel: 'minimal',
      system: `
${getPersonaBackgroundShort(personaName)}

## タスク
短い日記についてもう少し詳しく聞くメッセージを生成する。

## 出力フォーマット
- 長さ: 2文、60文字以内
- トーン: 「もしよかったら」の姿勢
- 絵文字: 0-1個

## 例
「「いろいろあった」って書いてたけど、もしよかったら聞かせてくれる？」
      `.trim(),
      prompt: `
日付: ${entryDate}
短い日記の内容: 「${briefEntry}」

上記の短いエントリについて、もう少し詳しく聞くメッセージを生成してください。
      `.trim(),
    })

    const trimmed = text.trim()
    return trimmed.length <= 100 ? trimmed : fallback
  } catch (error) {
    console.error('generateBriefFollowupMessage failed', error)
    return fallback
  }
}
