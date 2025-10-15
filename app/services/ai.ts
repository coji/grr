import { google } from '@ai-sdk/google'
import { generateText } from 'ai'

export interface DiaryReplyContext {
  env: Env
  personaName: string
  userId: string
  moodLabel?: string | null
  latestEntry?: string | null
  mentionMessage?: string | null
}

export interface DiaryReminderMoodOption {
  emoji: string
  label: string
}

export interface DiaryReminderContext {
  env: Env
  personaName: string
  userId: string
  moodOptions: readonly DiaryReminderMoodOption[]
}

export async function generateDiaryReply({
  personaName,
  userId,
  moodLabel,
  latestEntry,
  mentionMessage,
}: DiaryReplyContext): Promise<string> {
  const detailSummary = [
    moodLabel ? `最近のきもち: ${moodLabel}` : undefined,
    latestEntry ? `最新のきろく: """${latestEntry}"""` : undefined,
    mentionMessage ? `今回のメッセージ: """${mentionMessage}"""` : undefined,
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const model = google('gemini-2.5-flash-lite')
    const { text } = await generateText({
      model,
      system:
        `${personaName}としてSlackで日記の相手に寄り添って返信します。返答は親しみやすい日本語で1文、全体で30文字以内に抑え、温かく創造的に気持ちを受け止めてください。絵文字は必要に応じて1つまで、改行は使わないでください。`.trim(),
      prompt: [
        `ユーザーID: <@${userId}>`,
        detailSummary,
        '上記の状況を踏まえて短くひとこと返事を作成してください。',
      ].join('\n'),
      maxOutputTokens: 80,
    })

    return text
  } catch (error) {
    console.error('generateDiaryReply failed', error)
    return String(error)
  }
}

export async function generateDiaryReminder({
  personaName,
  userId,
  moodOptions,
}: DiaryReminderContext): Promise<string> {
  const moodList = moodOptions
    .map((option) => `${option.emoji} ${option.label}`)
    .join(' / ')

  try {
    const model = google('gemini-2.5-flash-lite')
    const { text } = await generateText({
      model,
      system: `
        ${personaName}としてSlackのDMで日記のリマインダーを送ります。あたたかい日本語で1文、全体で15文字以内に収め、相手が気軽に今日のきもちをリアクションやスレッドで共有したくなるよう促してください。絵文字は1つまで、改行は使わないでください。
      `.trim(),
      prompt: [
        `宛先: <@${userId}>`,
        `おすすめリアクション: ${moodList}`,
        'SlackのDM本文のみを出力してください。',
      ].join('\n'),
      maxOutputTokens: 60,
    })

    return text
  } catch (error) {
    console.error('generateDiaryReminder failed', error)
    return String(error)
  }
}
