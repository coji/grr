import { env } from 'cloudflare:workers'
import { nanoid } from 'nanoid'
import type { SlackApp, SlackEdgeAppEnv } from 'slack-cloudflare-workers'
import dayjs from '~/lib/dayjs'
import { storeAttachments } from '~/services/attachments'
import { updateCharacterOnDiaryEntry } from '~/services/character'
import { db } from '~/services/db'
import { triggerImmediateMemoryExtraction } from '~/services/memory'
import { handleDiaryEntryMilestone } from '~/services/milestone-handler'
import { detectAndStoreFutureEvents } from '~/services/pending-followups'
import { DIARY_PERSONA_NAME } from '../diary-constants'
import { filterSupportedFiles, type SlackFile } from './file-utils'
import { detectReferralPattern } from './onboarding-utils'
import { TOKYO_TZ, sanitizeText } from './utils'
import { buildReferralWelcomeMessage, buildWelcomeMessage } from './welcome'

type OnboardingStatus = 'none' | 'welcomed' | 'completed'

/**
 * ユーザーのオンボーディング状態を取得または初期化
 */
async function getOrCreateUserSettings(
  userId: string,
  channelId: string,
): Promise<{
  onboardingStatus: OnboardingStatus
  isNewUser: boolean
}> {
  const now = dayjs().utc().toISOString()

  const settings = await db
    .selectFrom('userDiarySettings')
    .selectAll()
    .where('userId', '=', userId)
    .executeTakeFirst()

  if (settings) {
    // 既存ユーザー: onboardingStatusを確認
    // diaryChannelIdが設定されていなければ更新
    if (!settings.diaryChannelId) {
      await db
        .updateTable('userDiarySettings')
        .set({
          diaryChannelId: channelId,
          updatedAt: now,
        })
        .where('userId', '=', userId)
        .execute()
    }

    return {
      onboardingStatus:
        (settings.onboardingStatus as OnboardingStatus) || 'none',
      isNewUser: false,
    }
  }

  // 新規ユーザー: 設定レコードを作成
  await db
    .insertInto('userDiarySettings')
    .values({
      userId,
      reminderEnabled: 1,
      reminderHour: 21,
      skipWeekends: 0,
      diaryChannelId: channelId,
      personalityChangePending: 0,
      onboardingStatus: 'none',
      createdAt: now,
      updatedAt: now,
    })
    .execute()

  return {
    onboardingStatus: 'none',
    isNewUser: true,
  }
}

/**
 * オンボーディング状態を更新
 */
async function updateOnboardingStatus(
  userId: string,
  status: OnboardingStatus,
): Promise<void> {
  const now = dayjs().utc().toISOString()

  await db
    .updateTable('userDiarySettings')
    .set({
      onboardingStatus: status,
      updatedAt: now,
    })
    .where('userId', '=', userId)
    .execute()
}

/**
 * ユーザー名を取得
 */
async function getUserDisplayName(
  userId: string,
  // biome-ignore lint/suspicious/noExplicitAny: Slack client type
  client: any,
): Promise<string> {
  try {
    const result = await client.users.info({ user: userId })
    if (result.ok && result.user) {
      return (
        result.user.profile?.display_name ||
        result.user.profile?.real_name ||
        result.user.name ||
        'ユーザー'
      )
    }
  } catch (error) {
    console.error('Failed to get user info:', error)
  }
  return 'ユーザー'
}

