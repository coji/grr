/**
 * Pure utility functions for character social features.
 * No database or external dependencies — safe to import in unit tests.
 */

// ============================================
// Constants
// ============================================

/** Base probability of an encounter per eligible pair per check (every 3h) */
export const ENCOUNTER_BASE_CHANCE = 0.08

/** Bonus when both users were active in last 24h */
export const ACTIVE_BONUS = 0.06

/** Bonus per shared public channel (capped) */
export const SHARED_CHANNEL_BONUS = 0.02
export const MAX_SHARED_CHANNEL_BONUS = 0.1

/** Bonus for having met before */
export const PREVIOUS_ENCOUNTER_BONUS = 0.04

/** Max encounters per user per day */
export const MAX_DAILY_ENCOUNTERS = 2

/** Max characters in a single group adventure */
export const MAX_ADVENTURE_PARTICIPANTS = 5

// ============================================
// Adventure Themes
// ============================================

export const ADVENTURE_THEMES = [
  { id: 'crystal_cave', name: '光る洞窟探検', emoji: '💎' },
  { id: 'cloud_journey', name: '雲の上の旅', emoji: '☁️' },
  { id: 'forest_picnic', name: '森のピクニック', emoji: '🌲' },
  { id: 'stargazing', name: '星空観察会', emoji: '🌟' },
  { id: 'rainbow_chase', name: '虹を追いかけて', emoji: '🌈' },
  { id: 'treasure_hunt', name: '宝探しゲーム', emoji: '🗺️' },
  { id: 'cooking_party', name: 'みんなでお料理', emoji: '🍳' },
  { id: 'music_festival', name: '音楽会', emoji: '🎵' },
  { id: 'beach_day', name: '海辺のおさんぽ', emoji: '🏖️' },
  { id: 'flower_field', name: 'お花畑でひと休み', emoji: '🌻' },
  { id: 'rainy_day', name: '雨の日のぼうけん', emoji: '🌧️' },
  { id: 'snow_play', name: '雪遊び', emoji: '⛄' },
] as const

export const ADVENTURE_ROLES = [
  'リーダー（先頭を歩いた）',
  '発見者（珍しいものを見つけた）',
  'ムードメーカー（みんなを笑わせた）',
  'サポーター（困っている子を助けた）',
  '記録係（思い出を絵に描いた）',
] as const

// ============================================
// Pure Functions
// ============================================

/**
 * Calculate encounter probability between two characters.
 */
export function calculateEncounterProbability(
  sharedChannelCount: number,
  bothActive: boolean,
  previousEncounterCount: number,
): number {
  let probability = ENCOUNTER_BASE_CHANCE

  if (bothActive) probability += ACTIVE_BONUS

  const channelBonus = Math.min(
    sharedChannelCount * SHARED_CHANNEL_BONUS,
    MAX_SHARED_CHANNEL_BONUS,
  )
  probability += channelBonus

  if (previousEncounterCount > 0) probability += PREVIOUS_ENCOUNTER_BONUS

  return Math.min(probability, 0.5) // Cap at 50%
}
