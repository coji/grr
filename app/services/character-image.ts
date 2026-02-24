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
 * Avoids serving the same image consecutively by tracking the last served key.
 * Returns null if no active images exist.
 */
export async function getRandomPoolImage(
  userId: string,
  stage: number,
): Promise<ArrayBuffer | null> {
  const keys = await listActivePoolKeys(userId, stage)
  if (keys.length === 0) return null

  // Avoid repeating the last served image
  const lastKey = await getLastServedKey(userId)
  const candidates = keys.length > 1 ? keys.filter((k) => k !== lastKey) : keys

  const randomKey = candidates[Math.floor(Math.random() * candidates.length)]
  const object = await env.CHARACTER_IMAGES.get(randomKey)
  if (!object) return null

  // Remember this key (fire-and-forget)
  setLastServedKey(userId, randomKey).catch(() => {})

  return await object.arrayBuffer()
}

/**
 * Count how many images were generated today for this user (across all stages).
 * Iterates stage prefixes 1-5 and uses startAfter to only list today's keys.
 */
export async function countTodayGenerations(userId: string): Promise<number> {
  const today = new Date().toISOString().split('T')[0]
  let count = 0

  for (let stage = 1; stage <= 5; stage++) {
    const prefix = buildStagePoolPrefix(userId, stage)
    const startAfter = `${prefix}${today}`
    const listed = await env.CHARACTER_IMAGES.list({ prefix, startAfter })
    count += listed.objects.length
  }

  return count
}

/**
 * List pool keys within the active window for a specific stage.
 * Uses R2 startAfter to skip old keys efficiently.
 */
async function listActivePoolKeys(
  userId: string,
  stage: number,
): Promise<string[]> {
  const prefix = buildStagePoolPrefix(userId, stage)
  const cutoff = getActiveCutoffDate()
  // Keys sort lexicographically: {prefix}{date}-{id}.png
  // startAfter skips everything before the cutoff date
  const startAfter = `${prefix}${cutoff}`
  const listed = await env.CHARACTER_IMAGES.list({ prefix, startAfter })

  return listed.objects.map((obj) => obj.key)
}

// ============================================
// Helpers
// ============================================

function getActiveCutoffDate(): string {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - POOL_ACTIVE_DAYS)
  return cutoff.toISOString().split('T')[0]
}

function buildLastServedKvKey(userId: string): string {
  return `character:${userId}:last-pool-key`
}

async function getLastServedKey(userId: string): Promise<string | null> {
  return await env.KV.get(buildLastServedKvKey(userId))
}

async function setLastServedKey(
  userId: string,
  poolKey: string,
): Promise<void> {
  await env.KV.put(buildLastServedKvKey(userId), poolKey)
}
