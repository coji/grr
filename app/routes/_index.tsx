import { HStack } from '~/components/ui'
import dayjs from '~/lib/dayjs'
import { db } from '~/services/db'
import type { Route } from './+types/_index'

export const loader = async () => {
  const diaryEntries = await db
    .selectFrom('diaryEntries')
    .selectAll()
    .orderBy('reminderSentAt', 'desc')
    .limit(100)
    .execute()
  return {
    diaryEntries,
  }
}

export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <div className="p-4">
      <h1 className="text-3xl font-bold">ほたる日記ログ</h1>
      <div className="mt-4">
        {loaderData.diaryEntries.map((entry) => (
          <div key={entry.id} className="mb-4 rounded-md border p-4">
            <p className="text-sm text-gray-500">
              {dayjs(entry.entryDate).format('YYYY年M月D日(ddd)')} に灯した記録
            </p>
            <h2 className="text-xl">
              {entry.moodEmoji ? `${entry.moodEmoji} ` : ''}
              {entry.moodLabel ?? '気分未登録'}
            </h2>
            <p className="text-xs text-gray-500">
              {entry.moodRecordedAt
                ? `リアクション: ${dayjs(entry.moodRecordedAt).format('YYYY/MM/DD HH:mm')}`
                : 'まだリアクションはありません'}
            </p>
            {entry.detail ? (
              <p className="mt-2 whitespace-pre-wrap text-base">{entry.detail}</p>
            ) : (
              <p className="mt-2 text-sm text-gray-500">まだ日記の本文はありません。</p>
            )}
            {entry.detailRecordedAt ? (
              <p className="mt-1 text-xs text-gray-500">
                日記更新: {dayjs(entry.detailRecordedAt).format('YYYY/MM/DD HH:mm')}
              </p>
            ) : null}

            <HStack>
              <p>ユーザ: {entry.userId}</p>
              <div className="flex-1" />
              <p>チャンネル: {entry.channelId}</p>
            </HStack>
          </div>
        ))}
      </div>
    </div>
  )
}
