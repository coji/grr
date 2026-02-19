/**
 * HEARTBEAT Evaluators
 *
 * Each evaluator checks if a specific type of proactive message should be sent
 * and generates the message if conditions are met.
 */

import dayjs from '~/lib/dayjs'
import {
  generateAnniversaryMessage,
  generateBriefFollowupMessage,
  generateQuestionMessage,
  generateRandomCheckinMessage,
  generateSeasonalMessage,
  generateWeeklyInsightMessage,
} from './ai'
import {
  getActiveUsers,
  getAnniversaryEntry,
  getBriefEntries,
  getLastMessageOfType,
  getRecentEntries,
  recordProactiveMessage,
  wasMessageSent,
  type ProactiveMessageType,
} from './proactive-messages'
import { getSeasonalEventsForDate } from './seasonal-events'

const TOKYO_TZ = 'Asia/Tokyo'

export interface ProactiveMessageResult {
  userId: string
  channelId: string
  messageType: ProactiveMessageType
  messageKey: string
  text: string
  metadata?: Record<string, unknown>
}

/**
 * Evaluate and generate anniversary messages (1年前リマインド)
 */
export async function evaluateAnniversaryMessages(
  personaName: string,
): Promise<ProactiveMessageResult[]> {
  const results: ProactiveMessageResult[] = []
  const today = dayjs().tz(TOKYO_TZ)
  const oneYearAgo = today.subtract(1, 'year').format('YYYY-MM-DD')
  const messageKey = `anniversary:${oneYearAgo}`

  const users = await getActiveUsers()

  for (const { userId, channelId } of users) {
    // Check if already sent
    if (await wasMessageSent(userId, 'anniversary', messageKey)) {
      continue
    }

    // Check for entry from 1 year ago
    const entry = await getAnniversaryEntry(userId, oneYearAgo)
    if (!entry?.detail) {
      continue
    }

    const text = await generateAnniversaryMessage({
      personaName,
      oneYearAgoEntry: entry.detail,
      oneYearAgoDate: oneYearAgo,
    })

    results.push({
      userId,
      channelId,
      messageType: 'anniversary',
      messageKey,
      text,
      metadata: { entryId: entry.id, entryDate: oneYearAgo },
    })
  }

  return results
}

/**
 * Evaluate and generate seasonal greeting messages (季節の挨拶)
 */
export async function evaluateSeasonalMessages(
  personaName: string,
): Promise<ProactiveMessageResult[]> {
  const results: ProactiveMessageResult[] = []
  const today = dayjs().tz(TOKYO_TZ)
  const month = today.month() + 1
  const day = today.date()
  const todayStr = today.format('YYYY-MM-DD')

  const events = getSeasonalEventsForDate(month, day)
  if (events.length === 0) {
    return results
  }

  const event = events[0]
  const messageKey = `seasonal:${todayStr}:${event.name}`

  const users = await getActiveUsers()

  for (const { userId, channelId } of users) {
    // Check if already sent
    if (await wasMessageSent(userId, 'seasonal', messageKey)) {
      continue
    }

    // Limit to major events (二十四節気の主要なもの + 祝日)
    const majorEvents = [
      '立春',
      '春分',
      '立夏',
      '夏至',
      '立秋',
      '秋分',
      '立冬',
      '冬至',
      '元日',
      '節分',
      '七夕',
      'クリスマス',
      '大晦日',
    ]
    if (!majorEvents.includes(event.name)) {
      continue
    }

    const text = await generateSeasonalMessage({
      personaName,
      seasonalEvent: event.name,
      date: todayStr,
    })

    results.push({
      userId,
      channelId,
      messageType: 'seasonal',
      messageKey,
      text,
      metadata: { event: event.name, date: todayStr },
    })
  }

  return results
}

/**
 * Evaluate and generate weekly insight messages (週イチ気づき)
 */
