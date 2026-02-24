/**
 * Character image service for R2 storage with image pool management.
 *
 * Images are generated via Gemini's native image generation and stored in R2.
 * A pool of images accumulates over time per evolution stage.
 * Images are never deleted — old stages are preserved for future gallery use.
 *
 * R2 key structure:
 *   character/{userId}/base.png                          - Base character image
 *   character/{userId}/pool/stage{N}/{date}-{id}.png     - Pool images per stage
 */

import { env } from 'cloudflare:workers'
import { nanoid } from 'nanoid'

/** Max new image generations per user per day */
export const DAILY_GENERATION_CAP = 3

/** Only images within this window are candidates for random display */
export const POOL_ACTIVE_DAYS = 7

// ============================================
// R2 Key Builders
// ============================================

export function buildBaseKey(userId: string): string {
  return `character/${userId}/base.png`
}

function buildStagePoolPrefix(userId: string, stage: number): string {
  return `character/${userId}/pool/stage${stage}/`
}

function buildPoolKey(userId: string, stage: number, date: string): string {
  return `character/${userId}/pool/stage${stage}/${date}-${nanoid(8)}.png`
}

function extractDateFromPoolKey(key: string): string | null {
  // key format: character/{userId}/pool/stage{N}/{YYYY-MM-DD}-{id}.png
  const match = key.match(/(\d{4}-\d{2}-\d{2})-/)
  return match ? match[1] : null
}

// ============================================
// Base Image Operations
// ============================================

export async function getBaseImage(
  userId: string,
): Promise<ArrayBuffer | null> {
  const object = await env.CHARACTER_IMAGES.get(buildBaseKey(userId))
  if (!object) return null
  return await object.arrayBuffer()
}

export async function putBaseImage(
  userId: string,
  pngData: ArrayBuffer,
): Promise<void> {
  await env.CHARACTER_IMAGES.put(buildBaseKey(userId), pngData, {
    httpMetadata: { contentType: 'image/png' },
  })
}

// ============================================
// Pool Operations
// ============================================

/**
 * Add an image to the pool for a given evolution stage. Returns the R2 key.
 */
export async function addToPool(
  userId: string,
  stage: number,
  pngData: ArrayBuffer,
): Promise<string> {
  const today = new Date().toISOString().split('T')[0]
  const key = buildPoolKey(userId, stage, today)
  await env.CHARACTER_IMAGES.put(key, pngData, {
    httpMetadata: { contentType: 'image/png' },
  })
  return key
}

/**
 * Get a random image from the pool for the given evolution stage.
 * Only considers images within the active window (POOL_ACTIVE_DAYS).
 * Returns null if no active images exist.
 */
export async function getRandomPoolImage(
  userId: string,
  stage: number,
): Promise<ArrayBuffer | null> {
  const keys = await listActivePoolKeys(userId, stage)
  if (keys.length === 0) return null

  const randomKey = keys[Math.floor(Math.random() * keys.length)]
  const object = await env.CHARACTER_IMAGES.get(randomKey)
  if (!object) return null
  return await object.arrayBuffer()
}

/**
 * Count how many images were generated today for this user (across all stages).
 */
export async function countTodayGenerations(userId: string): Promise<number> {
  const today = new Date().toISOString().split('T')[0]
  const prefix = `character/${userId}/pool/`
  const listed = await env.CHARACTER_IMAGES.list({ prefix })

  return listed.objects.filter((obj) => {
    const date = extractDateFromPoolKey(obj.key)
    return date === today
  }).length
}

/**
 * List pool keys within the active window for a specific stage.
 */
async function listActivePoolKeys(
  userId: string,
  stage: number,
): Promise<string[]> {
  const prefix = buildStagePoolPrefix(userId, stage)
  const listed = await env.CHARACTER_IMAGES.list({ prefix })
  const cutoff = getActiveCutoffDate()

  return listed.objects
    .filter((obj) => {
      const date = extractDateFromPoolKey(obj.key)
      return date !== null && date >= cutoff
    })
    .map((obj) => obj.key)
}

// ============================================
// Helpers
// ============================================

function getActiveCutoffDate(): string {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - POOL_ACTIVE_DAYS)
  return cutoff.toISOString().split('T')[0]
}