export function registerAppMentionHandler(app: SlackApp<SlackEdgeAppEnv>) {
  app.event('app_mention', async ({ payload, context }) => {
    const event = payload
    if (!event.user) return

    // ボットのユーザーIDを取得（紹介パターン検出用）
    let botUserId = ''
    try {
      const authResult = await context.client.auth.test()
      botUserId = authResult.user_id || ''
    } catch {
      // 無視
    }

    // 紹介パターンの検出
    const referral = detectReferralPattern(event.text, event.user, botUserId)

    // 対象ユーザーを決定（紹介の場合は紹介された人、通常は送信者）
    const targetUserId =
      referral.isReferral && referral.newUserId
        ? referral.newUserId
        : event.user

    // オンボーディング状態を取得
    const { onboardingStatus } = await getOrCreateUserSettings(
      targetUserId,
      event.channel,
    )

    // 紹介パターンの場合: 新しいユーザーに歓迎メッセージを送信
    if (referral.isReferral && referral.newUserId) {
      const newUserName = await getUserDisplayName(
        referral.newUserId,
        context.client,
      )
      const referrerName = await getUserDisplayName(event.user, context.client)
      const welcomeMessage = buildReferralWelcomeMessage(
        newUserName,
        referrerName,
      )

      await context.client.chat.postMessage({
        channel: event.channel,
        text: welcomeMessage.text,
        blocks: welcomeMessage.blocks,
      })

      // 新しいユーザーのステータスを welcomed に更新
      await updateOnboardingStatus(referral.newUserId, 'welcomed')

      console.log(
        `Referral onboarding: ${event.user} introduced ${referral.newUserId}`,
      )
      return
    }

    // 初回ユーザー: 歓迎メッセージを送信して終了
    if (onboardingStatus === 'none') {
      const userName = await getUserDisplayName(event.user, context.client)
      const welcomeMessage = buildWelcomeMessage(userName)

      await context.client.chat.postMessage({
        channel: event.channel,
        text: welcomeMessage.text,
        blocks: welcomeMessage.blocks,
        thread_ts: event.ts,
      })

      await updateOnboardingStatus(event.user, 'welcomed')

      console.log(`First contact onboarding for user ${event.user}`)
      return
    }

    // welcomed 状態: 2回目のメッセージでキャラ生成 + 日記処理
    // completed 状態: 通常の日記処理
    // どちらも以下の処理を実行

    // 処理中であることを控えめに伝える
    await context.client.reactions
      .add({
        channel: event.channel,
        timestamp: event.ts,
        name: 'eyes',
      })
      .catch(() => {}) // リアクション追加失敗は無視

    const cleaned = sanitizeText(event.text)
    const hasFiles = 'files' in event && event.files && event.files.length > 0
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

    // Process file attachments if present
    if (entry && hasFiles) {
      const slackFiles = event.files as SlackFile[]
      console.log(
        `Received ${slackFiles.length} files in app_mention event:`,
        slackFiles.map((f) => ({
          id: f.id,
          name: f.name,
          mimetype: f.mimetype,
          url_private: f.url_private
            ? `${f.url_private.substring(0, 50)}...`
            : undefined,
        })),
      )

      const supportedFiles = filterSupportedFiles(slackFiles)

      if (supportedFiles.length > 0) {
        await storeAttachments(entry.id, supportedFiles)

        // Update entry timestamp if files were added
        await db
          .updateTable('diaryEntries')
          .set({
            updatedAt: insertedAt,
          })
          .where('id', '=', entry.id)
          .execute()
      }
    }

    // 未来のイベントを検出してフォローアップをスケジュール (Heartbeat機能)
    // Note: This runs async but we don't await it to avoid blocking the response
    if (entry && cleaned) {
      detectAndStoreFutureEvents(
        entry.id,
        event.user,
        event.channel,
        cleaned,
        entryDate,
      ).catch((error) => {
        console.error('Failed to detect future events:', error)
      })
    }

    // メモリ抽出を即時実行 (Workflowで非同期処理)
    // channel/message info is passed so the workflow can fetch unfurl data
    if (entry && cleaned) {
      triggerImmediateMemoryExtraction(event.user, entry.id, {
        channelId: event.channel,
        messageTs: event.ts,
        threadTs: 'thread_ts' in event ? event.thread_ts : undefined,
      }).catch((error) => {
        console.error('Failed to trigger memory extraction:', error)
      })
    }

    // マイルストーン追跡と祝いメッセージ (非同期で実行)
    if (entry) {
      handleDiaryEntryMilestone(
        event.user,
        event.channel,
        entryDate,
        DIARY_PERSONA_NAME,
      ).catch((error) => {
        console.error('Failed to handle milestone:', error)
      })
    }

    // キャラクター状態更新 (同期で実行)
    // 日記を書くとキャラクターが喜び、ポイントが貯まる
    // ワークフローでキャラクター画像を表示するため、先に作成しておく必要がある
    if (entry) {
      try {
        await updateCharacterOnDiaryEntry(event.user, entry.moodValue)
      } catch (error) {
        console.error('Failed to update character:', error)
      }
    }

    // welcomed 状態だった場合、completed に更新
    if (onboardingStatus === 'welcomed') {
      await updateOnboardingStatus(event.user, 'completed')
      console.log(`Onboarding completed for user ${event.user}`)
    }

    // 前回のエントリを取得（当日より前の最新エントリ）
    const previousEntry = entry
      ? await db
          .selectFrom('diaryEntries')
          .selectAll()
          .where('userId', '=', event.user)
          .where('entryDate', '<', entry.entryDate)
          .orderBy('entryDate', 'desc')
          .limit(1)
          .executeTakeFirst()
      : null

    // スレッド全体をコンテキストとして使用
    const fullDetail = entry?.detail ?? null
    const previousDetail = previousEntry?.detail ?? null

    // Start Cloudflare Workflow for AI reply processing
    // This handles the time-intensive image download + AI processing (can take 30+ seconds)
    try {
      const instance = await env.AI_DIARY_REPLY_WORKFLOW.create({
        params: {
          entryId: entry?.id || '',
          userId: event.user,
          channel: event.channel,
          messageTs: event.ts,
          threadTs: event.thread_ts,
          moodLabel: entry?.moodLabel ?? null,
          latestEntry: fullDetail,
          previousEntry: previousDetail,
          mentionMessage: cleaned || null,
          mention,
          isFirstDiary: onboardingStatus === 'welcomed',
        },
      })

      console.log(`Started AI reply workflow: ${instance.id}`)
    } catch (error) {
      console.error('Failed to start AI reply workflow:', error)
      // Remove "processing" reaction on error
      await context.client.reactions
        .remove({
          channel: event.channel,
          timestamp: event.ts,
          name: 'eyes',
        })
        .catch(() => {})
    }
  })
}
