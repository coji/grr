/**
 * Monthly Report Generator
 */

import { google, type GoogleGenerativeAIProviderOptions } from '@ai-sdk/google'
import { generateText } from 'ai'
import { getPersonaBackground } from '~/services/ai/persona'

interface MonthlyReportContext {
  personaName: string
  userId: string
  entries: Array<{
    date: string
    moodLabel: string | null
    detail: string | null
  }>
  stats: {
    totalDays: number
    entryCount: number
    moodCounts: Record<string, number>
    topMood: string | null
    commonWords: string[]
  }
  monthLabel: string
}

/**
 * Generate a monthly report message
 */
export async function generateMonthlyReport({
  personaName,
  entries,
  stats,
  monthLabel,
}: MonthlyReportContext): Promise<string> {
  const fallback = `${monthLabel}も日記を書いてくれてありがとう。来月も穏やかに過ごせますように。`

  try {
    const model = google('gemini-3-flash-preview')

    // Summarize entries for the prompt
    const entrySummary = entries
      .map(
        (e) =>
          `[${e.date}] ${e.moodLabel || ''}: ${(e.detail || '').slice(0, 50)}`,
      )
      .join('\n')

    const { text } = await generateText({
      model,
      providerOptions: {
        google: {
          thinkingConfig: { thinkingLevel: 'minimal' },
        } satisfies GoogleGenerativeAIProviderOptions,
      },
      system: `
${getPersonaBackground(personaName)}

## 今回のタスク
ユーザーの1ヶ月分の日記を振り返って、まとめのメッセージを生成してください。

## メッセージのルール
- 3-5文、200文字以内
- 月全体を俯瞰した感想やコメント
- ポジティブな変化や傾向を見つける
- 説教や助言は避ける
- 来月への温かいエールを添える
- 絵文字は1-2個まで

## 良い例
- 「全体的に穏やかな月だったみたいだね。特に後半は「散歩」が増えていて、外に出る時間を作れているのがいいな、と思ったよ。来月も、あなたのペースで過ごしていこうね。」

## 避けること
- 統計の羅列（それは別ブロックで表示される）
- 個々のエントリの詳細な言及
- プレッシャーを与える言葉
      `.trim(),
      prompt: `
月: ${monthLabel}
投稿日数: ${stats.entryCount}日
よく出てきた気分: ${stats.topMood || '(なし)'}
よく出てきた言葉: ${stats.commonWords.join('、') || '(なし)'}

日記の概要:
${entrySummary}

上記の内容を踏まえて、月のまとめメッセージを生成してください。
      `.trim(),
    })

    return text.trim() || fallback
  } catch (error) {
    console.error('generateMonthlyReport failed', error)
    return fallback
  }
}