export async function evaluateWeeklyInsightMessages(
  personaName: string,
): Promise<ProactiveMessageResult[]> {
  const results: ProactiveMessageResult[] = []
  const today = dayjs().tz(TOKYO_TZ)

  // Only on Saturdays (to complement weekly digest)
  if (today.day() !== 6) {
    return results
  }

  const weekNumber = today.week()
  const year = today.year()
  const messageKey = `weekly_insight:${year}-W${weekNumber}`

  const users = await getActiveUsers()

  for (const { userId, channelId } of users) {
    // Check if already sent this week
    if (await wasMessageSent(userId, 'weekly_insight', messageKey)) {
      continue
    }

    // Get this week's entries
    const entries = await getRecentEntries(userId, 7)
    if (entries.length < 3) {
      // Need at least 3 entries to provide meaningful insight
      continue
    }

    const text = await generateWeeklyInsightMessage({
      personaName,
      weekEntries: entries,
    })

    results.push({
      userId,
      channelId,
      messageType: 'weekly_insight',
      messageKey,
      text,
      metadata: { weekNumber, year, entryCount: entries.length },
    })
  }

  return results
}

/**
 * Evaluate and generate random check-in messages (ランダムな一言)
 */
export async function evaluateRandomCheckinMessages(
  personaName: string,
): Promise<ProactiveMessageResult[]> {
  const results: ProactiveMessageResult[] = []
  const today = dayjs().tz(TOKYO_TZ)
  const todayStr = today.format('YYYY-MM-DD')

  // Random probability: ~2% chance per heartbeat (roughly monthly)
  // 3-hour intervals, 4 active periods per day = 12 checks/day
  // 12 * 30 days = 360 checks/month, 2% = ~7 times/month, but we want 1-2
  // So let's use 0.3% for 1-2 per month
  if (Math.random() > 0.003) {
    return results
  }

  const users = await getActiveUsers()

  for (const { userId, channelId } of users) {
    // Check if sent recently (within 14 days)
    const lastMessage = await getLastMessageOfType(userId, 'random_checkin')
    if (lastMessage) {
      const daysSinceLastMessage = today.diff(dayjs(lastMessage.sentAt), 'day')
      if (daysSinceLastMessage < 14) {
        continue
      }
    }

    const messageKey = `random_checkin:${todayStr}`

    // Check if already sent today
    if (await wasMessageSent(userId, 'random_checkin', messageKey)) {
      continue
    }

    const text = await generateRandomCheckinMessage({
      personaName,
    })

    results.push({
      userId,
      channelId,
      messageType: 'random_checkin',
      messageKey,
      text,
    })

    // Only send to one user per heartbeat for random checkins
    break
  }

  return results
}

/**
 * Evaluate and generate question-based intervention messages (問いかけ型介入)
 */
export async function evaluateQuestionMessages(
  personaName: string,
): Promise<ProactiveMessageResult[]> {
  const results: ProactiveMessageResult[] = []
  const today = dayjs().tz(TOKYO_TZ)
  const weekNumber = today.week()
  const year = today.year()

  // Only check once per week (on Wednesdays)
  if (today.day() !== 3) {
    return results
  }

  const users = await getActiveUsers()

  for (const { userId, channelId } of users) {
    const messageKey = `question:${year}-W${weekNumber}`

    // Check if already sent this week
    if (await wasMessageSent(userId, 'question', messageKey)) {
      continue
    }

    // Get recent entries for pattern detection
    const entries = await getRecentEntries(userId, 7)
    if (entries.length < 3) {
      continue
    }

    // Simple pattern detection
    const allText = entries
      .map((e) => e.detail || '')
      .join(' ')
      .toLowerCase()

    let pattern: string | null = null

    // Detect "busy" pattern
    const busyCount = (allText.match(/忙し|バタバタ|慌ただし/g) || []).length
    if (busyCount >= 3) {
      pattern = '「忙しい」という言葉が多い'
    }

    // Detect "tired" pattern
    const tiredCount = (allText.match(/疲れ|つかれ|しんどい|だるい/g) || [])
      .length
    if (tiredCount >= 3) {
      pattern = '疲れがたまっているみたい'
    }

    // Detect low mood pattern
    const lowMoodCount = entries.filter((e) =>
      ['おつかれさま', 'もやもや', 'うーん'].includes(e.moodLabel || ''),
    ).length
    if (lowMoodCount >= 4) {
      pattern = '最近ちょっと大変そう'
    }

    if (!pattern) {
      continue
    }

    const text = await generateQuestionMessage({
      personaName,
      pattern,
      recentEntries: entries,
    })

    results.push({
      userId,
      channelId,
      messageType: 'question',
      messageKey,
      text,
      metadata: { pattern },
    })
  }

  return results
}

