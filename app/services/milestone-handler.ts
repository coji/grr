/**
 * Milestone Handler
 *
 * Tracks user milestones and sends celebration messages when appropriate.
 * This is called after diary entries are created/updated.
 */

import { env } from 'cloudflare:workers'
import { SlackAPIClient } from 'slack-edge'
import { generateMilestoneMessage } from './ai'
import { checkMilestones } from './heartbeat-evaluators'
import {
  getUserMilestones,
  markMilestoneCelebrated,
  recordProactiveMessage,
  updateUserMilestones,
} from './proactive-messages'

/**
 * Update user milestones after a diary entry is created
 * and send celebration message if a milestone is reached.
 *
 * This should be called with waitUntil() to not block the response.
 */
export async function handleDiaryEntryMilestone(
  userId: string,
  channelId: string,
  entryDate: string,
  personaName: string,
): Promise<void> {
  try {
    // Update milestone stats
    const milestones = await updateUserMilestones(userId, entryDate)

    // Get celebrated milestones
    const existingMilestones = await getUserMilestones(userId)
    const celebratedList: string[] = existingMilestones?.lastMilestoneCelebrated
      ? JSON.parse(existingMilestones.lastMilestoneCelebrated)
      : []

    // Check for new milestones
    const newMilestones = checkMilestones(
      {
        totalEntries: milestones.totalEntries,
        currentStreak: milestones.currentStreak,
        longestStreak: milestones.longestStreak,
        firstEntryDate: milestones.firstEntryDate,
      },
      celebratedList,
    )

    if (newMilestones.length === 0) {
      return
    }

    // Send celebration message for the first milestone
    const milestone = newMilestones[0]

    console.log(
      `[MILESTONE] User ${userId} reached ${milestone.type}: ${milestone.value}`,
    )

    // We allow milestone messages even if a recent message was sent,
    // because milestones are special occasions.

    const message = await generateMilestoneMessage({
      personaName,
      milestoneType: milestone.type,
      value: milestone.value,
    })

    const client = new SlackAPIClient(env.SLACK_BOT_TOKEN)

    const result = await client.chat.postMessage({
      channel: channelId,
      text: `<@${userId}> ${message}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `<@${userId}> ${message}`,
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '🎉 _マイルストーン達成！_',
            },
          ],
        },
      ],
    })

    if (result.ok && result.ts) {
      // Mark milestone as celebrated
      await markMilestoneCelebrated(userId, milestone.key)

      // Record the message
      await recordProactiveMessage({
        userId,
        channelId,
        messageType: 'milestone',
        messageKey: milestone.key,
        metadata: {
          milestoneType: milestone.type,
          value: milestone.value,
        },
        messageTs: result.ts,
      })

      console.log(`[MILESTONE] Sent celebration to ${userId}: ${milestone.key}`)
    }
  } catch (error) {
    console.error(
      `[MILESTONE] Failed to handle milestone for ${userId}:`,
      error,
    )
  }
}
