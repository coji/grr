/**
 * PNG route for character images
 *
 * Converts SVG character images to PNG format for Slack compatibility.
 * Slack Block Kit's image blocks don't support SVG, so this route
 * provides PNG versions using resvg-wasm for conversion.
 *
 * Supports the same query parameters as the SVG route:
 *   ?emotion=happy&action=pet&d=2026-02-24
 */

import { Resvg, initWasm } from '@resvg/resvg-wasm'
import {
  generateCharacterSvg,
  generateMessageSvg,
  type CharacterAction,
  type CharacterEmotion,
} from '~/services/ai/character-generation'
import { characterToConcept, getCharacter } from '~/services/character'
import type { Route } from './+types/character.$userId.png'

// WASM file URL from CDN (using specific version for stability)
const RESVG_WASM_URL = 'https://unpkg.com/@resvg/resvg-wasm@2.6.2/index_bg.wasm'

// Track WASM initialization state
let wasmInitialized = false
let wasmInitPromise: Promise<void> | null = null

async function ensureWasmInitialized() {
  if (wasmInitialized) return
  if (wasmInitPromise) return wasmInitPromise

  wasmInitPromise = (async () => {
    // Fetch WASM from CDN at runtime to avoid Vite build issues
    const wasmResponse = await fetch(RESVG_WASM_URL)
    if (!wasmResponse.ok) {
      throw new Error(`Failed to fetch resvg WASM: ${wasmResponse.status}`)
    }
    const wasmBytes = await wasmResponse.arrayBuffer()
    await initWasm(wasmBytes)
    wasmInitialized = true
  })()

  return wasmInitPromise
}

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

// PNG output size (Slack recommends images between 500-1500px)
const PNG_WIDTH = 400
const PNG_HEIGHT = 400

function svgToPng(svgString: string): ArrayBuffer {
  const resvg = new Resvg(svgString, {
    fitTo: {
      mode: 'width',
      value: PNG_WIDTH,
    },
  })
  const rendered = resvg.render()
  const pngData = rendered.asPng()
  // Convert Uint8Array to ArrayBuffer for Response compatibility
  return pngData.buffer.slice(
    pngData.byteOffset,
    pngData.byteOffset + pngData.byteLength,
  ) as ArrayBuffer
}

export const loader = async ({ params, request }: Route.LoaderArgs) => {
  const userId = params.userId
  const url = new URL(request.url)

  // Parse query parameters for dynamic SVG generation
  const emotionParam = url.searchParams.get('emotion')
  const actionParam = url.searchParams.get('action')

  // Initialize WASM
  await ensureWasmInitialized()

  if (!userId) {
    const pngData = svgToPng(FALLBACK_SVG)
    return new Response(pngData, {
      status: 404,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-cache',
      },
    })
  }

  const character = await getCharacter(userId)

  if (!character) {
    const pngData = svgToPng(FALLBACK_SVG)
    return new Response(pngData, {
      status: 404,
      headers: {
        'Content-Type': 'image/png',
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

      const pngData = svgToPng(svg)
      return new Response(pngData, {
        headers: {
          'Content-Type': 'image/png',
          // Short cache for dynamic PNGs - they change with each request
          'Cache-Control': 'public, max-age=60',
        },
      })
    } catch (error) {
      console.error('Failed to generate dynamic character PNG:', error)
      // Fall back to static SVG on error
    }
  }

  // If character has SVG, convert and serve it (static version)
  if (character.characterSvg) {
    try {
      const pngData = svgToPng(character.characterSvg)
      return new Response(pngData, {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
        },
      })
    } catch (error) {
      console.error('Failed to convert character SVG to PNG:', error)
    }
  }

  // Generate SVG on-the-fly if none exists, then convert to PNG
  try {
    const svg = await generateCharacterSvg({
      concept,
      evolutionStage: character.evolutionStage,
    })

    const pngData = svgToPng(svg)
    return new Response(pngData, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=300', // Short cache since it's generated
      },
    })
  } catch (error) {
    console.error('Failed to generate character PNG:', error)
    const pngData = svgToPng(FALLBACK_SVG)
    return new Response(pngData, {
      status: 500,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-cache',
      },
    })
  }
}
