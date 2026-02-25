/**
 * Cron job for character social events.
 *
 * Runs during the heartbeat interval (every 3 hours).
 * Evaluates encounters for all active workspaces and
 * triggers weekly adventures on Mondays.
 */

import { env } from 'cloudflare:workers'
import dayjs from '~/lib/dayjs'
import {
  generateAdventureEpisode,
  generateEncounterEpisode,
} from '~/services/ai/social-episode-generation'
import {
  channelToLocation,
  type ChannelLocation,
} from '~/services/channel-locations'
import {
  createGroupAdventure,
  ensureWorkspaceId,
  evaluateEncounters,
  getActiveWorkspaces,
} from '~/services/character-social'
import { db } from '~/services/db'

const TOKYO_TZ = 'Asia/Tokyo'

/**
 * Main entry point called by the heartbeat cron.
 * Evaluates random encounters and weekly adventures.
 */
export async function processCharacterSocialEvents(): Promise<void> {
  const now = dayjs().tz(TOKYO_TZ)
  const hour = now.hour()

  // Only run during active hours (9:00-21:00 JST)
  if (hour < 9 || hour >= 21) return

  // Backfill workspaceId for characters that don't have one yet
  await backfillWorkspaceIds()

  const workspaces = await getActiveWorkspaces()
  if (workspaces.length === 0) return

  for (const workspaceId of workspaces) {
    try {
      // Random encounters (every heartbeat)
      await processEncounters(workspaceId)

      // Weekly adventures (Monday 9:00-12:00 JST only)
      const isMonday = now.day() === 1
      if (isMonday && hour >= 9 && hour < 12) {
        await processWeeklyAdventure(workspaceId)
      }
    } catch (error) {
      console.error(
        `Error processing social events for workspace ${workspaceId}:`,
        error,
      )
    }
  }
}

/**
 * Process random encounters for a workspace.
 */
async function processEncounters(workspaceId: string): Promise<void> {
  const slackClient = createSlackClient()

  const encounterIds = await evaluateEncounters(
    workspaceId,
    // Fetch shared channels between two users
    async (userIdA: string, userIdB: string) => {
      return fetchSharedPublicChannels(slackClient, userIdA, userIdB)
    },
    // Generate episode text
    async (context) => {
      return generateEncounterEpisode(context)
    },
  )

  if (encounterIds.length > 0) {
    console.log(
      `Generated ${encounterIds.length} encounters for workspace ${workspaceId}`,
    )
  }
}

/**
 * Process weekly group adventure for a workspace.
 */
async function processWeeklyAdventure(workspaceId: string): Promise<void> {
  const adventureId = await createGroupAdventure(
    workspaceId,
    async (context) => {
      return generateAdventureEpisode(context)
    },
  )

  if (adventureId) {
    console.log(
      `Created weekly adventure ${adventureId} for workspace ${workspaceId}`,
    )
  }
}

// ============================================
// Backfill
// ============================================

/**
 * Backfill workspaceId for characters that have it set to NULL.
 * Uses auth.test to get the workspace's team_id and updates all
 * NULL records. Becomes a no-op once all records are filled.
 */
async function backfillWorkspaceIds(): Promise<void> {
  const nullRecords = await db
    .selectFrom('userCharacters')
    .select('userId')
    .where('workspaceId', 'is', null)
    .execute()

  if (nullRecords.length === 0) return

  try {
    const token = env.SLACK_BOT_TOKEN
    const response = await fetch('https://slack.com/api/auth.test', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = (await response.json()) as {
      ok: boolean
      team_id?: string
    }

    if (!data.ok || !data.team_id) {
      console.error('Failed to get team_id from auth.test')
      return
    }

    const teamId = data.team_id

    for (const record of nullRecords) {
      await ensureWorkspaceId(record.userId, teamId)
    }

    console.log(
      `Backfilled workspaceId for ${nullRecords.length} characters with team_id=${teamId}`,
    )
  } catch (error) {
    console.error('Failed to backfill workspace IDs:', error)
  }
}

// ============================================
// Slack API Helpers
// ============================================

interface SlackChannel {
  id: string
  name: string
  topic?: { value: string }
  purpose?: { value: string }
  num_members?: number
}

function createSlackClient() {
  const token = env.SLACK_BOT_TOKEN

  return {
    async getPublicChannels(): Promise<SlackChannel[]> {
      const channels: SlackChannel[] = []
      let cursor: string | undefined

      do {
        const params = new URLSearchParams({
          types: 'public_channel',
          exclude_archived: 'true',
          limit: '200',
        })
        if (cursor) params.set('cursor', cursor)

        const response = await fetch(
          `https://slack.com/api/conversations.list?${params}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        )
        const data = (await response.json()) as {
          ok: boolean
          channels: SlackChannel[]
          response_metadata?: { next_cursor?: string }
        }

        if (!data.ok) break

        channels.push(...data.channels)
        cursor = data.response_metadata?.next_cursor || undefined
      } while (cursor)

      return channels
    },

    async getChannelMembers(channelId: string): Promise<string[]> {
      const members: string[] = []
      let cursor: string | undefined

      do {
        const params = new URLSearchParams({
          channel: channelId,
          limit: '200',
        })
        if (cursor) params.set('cursor', cursor)

        const response = await fetch(
          `https://slack.com/api/conversations.members?${params}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        )
        const data = (await response.json()) as {
          ok: boolean
          members: string[]
          response_metadata?: { next_cursor?: string }
        }

        if (!data.ok) break

        members.push(...data.members)
        cursor = data.response_metadata?.next_cursor || undefined
      } while (cursor)

      return members
    },
  }
}

/**
 * Find public channels that both users are members of.
 * Returns channel locations for encounter context.
 */
async function fetchSharedPublicChannels(
  client: ReturnType<typeof createSlackClient>,
  userIdA: string,
  userIdB: string,
): Promise<ChannelLocation[]> {
  try {
    const channels = await client.getPublicChannels()
    const sharedLocations: ChannelLocation[] = []

    for (const channel of channels) {
      const members = await client.getChannelMembers(channel.id)
      const hasA = members.includes(userIdA)
      const hasB = members.includes(userIdB)

      if (hasA && hasB) {
        sharedLocations.push(
          channelToLocation(
            channel.id,
            channel.name,
            channel.topic?.value || channel.purpose?.value,
          ),
        )
      }
    }

    return sharedLocations
  } catch (error) {
    console.error('Error fetching shared channels:', error)
    return []
  }
}
