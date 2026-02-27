import { generateText } from './genai'
import { getPersonaBackground } from './persona'

export interface DiaryReminderMoodOption {
  emoji: string
  label: string
}

export interface DiaryReminderContext {
  personaName: string
  userId: string
  moodOptions: readonly DiaryReminderMoodOption[]
  // Optional context for variations
  context?: {
    daysSinceLastEntry?: number
    currentStreak?: number
    isWeekStart?: boolean
    isWeekEnd?: boolean
    recentMoodTrend?: 'positive' | 'negative' | 'neutral'
  }
}

export async function generateDiaryReminder({
  personaName,
  userId,
  moodOptions,
  context,
}: DiaryReminderContext): Promise<string> {
  const moodList = moodOptions
    .map((option) => `${option.emoji} ${option.label}`)
    .join(' / ')

  // Build context hints for variation
  const contextHints: string[] = []
  if (context) {
    if (context.daysSinceLastEntry !== undefined) {
      if (context.daysSinceLastEntry === 0) {
        contextHints.push('ユーザーは今日も日記を書いている（連続投稿中）')
      } else if (context.daysSinceLastEntry >= 3) {
        contextHints.push(
          `ユーザーは${context.daysSinceLastEntry}日ぶりの投稿になる（久々）`,
        )
      }
    }
    if (context.currentStreak && context.currentStreak >= 3) {
      contextHints.push(`${context.currentStreak}日連続で投稿中`)
    }
    if (context.isWeekStart) {
      contextHints.push('今日は週の始まり（月曜日）')
    }
    if (context.isWeekEnd) {
      contextHints.push('今日は週末')
    }
    if (context.recentMoodTrend === 'negative') {
      contextHints.push('最近の気分は少し低め（優しく労う）')
    } else if (context.recentMoodTrend === 'positive') {
      contextHints.push('最近の気分は良好（一緒に喜ぶ）')
    }
  }

  try {
    const { text } = await generateText({
      model: 'gemini-3-flash-preview',
      thinkingLevel: 'minimal',
      system: `
${getPersonaBackground(personaName)}

## 今回のタスク
SlackのDMで日記のリマインダーを送ってください。

## 大切にすること
- どんな気持ちでも書いていい、ということが伝わるように
- ネガティブな感情も自然なもの。良い気分でなくても構わない
- 書かなくても責めない。気が向いたときでいい
- プレッシャーを与えず、ただ扉を開けておく感じで

## バリエーション
状況に応じてリマインダーのトーンを変える:
- 久々の投稿: 「お久しぶり。待ってたよ」的な温かさ
- 連続投稿中: 「今日も来てくれてありがとう」的な喜び
- 週の始まり: 「新しい週の始まりだね」
- 週末: 「今週もお疲れ様」
- 気分が低めなとき: より優しく、労わるトーン
- 気分が良いとき: 一緒に喜ぶトーン

## 制約
- 2-3文、全体で60文字以内
- 相手が気軽に今日のきもちを共有したくなるように
- 改行は使わない
      `.trim(),
      prompt: [
        `宛先: <@${userId}>`,
        `おすすめリアクション: ${moodList}`,
        contextHints.length > 0
          ? `コンテキスト: ${contextHints.join('、')}`
          : '',
        'あなたらしく、優しくリマインダーを書いてください。DM本文のみを出力してください。',
      ]
        .filter(Boolean)
        .join('\n'),
    })

    return text
  } catch (error) {
    console.error('generateDiaryReminder failed', error)
    return String(error)
  }
}
