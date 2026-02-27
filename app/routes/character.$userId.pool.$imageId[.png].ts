/**
 * PNG route for specific pool images
 *
 * Serves a specific character image from the R2 pool by its image ID.
 * This ensures the exact image that was generated is displayed,
 * rather than randomly selecting from the pool.
 *
 * URL format: /character/{userId}/pool/{imageId}.png
 * Example: /character/U123ABC/pool/2026-02-27-abc12345.png
 */

import { getPoolImageById } from '~/services/character-image'
import type { Route } from './+types/character.$userId.pool.$imageId[.png]'

// 1x1 transparent PNG as fallback
const FALLBACK_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0xe5, 0x27,
  0xde, 0xfc, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60,
  0x82,
]).buffer

// Cache headers - allow caching since image ID is unique and immutable
const CACHE_HEADERS = {
  'Content-Type': 'image/png',
  'Cache-Control': 'public, max-age=31536000, immutable',
}

const NO_CACHE_HEADERS = {
  'Content-Type': 'image/png',
  'Cache-Control': 'private, no-store',
}

export const loader = async ({ params }: Route.LoaderArgs) => {
  const { userId, imageId } = params

  if (!userId || !imageId) {
    return new Response(FALLBACK_PNG, {
      status: 404,
      headers: NO_CACHE_HEADERS,
    })
  }

  const image = await getPoolImageById(userId, imageId)

  if (!image) {
    console.warn(`Pool image not found: userId=${userId}, imageId=${imageId}`)
    return new Response(FALLBACK_PNG, {
      status: 404,
      headers: NO_CACHE_HEADERS,
    })
  }

  return new Response(image, {
    headers: CACHE_HEADERS,
  })
}