/**
 * Evaluate and generate brief entry follow-up messages (続きを聞かせて)
 */
export async function evaluateBriefFollowupMessages(
  personaName: string,
): Promise<ProactiveMessageResult[]> {
  const results: ProactiveMessageResult[] = []
  const today = dayjs().tz(TOKYO_TZ)

  const users = await getActiveUsers()

  for (const { userId, channelId } of users) {
    // Check if sent recently (within 7 days)
    const lastMessage = await getLastMessageOfType(userId, 'brief_followup')
    if (lastMessage) {
      const daysSinceLastMessage = today.diff(dayjs(lastMessage.sentAt), 'day')
      if (daysSinceLastMessage < 7) {
        continue
      }
    }

    // Get brief entries from the last 3 days
    const briefEntries = await getBriefEntries(userId, 3, 30)
    if (briefEntries.length === 0) {
      continue
    }

    // Pick one brief entry
    const entry = briefEntries[0]
    const messageKey = `brief_followup:${entry.id}`

    // Check if already sent for this entry
    if (await wasMessageSent(userId, 'brief_followup', messageKey)) {
      continue
    }

    const text = await generateBriefFollowupMessage({
      personaName,
      briefEntry: entry.detail,
      entryDate: entry.entryDate,
    })

    results.push({
      userId,
      channelId,
      messageType: 'brief_followup',
      messageKey,
      text,
      metadata: { entryId: entry.id, entryDate: entry.entryDate },
    })
  }

  return results
}

/**
 * Check for milestone achievements
 * Returns milestone type and value if a new milestone was reached
 */
export function checkMilestones(
  milestones: {
    totalEntries: number
    currentStreak: number
    longestStreak: number
    firstEntryDate: string | null
  },
  celebratedMilestones: string[],
): Array<{ type: 'total_entries' | 'streak'; value: number; key: string }> {
  const newMilestones: Array<{
    type: 'total_entries' | 'streak'
    value: number
    key: string
  }> = []

  // Total entry milestones
  const entryMilestones = [10, 30, 50, 100, 200, 365, 500, 1000]
  for (const milestone of entryMilestones) {
    const key = `total_entries:${milestone}`
    if (
      milestones.totalEntries >= milestone &&
      !celebratedMilestones.includes(key)
    ) {
      newMilestones.push({ type: 'total_entries', value: milestone, key })
      break // Only celebrate one at a time
    }
  }

  // Streak milestones
  const streakMilestones = [7, 14, 30, 60, 100, 365]
  for (const milestone of streakMilestones) {
    const key = `streak:${milestone}`
    if (
      milestones.currentStreak >= milestone &&
      !celebratedMilestones.includes(key)
    ) {
      newMilestones.push({ type: 'streak', value: milestone, key })
      break // Only celebrate one at a time
    }
  }

  return newMilestones
}

/**
 * Record a proactive message as sent
 */
export async function recordMessageSent(
  result: ProactiveMessageResult,
  messageTs: string,
): Promise<void> {
  await recordProactiveMessage({
    userId: result.userId,
    channelId: result.channelId,
    messageType: result.messageType,
    messageKey: result.messageKey,
    metadata: result.metadata,
    messageTs,
  })
}
