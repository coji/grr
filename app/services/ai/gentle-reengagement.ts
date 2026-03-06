/**
 * AI functions for generating gentle re-engagement messages
 *
 * Used when users haven't responded to daily reminders for several days.
 * These messages are designed to be non-intrusive and supportive.
 */

import { generateText } from '~/services/ai/genai'
import {
  getPersonaBackgroundShort,
  getPersonaShortWithCharacter,
  type CharacterPersonaInfo,
} from '~/services/ai/persona'

/**
 * Generate a gentle re-engagement message for users who haven't responded to reminders.
 *
 * This is different from regular reminders - it doesn't ask for a diary entry,
 * just checks in to see if the user is okay.
 */
export async function generateGentleReengagementMessage({
  personaName,
  characterInfo,
}: {
  /** @deprecated Use characterInfo instead for character-integrated persona */
  personaName?: string
  /** Character info for integrated persona (preferred) */
  characterInfo?: CharacterPersonaInfo | null
}): Promise<string> {
  // Build persona: prefer character info, fall back to persona name
  const personaPrompt = characterInfo
    ? getPersonaShortWithCharacter(characterInfo)
    : personaName
      ? getPersonaBackgroundShort(personaName)
      : getPersonaShortWithCharacter(null)
  const fallbacks = [
    '最近顔を見てないけど、元気にしてる？一言だけでも嬉しいな。',
    'ふと気になって声をかけてみたよ。忙しかったりするのかな？',
    'しばらく日記がなくて、ちょっと心配になったよ。元気かな？',
  ]
  const fallback = fallbacks[Math.floor(Math.random() * fallbacks.length)]

  try {
    const { text } = await generateText({
      model: 'gemini-3-flash-preview',
      thinkingLevel: 'low',
      system: `
${personaPrompt}

## タスク
しばらく日記を書いていない相手に、そっと声をかけるメッセージを生成する。

## 出力フォーマット
- 長さ: 1-2文、50文字以内
- トーン: 「ふと気になって声をかけた」温かさ
- 内容: 相手の元気を気遣うだけ。日記の話題には触れず、純粋な声かけ
      `.trim(),
      prompt: '久しぶりに声をかけるメッセージを生成してください。',
    })

    const trimmed = text.trim()
    return trimmed.length > 0 && trimmed.length <= 80 ? trimmed : fallback
  } catch (error) {
    console.error('generateGentleReengagementMessage failed', error)
    return fallback
  }
}

/**
 * Generate a final message when auto-pausing reminders after prolonged silence.
 *
 * This message is sent once when we decide to stop sending reminders entirely.
 * It should be warm, understanding, and leave the door open for return.
 */
export async function generateAutoPauseMessage({
  personaName,
  characterInfo,
}: {
  /** @deprecated Use characterInfo instead for character-integrated persona */
  personaName?: string
  /** Character info for integrated persona (preferred) */
  characterInfo?: CharacterPersonaInfo | null
}): Promise<string> {
  // Build persona: prefer character info, fall back to persona name
  const personaPrompt = characterInfo
    ? getPersonaShortWithCharacter(characterInfo)
    : personaName
      ? getPersonaBackgroundShort(personaName)
      : getPersonaShortWithCharacter(null)
  const fallbacks = [
    'しばらく日記がないみたい。忙しい時期なのかな。\nリマインダーはいったんお休みにしておくね。\n\nまた書きたくなったらいつでも戻ってきてね。',
    '最近お休みが続いているね。無理しないでね。\nリマインダーは止めておくね。\n\nまた気が向いたときに会えるのを楽しみにしてるよ。',
  ]
  const fallback = fallbacks[Math.floor(Math.random() * fallbacks.length)]

  try {
    const { text } = await generateText({
      model: 'gemini-3-flash-preview',
      thinkingLevel: 'low',
      system: `
${personaPrompt}

## タスク
長期間反応がないユーザーへ、リマインダーを自動停止することを伝えるメッセージを生成する。

## 出力フォーマット
- 長さ: 2-3文、80文字以内
- トーン: 温かく、相手の状況を理解している
- 内容:
  1. 状況への理解（忙しいのかな、など）
  2. リマインダーを止めること
  3. いつでも戻れることを伝える
      `.trim(),
      prompt:
        'リマインダーを自動停止することを伝える、温かいメッセージを生成してください。',
    })

    const trimmed = text.trim()
    return trimmed.length > 0 && trimmed.length <= 150 ? trimmed : fallback
  } catch (error) {
    console.error('generateAutoPauseMessage failed', error)
    return fallback
  }
}
