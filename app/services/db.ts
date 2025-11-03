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
}

export const createDb = (database: D1Database) =>
  new Kysely<Database>({
    dialect: new D1Dialect({ database }),
    plugins: [new CamelCasePlugin()],
  })

export const db = createDb(env.DB)
