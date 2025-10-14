import { nanoid } from 'nanoid'
import type { SlackApp, SlackEdgeAppEnv } from 'slack-cloudflare-workers'
import { SlackAPIError } from 'slack-edge'
import dayjs from '~/lib/dayjs'
import { db } from '~/services/db'
import {
  DIARY_MOOD_CHOICES,
  DIARY_PERSONA_NAME,
  SUPPORTIVE_REACTIONS,
} from './diary-constants'

const TOKYO_TZ = 'Asia/Tokyo'

const sanitizeText = (text: string | undefined) =>
  text
    ?.replace(/<@[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim() ?? ''

const pickRandom = <T>(list: readonly T[]): T =>
  list[Math.floor(Math.random() * list.length)]

const truncate = (value: string, length: number) =>
  value.length > length ? `${value.slice(0, length - 1)}…` : value

export const registerDiaryHandlers = (app: SlackApp<SlackEdgeAppEnv>) => {
  app.event('reaction_added', async ({ payload, context }) => {
    const event = payload
    if (event.item.type !== 'message') return
    const messageTs = event.item.ts
    const channelId = event.item.channel
    if (!messageTs || !channelId) return

    const entry = await db
      .selectFrom('diaryEntries')
      .selectAll()
      .where('messageTs', '=', messageTs)
      .executeTakeFirst()

    if (!entry) return
    if (entry.userId !== event.user) return

    const choice = DIARY_MOOD_CHOICES.find(
      (item) => item.reaction === event.reaction,
    )
    const now = dayjs().utc().toISOString()
    const moodEmoji = choice?.emoji ?? `:${event.reaction}:`
    const moodLabel = choice?.label ?? 'custom'
    const moodValue = choice?.value ?? null

    await db
      .updateTable('diaryEntries')
      .set({
        moodEmoji,
        moodLabel,
        moodValue,
        moodRecordedAt: now,
        updatedAt: now,
      })
      .where('id', '=', entry.id)
      .execute()

    if (!entry.moodRecordedAt) {
      const label = choice ? `「${choice.label}」` : `「:${event.reaction}:」`
      await context.client.chat
        .postMessage({
          channel: channelId,
          thread_ts: messageTs,
          text: `${DIARY_PERSONA_NAME}が今日のきもち${label}をそっと受け取ったよ。いつもおつかれさま。`,
        })
        .catch(() => {})
    }
  })

  app.event('reaction_removed', async ({ payload }) => {
    const event = payload
    if (event.item.type !== 'message') return
    const messageTs = event.item.ts
    if (!messageTs) return

    const entry = await db
      .selectFrom('diaryEntries')
      .selectAll()
      .where('messageTs', '=', messageTs)
      .executeTakeFirst()

    if (!entry) return
    if (entry.userId !== event.user) return

    const normalized =
      DIARY_MOOD_CHOICES.find((item) => item.reaction === event.reaction)
        ?.emoji ?? `:${event.reaction}:`

    if (entry.moodEmoji !== normalized) return

    const now = dayjs().utc().toISOString()

    await db
      .updateTable('diaryEntries')
      .set({
        moodEmoji: null,
        moodLabel: null,
        moodValue: null,
        moodRecordedAt: null,
        updatedAt: now,
      })
      .where('id', '=', entry.id)
      .execute()
  })

  app.event('message', async ({ payload, context }) => {
    const event = payload
    if (
      'subtype' in event &&
      event.subtype &&
      event.subtype !== 'thread_broadcast'
    )
      return
    if (!('thread_ts' in event) || !event.thread_ts) return
    if (!event.user) return

    const entry = await db
      .selectFrom('diaryEntries')
      .selectAll()
      .where('messageTs', '=', event.thread_ts)
      .executeTakeFirst()

    if (!entry) return
    if (entry.userId !== event.user) return

    const text = sanitizeText(event.text)
    if (!text) return

    const now = dayjs().utc().toISOString()
    const combined = entry.detail ? `${entry.detail}\n\n---\n${text}` : text

    await db
      .updateTable('diaryEntries')
      .set({
        detail: combined,
        detailRecordedAt: now,
        updatedAt: now,
      })
      .where('id', '=', entry.id)
      .execute()

    if (Math.random() < 0.35) {
      const reaction = pickRandom(SUPPORTIVE_REACTIONS)
      await context.client.reactions
        .add({ channel: entry.channelId, timestamp: event.ts, name: reaction })
        .catch((error) => {
          if (
            error instanceof SlackAPIError &&
            error.error === 'already_reacted'
          ) {
            return
          }
          console.error('Failed to add supportive reaction', error)
        })
    }
  })

  app.event('app_mention', async ({ payload, context }) => {
    const event = payload
    if (!event.user) return
    const cleaned = sanitizeText(event.text)
    const insertedAt = dayjs().utc().toISOString()
    const entryDate = dayjs().tz(TOKYO_TZ).format('YYYY-MM-DD')
    const mention = `<@${event.user}> さん`

    let entry =
      'thread_ts' in event && event.thread_ts
        ? await db
            .selectFrom('diaryEntries')
            .selectAll()
            .where('messageTs', '=', event.thread_ts)
            .executeTakeFirst()
        : await db
            .selectFrom('diaryEntries')
            .selectAll()
            .where('messageTs', '=', event.ts)
            .executeTakeFirst()

    if (!('thread_ts' in event) || !event.thread_ts) {
      if (!entry) {
        const detailRecordedAt = cleaned ? insertedAt : null
        const baseEntry = {
          id: nanoid(),
          userId: event.user,
          channelId: event.channel,
          messageTs: event.ts,
          entryDate,
          moodEmoji: null,
          moodValue: null,
          moodLabel: null,
          detail: cleaned || null,
          reminderSentAt: insertedAt,
          moodRecordedAt: null,
          detailRecordedAt,
          createdAt: insertedAt,
          updatedAt: insertedAt,
        }

        await db.insertInto('diaryEntries').values(baseEntry).execute()
        entry = baseEntry
      } else if (cleaned && !entry.detail) {
        await db
          .updateTable('diaryEntries')
          .set({
            detail: cleaned,
            detailRecordedAt: insertedAt,
            updatedAt: insertedAt,
          })
          .where('id', '=', entry.id)
          .execute()
        entry = {
          ...entry,
          detail: cleaned,
          detailRecordedAt: insertedAt,
          updatedAt: insertedAt,
        }
      }
    } else if (entry && cleaned) {
      const combined = entry.detail
        ? `${entry.detail}\n\n---\n${cleaned}`
        : cleaned
      await db
        .updateTable('diaryEntries')
        .set({
          detail: combined,
          detailRecordedAt: insertedAt,
          updatedAt: insertedAt,
        })
        .where('id', '=', entry.id)
        .execute()
      entry = {
        ...entry,
        detail: combined,
        detailRecordedAt: insertedAt,
        updatedAt: insertedAt,
      }
    }

    const summaryBits: string[] = []
    if (entry?.moodLabel) {
      summaryBits.push(`最近のきもち: ${entry.moodLabel}`)
    }
    if (entry?.detail) {
      const segments = entry.detail.split('\n\n---\n')
      const latestDetail = segments[segments.length - 1]
      summaryBits.push(`きろく: 「${truncate(latestDetail, 40)}」`)
    } else if (cleaned) {
      summaryBits.push(`きろく: 「${truncate(cleaned, 40)}」`)
    }
    const summaryLine =
      summaryBits.length > 0
        ? summaryBits.join(' / ')
        : '話してくれてありがとう。ここでいつでも受け止めるよ。'
    const closingLine = '無理せず、続きを書きたくなったらまた呼んでね。'
    const message = `やっほー、${DIARY_PERSONA_NAME}だよ。${mention}\n${summaryLine}\n${closingLine}`

    await context.client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.thread_ts ?? event.ts,
      text: message,
    })

    const reactionName = pickRandom(SUPPORTIVE_REACTIONS)
    await context.client.reactions
      .add({
        channel: event.channel,
        timestamp: event.ts,
        name: reactionName,
      })
      .catch((error) => {
        if (error instanceof SlackAPIError && error.error === 'already_reacted')
          return
        console.error('Failed to add supportive reaction', error)
      })
  })
}
