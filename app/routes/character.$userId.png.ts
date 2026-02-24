/**
 * PNG route for character images
 *
 * Converts SVG character images to PNG format for Slack compatibility.
 * Slack Block Kit's image blocks don't support SVG, so this route
 * provides PNG versions using resvg-wasm for conversion.
 *
 * Note: Dynamic SVG generation via AI is disabled because Slack's image
 * download timeout (~3-5 seconds) is too short for AI generation.
 * All requests return the stored static character SVG converted to PNG.
 *
 * Query parameters (emotion, action, d) are accepted but currently ignored.
 * A future improvement could pre-generate and cache emotion variants.
 */

import { Resvg, initWasm } from '@resvg/resvg-wasm'
import { generateCharacterSvg } from '~/services/ai/character-generation'
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

// PNG output size (Slack recommends images between 500-1500px)
const PNG_WIDTH = 400

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

export const loader = async ({ params }: Route.LoaderArgs) => {
  const userId = params.userId

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

  // Use stored SVG if available (fast path)
  // Note: We skip dynamic AI generation because Slack's image download
  // timeout (~3-5 seconds) is too short for AI to generate SVGs on-the-fly.
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

  // Generate SVG on-the-fly only if none exists in DB
  // This should be rare - only happens for newly created characters
  // before their SVG has been saved
  try {
    const concept = characterToConcept(character)
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
