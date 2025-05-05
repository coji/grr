import { db } from '~/services/db'
import dayjs from '~/utils/dayjs'
import type { Route } from './+types/_index'

export const loader = async () => {
  const irritations = await db
    .selectFrom('irritations')
    .selectAll()
    .orderBy('createdAt', 'desc')
    .limit(100)
    .execute()
  return {
    irritations,
  }
}

export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <div className="p-4">
      <h1 className="text-3xl font-bold">Irritations</h1>
      <div className="mt-4">
        {loaderData.irritations.map((irritation) => (
          <div key={irritation.id} className="mb-4 rounded-md border p-4">
            <h2 className="text-xl">{irritation.rawText}</h2>
            <div className="flex flex-row gap-2">
              イラ度: <p>{irritation.score}</p>
            </div>
            <p>{irritation.userId}</p>
            <p className="text-sm text-gray-500">
              {dayjs(irritation.createdAt).format()}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
