import { generateText } from './genai'
import { getPersonaBackgroundShort } from './persona'

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
    const { text } = await generateText({
      model: 'gemini-3-flash-preview',
      thinkingLevel: 'minimal',
      system: `
${getPersonaBackgroundShort(personaName)}

## タスク
以前日記に書いていた未来のイベントについてフォローアップする。

## 出力フォーマット
- 長さ: 1-2文、60文字以内（改行なし）
- 内容: 「どうだった？」の問いかけを含む
- トーン: さりげない関心
- 絵文字: 0-1個

## 例
「昨日のプレゼン、どうだった？気になってたよ。」
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
