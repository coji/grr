import dayjs from '~/lib/dayjs'
import { db } from '~/services/db'
import type { Route } from './+types/_index'

type LoaderData = {
  totalEntries: number
  latestEntryDate: string | null
}

export const loader = async () => {
  const result = await db
    .selectFrom('diaryEntries')
    .select((eb) => [
      eb.fn.countAll<number>().as('totalEntries'),
      eb.fn.max('entryDate').as('latestEntryDate'),
    ])
    .executeTakeFirst()

  const data: LoaderData = {
    totalEntries: Number(result?.totalEntries ?? 0),
    latestEntryDate: result?.latestEntryDate ?? null,
  }

  return data
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const data = loaderData as LoaderData
  return (
    <div className="p-4">
      <h1 className="text-3xl font-bold">ほたる日記</h1>
      <div className="mt-4 space-y-4 rounded-md border border-dashed p-4 text-sm text-gray-600">
        <p>
          ここには具体的な日記の内容は表示されません。ほたるとの会話や気分の記録は、Slack
          上での本人とほたるだけの内緒話として保護されます。
        </p>
        <p>いままでに灯った日記の数: {data.totalEntries.toLocaleString()} 件</p>
        {data.latestEntryDate ? (
          <p>
            直近の灯り:{' '}
            {dayjs(data.latestEntryDate).format('YYYY年M月D日(ddd)')}
          </p>
        ) : (
          <p>
            まだ日記は灯っていません。今夜の21時にほたるが声をかけにいきます。
          </p>
        )}
      </div>
    </div>
  )
}
