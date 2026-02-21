import { nanoid } from 'nanoid'
import dayjs from '~/lib/dayjs'
import {
  clearPersonalityChangePending,
  generateDailyReflection,
  getPersonalityChangeNote,
  getUserPersonality,
  updateUserPersonality,
  type DailyReflectionEntry,
} from '~/services/ai'
import { db } from '~/services/db'
import { DIARY_PERSONA_NAME } from './handlers/diary-constants'
import { TOKYO_TZ } from './handlers/diary/utils'

const hasMeaningfulContent = (entry: DailyReflectionEntry) =>
  Boolean(entry.detail?.trim() || entry.moodLabel)

export const generateDailyDiaryReflections = async () => {
  console.log('generateDailyDiaryReflections started')

  const tokyoNow = dayjs().tz(TOKYO_TZ)
  const targetDate = tokyoNow.subtract(1, 'day').format('YYYY-MM-DD')

  const todaysEntries = await db
    .selectFrom('diaryEntries')
    .selectAll()
    .where('entryDate', '=', targetDate)
    .execute()

  if (todaysEntries.length === 0) {
    console.log('No diary entries to reflect on for', targetDate)
    return
  }

  const entriesByUser = new Map<string, (typeof todaysEntries)[number][]>()
  for (const entry of todaysEntries) {
    const list = entriesByUser.get(entry.userId) ?? []
    list.push(entry)
    entriesByUser.set(entry.userId, list)
  }

  for (const [userId, entries] of entriesByUser) {
    const existing = await db
      .selectFrom('aiDailyReflections')
      .select('id')
      .where('userId', '=', userId)
      .where('entryDate', '=', targetDate)
      .executeTakeFirst()

    if (existing) {
      continue
    }

    const sortedEntries = [...entries].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    )

    const reflectionEntries: DailyReflectionEntry[] = sortedEntries.map(
      (entry) => ({
        entryId: entry.id,
        moodLabel: entry.moodLabel,
        moodEmoji: entry.moodEmoji,
        detail: entry.detail,
        recordedAt: entry.updatedAt ?? entry.createdAt,
      }),
    )

    if (!reflectionEntries.some(hasMeaningfulContent)) {
      console.log(
        'Skipping reflection generation for user',
        userId,
        ': no data',
      )
      continue
    }

    try {
      const userRecord = await db
        .selectFrom('users')
        .select('userName')
        .where('userId', '=', userId)
        .executeTakeFirst()

      // Try to update personality if conditions are met
      await updateUserPersonality(userId).catch((error) => {
        console.warn('Failed to update personality for user', userId, error)
      })

      // Get current personality and any pending change note
      const personality = await getUserPersonality(userId)
      const personalityChangeNote = await getPersonalityChangeNote(userId)

      const reflection = await generateDailyReflection({
        personaName: DIARY_PERSONA_NAME,
        userId,
        targetDate,
        entries: reflectionEntries,
        personality,
        personalityChangeNote,
      })

      const sourceEntryIds = JSON.stringify(
        reflectionEntries.map((entry) => entry.entryId),
      )

      const now = dayjs().utc().toISOString()

      await db
        .insertInto('aiDailyReflections')
        .values({
          id: nanoid(),
          userId,
          userName: userRecord?.userName ?? null,
          entryDate: targetDate,
          reflection,
          sourceEntryIds,
          createdAt: now,
          updatedAt: now,
        })
        .execute()

      // Clear the personality change pending flag after including it in reflection
      if (personalityChangeNote) {
        await clearPersonalityChangePending(userId)
      }

      console.log('Stored reflection for', userId, targetDate)
    } catch (error) {
      console.error('Failed to generate reflection for user', userId, error)
    }
  }
}
