import { sql } from 'kysely'
import dayjs from '~/lib/dayjs'
import { db } from '~/services/db'
import type { Route } from './+types/_index'

const TOKYO_TZ = 'Asia/Tokyo'

type MoodDistribution = {
  moodLabel: string
  count: number
}

type WeekdayDistribution = {
  weekday: number
  count: number
}

type LoaderData = {
  totalEntries: number
  latestEntryDate: string | null
  totalUsers: number
  thisMonthEntries: number
  thisWeekEntries: number
  currentStreak: number
  moodDistribution: MoodDistribution[]
  weekdayDistribution: WeekdayDistribution[]
}

export const loader = async () => {
  const now = dayjs().tz(TOKYO_TZ)
  const thisMonthStart = now.startOf('month').format('YYYY-MM-DD')
  const thisWeekStart = now.startOf('week').format('YYYY-MM-DD')

  // 基本統計
  const basicStats = await db
    .selectFrom('diaryEntries')
    .select((eb) => [
      eb.fn.countAll<number>().as('totalEntries'),
      eb.fn.max('entryDate').as('latestEntryDate'),
    ])
    .executeTakeFirst()

  // ユーザー数
  const userCount = await db
    .selectFrom('diaryEntries')
    .select((eb) => eb.fn.count<number>(sql`DISTINCT user_id`).as('count'))
    .executeTakeFirst()

  // 今月の記録数
  const thisMonthStats = await db
    .selectFrom('diaryEntries')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('entryDate', '>=', thisMonthStart)
    .executeTakeFirst()

  // 今週の記録数
  const thisWeekStats = await db
    .selectFrom('diaryEntries')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('entryDate', '>=', thisWeekStart)
    .executeTakeFirst()

  // 連続記録日数（全ユーザー合計で日付ベース）
  const recentDates = await db
    .selectFrom('diaryEntries')
    .select('entryDate')
    .distinct()
    .orderBy('entryDate', 'desc')
    .limit(100)
    .execute()

  let currentStreak = 0
  let checkDate = now.startOf('day')
  const dateSet = new Set(recentDates.map((r) => r.entryDate))

  // 今日または昨日から連続でカウント
  if (!dateSet.has(checkDate.format('YYYY-MM-DD'))) {
    checkDate = checkDate.subtract(1, 'day')
  }
  while (dateSet.has(checkDate.format('YYYY-MM-DD'))) {
    currentStreak++
    checkDate = checkDate.subtract(1, 'day')
  }

  // 気分の分布（最近30日）
  const thirtyDaysAgo = now.subtract(30, 'day').format('YYYY-MM-DD')
  const moodStats = await db
    .selectFrom('diaryEntries')
    .select(['moodLabel', (eb) => eb.fn.countAll<number>().as('count')])
    .where('moodLabel', 'is not', null)
    .where('entryDate', '>=', thirtyDaysAgo)
    .groupBy('moodLabel')
    .orderBy('count', 'desc')
    .execute()

  // 曜日別の記録傾向
  const weekdayStats = await db
    .selectFrom('diaryEntries')
    .select([
      sql<number>`CAST(strftime('%w', entry_date) AS INTEGER)`.as('weekday'),
      (eb) => eb.fn.countAll<number>().as('count'),
    ])
    .groupBy(sql`strftime('%w', entry_date)`)
    .execute()

  const data: LoaderData = {
    totalEntries: Number(basicStats?.totalEntries ?? 0),
    latestEntryDate: basicStats?.latestEntryDate ?? null,
    totalUsers: Number(userCount?.count ?? 0),
    thisMonthEntries: Number(thisMonthStats?.count ?? 0),
    thisWeekEntries: Number(thisWeekStats?.count ?? 0),
    currentStreak,
    moodDistribution: moodStats.map((m) => ({
      moodLabel: m.moodLabel ?? '',
      count: Number(m.count),
    })),
    weekdayDistribution: weekdayStats.map((w) => ({
      weekday: Number(w.weekday),
      count: Number(w.count),
    })),
  }

  return data
}

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

export default function Home({ loaderData }: Route.ComponentProps) {
  const data = loaderData as LoaderData

  // 曜日分布を整形（0=日曜から6=土曜）
  const weekdayMap = new Map(
    data.weekdayDistribution.map((w) => [w.weekday, w.count]),
  )
  const maxWeekdayCount = Math.max(
    ...data.weekdayDistribution.map((w) => w.count),
    1,
  )

  return (
    <div className="mx-auto max-w-2xl p-4">
      <h1 className="text-3xl font-bold">🌙 ほたる日記</h1>

      <p className="mt-4 text-sm text-gray-600">
        ここには具体的な日記の内容は表示されません。ほたるとの会話や気分の記録は、Slack
        上での本人とほたるだけの内緒話として保護されます。
      </p>

      {/* メイン統計 */}
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="総記録数" value={data.totalEntries} unit="件" />
        <StatCard label="参加者" value={data.totalUsers} unit="人" />
        <StatCard label="今月" value={data.thisMonthEntries} unit="件" />
        <StatCard label="今週" value={data.thisWeekEntries} unit="件" />
      </div>

      {/* 連続記録 */}
      {data.currentStreak > 0 && (
        <div className="mt-6 rounded-lg bg-amber-50 p-4 text-center">
          <p className="text-sm text-amber-700">🔥 連続記録中</p>
          <p className="text-3xl font-bold text-amber-600">
            {data.currentStreak}
            <span className="ml-1 text-base font-normal">日</span>
          </p>
        </div>
      )}

      {/* 直近の記録 */}
      <div className="mt-6 text-center text-sm text-gray-500">
        {data.latestEntryDate ? (
          <p>
            直近の灯り:{' '}
            {dayjs(data.latestEntryDate).format('YYYY年M月D日(ddd)')}
          </p>
        ) : (
          <p>
            まだ日記は灯っていません。今夜の22時にほたるが声をかけにいきます。
          </p>
        )}
      </div>

      {/* 気分の分布 */}
      {data.moodDistribution.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-medium text-gray-700">最近30日の気分</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {data.moodDistribution.slice(0, 6).map((mood) => (
              <span
                key={mood.moodLabel}
                className="rounded-full bg-gray-100 px-3 py-1 text-sm"
              >
                {mood.moodLabel}{' '}
                <span className="text-gray-500">{mood.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 曜日別の記録傾向 */}
      {data.weekdayDistribution.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-medium text-gray-700">
            曜日別の記録傾向
          </h2>
          <div className="mt-2 flex items-end justify-between gap-1">
            {WEEKDAY_LABELS.map((label, i) => {
              const count = weekdayMap.get(i) ?? 0
              const height =
                maxWeekdayCount > 0 ? (count / maxWeekdayCount) * 48 : 0
              return (
                <div
                  key={label}
                  className="flex flex-1 flex-col items-center gap-1"
                >
                  <div
                    className="w-full rounded-t bg-blue-200"
                    style={{ height: `${Math.max(height, 2)}px` }}
                    title={`${label}曜日: ${count}件`}
                  />
                  <span className="text-xs text-gray-500">{label}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  unit,
}: {
  label: string
  value: number
  unit: string
}) {
  return (
    <div className="rounded-lg border bg-white p-3 text-center shadow-sm">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-gray-800">
        {value.toLocaleString()}
        <span className="ml-1 text-sm font-normal text-gray-500">{unit}</span>
      </p>
    </div>
  )
}
