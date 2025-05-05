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
}

export const db = new Kysely<Database>({
  dialect: new D1Dialect({ database: env.DB }),
  plugins: [new CamelCasePlugin()],
})
