/**
 * Character social interactions service.
 *
 * Manages random encounters between characters and weekly group adventures.
 * PRIVACY: Never accesses diary content. Only uses character metadata and
 * public Slack channel information.
 */

import { nanoid } from 'nanoid'
import dayjs from '~/lib/dayjs'
import {
  type ChannelLocation,
  pickEncounterLocation,
} from './channel-locations'
import {
  ADVENTURE_ROLES,
  ADVENTURE_THEMES,
  MAX_ADVENTURE_PARTICIPANTS,
  MAX_DAILY_ENCOUNTERS,
  calculateEncounterProbability,
} from './character-social-utils'
import { db } from './db'

export {
  ADVENTURE_ROLES,
  ADVENTURE_THEMES,
  calculateEncounterProbability,
} from './character-social-utils'

// ============================================
// Workspace Character Queries
// ============================================

/**
 * Get all characters in a workspace that have social interactions enabled.
 */
export async function getWorkspaceCharacters(workspaceId: string) {
  return db
    .selectFrom('userCharacters')
    .selectAll()
    .where('workspaceId', '=', workspaceId)
    .where('interactionEnabled', '=', 1)
    .execute()
}

/**
 * Get all unique workspace IDs that have characters.
 */
export async function getActiveWorkspaces(): Promise<string[]> {
  const rows = await db
    .selectFrom('userCharacters')
    .select('workspaceId')
    .where('workspaceId', 'is not', null)
    .where('interactionEnabled', '=', 1)
    .groupBy('workspaceId')
    .execute()

  return rows
    .map((r) => r.workspaceId)
    .filter((id): id is string => id !== null)
}

/**
 * Update a character's workspace ID (called during interactions).
 */
export async function ensureWorkspaceId(
  userId: string,
  workspaceId: string,
): Promise<void> {
  await db
    .updateTable('userCharacters')
    .set({ workspaceId })
    .where('userId', '=', userId)
    .where((eb) =>
      eb.or([
        eb('workspaceId', 'is', null),
        eb('workspaceId', '!=', workspaceId),
      ]),
    )
    .execute()
}

/**
 * Toggle interaction enabled/disabled for a user's character.
 */
export async function setInteractionEnabled(
  userId: string,
  enabled: boolean,
): Promise<void> {
  await db
    .updateTable('userCharacters')
    .set({ interactionEnabled: enabled ? 1 : 0 })
    .where('userId', '=', userId)
    .execute()
}

// ============================================
// Encounter Logic
// ============================================

interface EncounterCandidate {
  userIdA: string
  userIdB: string
  probability: number
  sharedChannels: ChannelLocation[]
}

/**
 * Check how many encounters a user has had today.
 */
async function getTodayEncounterCount(userId: string): Promise<number> {
  const todayStart = dayjs().utc().startOf('day').toISOString()

  const resultA = await db
    .selectFrom('characterEncounters')
    .where('characterAUserId', '=', userId)
    .where('createdAt', '>=', todayStart)
    .select(db.fn.countAll().as('count'))
    .executeTakeFirstOrThrow()

  const resultB = await db
    .selectFrom('characterEncounters')
    .where('characterBUserId', '=', userId)
    .where('createdAt', '>=', todayStart)
    .select(db.fn.countAll().as('count'))
    .executeTakeFirstOrThrow()

  return Number(resultA.count) + Number(resultB.count)
}

/**
 * Count previous encounters between two users.
 */
async function getPreviousEncounterCount(
  userIdA: string,
  userIdB: string,
): Promise<number> {
  const result = await db
    .selectFrom('characterEncounters')
    .where((eb) =>
      eb.or([
        eb.and([
          eb('characterAUserId', '=', userIdA),
          eb('characterBUserId', '=', userIdB),
        ]),
        eb.and([
          eb('characterAUserId', '=', userIdB),
          eb('characterBUserId', '=', userIdA),
        ]),
      ]),
    )
    .select(db.fn.countAll().as('count'))
    .executeTakeFirstOrThrow()

  return Number(result.count)
}

/**
 * Store a new encounter in the database.
 */
