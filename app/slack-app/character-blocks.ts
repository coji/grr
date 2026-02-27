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
 * Build a character image URL with a seed for Slack cache busting.
 *
 * Uses path segment format (/character/{userId}/{seed}.png) instead of
 * query params to ensure cache busting works with Slack and Cloudflare CDN,
 * which may ignore query strings when caching images.
 */
export function getCharacterImageUrl(userId: string, seed?: string): string {
  if (!seed) {
    return `${CHARACTER_IMAGE_BASE_URL}/character/${userId}.png`
  }
  return `${CHARACTER_IMAGE_BASE_URL}/character/${userId}/${seed}.png`
}

/**
 * Build a URL for a specific pool image.
 * This ensures the exact generated image is displayed.
 *
 * @param userId - The user's Slack ID
 * @param imageId - The image ID (e.g., "2026-02-27-abc12345")
 */
export function getPoolImageUrl(userId: string, imageId: string): string {
  return `${CHARACTER_IMAGE_BASE_URL}/character/${userId}/pool/${imageId}.png`
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
 * Build a Slack image block with a specific seed.
 * Use this when you need consistent images across multiple modal updates.
 *
 * @deprecated Use buildCharacterImageBlockWithPoolId instead for consistent images.
 */
export function buildCharacterImageBlockWithSeed(
  userId: string,
  seed: string,
  altText = 'キャラクターの画像',
): ImageBlock {
  return {
    type: 'image',
    image_url: getCharacterImageUrl(userId, seed),
    alt_text: altText,
  }
}

/**
 * Build a Slack image block for a specific pool image.
 * Use this to ensure the exact same image is shown consistently.
 */
export function buildCharacterImageBlockWithPoolId(
  userId: string,
  imageId: string,
  altText = 'キャラクターの画像',
): ImageBlock {
  return {
    type: 'image',
    image_url: getPoolImageUrl(userId, imageId),
    alt_text: altText,
  }
}

/**
 * Build a character image block using a specific pool image if available.
 * Falls back to random pool selection if no imageId is provided.
 *
 * This is a convenience wrapper that handles the common pattern of:
 * - Using a specific pool image when available (for consistent tap-to-enlarge)
 * - Falling back to random selection when pool is empty
 */
export function buildCharacterImageBlockFromPoolId(
  userId: string,
  imageId: string | null,
  altText = 'キャラクターの画像',
): ImageBlock {
  return imageId
    ? buildCharacterImageBlockWithPoolId(userId, imageId, altText)
    : buildCharacterImageBlock(userId, altText)
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
 *
 * @deprecated Use pickRandomPoolKey + buildCharacterImageBlockWithPoolId instead
 * for consistent images when users tap to enlarge.
 */
export function buildCharacterImageBlockForContext(
  userId: string,
  _messageContext: keyof typeof MESSAGE_CHARACTER_STYLES,
): ImageBlock {
  return buildCharacterImageBlock(userId)
}
