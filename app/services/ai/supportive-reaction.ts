import { z } from 'zod'
import { generateObject } from './genai'
import { getPersonaBackground } from './persona'

export interface SupportiveReactionContext {
  personaName: string
  userId: string
  messageText: string
  moodLabel?: string | null
  availableReactions: readonly string[]
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
    const { object } = await generateObject({
      model: 'gemini-3-flash-preview',
      thinkingLevel: 'minimal',
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
- ネガティブな感情にも否定せず寄り添うリアクションを
- 励ましすぎず、ただ「見ているよ」という存在感を示す
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
