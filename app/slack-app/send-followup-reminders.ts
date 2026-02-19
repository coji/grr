import { SlackAPIClient } from 'slack-edge'
import dayjs from '~/lib/dayjs'
import { generateFollowupMessage } from '~/services/ai'
import {
  expireOldFollowups,
  getFollowupWithEntry,
  getPendingFollowupsForDate,
  markFollowupAsSent,
} from '~/services/pending-followups'
import { DIARY_PERSONA_NAME } from './handlers/diary-constants'

const TOKYO_TZ = 'Asia/Tokyo'

/**
 * Send follow-up reminders for events that occurred
 * This is the "Heartbeat" feature - proactively asking users
 * about events they mentioned in their diary.
 *
 * Runs daily at 14:00 UTC (23:00 JST)
 */
export const sendFollowupReminders = async (env: Env) => {
  console.log('sendFollowupReminders started')
  const client = new SlackAPIClient(env.SLACK_BOT_TOKEN)

  const tokyoNow = dayjs().tz(TOKYO_TZ)
  const todayDate = tokyoNow.format('YYYY-MM-DD')

  // First, expire old pending follow-ups that were never sent
  try {
    const expiredCount = await expireOldFollowups(7)
    if (expiredCount > 0) {
      console.log(`Expired ${expiredCount} old pending follow-ups`)
    }
  } catch (error) {
    console.error('Failed to expire old follow-ups:', error)
  }

  // Get pending follow-ups scheduled for today
  const followups = await getPendingFollowupsForDate(todayDate)
  console.log(`Found ${followups.length} follow-ups scheduled for ${todayDate}`)

  if (followups.length === 0) {
    console.log('sendFollowupReminders completed (no follow-ups)')
    return
  }

  let sentCount = 0
  let errorCount = 0

  for (const followup of followups) {
    try {
      // Get the original entry details for context
      const followupWithEntry = await getFollowupWithEntry(followup.id)
      const originalEntry = followupWithEntry?.entryDetail ?? null

      // Generate a warm, personalized follow-up message
      const followupText = await generateFollowupMessage({
        personaName: DIARY_PERSONA_NAME,
        userId: followup.userId,
        eventDescription: followup.eventDescription,
        originalEntryText: originalEntry,
      })

      // Send the follow-up message
      const result = await client.chat.postMessage({
        channel: followup.channelId,
        text: `<@${followup.userId}> ${followupText}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `<@${followup.userId}> ${followupText}`,
            },
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `💭 _${dayjs(followup.eventDate).format('M/D')}の日記から_`,
              },
            ],
          },
        ],
      })

      if (result.ok && result.ts) {
        await markFollowupAsSent(followup.id, result.ts)
        sentCount++
        console.log(
          `Sent follow-up to user ${followup.userId}: "${followup.eventDescription}"`,
        )
      } else {
        console.warn(
          `Failed to send follow-up message: ${result.error}`,
          followup.id,
        )
        errorCount++
      }
    } catch (error) {
      console.error(
        `Failed to process follow-up for user ${followup.userId}:`,
        error,
      )
      errorCount++
    }
  }

  console.log(
    `sendFollowupReminders completed: ${sentCount} sent, ${errorCount} errors`,
  )
}
