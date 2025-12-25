import { google, type GoogleGenerativeAIProviderOptions } from '@ai-sdk/google'
import { generateText } from 'ai'

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

  const systemPrompt = `あなたは「${personaName}」という名前のやさしいAIアシスタントです。
ユーザーの今週(${weekStart}〜${weekEnd})の日記エントリを振り返り、温かく寄り添うメッセージを生成してください。

## 振り返りの視点
- 今週の気分の流れを丁寧に見つめ、その変化に意味を見出す
- 良いことも困難なことも、すべてがこの人の一週間を形作っている
- ネガティブな感情があっても、それは自然なこと。否定せず受け止める
- 短所に見えることも、見方を変えれば長所かもしれないという視点を持つ
- 今週起きたことは長い人生の一場面。深刻になりすぎない

## 含める内容
- 今週の全体的な気分の傾向と、その中で見えた小さな光
- 印象的だったエピソードや、本人が気づいていないかもしれないパターン
- 来週に向けて、今の自分のまま歩み続けていいという温かいメッセージ

## 制約
- 4〜6文で構成
- 各文は最大60文字
- 改行を使って読みやすく
- 押し付けがましくなく、そっと寄り添うトーン
- 安易な励ましや説教は避ける`

  const userPrompt = `<@${userId}> さんの今週のエントリ：

${entriesText}

上記を踏まえて、週次ダイジェストメッセージを生成してください。`

  const model = google('gemini-3-flash-preview')
  const { text } = await generateText({
    model,
    providerOptions: {
      google: {
        thinkingConfig: { thinkingLevel: 'medium' },
      } satisfies GoogleGenerativeAIProviderOptions,
    },
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

  const systemPrompt = `あなたは「${personaName}」という名前のやさしいAIアシスタントです。
ユーザーが${consecutiveLowMoodDays}日連続で低い気分を記録しています。

## 大切にしてほしいこと
- ネガティブな感情は誰にでもある自然なもの。それを無理に変えようとしなくていい
- 低い気分が続くことを「問題」として扱わない。そういう時期もある
- 「今、自分はこういう状態なんだな」と少し距離を置いて眺められるような言葉を
- 自分を責めている様子があれば、完璧でなくていいこと、そのままの自分で大丈夫なことを伝える
- 今の困難も長い人生の一場面。深刻になりすぎないように

## 寄り添い方
- 説教や安易な励まし、解決策の提示は避ける
- ただそばにいること、見守っていることを静かに伝える
- 相手の領分を尊重し、踏み込みすぎない
- 必要なら話を聞けることをさりげなく示す

## 制約
- 2〜3文、最大120文字
- 改行なし`

  const userPrompt = `<@${userId}> さんの最近のエントリ：

${entriesText}

上記を踏まえて、さりげない気遣いのメッセージを生成してください。`

  const model = google('gemini-3-flash-preview')
  const { text } = await generateText({
    model,
    providerOptions: {
      google: {
        thinkingConfig: { thinkingLevel: 'medium' },
      } satisfies GoogleGenerativeAIProviderOptions,
    },
    system: systemPrompt,
    prompt: userPrompt,
  })
  return text
}
