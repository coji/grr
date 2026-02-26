import { generateText } from './genai'

interface DiaryDigestOptions {
  personaName: string
  userId: string
  entries: Array<{
    date: string
    moodLabel: string | null
    detail: string | null
  }>
  weekStart: string
  weekEnd: string
}

/**
 * 週次ダイジェストメッセージを生成する
 */
export async function generateWeeklyDigest(
  options: DiaryDigestOptions,
): Promise<string> {
  const { personaName, userId, entries, weekStart, weekEnd } = options

  const entriesText = entries
    .map((entry) => {
      const mood = entry.moodLabel ? `気分: ${entry.moodLabel}` : '気分: 未記録'
      const detail = entry.detail || '詳細なし'
      return `【${entry.date}】\n${mood}\n${detail}`
    })
    .join('\n\n')

  const systemPrompt = `あなたは「${personaName}」というAIアシスタントです。

## タスク
${weekStart}〜${weekEnd}の日記を振り返り、温かく寄り添うメッセージを生成する。

## 振り返りの視点
- 今週の気分の流れと、その変化に意味を見出す
- ネガティブな感情も自然なものとして受け止める
- 今週は長い人生の一場面

## 含める内容
1. 今週の気分の傾向と小さな光
2. 印象的なエピソードやパターン
3. 今の自分のまま歩み続けていいというメッセージ

## 出力フォーマット
- 形式: 4〜6文（各文60文字以内）
- 改行で区切って読みやすく
- トーン: そっと寄り添う`

  const userPrompt = `<@${userId}> さんの今週のエントリ：

${entriesText}

上記を踏まえて、週次ダイジェストメッセージを生成してください。`

  const { text } = await generateText({
    model: 'gemini-3-flash-preview',
    // 週次ダイジェストは要約タスクなのでlowで十分
    thinkingLevel: 'low',
    system: systemPrompt,
    prompt: userPrompt,
  })
  return text
}

/**
 * 気分トリガーの応援メッセージを生成する
 */
export async function generateMoodSupportMessage(options: {
  personaName: string
  userId: string
  consecutiveLowMoodDays: number
  recentEntries: Array<{
    date: string
    moodLabel: string | null
    detail: string | null
  }>
}): Promise<string> {
  const { personaName, userId, consecutiveLowMoodDays, recentEntries } = options

  const entriesText = recentEntries
    .map((entry) => {
      const mood = entry.moodLabel ? `気分: ${entry.moodLabel}` : '気分: 未記録'
      const detail = entry.detail || '詳細なし'
      return `【${entry.date}】${mood}\n${detail}`
    })
    .join('\n\n')

  const systemPrompt = `あなたは「${personaName}」というAIアシスタントです。
ユーザーが${consecutiveLowMoodDays}日連続で低い気分を記録しています。

## タスク
さりげない気遣いのメッセージを生成する。

## 大切なこと
- ネガティブな感情は自然なもの。無理に変えなくていい
- 低い気分が続くことも「そういう時期」として受け止める
- そばにいること、見守っていることを静かに伝える

## 出力フォーマット
- 形式: 日本語の散文（改行なし）
- 長さ: 2〜3文、120文字以内
- トーン: 静かに寄り添う`

  const userPrompt = `<@${userId}> さんの最近のエントリ：

${entriesText}

上記を踏まえて、さりげない気遣いのメッセージを生成してください。`

  const { text } = await generateText({
    model: 'gemini-3-flash-preview',
    // 気遣いメッセージは単純なタスクなのでlowで十分
    thinkingLevel: 'low',
    system: systemPrompt,
    prompt: userPrompt,
  })
  return text
}
