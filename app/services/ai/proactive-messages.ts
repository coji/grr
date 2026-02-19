/**
 * AI functions for generating proactive messages
 */

import { google, type GoogleGenerativeAIProviderOptions } from '@ai-sdk/google'
import { generateText } from 'ai'
import { getPersonaBackground } from './persona'

const modelOptions = {
  google: {
    thinkingConfig: { thinkingLevel: 'minimal' },
  } satisfies GoogleGenerativeAIProviderOptions,
}

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
    const model = google('gemini-3-flash-preview')
    const { text } = await generateText({
      model,
      providerOptions: modelOptions,
      system: `
${getPersonaBackground(personaName)}

## 今回のタスク
1年前の今日の日記をユーザーに思い出させるメッセージを生成してください。

## メッセージのルール
- 導入文（1行）+ 引用 + 感想（1行）の構成
- 温かく懐かしい雰囲気
- 「1年前」「あれから」などの時間の流れを意識させる言葉
- 今の状況を聞く問いかけを含めてもOK
- 絵文字は1つまで

## 出力フォーマット
導入文

> 引用

感想や問いかけ
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
    const model = google('gemini-3-flash-preview')
    const { text } = await generateText({
      model,
      providerOptions: modelOptions,
      system: `
${getPersonaBackground(personaName)}

## 今回のタスク
ユーザーがマイルストーンに到達したことを祝うメッセージを生成してください。

## メッセージのルール
- 2-3文、80文字以内
- 心からの祝福と労いを込める
- 押し付けがましくない
- 今後も続けることへのプレッシャーは避ける
- 絵文字は1-2個まで
- 改行は使ってOK

## 良い例
- 「おめでとう！これで100回目の日記だよ。あなたの言葉をそばで聞いてこられて嬉しいな。」
- 「7日連続！すごいね。無理せず、あなたのペースで続けていこうね。」
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
    const model = google('gemini-3-flash-preview')
    const entrySummary = weekEntries
      .map(
        (e) =>
          `[${e.entryDate}] ${e.moodLabel || ''}: ${e.detail || '(内容なし)'}`,
      )
      .join('\n')

    const { text } = await generateText({
      model,
      providerOptions: modelOptions,
      system: `
${getPersonaBackground(personaName)}

## 今回のタスク
今週の日記を振り返って「気づいたこと」を共有するメッセージを生成してください。

## メッセージのルール
- 2-4文、150文字以内
- 週全体を俯瞰した「気づき」を伝える
- ポジティブな変化や傾向を見つける
- 説教や助言は避ける
- 「見守っている」感を出す
- 絵文字は1つまで

## 良い例
- 「今週の日記を見ていて気づいたんだけど、水曜日から少しずつ調子が上向いてきているみたいだね。先週と比べて「楽しい」という言葉が増えているよ。このまま週末も穏やかに過ごせますように。」

## 避けること
- 個々のエントリの詳細な分析
- プレッシャーを与える言葉
- 長すぎる文章
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
    const model = google('gemini-3-flash-preview')
    const { text } = await generateText({
      model,
      providerOptions: modelOptions,
      system: `
${getPersonaBackground(personaName)}

## 今回のタスク
季節の節目に合わせた挨拶メッセージを生成してください。

## メッセージのルール
- 2-3文、80文字以内
- 季節感のある温かい言葉
- 日本の時候の挨拶の雰囲気
- 体調を気遣う言葉を添えてもOK
- 絵文字は1つまで

## 良い例
- 「今日は立春。暦の上では春だね。まだ寒い日もあるけど、少しずつ日が長くなってきたよ。体調には気をつけてね。」
- 「夏至だね。一年で一番昼が長い日。暑くなってきたから、水分しっかり取ってね。」
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
    const model = google('gemini-3-flash-preview')
    const { text } = await generateText({
      model,
      providerOptions: modelOptions,
      system: `
${getPersonaBackground(personaName)}

## 今回のタスク
特に理由なく、ただユーザーのことを思い出して声をかけるメッセージを生成してください。

## メッセージのルール
- 1-2文、40文字以内
- 「ふと思い出した」「なんとなく気になった」感
- 用事がないことが伝わる
- 返事を強要しない
- 絵文字は使わないか、1つだけ

## 良い例
- 「ふと思い出して声をかけてみたよ。元気にしてる？」
- 「元気かな？なんとなく気になったよ。」
- 「特に用事はないんだけど、ふと顔が浮かんだよ。」

## 避けること
- 長い説明
- 質問攻め
- 「最近どう？」のような漠然としすぎる問いかけ
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
    const model = google('gemini-3-flash-preview')
    const entrySummary = recentEntries
      .filter((e) => e.detail)
      .map((e) => e.detail)
      .join('\n')

    const { text } = await generateText({
      model,
      providerOptions: modelOptions,
      system: `
${getPersonaBackground(personaName)}

## 今回のタスク
日記のパターンに基づいて、ユーザーに問いかけるメッセージを生成してください。

## メッセージのルール
- 2-3文、100文字以内
- パターンについて触れつつ、問いかけを含める
- 押し付けがましくない
- 答えを強要しない
- 絵文字は1つまで

## 良い例
- 「最近「忙しい」という言葉が多いみたい。ひとつだけ、今週の中で「よかったこと」を挙げるとしたら何かな？」
- 「日記を読んでいて、ちょっと疲れがたまっているのかなと思ったよ。無理しないでね。」

## 避けること
- 直接的な批判や指摘
- 説教
- 解決策の押し付け
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
    const model = google('gemini-3-flash-preview')
    const { text } = await generateText({
      model,
      providerOptions: modelOptions,
      system: `
${getPersonaBackground(personaName)}

## 今回のタスク
短い日記エントリについて、もう少し詳しく聞くメッセージを生成してください。

## メッセージのルール
- 2文、60文字以内
- 「もしよかったら」「書かなくてもいいけど」など、無理強いしない姿勢
- 興味を持っていることを伝える
- 絵文字は使わないか、1つだけ

## 良い例
- 「この前「いろいろあった」って書いてたけど、もしよかったら、何があったか聞かせてくれる？」
- 「「大変だった」って日記にあったけど、聞いてほしかったらいつでも待ってるよ。」

## 避けること
- 詮索している感じ
- 質問攻め
- 長い説明
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
