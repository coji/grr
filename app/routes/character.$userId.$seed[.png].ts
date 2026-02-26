/**
 * PNG route for character images with seed-based cache busting
 *
 * Serves character images from the R2 image pool with a seed in the path
 * to ensure proper cache busting with Slack and CDN caching layers.
 *
 * URL format: /character/{userId}/{seed}.png
 *
 * Flow:
 * 1. Try to serve a random image from the current stage's pool
 * 2. If pool is empty but under daily cap, generate a new one and add to pool
 * 3. If over daily cap, serve the base image
 * 4. Fallback placeholder if nothing exists
 */

import { generateCharacterImage } from '~/services/ai/character-generation'
import { characterToConcept, getCharacter } from '~/services/character'
import {
  addToPool,
  countTodayGenerations,
  DAILY_GENERATION_CAP,
  getBaseImage,
  getRandomPoolImage,
  putBaseImage,
} from '~/services/character-image'
import type { Route } from './+types/character.$userId.$seed[.png]'

// 1x1 transparent PNG as final fallback
const FALLBACK_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0xe5, 0x27,
  0xde, 0xfc, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60,
  0x82,
]).buffer

// Cache-Control headers to prevent aggressive caching
// Using private to prevent CDN caching, no-store to prevent browser caching
const NO_CACHE_HEADERS = {
  'Content-Type': 'image/png',
  'Cache-Control': 'private, no-store, must-revalidate',
  Vary: 'Accept',
}

export const loader = async ({ params }: Route.LoaderArgs) => {
  const userId = params.userId
  // seed is captured but not used directly - its presence in the URL path
  // ensures each request gets a unique URL for cache busting

  if (!userId) {
    return new Response(FALLBACK_PNG, {
      status: 404,
      headers: NO_CACHE_HEADERS,
    })
  }

  const character = await getCharacter(userId)
  if (!character) {
    return new Response(FALLBACK_PNG, {
      status: 404,
      headers: NO_CACHE_HEADERS,
    })
  }

  const { evolutionStage } = character

  // 1. Try pool (random selection from current stage)
  const poolImage = await getRandomPoolImage(userId, evolutionStage)
  if (poolImage) {
    return new Response(poolImage, {
      headers: NO_CACHE_HEADERS,
    })
  }

  // 2. Pool is empty — check if we can generate
  const todayCount = await countTodayGenerations(userId)
  if (todayCount < DAILY_GENERATION_CAP) {
    try {
      const concept = characterToConcept(character)
      const baseImage = (await getBaseImage(userId)) ?? undefined

      const pngData = await generateCharacterImage({
        userId,
        concept,
        evolutionStage,
        baseImage,
      })

      // Store as base if none exists, also add to pool
      if (!baseImage) {
        await putBaseImage(userId, pngData)
      }
      await addToPool(userId, evolutionStage, pngData)

      return new Response(pngData, {
        headers: NO_CACHE_HEADERS,
      })
    } catch (error) {
      console.error('Failed to generate character image:', error)
    }
  }

  // 3. Over daily cap or generation failed — serve base image
  const baseImage = await getBaseImage(userId)
  if (baseImage) {
    return new Response(baseImage, {
      headers: NO_CACHE_HEADERS,
    })
  }

  // 4. Final fallback
  return new Response(FALLBACK_PNG, {
    status: 500,
    headers: NO_CACHE_HEADERS,
  })
}