export async function createEncounter(input: {
  workspaceId: string
  userIdA: string
  userIdB: string
  encounterType: string
  locationChannelId?: string
  locationName?: string
  episodeText: string
}): Promise<string> {
  const id = nanoid()
  const now = dayjs().utc().toISOString()

  await db
    .insertInto('characterEncounters')
    .values({
      id,
      workspaceId: input.workspaceId,
      characterAUserId: input.userIdA,
      characterBUserId: input.userIdB,
      encounterType: input.encounterType,
      locationChannelId: input.locationChannelId ?? null,
      locationName: input.locationName ?? null,
      episodeText: input.episodeText,
      readByA: 0,
      readByB: 0,
      createdAt: now,
    })
    .execute()

  return id
}

/**
 * Get unread encounters for a user, plus recent read ones.
 */
export async function getRecentEncounters(userId: string, limit = 5) {
  return db
    .selectFrom('characterEncounters')
    .selectAll()
    .where((eb) =>
      eb.or([
        eb('characterAUserId', '=', userId),
        eb('characterBUserId', '=', userId),
      ]),
    )
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .execute()
}

/**
 * Mark encounters as read for a specific user.
 */
export async function markEncountersRead(userId: string): Promise<void> {
  const now = dayjs().utc().toISOString()

  await db
    .updateTable('characterEncounters')
    .set({ readByA: 1 })
    .where('characterAUserId', '=', userId)
    .where('readByA', '=', 0)
    .execute()

  await db
    .updateTable('characterEncounters')
    .set({ readByB: 1 })
    .where('characterBUserId', '=', userId)
    .where('readByB', '=', 0)
    .execute()
}

/**
 * Count unread encounters for a user.
 */
export async function countUnreadEncounters(userId: string): Promise<number> {
  const resultA = await db
    .selectFrom('characterEncounters')
    .where('characterAUserId', '=', userId)
    .where('readByA', '=', 0)
    .select(db.fn.countAll().as('count'))
    .executeTakeFirstOrThrow()

  const resultB = await db
    .selectFrom('characterEncounters')
    .where('characterBUserId', '=', userId)
    .where('readByB', '=', 0)
    .select(db.fn.countAll().as('count'))
    .executeTakeFirstOrThrow()

  return Number(resultA.count) + Number(resultB.count)
}

/**
 * Evaluate and generate encounters for a workspace.
 * Called by the heartbeat cron job.
 */
export async function evaluateEncounters(
  workspaceId: string,
  fetchSharedChannels: (
    userIdA: string,
    userIdB: string,
  ) => Promise<ChannelLocation[]>,
  generateEpisode: (context: {
    characterA: {
      name: string
      species: string
      personality: string
      emoji: string
      ownerName?: string
    }
    characterB: {
      name: string
      species: string
      personality: string
      emoji: string
      ownerName?: string
    }
    location?: ChannelLocation
  }) => Promise<string>,
): Promise<string[]> {
  const characters = await getWorkspaceCharacters(workspaceId)
  if (characters.length < 2) return []

  const encounterIds: string[] = []
  const oneDayAgo = dayjs().subtract(1, 'day').utc().toISOString()

  // Generate all unique pairs
  for (let i = 0; i < characters.length; i++) {
    for (let j = i + 1; j < characters.length; j++) {
      const a = characters[i]
      const b = characters[j]

      // Check daily limits
      const countA = await getTodayEncounterCount(a.userId)
      const countB = await getTodayEncounterCount(b.userId)
      if (countA >= MAX_DAILY_ENCOUNTERS || countB >= MAX_DAILY_ENCOUNTERS) {
        continue
      }

      // Calculate probability
      const sharedChannels = await fetchSharedChannels(a.userId, b.userId)
      const bothActive =
        a.lastInteractedAt !== null &&
        a.lastInteractedAt >= oneDayAgo &&
        b.lastInteractedAt !== null &&
        b.lastInteractedAt >= oneDayAgo
      const prevCount = await getPreviousEncounterCount(a.userId, b.userId)

      const probability = calculateEncounterProbability(
        sharedChannels.length,
        bothActive,
        prevCount,
      )

      // Roll for encounter
      if (Math.random() >= probability) continue

      // Generate encounter
      const location = pickEncounterLocation(sharedChannels)

      try {
        const episodeText = await generateEpisode({
          characterA: {
            name: a.characterName,
            species: a.characterSpecies,
            personality: a.characterPersonality ?? '',
            emoji: a.characterEmoji,
          },
          characterB: {
            name: b.characterName,
            species: b.characterSpecies,
            personality: b.characterPersonality ?? '',
            emoji: b.characterEmoji,
          },
          location: location ?? undefined,
        })

        const id = await createEncounter({
          workspaceId,
          userIdA: a.userId,
          userIdB: b.userId,
          encounterType: 'random_meeting',
          locationChannelId: location?.channelId,
          locationName: location?.locationName,
          episodeText,
        })

        encounterIds.push(id)
      } catch (error) {
        console.error(
          `Failed to generate encounter for ${a.userId} and ${b.userId}:`,
          error,
        )
      }
    }
  }

  return encounterIds
}

