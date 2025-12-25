import { google, type GoogleGenerativeAIProviderOptions } from '@ai-sdk/google'
import { generateText } from 'ai'
import { getPersonaBackground } from './persona'

export interface DiaryReminderMoodOption {
  emoji: string
  label: string
}

export interface DiaryReminderContext {
  personaName: string
  userId: string
  moodOptions: readonly DiaryReminderMoodOption[]
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
    const model = google('gemini-3-flash-preview')
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
SlackのDMで日記のリマインダーを送ってください。

## 大切にすること
- どんな気持ちでも書いていい、ということが伝わるように
- ネガティブな感情も自然なもの。良い気分でなくても構わない
- 書かなくても責めない。気が向いたときでいい
- プレッシャーを与えず、ただ扉を開けておく感じで

## 制約
- 2-3文、全体で60文字以内
- 相手が気軽に今日のきもちを共有したくなるように
- 改行は使わない
      `.trim(),
      prompt: [
        `宛先: <@${userId}>`,
        `おすすめリアクション: ${moodList}`,
        'あなたらしく、優しくリマインダーを書いてください。DM本文のみを出力してください。',
      ].join('\n'),
    })

    return text
  } catch (error) {
    console.error('generateDiaryReminder failed', error)
    return String(error)
  }
}
