import { env } from 'cloudflare:workers'
import { CamelCasePlugin, Kysely } from 'kysely'
import { D1Dialect } from 'kysely-d1'

export interface Database {
  irritations: {
    id: string
    userId: string // SlackユーザーID
    channelId: string | null // SlackチャンネルID
    rawText: string // 元の投稿内容
    score: number // イライラ度の累積
    createdAt: string // 初記録日時 (ISO8601)
    updatedAt: string // 最新記録日時 (ISO8601)
    isPublic: number // 公開可否 (0/1)
  }

  users: {
    userId: string // SlackユーザーID
    userName: string // Slack表示名
    joinedAt: string // 初記録日時 (ISO8601)
    createdAt: string // レコード作成日時 (ISO8601)
    updatedAt: string // 更新日時 (ISO8601)
  }

  diaryEntries: {
    id: string
    userId: string
    channelId: string
    messageTs: string
    entryDate: string
    moodEmoji: string | null
    moodValue: number | null
    moodLabel: string | null
    detail: string | null
    reminderSentAt: string
    moodRecordedAt: string | null
    detailRecordedAt: string | null
    createdAt: string
    updatedAt: string
  }

  userDiarySettings: {
    userId: string
    reminderHour: number
    reminderEnabled: number
    skipWeekends: number
    diaryChannelId: string | null
    createdAt: string
    updatedAt: string
  }

  diaryTags: {
    id: string
    entryId: string
    tagName: string
    createdAt: string
  }

  diaryAttachments: {
    id: string
    entryId: string
    fileType: 'image' | 'video' | 'document'
    fileName: string
    mimeType: string | null
    fileSize: number | null
    slackFileId: string
    slackUrlPrivate: string
    slackPermalink: string | null
    slackThumb360: string | null
    slackThumbvideo: string | null
    width: number | null
    height: number | null
    displayOrder: number
    createdAt: string
  }

  aiDailyReflections: {
    id: string
    userId: string
    userName: string | null
    entryDate: string
    reflection: string
    sourceEntryIds: string | null
    createdAt: string
    updatedAt: string
  }

  pendingFollowups: {
    id: string
    entryId: string
    userId: string
    channelId: string
    eventDescription: string
    eventDate: string // YYYY-MM-DD - the date the event occurs
    followUpDate: string // YYYY-MM-DD - when to send the follow-up
    followUpType: 'how_did_it_go' | 'reminder'
    messageTs: string | null // Slack message timestamp of the follow-up
    status: 'pending' | 'sent' | 'answered' | 'expired'
    createdAt: string
    updatedAt: string
  }

  proactiveMessages: {
    id: string
    userId: string
    channelId: string
    messageType:
      | 'anniversary'
      | 'milestone'
      | 'weekly_insight'
      | 'seasonal'
      | 'random_checkin'
      | 'monthly_report'
      | 'question'
      | 'brief_followup'
    messageKey: string | null
    metadata: string | null
    messageTs: string | null
    sentAt: string
    createdAt: string
  }

  userMilestones: {
    userId: string
    totalEntries: number
    currentStreak: number
    longestStreak: number
    lastEntryDate: string | null
    firstEntryDate: string | null
    lastMilestoneCelebrated: string | null // JSON array
    createdAt: string
    updatedAt: string
  }
}

export const createDb = (database: D1Database) =>
  new Kysely<Database>({
    dialect: new D1Dialect({ database }),
    plugins: [new CamelCasePlugin()],
  })

export const db = createDb(env.DB)
