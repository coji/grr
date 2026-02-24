/**
 * SVG route for character images
 *
 * Serves the character's SVG artwork with proper caching headers.
 * If no SVG exists yet, generates one on-the-fly.
 */

import { generateCharacterSvg } from '~/services/ai/character-generation'
import { getCharacter } from '~/services/character'
import type { Route } from './+types/character.$userId.svg'

// Default fallback SVG for when character doesn't exist
const FALLBACK_SVG = `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <circle cx="100" cy="100" r="60" fill="#E8E8E8" />
  <text x="100" y="110" text-anchor="middle" font-size="40">🥚</text>
</svg>`

export const loader = async ({ params }: Route.LoaderArgs) => {
  const userId = params.userId

  if (!userId) {
    return new Response(FALLBACK_SVG, {
      status: 404,
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'no-cache',
      },
    })
  }

  const character = await getCharacter(userId)

  if (!character) {
    return new Response(FALLBACK_SVG, {
      status: 404,
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'no-cache',
      },
    })
  }

  // If character has SVG, serve it
  if (character.characterSvg) {
    return new Response(character.characterSvg, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
      },
    })
  }

  // Generate SVG on-the-fly if none exists
  try {
    const traits = character.characterTraits
      ? JSON.parse(character.characterTraits)
      : undefined

    const svg = await generateCharacterSvg({
      characterType: character.characterType,
      evolutionStage: character.evolutionStage,
      traits,
    })

    // Note: We don't save here to avoid side effects in loader
    // The SVG will be saved when the character is created/evolved

    return new Response(svg, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=300', // Short cache since it's generated
      },
    })
  } catch (error) {
    console.error('Failed to generate character SVG:', error)
    return new Response(FALLBACK_SVG, {
      status: 500,
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'no-cache',
      },
    })
  }
}
