/**
 * Character image service for R2 storage.
 *
 * Images are generated via Gemini's native image generation and stored in R2.
 * The PNG route serves images from R2 for fast response times.
 */

import { env } from 'cloudflare:workers'
import type {
  CharacterAction,
  CharacterEmotion,
} from '~/services/ai/character-generation'

// ============================================
// R2 Key Builders
// ============================================

/**
 * Build an R2 key for a character image.
 * Static images: `character/{userId}/static.png`
 * Dynamic images: `character/{userId}/{emotion}-{action}-{date}.png`
 */
export function buildR2Key(
  userId: string,
  options?: {
    emotion: CharacterEmotion
    action: CharacterAction
    date: string
  },
): string {
  if (!options) return `character/${userId}/static.png`
  return `character/${userId}/${options.emotion}-${options.action}-${options.date}.png`
}

// ============================================
// R2 Operations
// ============================================

/**
 * Get a character image from R2.
 * Returns the PNG data or null if not found.
 */
export async function getCharacterImageFromR2(
  r2Key: string,
): Promise<ArrayBuffer | null> {
  const object = await env.CHARACTER_IMAGES.get(r2Key)
  if (!object) return null
  return await object.arrayBuffer()
}

/**
 * Upload a character image to R2.
 */
export async function putCharacterImageToR2(
  r2Key: string,
  pngData: ArrayBuffer,
): Promise<void> {
  await env.CHARACTER_IMAGES.put(r2Key, pngData, {
    httpMetadata: { contentType: 'image/png' },
  })
}
