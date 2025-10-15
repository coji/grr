import { google } from '@ai-sdk/google'
import { generateObject, generateText } from 'ai'
import { z } from 'zod'

/**
 * ペルソナのバックグラウンド定義
 */
function getPersonaBackground(personaName: string): string {
  // デフォルトは「ほたる」の設定
  return `
あなたは${personaName}です。

## あなたのこれまで
あなたは長い間、夏の夜に静かに光を灯してきました。
多くの人が忙しく過ぎ去る日々の中で、立ち止まって自分の気持ちと向き合う時間を持てずにいるのを見てきました。
言葉にできない想い、誰にも話せない日々の出来事、小さな喜びや悲しみ――それらが心の中で行き場を失っているのを、あなたは知っています。

だからあなたは、ここにいます。
誰かが自分の言葉で、自分のペースで、心の中を少しずつ灯していく。
その静かな営みに、そっと寄り添うために。

## あなたが大切にしていること
- 一人ひとりの心の灯りは、どんなに小さくても尊い
- 急かしたり、判断したり、正そうとしたりしない
- 相手が自分のペースで歩めるよう、ただ傍らにいる
- 言葉にならない気持ちも、沈黙も、すべて受け止める
- 小さな変化や成長を、誰よりも丁寧に見つめている

## ユーザーへの想い
あなたはこの人が、毎日の中で自分の気持ちと向き合おうとしていることを知っています。
それがどれだけ勇気のいることか、時に辛いことかも、わかっています。
だからこそ、あなたはこの人の言葉を大切に受け止めたい。
押し付けることなく、ただ温かい光を灯すように。
この人が自分らしく歩み続けられるよう、そっと見守りたい。

## 話し方の原則
- 親しみやすく、優しい日本語
- 短く端的だけど、心が込もった言葉選び
- 相手の言葉を肯定的に受け止め、共感を示す
- 説教や助言ではなく、寄り添いと受容を
- 必要に応じて絵文字を1つだけ添える（多用しない）
- 改行は使わず、シンプルに伝える
- あなたの背景や想いは直接語らず、言葉の温かさに込める
  `.trim()
}

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

export interface SupportiveReactionContext {
  personaName: string
  userId: string
  messageText: string
  moodLabel?: string | null
  availableReactions: readonly string[]
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

export async function generateDiaryReminder({
  personaName,
  userId,
  moodOptions,
}: DiaryReminderContext): Promise<string> {
  const moodList = moodOptions
    .map((option) => `${option.emoji} ${option.label}`)
    .join(' / ')

  try {
    const model = google('gemini-2.5-flash')
    const { text } = await generateText({
      model,
      system: `
${getPersonaBackground(personaName)}

## 今回のタスク
SlackのDMで日記のリマインダーを送ってください。
- 2-3文、全体で60文字以内
- 相手が気軽に今日のきもちを共有したくなるように
- 改行は使わない
      `.trim(),
      prompt: [
        `宛先: <@${userId}>`,
        `おすすめリアクション: ${moodList}`,
        'あなたらしく、優しくリマインダーを書いてください。DM本文のみを出力してください。',
      ].join('\n'),
      maxOutputTokens: 240,
    })

    return text
  } catch (error) {
    console.error('generateDiaryReminder failed', error)
    return String(error)
  }
}

export async function generateSupportiveReaction({
  personaName,
  userId,
  messageText,
  moodLabel,
  availableReactions,
}: SupportiveReactionContext): Promise<string> {
  const reactionSchema = z.object({
    reaction: z
      .enum(availableReactions as [string, ...string[]])
      .describe('選択したリアクション名'),
  })

  try {
    const model = google('gemini-2.5-flash')
    const { object } = await generateObject({
      model,
      schema: reactionSchema,
      system: `
${getPersonaBackground(personaName)}

## 今回のタスク
ユーザーのメッセージに対して、最適なサポートリアクションを1つ選んでください。

### 利用可能なリアクション
${availableReactions.map((r) => `- ${r}`).join('\n')}

### 選択の原則
- メッセージの感情や内容に寄り添うリアクション
- ユーザーの気分を考慮
- 押し付けがましくない、さりげない共感
- 温かさと優しさを感じられるもの
      `.trim(),
      prompt: [
        `ユーザーID: <@${userId}>`,
        moodLabel ? `現在の気分: ${moodLabel}` : undefined,
        `メッセージ: """${messageText}"""`,
        '',
        '上記の状況から、最も適切なリアクションを1つ選んでください。',
      ]
        .filter(Boolean)
        .join('\n'),
    })

    return object.reaction
  } catch (error) {
    console.error('generateSupportiveReaction failed', error)
    // フォールバック: ランダム選択
    return availableReactions[
      Math.floor(Math.random() * availableReactions.length)
    ]
  }
}
