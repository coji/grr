/**
 * Monthly Report - 月次レポート
 *
 * 毎月最初の週末に、前月のまとめを送信
 */

import { SlackAPIClient } from 'slack-edge'
import dayjs from '~/lib/dayjs'
import { db } from '~/services/db'
import {
  getLastMessageOfType,
  recordProactiveMessage,
} from '~/services/proactive-messages'
import { DIARY_PERSONA_NAME } from './handlers/diary-constants'
import { generateMonthlyReport } from './monthly-report-generator'

const TOKYO_TZ = 'Asia/Tokyo'

/**
 * 月次レポートを送信する
 * 毎月1-7日の土曜日に実行
 */
export const sendMonthlyReport = async (env: Env) => {
  const tokyoNow = dayjs().tz(TOKYO_TZ)
  const dayOfMonth = tokyoNow.date()
  const dayOfWeek = tokyoNow.day()

  // 月初1-7日の土曜日のみ
  if (dayOfMonth > 7 || dayOfWeek !== 6) {
    console.log('[MONTHLY_REPORT] Not the right day. Skipping.')
    return
  }

  console.log('[MONTHLY_REPORT] Starting monthly report generation')

  const client = new SlackAPIClient(env.SLACK_BOT_TOKEN)

  // 前月の範囲を計算
  const lastMonth = tokyoNow.subtract(1, 'month')
  const monthStart = lastMonth.startOf('month').format('YYYY-MM-DD')
  const monthEnd = lastMonth.endOf('month').format('YYYY-MM-DD')
  const monthLabel = lastMonth.format('YYYY年M月')
  const messageKey = `monthly_report:${lastMonth.format('YYYY-MM')}`

  // 前月にエントリがあるユーザーを取得
  const usersWithEntries = await db
    .selectFrom('diaryEntries')
    .select('userId')
    .distinct()
    .where('entryDate', '>=', monthStart)
    .where('entryDate', '<=', monthEnd)
    .execute()

  for (const { userId } of usersWithEntries) {
    try {
      // 既に送信済みかチェック
      const lastReport = await getLastMessageOfType(userId, 'monthly_report')
      if (lastReport) {
        const metadata = lastReport.metadata
          ? JSON.parse(lastReport.metadata)
          : {}
        if (metadata.monthKey === messageKey) {
          console.log(
            `[MONTHLY_REPORT] Already sent to ${userId} for ${monthLabel}`,
          )
          continue
        }
      }

      // 前月のエントリを取得
      const entries = await db
        .selectFrom('diaryEntries')
        .selectAll()
        .where('userId', '=', userId)
        .where('entryDate', '>=', monthStart)
        .where('entryDate', '<=', monthEnd)
        .orderBy('entryDate', 'asc')
        .execute()

      if (entries.length < 5) {
        // 最低5日分のエントリがないとスキップ
        continue
      }

      // ユーザーの日記チャンネルを取得
      const settings = await db
        .selectFrom('userDiarySettings')
        .select('diaryChannelId')
        .where('userId', '=', userId)
        .executeTakeFirst()

      const channelId = settings?.diaryChannelId || entries[0].channelId

      // 統計を計算
      const stats = calculateMonthStats(entries)

      // AIでレポートを生成
      const reportMessage = await generateMonthlyReport({
        personaName: DIARY_PERSONA_NAME,
        userId,
        entries: entries.map((e) => ({
          date: e.entryDate,
          moodLabel: e.moodLabel,
          detail: e.detail,
        })),
        stats,
        monthLabel,
      })

      // レポートを送信
      const result = await client.chat.postMessage({
        channel: channelId,
        text: `<@${userId}> ${reportMessage}`,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: `📊 ${monthLabel}のまとめ`,
              emoji: true,
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: formatStatsBlock(stats, lastMonth.daysInMonth()),
            },
          },
          {
            type: 'divider',
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `<@${userId}> ${reportMessage}`,
            },
          },
        ],
      })

      if (result.ok && result.ts) {
        // 送信を記録
        await recordProactiveMessage({
          userId,
          channelId,
          messageType: 'monthly_report',
          messageKey,
          metadata: {
            monthKey: messageKey,
            monthLabel,
            entryCount: entries.length,
          },
          messageTs: result.ts,
        })

        console.log(`[MONTHLY_REPORT] Sent to ${userId} for ${monthLabel}`)
      }
    } catch (error) {
      console.error(`[MONTHLY_REPORT] Failed for user ${userId}:`, error)
    }
  }

  console.log('[MONTHLY_REPORT] Completed')
}

interface MonthStats {
  totalDays: number
  entryCount: number
  moodCounts: Record<string, number>
  topMood: string | null
  commonWords: string[]
}

function calculateMonthStats(
  entries: Array<{
    moodLabel: string | null
    detail: string | null
  }>,
): MonthStats {
  const moodCounts: Record<string, number> = {}

  for (const entry of entries) {
    if (entry.moodLabel) {
      moodCounts[entry.moodLabel] = (moodCounts[entry.moodLabel] || 0) + 1
    }
  }

  // Find top mood
  let topMood: string | null = null
  let maxCount = 0
  for (const [mood, count] of Object.entries(moodCounts)) {
    if (count > maxCount) {
      maxCount = count
      topMood = mood
    }
  }

  // Extract common words (simple approach)
  const wordCounts: Record<string, number> = {}
  const stopWords = new Set([
    'の',
    'に',
    'を',
    'は',
    'が',
    'と',
    'で',
    'た',
    'て',
    'も',
    'な',
    'い',
    'だ',
    'です',
    'ます',
    'した',
    'から',
    'けど',
    'ある',
    'ない',
    'する',
    'こと',
    'もの',
    'よう',
    'ため',
    'という',
    'として',
    'について',
    'できる',
    'なる',
    'れる',
    'られる',
  ])

  for (const entry of entries) {
    if (!entry.detail) continue

    // Simple word extraction (split by non-Japanese characters and common particles)
    const words = entry.detail
      .split(/[\s、。！？「」『』（）()【】・]/g)
      .filter((w) => w.length >= 2 && w.length <= 10 && !stopWords.has(w))

    for (const word of words) {
      wordCounts[word] = (wordCounts[word] || 0) + 1
    }
  }

  // Get top words
  const sortedWords = Object.entries(wordCounts)
    .filter(([_, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word)

  return {
    totalDays: entries.length,
    entryCount: entries.length,
    moodCounts,
    topMood,
    commonWords: sortedWords,
  }
}

function formatStatsBlock(stats: MonthStats, daysInMonth: number): string {
  const lines: string[] = []

  lines.push(`📝 *投稿数*: ${stats.entryCount}日/${daysInMonth}日`)

  if (Object.keys(stats.moodCounts).length > 0) {
    const moodParts = Object.entries(stats.moodCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([mood, count]) => `${mood} ${count}日`)
    lines.push(`😊 *気分*: ${moodParts.join('、')}`)
  }

  if (stats.commonWords.length > 0) {
    lines.push(`💬 *よく出てきた言葉*: ${stats.commonWords.join('、')}`)
  }

  return lines.join('\n')
}
