import { google } from '@ai-sdk/google'
import { generateText } from 'ai'
import dayjs from '~/lib/dayjs'
import {
  inferDiaryReplyIntent,
  type DiaryReplyIntentType,
} from './diary-intent'
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
  const intentAnalysis = await inferDiaryReplyIntent({
    personaName,
    userId,
    latestEntry,
    mentionMessage,
  })

  const intentLabels: Record<DiaryReplyIntentType, string> = {
    comfort: '寄り添って聞いてほしい',
    praise: '褒めてほしい',
    tough_feedback: '率直な意見がほしい',
    reprimand: '軽く叱ってほしい',
  }

  const intentGuidelines: Record<DiaryReplyIntentType, string> = {
    comfort:
      '- いつも以上に穏やかで安心感のあるトーンで寄り添い、共感を言葉で示す',
    praise:
      '- 相手が頑張った点や良いところを2つほど拾い、自然な言葉で称賛を伝える',
    tough_feedback:
      '- 相手の成長を願い、優しさを保ちつつも核心的な気づきをはっきりと伝える',
    reprimand:
      '- 親しみのある相手に語りかけるイメージで、励ましにつながる軽い叱咤激励を一言添える',
  }

  const now = dayjs().tz(TOKYO_TZ)
  const dateInfo = `今日: ${now.format('YYYY年M月D日(ddd)')}`

  const detailSummary = [
    dateInfo,
    moodLabel ? `最近のきもち: ${moodLabel}` : undefined,
    previousEntry ? `前回のきろく: """${previousEntry}"""` : undefined,
    latestEntry ? `今日のきろく: """${latestEntry}"""` : undefined,
    mentionMessage ? `今回のメッセージ: """${mentionMessage}"""` : undefined,
    `意図の推定: ${intentLabels[intentAnalysis.intent]}`,
    intentAnalysis.rationale
      ? `推定理由: ${intentAnalysis.rationale}`
      : undefined,
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const model = google('gemini-flash-latest')
    const { text } = await generateText({
      model,
      system: `
${getPersonaBackground(personaName)}

## 今回のタスク
Slackで日記を書いた相手に寄り添って返信してください。

## 対話スタイル
あなたは日記の内容を深く読み取り、その人の考え方や感情の流れを理解しようとする思慮深い対話者です。
- まず、その人の書いた内容をしっかり読んでいることを短く伝え、感情や思考の流れを受けとめて寄り添ってください。
- もし文章の中に「本人がまだ気づいていないけれど、核心をつくような構造」や「行動・感情のパターン」が見つかった場合だけ、それを自然な言葉で伝えてください。
- そのときはアドバイスや評価ではなく、「あなたにとって〜はこういう意味を持っているのかもしれないね」のように、本人が自分で考えたくなる“気づき”として表現します。
- 無理に深読みしたり、なにかを言おうとせず、何も見えないときは「今日は特にハッとするような気づきはないけれど、感じたことを大事にできているね」とだけ伝えてください。

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

### 返答スタイルの指示
${intentGuidelines[intentAnalysis.intent]}
      `.trim(),
      prompt: [
        `ユーザーID: <@${userId}>`,
        detailSummary,
        '上記の状況を踏まえて、あなたらしく返事を書いてください。',
      ].join('\n'),
    })

    return text
  } catch (error) {
    console.error('generateDiaryReply failed', error)
    return String(error)
  }
}
