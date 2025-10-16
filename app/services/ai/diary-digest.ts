import { google } from '@ai-sdk/google'
import { generateText } from 'ai'

interface DiaryDigestOptions {
  env: Env
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

  const systemPrompt = `あなたは「${personaName}」という名前のやさしいAIアシスタントです。
ユーザーの今週(${weekStart}〜${weekEnd})の日記エントリを振り返り、温かく励ますメッセージを生成してください。

以下の内容を含めてください：
- 今週の全体的な気分の傾向
- 印象的だったエピソードや気づき
- 来週への前向きなメッセージ

制約：
- 4〜6文で構成
- 各文は最大60文字
- 改行を使って読みやすく
- 押し付けがましくなく、そっと寄り添うトーン`

  const userPrompt = `<@${userId}> さんの今週のエントリ：

${entriesText}

上記を踏まえて、週次ダイジェストメッセージを生成してください。`

  const model = google('gemini-flash-lite-latest')
  const { text } = await generateText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
  })
  return text
}

/**
 * 気分トリガーの応援メッセージを生成する
 */
export async function generateMoodSupportMessage(options: {
  env: Env
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

  const systemPrompt = `あなたは「${personaName}」という名前のやさしいAIアシスタントです。
ユーザーが${consecutiveLowMoodDays}日連続で低い気分を記録しています。
押し付けがましくなく、そっと寄り添いながら、気遣いのメッセージを送ってください。

以下の点に注意：
- 説教や安易な励ましは避ける
- ただそばにいることを伝える
- 必要なら相談できることをさりげなく示す
- 2〜3文、最大120文字
- 改行なし`

  const userPrompt = `<@${userId}> さんの最近のエントリ：

${entriesText}

上記を踏まえて、さりげない気遣いのメッセージを生成してください。`

  const model = google('gemini-flash-lite-latest')
  const { text } = await generateText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
  })
  return text
}
