/**
 * Service for managing user characters (Tamagotchi-style companions)
 *
 * This handles CRUD operations for user characters generated from diary entries.
 * Characters are completely unique to each user - no fixed types!
 */

import { nanoid } from 'nanoid'
import dayjs from '~/lib/dayjs'
import type { CharacterConcept } from './ai/character-generation'
import type { Database } from './db'
import { db } from './db'

export type UserCharacter = Database['userCharacters']
export type CharacterInteraction = Database['characterInteractions']

export type InteractionType = CharacterInteraction['interactionType']

// Points earned for different interactions
export const INTERACTION_POINTS = {
  diary_entry: 10,
  mood_recorded: 5,
  pet: 3,
  talk: 5,
} as const

// Points required for each evolution stage
export const EVOLUTION_THRESHOLDS = [0, 30, 100, 250, 500] as const

// Daily decay when no diary is written
export const DAILY_DECAY = {
  happiness: -5,
  energy: -3,
} as const

// ============================================
// Character CRUD Operations
// ============================================

/**
 * Get a user's character
 */
export async function getCharacter(
  userId: string,
): Promise<UserCharacter | null> {
  const character = await db
    .selectFrom('userCharacters')
    .selectAll()
    .where('userId', '=', userId)
    .executeTakeFirst()

  return character ?? null
}

/**
 * Create a new character for a user from AI-generated concept
 */
export async function createCharacter(input: {
  userId: string
  concept: CharacterConcept
  characterSvg?: string | null
}): Promise<UserCharacter> {
  const now = dayjs().utc().toISOString()

  const character: UserCharacter = {
    userId: input.userId,
    characterName: input.concept.name,
    characterSpecies: input.concept.species,
    characterEmoji: input.concept.emoji,
    characterAppearance: input.concept.appearance,
    characterPersonality: input.concept.personality,
    characterCatchphrase: input.concept.catchphrase,
    characterSvg: input.characterSvg ?? null,
    evolutionStage: 1,
    evolutionPoints: 0,
    happiness: 50,
    energy: 50,
    bondLevel: 0,
    lastInteractedAt: now,
    daysWithoutDiary: 0,
    createdAt: now,
    updatedAt: now,
  }

  await db.insertInto('userCharacters').values(character).execute()

  return character
}

/**
 * Update a character's state
 */
export async function updateCharacter(
  userId: string,
  updates: Partial<
    Pick<
      UserCharacter,
      | 'characterSvg'
      | 'evolutionStage'
      | 'evolutionPoints'
      | 'happiness'
      | 'energy'
      | 'bondLevel'
      | 'lastInteractedAt'
      | 'daysWithoutDiary'
    >
  >,
): Promise<void> {
  const now = dayjs().utc().toISOString()

  await db
    .updateTable('userCharacters')
    .set({
      ...updates,
      updatedAt: now,
    })
    .where('userId', '=', userId)
    .execute()
}

// ============================================
// Character Interaction Operations
// ============================================

/**
 * Record an interaction with a character
 */
export async function recordInteraction(input: {
  userId: string
  interactionType: InteractionType
  metadata?: Record<string, unknown>
}): Promise<{ pointsEarned: number; evolved: boolean }> {
  const now = dayjs().utc().toISOString()
  const pointsEarned = INTERACTION_POINTS[input.interactionType]

  // Record the interaction
  await db
    .insertInto('characterInteractions')
    .values({
      id: nanoid(),
      userId: input.userId,
      interactionType: input.interactionType,
      pointsEarned,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      createdAt: now,
    })
    .execute()

  // Update character state
  const character = await getCharacter(input.userId)
  if (!character) {
    return { pointsEarned, evolved: false }
  }

  const newPoints = character.evolutionPoints + pointsEarned
  const newHappiness = Math.min(100, character.happiness + 5)
  const newEnergy = Math.min(100, character.energy + 3)
  const newBond = Math.min(100, character.bondLevel + 1)

  // Check for evolution
  const evolved = checkAndApplyEvolution(character, newPoints)

  await updateCharacter(input.userId, {
    evolutionPoints: newPoints,
    happiness: newHappiness,
    energy: newEnergy,
    bondLevel: newBond,
    lastInteractedAt: now,
    daysWithoutDiary: 0,
  })

  return { pointsEarned, evolved }
}

/**
 * Check if character should evolve and apply evolution
 */
function checkAndApplyEvolution(
  character: UserCharacter,
  newPoints: number,
): boolean {
  const currentStage = character.evolutionStage
  if (currentStage >= 5) return false

  const threshold = EVOLUTION_THRESHOLDS[currentStage]
  if (newPoints >= threshold) {
    // Will evolve - update in separate call with new SVG
    return true
  }

  return false
}

/**
 * Apply evolution to a character (updates stage and triggers SVG regeneration)
 */
export async function evolveCharacter(
  userId: string,
  newSvg?: string,
): Promise<{ newStage: number } | null> {
  const character = await getCharacter(userId)
  if (!character || character.evolutionStage >= 5) {
    return null
  }

  const newStage = character.evolutionStage + 1

  await updateCharacter(userId, {
    evolutionStage: newStage,
    characterSvg: newSvg ?? character.characterSvg,
  })

  return { newStage }
}

/**
 * Apply daily decay to a character (called by scheduled job)
 */
export async function applyDailyDecay(userId: string): Promise<void> {
  const character = await getCharacter(userId)
  if (!character) return

  const newHappiness = Math.max(0, character.happiness + DAILY_DECAY.happiness)
  const newEnergy = Math.max(0, character.energy + DAILY_DECAY.energy)
  const newDaysWithout = character.daysWithoutDiary + 1

  await updateCharacter(userId, {
    happiness: newHappiness,
    energy: newEnergy,
    daysWithoutDiary: newDaysWithout,
  })
}

// ============================================
// Helper Functions
// ============================================

/**
 * Generate a progress bar string
 */
export function getProgressBar(value: number): string {
  const filled = Math.floor(value / 10)
  const empty = 10 - filled
  return '█'.repeat(filled) + '░'.repeat(empty)
}

/**
 * Calculate bond level display (1-10 from 0-100)
 */
export function getBondLevelDisplay(bondLevel: number): number {
  return Math.floor(bondLevel / 10) + 1
}

/**
 * Convert UserCharacter to CharacterConcept for AI functions
 */
export function characterToConcept(character: UserCharacter): CharacterConcept {
  return {
    name: character.characterName,
    species: character.characterSpecies,
    emoji: character.characterEmoji,
    appearance: character.characterAppearance ?? '',
    personality: character.characterPersonality ?? '',
    catchphrase: character.characterCatchphrase ?? '',
  }
}
