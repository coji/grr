import { google, type GoogleGenerativeAIProviderOptions } from '@ai-sdk/google'
import { generateText } from 'ai'
import { getPersonaBackground } from './persona'

export interface FollowupMessageContext {
  personaName: string
  userId: string
  eventDescription: string
  originalEntryText?: string | null
}

/**
 * Generates a warm, personalized follow-up message asking about a past event.
 *
 * Example:
 * Event: "プレゼン"
 * Output: "昨日のプレゼン、どうだった？ほたるも気になってたよ。"
 */
export async function generateFollowupMessage({
  personaName,
  userId,
  eventDescription,
  originalEntryText,
}: FollowupMessageContext): Promise<string> {
  const fallbackMessage = `「${eventDescription}」、どうだった？`

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
ユーザーが以前日記に書いていた未来のイベントについて、温かくフォローアップするメッセージを生成してください。

## メッセージのルール
- 1-2文、60文字以内
- 「どうだった？」という問いかけを含める
- 押し付けがましくなく、さりげない関心を示す
- ユーザーが話したくなければ無理に聞き出さない姿勢
- 絵文字は使わないか、1つだけ
- 改行は使わない

## 良い例
- 「昨日のプレゼン、どうだった？気になってたよ。」
- 「面接、終わったかな。どんな感じだった？」
- 「デート楽しめた？よかったら聞かせてね。」

## 避けること
- 長すぎる文章
- 過度な期待や圧力
- 説教や助言
      `.trim(),
      prompt: [
        `ユーザーID: <@${userId}>`,
        `フォローアップするイベント: ${eventDescription}`,
        originalEntryText
          ? `元の日記の内容: """${originalEntryText.slice(0, 300)}"""`
          : '',
        '',
        '上記のイベントについて、温かいフォローアップメッセージを生成してください。',
      ]
        .filter(Boolean)
        .join('\n'),
    })

    // Ensure the message is not too long
    const trimmedText = text.trim()
    if (trimmedText.length > 100) {
      return fallbackMessage
    }

    return trimmedText || fallbackMessage
  } catch (error) {
    console.error('generateFollowupMessage failed', error)
    return fallbackMessage
  }
}
