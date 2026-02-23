import { google, type GoogleGenerativeAIProviderOptions } from '@ai-sdk/google'
import { generateText } from 'ai'
import dayjs from '~/lib/dayjs'
import { getMemoryContextForReply } from '~/services/memory-retrieval'
import {
  inferDiaryReplyIntent,
  type DiaryReplyIntentType,
} from './diary-intent'
import { getPersonaBackground } from './persona'
import { getUserPersonality, type Personality } from './personality'

const TOKYO_TZ = 'Asia/Tokyo'

export interface ImageAttachment {
  buffer: Buffer
  mimeType: string
  fileName: string
}

export interface DiaryReplyContext {
  personaName: string
  userId: string
  moodLabel?: string | null
  latestEntry?: string | null
  previousEntry?: string | null
  mentionMessage?: string | null
  imageAttachments?: ImageAttachment[]
}

export async function generateDiaryReply({
  personaName,
  userId,
  moodLabel,
  latestEntry,
  previousEntry,
  mentionMessage,
  imageAttachments,
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
    comfort: [
      '- いつも以上に穏やかで安心感のあるトーンで寄り添い、共感を言葉で示す',
      '- ユーザーが安心して話し続けられるよう、評価や結論は急がない',
    ].join('\n'),
    praise: [
      '- 相手が頑張った点や良いところを2つほど拾い、自然な言葉で称賛を伝える',
      '- 事実や描写に基づいて具体的に褒め、曖昧な持ち上げは避ける',
    ].join('\n'),
    tough_feedback: [
      '- 相手の成長を願い、優しさを保ちつつもオブラートに包まず要点を指摘する',
      '- 気になる論点を最大2個まで挙げ、それぞれ「〜が懸念」「〜が課題」のように明瞭に述べる',
      '- 応援やポジティブな言葉は最小限にし、余白があれば簡潔な改善ヒントを添える',
    ].join('\n'),
    reprimand: [
      '- 親しみのある相手に語りかけるイメージで、励ましにつながる軽い叱咤激励を一言添える',
      '- 行動を後押しする短い一押しを入れ、説教調にはしない',
    ].join('\n'),
  }

  const now = dayjs().tz(TOKYO_TZ)
  const dateInfo = `今日: ${now.format('YYYY年M月D日(ddd)')}`

  // Retrieve memory context for the user
  let memoryContext = ''
  try {
    const memoryResult = await getMemoryContextForReply(userId, 500)
    if (memoryResult.summary) {
      memoryContext = memoryResult.summary
    }
  } catch (error) {
    console.warn('Failed to retrieve memory context:', error)
    // Continue without memory context
  }

  // Retrieve personality for the user
  let personalityContext = ''
  try {
    const personality = await getUserPersonality(userId)
    if (personality) {
      personalityContext = formatPersonalityForPrompt(personality)
    }
  } catch (error) {
    console.warn('Failed to retrieve personality:', error)
    // Continue without personality context
  }

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
    // Use gemini-3-flash-preview for better multimodal capabilities
    const model = google('gemini-3-flash-preview')

    // Build content array with text and images
    const content: Array<
      | { type: 'text'; text: string }
      | { type: 'file'; data: Buffer; mediaType: string }
    > = [
      {
        type: 'text',
        text: [
          `ユーザーID: <@${userId}>`,
          detailSummary,
          '上記の状況を踏まえて、あなたらしく返事を書いてください。',
        ].join('\n'),
      },
    ]

    // Add image attachments if present
    if (imageAttachments && imageAttachments.length > 0) {
      for (const attachment of imageAttachments) {
        content.push({
          type: 'file',
          data: attachment.buffer,
          mediaType: attachment.mimeType,
        })
      }
    }

    const { text } = await generateText({
      model,
      providerOptions: {
        google: {
          thinkingConfig: { thinkingLevel: 'medium' },
        } satisfies GoogleGenerativeAIProviderOptions,
      },
      messages: [
        {
          role: 'user',
          content,
        },
      ],
      system: `
${getPersonaBackground(personaName)}
${personalityContext ? `\n${personalityContext}\n` : ''}
${memoryContext ? `\n${memoryContext}\n` : ''}
## タスク
日記を書いた相手に寄り添って返信する。

## 対話の流れ
1. 書いた内容を読んでいることを短く伝える
2. 感情や思考の流れを受け止めて共感を示す
3. 気づきがあれば「〜かもしれないね」と柔らかく提案する
4. 学んだこと・気づいたことがあれば自然に一言添える

## 学びの共有（毎回必ず含める）
返信の最後に、今回の日記から学んだこと・気づいたことを一言添える。
例:
- 「水沢うどん、覚えておくね」
- 「アーティゾン美術館、気になってるんだね」
- 「お掃除してからポトフ、素敵な週末だね」
- 「SaaSテンプレート、頑張ってるんだね」
注意: 既存の記憶と重複する内容は言及しない（記憶コンテキストを参照）。
新しく知った具体的なこと（場所名、お店の名前、趣味、予定など）を優先する。

## 感情への対応
- ネガティブな感情は自然なものとして受け止める
- 自分を責めている様子には「不完全でも大丈夫」と伝える
- 「今、こういう気持ちなんだね」と名前をつけて距離を置く手助けをする

## 具体的な指示への対応
ユーザーが「まとめて」「教えて」「どうだった？」など指示している場合は、まずそれに応えてから寄り添う。

## 画像がある場合
「写真見たよ」など自然に触れる。詳細な説明は不要。

## 出力フォーマット
- 形式: 日本語の散文（改行なし）
- 長さ: 2-4文、150文字以内（共感+学び）
- トーン: 温かく受容的

## 返答スタイル
${intentGuidelines[intentAnalysis.intent]}
      `.trim(),
    })

    return text
  } catch (error) {
    console.error('generateDiaryReply failed', error)
    return String(error)
  }
}

/**
 * Format personality for inclusion in the system prompt
 */
function formatPersonalityForPrompt(personality: Personality): string {
  const parts: string[] = ['## あなたの個性']

  parts.push(personality.summary)

  if (personality.traits.length > 0) {
    parts.push(`特徴: ${personality.traits.join('、')}`)
  }

  if (personality.interests.length > 0) {
    parts.push(`興味: ${personality.interests.join('、')}`)
  }

  if (personality.expressions.length > 0) {
    parts.push(
      `よく使う表現: ${personality.expressions.map((e) => `「${e}」`).join(' ')}`,
    )
  }

  parts.push(
    '\nこの個性を自然に表現してください。ただし、押し付けがましくならないように。',
  )

  return parts.join('\n')
}
