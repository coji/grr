/**
 * PNG route for decorated room images
 *
 * Serves the AI-generated room image showing the character in their cozy space
 * with decorated items.
 *
 * Flow:
 * 1. Try to serve the existing room image from R2
 * 2. If no image exists and user has decorated items, generate one
 * 3. Fallback placeholder if nothing exists or user has no decorations
 */

import {
  generateDecoratedRoomImage,
  type DecoratedItem,
} from '~/services/ai/character-generation'
import { characterToConcept, getCharacter } from '~/services/character'
import { getDecoratedItems } from '~/services/character-items'
import { getRoomImage, putRoomImage } from '~/services/room-image'
import type { Route } from './+types/room.$userId[.png]'

// 1x1 transparent PNG as final fallback
const FALLBACK_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0xe5, 0x27,
  0xde, 0xfc, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60,
  0x82,
]).buffer

// Cache-Control headers - short cache since room can change when decorations update
const CACHE_HEADERS = {
  'Content-Type': 'image/png',
  'Cache-Control': 'private, max-age=300, must-revalidate',
  Vary: 'Accept',
}

const NO_CACHE_HEADERS = {
  'Content-Type': 'image/png',
  'Cache-Control': 'private, no-store, must-revalidate',
  Vary: 'Accept',
}

export const loader = async ({ params }: Route.LoaderArgs) => {
  const userId = params.userId

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

  // Get decorated items
  const decoratedItems = await getDecoratedItems(userId)

  // If no decorated items, return fallback
  if (decoratedItems.length === 0) {
    return new Response(FALLBACK_PNG, {
      status: 404,
      headers: NO_CACHE_HEADERS,
    })
  }

  // 1. Try to serve existing room image
  const existingImage = await getRoomImage(userId)
  if (existingImage) {
    return new Response(existingImage, {
      headers: CACHE_HEADERS,
    })
  }

  // 2. Generate new room image
  try {
    const concept = characterToConcept(character)
    const items: DecoratedItem[] = decoratedItems.map((item) => ({
      itemName: item.itemName,
      itemEmoji: item.itemEmoji,
      itemCategory: item.itemCategory,
    }))

    const pngData = await generateDecoratedRoomImage({
      userId,
      concept,
      evolutionStage: character.evolutionStage,
      decoratedItems: items,
    })

    // Store for future requests
    await putRoomImage(userId, pngData)

    return new Response(pngData, {
      headers: CACHE_HEADERS,
    })
  } catch (error) {
    console.error('Failed to generate room image:', error)
    return new Response(FALLBACK_PNG, {
      status: 500,
      headers: NO_CACHE_HEADERS,
    })
  }
}
