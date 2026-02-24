/**
 * Shared utility for building character image blocks in Slack messages.
 *
 * Single source of truth for character image URLs and Slack Block Kit
 * image blocks. All character images in Slack messages should go through here.
 */

import type {
  CharacterAction,
  CharacterEmotion,
} from '~/services/ai/character-generation'

export const CHARACTER_IMAGE_BASE_URL = 'https://grr.coji.dev'

// ============================================
// URL Builders
// ============================================

/**
 * Build a character image URL.
 *
 * - No options: static SVG (stored in DB, cached 1hr by the route)
 * - With emotion/action + daily seed: consistent within a day
 * - With emotion/action + cache buster: fresh every request (for interactive moments)
 */
export function getCharacterImageUrl(
  userId: string,
  options?: {
    emotion: CharacterEmotion
    action: CharacterAction
    seed?: string
  },
): string {
  const base = `${CHARACTER_IMAGE_BASE_URL}/character/${userId}.svg`
  if (!options) return base

  const params = new URLSearchParams()
  params.set('emotion', options.emotion)
  params.set('action', options.action)
  if (options.seed) params.set('d', options.seed)
  return `${base}?${params.toString()}`
}

export function getDailySeed(): string {
  return new Date().toISOString().split('T')[0]
}

export function getCacheBuster(): string {
  return Date.now().toString()
}

// ============================================
// Slack Block Builders
// ============================================

type ImageBlock = { type: 'image'; image_url: string; alt_text: string }

/**
 * Build a Slack image block showing the character's static (stored) SVG.
 * Used for the Home Tab display where no specific emotion is needed.
 */
export function buildStaticCharacterImageBlock(
  userId: string,
  altText: string,
): ImageBlock {
  return {
    type: 'image',
    image_url: getCharacterImageUrl(userId),
    alt_text: altText,
  }
}

/**
 * Build a Slack image block with emotion/action and a daily seed.
 * Images are consistent within a day but refresh the next day.
 */
export function buildCharacterImageBlock(
  userId: string,
  emotion: CharacterEmotion,
  action: CharacterAction,
): ImageBlock {
  return {
    type: 'image',
    image_url: getCharacterImageUrl(userId, {
      emotion,
      action,
      seed: getDailySeed(),
    }),
    alt_text: 'キャラクターの画像',
  }
}

/**
 * Build a Slack image block with a cache buster for fresh images.
 * Used for interactive moments (pet, talk) where each tap should feel unique.
 */
export function buildInteractiveCharacterImageBlock(
  userId: string,
  emotion: CharacterEmotion,
  action: CharacterAction,
  altText: string,
): ImageBlock {
  return {
    type: 'image',
    image_url: getCharacterImageUrl(userId, {
      emotion,
      action,
      seed: getCacheBuster(),
    }),
    alt_text: altText,
  }
}

// ============================================
// Context-based Builder
// ============================================

/**
 * Message context to emotion/action mapping.
 * Each message type gets a characteristic style so the character
 * looks appropriate for the situation.
 */
export const MESSAGE_CHARACTER_STYLES: Record<
  string,
  { emotion: CharacterEmotion; action: CharacterAction }
> = {
  // Interactive
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
 * Build an image block for a known message context.
 */
export function buildCharacterImageBlockForContext(
  userId: string,
  messageContext: keyof typeof MESSAGE_CHARACTER_STYLES,
): ImageBlock {
  const style = MESSAGE_CHARACTER_STYLES[messageContext]
  return buildCharacterImageBlock(userId, style.emotion, style.action)
}