// ============================================
// Adventure Logic
// ============================================

/**
 * Create a weekly group adventure for a workspace.
 * Called once per week (Monday morning).
 */
export async function createGroupAdventure(
  workspaceId: string,
  generateAdventureEpisode: (context: {
    theme: { id: string; name: string; emoji: string }
    participants: Array<{
      name: string
      species: string
      personality: string
      emoji: string
      role: string
    }>
  }) => Promise<{
    mainEpisode: string
    highlights: Record<string, string>
  }>,
): Promise<string | null> {
  const characters = await getWorkspaceCharacters(workspaceId)
  if (characters.length < 2) return null

  // Check if there's already an adventure this week
  const weekStart = dayjs().utc().startOf('week').toISOString()
  const existing = await db
    .selectFrom('characterAdventures')
    .where('workspaceId', '=', workspaceId)
    .where('createdAt', '>=', weekStart)
    .select('id')
    .executeTakeFirst()

  if (existing) return null

  // Pick random theme
  const theme =
    ADVENTURE_THEMES[Math.floor(Math.random() * ADVENTURE_THEMES.length)]

  // Select participants (up to MAX_ADVENTURE_PARTICIPANTS)
  const shuffled = [...characters].sort(() => Math.random() - 0.5)
  const participants = shuffled.slice(0, MAX_ADVENTURE_PARTICIPANTS)

  // Assign roles based on personality (simple round-robin for now)
  const roles = [...ADVENTURE_ROLES]
  const participantData = participants.map((char, i) => ({
    userId: char.userId,
    name: char.characterName,
    species: char.characterSpecies,
    personality: char.characterPersonality ?? '',
    emoji: char.characterEmoji,
    role: roles[i % roles.length],
  }))

  try {
    const result = await generateAdventureEpisode({
      theme: { id: theme.id, name: theme.name, emoji: theme.emoji },
      participants: participantData,
    })

    const adventureId = nanoid()
    const now = dayjs().utc().toISOString()

    await db
      .insertInto('characterAdventures')
      .values({
        id: adventureId,
        workspaceId,
        themeId: theme.id,
        themeName: theme.name,
        themeEmoji: theme.emoji,
        mainEpisode: result.mainEpisode,
        participantCount: participants.length,
        createdAt: now,
      })
      .execute()

    // Insert participants
    for (const p of participantData) {
      await db
        .insertInto('characterAdventureParticipants')
        .values({
          id: nanoid(),
          adventureId,
          characterUserId: p.userId,
          roleText: p.role,
          highlightText:
            result.highlights[p.userId] ?? `${p.name}も一緒に楽しんだよ！`,
          isRead: 0,
        })
        .execute()
    }

    return adventureId
  } catch (error) {
    console.error(
      `Failed to create adventure for workspace ${workspaceId}:`,
      error,
    )
    return null
  }
}

/**
 * Get the latest adventure for a user.
 */
export async function getLatestAdventure(userId: string) {
  const participation = await db
    .selectFrom('characterAdventureParticipants as cap')
    .innerJoin('characterAdventures as ca', 'ca.id', 'cap.adventureId')
    .selectAll('cap')
    .where('cap.characterUserId', '=', userId)
    .orderBy('ca.createdAt', 'desc')
    .limit(1)
    .executeTakeFirst()

  if (!participation) return null

  const adventure = await db
    .selectFrom('characterAdventures')
    .selectAll()
    .where('id', '=', participation.adventureId)
    .executeTakeFirst()

  if (!adventure) return null

  const allParticipants = await db
    .selectFrom('characterAdventureParticipants')
    .selectAll()
    .where('adventureId', '=', adventure.id)
    .execute()

  return { adventure, participation, allParticipants }
}

/**
 * Mark adventure as read for a user.
 */
export async function markAdventureRead(
  adventureId: string,
  userId: string,
): Promise<void> {
  await db
    .updateTable('characterAdventureParticipants')
    .set({ isRead: 1 })
    .where('adventureId', '=', adventureId)
    .where('characterUserId', '=', userId)
    .execute()
}
