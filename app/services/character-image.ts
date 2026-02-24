/**
 * Character image service for R2 storage and SVG→PNG conversion.
 *
 * Images are generated dynamically by AI, converted to PNG, and stored in R2.
 * The PNG route serves images from R2 for fast response times.
 * The ai-diary-reply workflow pre-generates images before posting to Slack.
 */

import { Resvg, initWasm } from '@resvg/resvg-wasm'
import { env } from 'cloudflare:workers'
import type {
  CharacterAction,
  CharacterEmotion,
} from '~/services/ai/character-generation'

// WASM file URL from CDN (using specific version for stability)
const RESVG_WASM_URL = 'https://unpkg.com/@resvg/resvg-wasm@2.6.2/index_bg.wasm'

// Track WASM initialization state
let wasmInitialized = false
let wasmInitPromise: Promise<void> | null = null

async function ensureWasmInitialized() {
  if (wasmInitialized) return
  if (wasmInitPromise) return wasmInitPromise

  wasmInitPromise = (async () => {
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

// PNG output size (Slack recommends images between 500-1500px)
const PNG_WIDTH = 400

/**
 * Convert an SVG string to PNG ArrayBuffer.
 * Initializes resvg-wasm on first call.
 */
export async function svgToPng(svgString: string): Promise<ArrayBuffer> {
  await ensureWasmInitialized()

  const resvg = new Resvg(svgString, {
    fitTo: { mode: 'width', value: PNG_WIDTH },
  })
  const rendered = resvg.render()
  const pngData = rendered.asPng()
  return pngData.buffer.slice(
    pngData.byteOffset,
    pngData.byteOffset + pngData.byteLength,
  ) as ArrayBuffer
}

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
