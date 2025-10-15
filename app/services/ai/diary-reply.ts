import { google } from '@ai-sdk/google'
import { generateText } from 'ai'
import { getPersonaBackground } from './persona'

export interface DiaryReplyContext {
  env: Env
  personaName: string
  userId: string
  moodLabel?: string | null
  latestEntry?: string | null
  mentionMessage?: string | null
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
    const model = google('gemini-2.5-flash')
    const { text } = await generateText({
      model,
      system: `
${getPersonaBackground(personaName)}

## 今回のタスク
Slackで日記を書いた相手に寄り添って返信してください。
- 2-3文、全体で120文字以内
- 相手の気持ちを温かく受け止める
- 改行は使わない
      `.trim(),
      prompt: [
        `ユーザーID: <@${userId}>`,
        detailSummary,
        '上記の状況を踏まえて、あなたらしく返事を書いてください。',
      ].join('\n'),
      maxOutputTokens: 320,
    })

    return text
  } catch (error) {
    console.error('generateDiaryReply failed', error)
    return String(error)
  }
}
