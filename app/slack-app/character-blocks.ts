/**
 * Shared utility for building character image blocks in Slack messages.
 *
 * Single source of truth for character image URLs and Slack Block Kit
 * image blocks. All character images in Slack messages should go through here.
 *
 * Images are served from the pool (random selection) via the PNG route.
 * The daily seed query param busts Slack's image cache so users see
 * a fresh pool pick each day.
 */

import type {
  CharacterAction,
  CharacterEmotion,
} from '~/services/ai/character-generation'

export const CHARACTER_IMAGE_BASE_URL = 'https://grr.techtalkjp.workers.dev'

// ============================================
// URL Builders
// ============================================

/**
 * Build a character image URL with a daily seed for Slack cache busting.
 */
export function getCharacterImageUrl(userId: string, seed?: string): string {
  const base = `${CHARACTER_IMAGE_BASE_URL}/character/${userId}.png`
  if (!seed) return base
  return `${base}?d=${seed}`
}

export function getCacheBuster(): string {
  return Date.now().toString()
}

// ============================================
// Slack Block Builders
// ============================================

type ImageBlock = { type: 'image'; image_url: string; alt_text: string }

/**
 * Build a Slack image block for the character.
 * Uses a daily seed so the image refreshes once per day from the pool.
 */
export function buildCharacterImageBlock(
  userId: string,
  altText = 'キャラクターの画像',
): ImageBlock {
  return {
    type: 'image',
    image_url: getCharacterImageUrl(userId, getCacheBuster()),
    alt_text: altText,
  }
}

/**
 * Build a Slack image block with a cache buster for fresh images.
 * Used for interactive moments (pet, talk) where each tap should feel unique.
 */
export function buildInteractiveCharacterImageBlock(
  userId: string,
  altText: string,
): ImageBlock {
  return {
    type: 'image',
    image_url: getCharacterImageUrl(userId, getCacheBuster()),
    alt_text: altText,
  }
}

// ============================================
// Context-based styles (used by workflow for image generation)
// ============================================

/**
 * Message context to emotion/action mapping.
 * Used when generating new images in the workflow to give
 * the character an appropriate expression for the situation.
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
 * Uses daily seed for cache busting.
 */
export function buildCharacterImageBlockForContext(
  userId: string,
  _messageContext: keyof typeof MESSAGE_CHARACTER_STYLES,
): ImageBlock {
  return buildCharacterImageBlock(userId)
}
