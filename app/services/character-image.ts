/**
 * Character image service for R2 storage with image pool management.
 *
 * Images are generated via Gemini's native image generation and stored in R2.
 * A pool of images accumulates over time and rotates based on TTL.
 *
 * R2 key structure:
 *   character/{userId}/base.png              - Base character image
 *   character/{userId}/pool/{date}-{id}.png  - Pool images with date prefix
 */

import { env } from 'cloudflare:workers'
import { nanoid } from 'nanoid'

/** Max new image generations per user per day */
export const DAILY_GENERATION_CAP = 3

/** Pool images older than this are expired */
export const POOL_TTL_DAYS = 7

// ============================================
// R2 Key Builders
// ============================================

export function buildBaseKey(userId: string): string {
  return `character/${userId}/base.png`
}

export function buildPoolPrefix(userId: string): string {
  return `character/${userId}/pool/`
}

function buildPoolKey(userId: string, date: string): string {
  return `character/${userId}/pool/${date}-${nanoid(8)}.png`
}

function extractDateFromPoolKey(key: string): string | null {
  // key format: character/{userId}/pool/{YYYY-MM-DD}-{id}.png
  const match = key.match(/pool\/(\d{4}-\d{2}-\d{2})-/)
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
 * Add an image to the pool. Returns the R2 key.
 */
export async function addToPool(
  userId: string,
  pngData: ArrayBuffer,
): Promise<string> {
  const today = new Date().toISOString().split('T')[0]
  const key = buildPoolKey(userId, today)
  await env.CHARACTER_IMAGES.put(key, pngData, {
    httpMetadata: { contentType: 'image/png' },
  })
  return key
}

/**
 * Get a random image from the pool (excluding expired ones).
 * Returns null if pool is empty.
 */
export async function getRandomPoolImage(
  userId: string,
): Promise<ArrayBuffer | null> {
  const keys = await listValidPoolKeys(userId)
  if (keys.length === 0) return null

  const randomKey = keys[Math.floor(Math.random() * keys.length)]
  const object = await env.CHARACTER_IMAGES.get(randomKey)
  if (!object) return null
  return await object.arrayBuffer()
}

/**
 * Count how many images were generated today for this user.
 */
export async function countTodayGenerations(userId: string): Promise<number> {
  const today = new Date().toISOString().split('T')[0]
  const prefix = buildPoolPrefix(userId)
  const listed = await env.CHARACTER_IMAGES.list({ prefix })

  return listed.objects.filter((obj) => {
    const date = extractDateFromPoolKey(obj.key)
    return date === today
  }).length
}

/**
 * List all valid (non-expired) pool keys for a user.
 */
async function listValidPoolKeys(userId: string): Promise<string[]> {
  const prefix = buildPoolPrefix(userId)
  const listed = await env.CHARACTER_IMAGES.list({ prefix })
  const cutoff = getCutoffDate()

  return listed.objects
    .filter((obj) => {
      const date = extractDateFromPoolKey(obj.key)
      return date !== null && date >= cutoff
    })
    .map((obj) => obj.key)
}

/**
 * Clear all pool images for a user (used on evolution).
 */
export async function clearPool(userId: string): Promise<number> {
  const prefix = buildPoolPrefix(userId)
  const listed = await env.CHARACTER_IMAGES.list({ prefix })

  if (listed.objects.length === 0) return 0

  await Promise.all(
    listed.objects.map((obj) => env.CHARACTER_IMAGES.delete(obj.key)),
  )

  console.log(
    `[character-image] Cleared ${listed.objects.length} pool images for ${userId}`,
  )
  return listed.objects.length
}

/**
 * Clean up expired pool images for a user.
 * Can be called periodically or on access.
 */
export async function cleanupExpiredImages(userId: string): Promise<number> {
  const prefix = buildPoolPrefix(userId)
  const listed = await env.CHARACTER_IMAGES.list({ prefix })
  const cutoff = getCutoffDate()

  const expired = listed.objects.filter((obj) => {
    const date = extractDateFromPoolKey(obj.key)
    return date !== null && date < cutoff
  })

  if (expired.length === 0) return 0

  await Promise.all(expired.map((obj) => env.CHARACTER_IMAGES.delete(obj.key)))

  console.log(
    `[character-image] Cleaned up ${expired.length} expired pool images for ${userId}`,
  )
  return expired.length
}

// ============================================
// Legacy compatibility
// ============================================

/** @deprecated Use buildBaseKey or pool functions instead */
export function buildR2Key(
  userId: string,
  options?: { emotion: string; action: string; date: string },
): string {
  if (!options) return buildBaseKey(userId)
  return `character/${userId}/${options.emotion}-${options.action}-${options.date}.png`
}

/** @deprecated Use getBaseImage or getRandomPoolImage instead */
export async function getCharacterImageFromR2(
  r2Key: string,
): Promise<ArrayBuffer | null> {
  const object = await env.CHARACTER_IMAGES.get(r2Key)
  if (!object) return null
  return await object.arrayBuffer()
}

/** @deprecated Use putBaseImage or addToPool instead */
export async function putCharacterImageToR2(
  r2Key: string,
  pngData: ArrayBuffer,
): Promise<void> {
  await env.CHARACTER_IMAGES.put(r2Key, pngData, {
    httpMetadata: { contentType: 'image/png' },
  })
}

// ============================================
// Helpers
// ============================================

function getCutoffDate(): string {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - POOL_TTL_DAYS)
  return cutoff.toISOString().split('T')[0]
}
