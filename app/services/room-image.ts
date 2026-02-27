/**
 * Decorated room image service for R2 storage.
 *
 * Stores AI-generated room images showing the character in their cozy space
 * with decorated items. Unlike character images (which have a pool), room images
 * are stored as a single image per user that gets regenerated when decorations change.
 *
 * R2 key structure:
 *   room/{userId}/decorated.png - The decorated room image
 */

import { env } from 'cloudflare:workers'

// ============================================
// R2 Key Builders
// ============================================

function buildRoomImageKey(userId: string): string {
  return `room/${userId}/decorated.png`
}

// ============================================
// Room Image Operations
// ============================================

/**
 * Get the decorated room image for a user.
 * Returns null if no room image exists.
 */
export async function getRoomImage(
  userId: string,
): Promise<ArrayBuffer | null> {
  const object = await env.CHARACTER_IMAGES.get(buildRoomImageKey(userId))
  if (!object) return null
  return await object.arrayBuffer()
}

/**
 * Store a decorated room image for a user.
 * Overwrites any existing room image.
 */
export async function putRoomImage(
  userId: string,
  pngData: ArrayBuffer,
): Promise<void> {
  await env.CHARACTER_IMAGES.put(buildRoomImageKey(userId), pngData, {
    httpMetadata: { contentType: 'image/png' },
  })
}

/**
 * Check if a user has a decorated room image.
 */
export async function hasRoomImage(userId: string): Promise<boolean> {
  const object = await env.CHARACTER_IMAGES.head(buildRoomImageKey(userId))
  return object !== null
}

/**
 * Delete the decorated room image for a user.
 * Called when all decorations are removed.
 */
export async function deleteRoomImage(userId: string): Promise<void> {
  await env.CHARACTER_IMAGES.delete(buildRoomImageKey(userId))
}
