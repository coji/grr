/**
 * Shared utility for building character image blocks in Slack messages.
 *
 * Provides a consistent way to attach character SVG images
 * to any Slack message, with emotion/action variants.
 */

import type {
  CharacterAction,
  CharacterEmotion,
} from '~/services/ai/character-generation'

const BASE_URL = 'https://grr.coji.dev'

/**
 * Build a Slack image block for a character with the given emotion and action.
 *
 * Uses a daily seed so images change once per day but are cacheable within a day.
 * The SVG route returns a fallback egg for users without a character.
 */
export function buildCharacterImageBlock(
  userId: string,
  emotion: CharacterEmotion,
  action: CharacterAction,
): { type: 'image'; image_url: string; alt_text: string } {
  // Daily seed so the same message type gets a consistent image within a day
  const dailySeed = new Date().toISOString().split('T')[0]
  const imageUrl = `${BASE_URL}/character/${userId}.svg?emotion=${emotion}&action=${action}&d=${dailySeed}`

  return {
    type: 'image',
    image_url: imageUrl,
    alt_text: 'キャラクターの画像',
  }
}

/**
 * Message context to emotion/action mapping.
 *
 * Each message type gets a characteristic emotion and action
 * so the character looks appropriate for the situation.
 */
export const MESSAGE_CHARACTER_STYLES: Record<
  string,
  { emotion: CharacterEmotion; action: CharacterAction }
> = {
  // Interactive (used in home-tab.ts)
  pet: { emotion: 'love', action: 'pet' },
  talk: { emotion: 'happy', action: 'talk' },

  // Diary responses
  diary_reply: { emotion: 'happy', action: 'wave' },

  // Reminders
  daily_reminder: { emotion: 'excited', action: 'wave' },

  // Celebrations
  milestone: { emotion: 'excited', action: 'sparkle' },

  // Proactive messages
  followup: { emotion: 'shy', action: 'talk' },
  anniversary: { emotion: 'love', action: 'sparkle' },
  seasonal: { emotion: 'happy', action: 'dance' },
  weekly_insight: { emotion: 'happy', action: 'talk' },
  random_checkin: { emotion: 'shy', action: 'wave' },
  question: { emotion: 'excited', action: 'talk' },
  brief_followup: { emotion: 'happy', action: 'talk' },

  // Digest
  weekly_digest: { emotion: 'excited', action: 'sparkle' },
}

/**
 * Convenience: build an image block for a known message context.
 */
export function buildCharacterImageBlockForContext(
  userId: string,
  messageContext: keyof typeof MESSAGE_CHARACTER_STYLES,
): { type: 'image'; image_url: string; alt_text: string } {
  const style = MESSAGE_CHARACTER_STYLES[messageContext]
  return buildCharacterImageBlock(userId, style.emotion, style.action)
}
