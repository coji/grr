/**
 * SVG route for character images
 *
 * Serves the character's SVG artwork with proper caching headers.
 * Supports dynamic expression/action variants via query parameters:
 *   ?emotion=happy&action=pet
 *
 * If no SVG exists yet, generates one on-the-fly.
 */

import {
  generateCharacterSvg,
  generateMessageSvg,
  type CharacterAction,
  type CharacterEmotion,
} from '~/services/ai/character-generation'
import { characterToConcept, getCharacter } from '~/services/character'
import type { Route } from './+types/character.$userId[.svg]'

// Default fallback SVG for when character doesn't exist
const FALLBACK_SVG = `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <circle cx="100" cy="100" r="60" fill="#E8E8E8" />
  <text x="100" y="110" text-anchor="middle" font-size="40">🥚</text>
</svg>`

// Valid emotions and actions for validation
const VALID_EMOTIONS: CharacterEmotion[] = [
  'happy',
  'excited',
  'shy',
  'sleepy',
  'love',
]
const VALID_ACTIONS: CharacterAction[] = [
  'pet',
  'talk',
  'wave',
  'dance',
  'sparkle',
]

export const loader = async ({ params, request }: Route.LoaderArgs) => {
  const userId = params.userId
  const url = new URL(request.url)

  // Parse query parameters for dynamic SVG generation
  const emotionParam = url.searchParams.get('emotion')
  const actionParam = url.searchParams.get('action')

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

  const concept = characterToConcept(character)

  // Check if dynamic SVG is requested
  if (emotionParam || actionParam) {
    const emotion =
      emotionParam && VALID_EMOTIONS.includes(emotionParam as CharacterEmotion)
        ? (emotionParam as CharacterEmotion)
        : 'happy'
    const action =
      actionParam && VALID_ACTIONS.includes(actionParam as CharacterAction)
        ? (actionParam as CharacterAction)
        : 'wave'

    try {
      const svg = await generateMessageSvg({
        concept,
        evolutionStage: character.evolutionStage,
        emotion,
        action,
      })

      return new Response(svg, {
        headers: {
          'Content-Type': 'image/svg+xml',
          // Short cache for dynamic SVGs - they change with each request
          'Cache-Control': 'public, max-age=60',
        },
      })
    } catch (error) {
      console.error('Failed to generate dynamic character SVG:', error)
      // Fall back to static SVG on error
    }
  }

  // If character has SVG, serve it (static version)
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
    const svg = await generateCharacterSvg({
      concept,
      evolutionStage: character.evolutionStage,
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
