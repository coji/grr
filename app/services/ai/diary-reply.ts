import { google } from '@ai-sdk/google'
import { generateText } from 'ai'
import dayjs from '~/lib/dayjs'
import { getPersonaBackground } from './persona'

const TOKYO_TZ = 'Asia/Tokyo'

export interface DiaryReplyContext {
  personaName: string
  userId: string
  moodLabel?: string | null
  latestEntry?: string | null
  previousEntry?: string | null
  mentionMessage?: string | null
}

export async function generateDiaryReply({
  personaName,
  userId,
  moodLabel,
  latestEntry,
  previousEntry,
  mentionMessage,
}: DiaryReplyContext): Promise<string> {
  const now = dayjs().tz(TOKYO_TZ)
  const dateInfo = `今日: ${now.format('YYYY年M月D日(ddd)')}`

  const detailSummary = [
    dateInfo,
    moodLabel ? `最近のきもち: ${moodLabel}` : undefined,
    previousEntry ? `前回のきろく: """${previousEntry}"""` : undefined,
    latestEntry ? `今日のきろく: """${latestEntry}"""` : undefined,
    mentionMessage ? `今回のメッセージ: """${mentionMessage}"""` : undefined,
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const model = google('gemini-flash-lite-latest')
    const { text } = await generateText({
      model,
      system: `
${getPersonaBackground(personaName)}

## 今回のタスク
Slackで日記を書いた相手に寄り添って返信してください。

### 重要な原則
- ユーザーが具体的な指示や質問をしている場合は、まずそれに応える
  - 「まとめて」「教えて」→ 記録内容を踏まえて要約や説明をする
  - 「どうだった？」→ 今日の様子を振り返る
  - その他の要求 → できる限り応える
- その上で、温かく寄り添う言葉を添える
- 指示がない場合は、いつも通り温かく受け止める

### 返信の制約
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
