/**
 * 日記音楽生成コマンドハンドラ
 *
 * /diary music [generate|status|list] で音楽生成を管理する。
 */

import type { SlackAppContextWithOptionalRespond } from 'slack-cloudflare-workers'
import type { SlackAPIClient } from 'slack-edge'
import {
  generateDiaryMusic,
  getMusicGenerations,
  getPendingMusicGeneration,
  MIN_ENTRIES_FOR_MUSIC,
  updateMusicStatus,
} from '~/services/diary-music'
import { isSunoConfigured } from '~/services/suno-api'

/**
 * 音楽コマンドのメインハンドラ
 */
export async function handleMusicCommand(
  userId: string,
  args: string[],
  context: SlackAppContextWithOptionalRespond,
  cloudflareCtx?: { waitUntil: (promise: Promise<unknown>) => void },
  client?: SlackAPIClient,
): Promise<void> {
  const action = args[0]?.toLowerCase() || 'generate'

  switch (action) {
    case 'generate':
      return await handleMusicGenerate(
        userId,
        args.slice(1),
        context,
        cloudflareCtx,
        client,
      )
    case 'status':
      return await handleMusicStatus(userId, context)
    case 'list':
      return await handleMusicList(userId, context)
    default:
      return await handleMusicHelp(context)
  }
}

/**
 * 音楽生成コマンド
 */
async function handleMusicGenerate(
  userId: string,
  args: string[],
  context: SlackAppContextWithOptionalRespond,
  cloudflareCtx?: { waitUntil: (promise: Promise<unknown>) => void },
  client?: SlackAPIClient,
): Promise<void> {
  // Suno API が設定されているか確認
  if (!isSunoConfigured()) {
    await context.respond?.({
      text: '音楽生成サービスが設定されていません。管理者に連絡してください。',
      response_type: 'ephemeral',
    })
    return
  }

  // 対象月をパース（省略時は先月）
  let targetMonth: { year: number; month: number } | undefined
  if (args[0]) {
    const match = args[0].match(/^(\d{4})-(\d{1,2})$/)
    if (match) {
      targetMonth = {
        year: Number.parseInt(match[1], 10),
        month: Number.parseInt(match[2], 10),
      }
    } else {
      await context.respond?.({
        text: '月の指定は `YYYY-MM` 形式で入力してください。\n例: `/diary music generate 2026-02`',
        response_type: 'ephemeral',
      })
      return
    }
  }

  try {
    const result = await generateDiaryMusic({ userId, targetMonth })

    if (!result.isNew) {
      // 既存の生成がある場合
      const gen = result.generation
      if (gen.status === 'completed' && gen.sunoAudioUrl) {
        await context.respond?.({
          text:
            `*${gen.periodLabel}の振り返りBGM*\n\n` +
            `曲名: ${gen.musicTitle}\n` +
            `テーマ: ${gen.theme}\n\n` +
            `${gen.sunoAudioUrl}`,
          response_type: 'ephemeral',
        })
      } else {
        await context.respond?.({
          text: result.message,
          response_type: 'ephemeral',
        })
      }
      return
    }

    // 生成開始メッセージ
    await context.respond?.({
      text:
        `${result.message}\n\n` +
        `曲名: ${result.generation.musicTitle}\n` +
        `テーマ: ${result.generation.theme}\n\n` +
        '生成には数分かかります。完了したらDMでお知らせします。',
      response_type: 'ephemeral',
    })

    // 非同期でポーリングを開始（Cloudflare Workers の waitUntil を使用）
    if (cloudflareCtx && client) {
      cloudflareCtx.waitUntil(
        pollMusicGeneration(result.generation.id, userId, client),
      )
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'エラーが発生しました'
    await context.respond?.({
      text: errorMessage,
      response_type: 'ephemeral',
    })
  }
}

/**
 * 音楽生成ステータス確認コマンド
 */
async function handleMusicStatus(
  userId: string,
  context: SlackAppContextWithOptionalRespond,
): Promise<void> {
  const pending = await getPendingMusicGeneration(userId)

  if (!pending) {
    await context.respond?.({
      text: '現在生成中の曲はありません。\n`/diary music generate` で新しい曲を生成できます。',
      response_type: 'ephemeral',
    })
    return
  }

  // ステータスを更新
  const updated = await updateMusicStatus(pending.id)

  if (!updated) {
    await context.respond?.({
      text: '生成情報の取得に失敗しました。',
      response_type: 'ephemeral',
    })
    return
  }

  const statusLabels: Record<string, string> = {
    pending: '準備中',
    generating: '生成中',
    completed: '完了',
    failed: '失敗',
  }

  let message = `*${updated.periodLabel}の振り返りBGM*\n\n`
  message += `曲名: ${updated.musicTitle}\n`
  message += `ステータス: ${statusLabels[updated.status] ?? updated.status}\n`

  if (updated.status === 'completed' && updated.sunoAudioUrl) {
    message += `\n${updated.sunoAudioUrl}`
  } else if (updated.status === 'failed' && updated.errorMessage) {
    message += `\nエラー: ${updated.errorMessage}`
  } else if (updated.status === 'generating') {
    message += '\n生成には数分かかります。完了したらDMでお知らせします。'
  }

  await context.respond?.({
    text: message,
    response_type: 'ephemeral',
  })
}

/**
 * 過去の生成一覧コマンド
 */
async function handleMusicList(
  userId: string,
  context: SlackAppContextWithOptionalRespond,
): Promise<void> {
  const generations = await getMusicGenerations(userId, 10)

  if (generations.length === 0) {
    await context.respond?.({
      text: 'まだ曲が生成されていません。\n`/diary music generate` で最初の曲を作りましょう！',
      response_type: 'ephemeral',
    })
    return
  }

  const statusLabels: Record<string, string> = {
    pending: '準備中',
    generating: '生成中',
    completed: '完了',
    failed: '失敗',
  }

  const list = generations
    .map((gen) => {
      const status = statusLabels[gen.status] ?? gen.status
      const audioLink =
        gen.status === 'completed' && gen.sunoAudioUrl
          ? ` <${gen.sunoAudioUrl}|聴く>`
          : ''
      return `• *${gen.periodLabel}* - ${gen.musicTitle} (${status})${audioLink}`
    })
    .join('\n')

  await context.respond?.({
    text: `*振り返りBGM一覧*\n\n${list}`,
    response_type: 'ephemeral',
  })
}

/**
 * ヘルプコマンド
 */
async function handleMusicHelp(
  context: SlackAppContextWithOptionalRespond,
): Promise<void> {
  const help = `*日記音楽コマンド*

日記から振り返り用のオリジナルBGMを生成します。

\`/diary music generate [YYYY-MM]\` - 指定月の曲を生成（省略時は先月）
\`/diary music status\` - 生成中の曲のステータスを確認
\`/diary music list\` - 過去に生成した曲の一覧

*必要条件*
- 対象月に${MIN_ENTRIES_FOR_MUSIC}件以上の日記エントリが必要です
- 生成には数分かかります
- 完了したらDMでお知らせします
`

  await context.respond?.({
    text: help,
    response_type: 'ephemeral',
  })
}

// ============================================
// Background Polling
// ============================================

/**
 * 音楽生成の完了をポーリングし、完了時にDMで通知
 */
async function pollMusicGeneration(
  generationId: string,
  userId: string,
  client: SlackAPIClient,
): Promise<void> {
  const maxAttempts = 60 // 最大60回（5分 x 60 = 5分間隔で最大5時間）
  const pollInterval = 5000 // 5秒間隔

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // 少し待機
    await new Promise((resolve) => setTimeout(resolve, pollInterval))

    try {
      const updated = await updateMusicStatus(generationId)

      if (!updated) {
        console.error(`Music generation not found: ${generationId}`)
        return
      }

      if (updated.status === 'completed' && updated.sunoAudioUrl) {
        // 完了通知を送信
        await client.chat.postMessage({
          channel: userId,
          text:
            `*${updated.periodLabel}の振り返りBGMが完成しました！*\n\n` +
            `曲名: ${updated.musicTitle}\n` +
            `テーマ: ${updated.theme}\n\n` +
            `${updated.sunoAudioUrl}\n\n` +
            `${updated.moodSummary}\n\n` +
            `_今月も日記を書いてくれてありがとう。この曲と一緒に振り返ってみてね。_`,
        })
        return
      }

      if (updated.status === 'failed') {
        // 失敗通知を送信
        await client.chat.postMessage({
          channel: userId,
          text:
            `*${updated.periodLabel}の振り返りBGM生成に失敗しました*\n\n` +
            `エラー: ${updated.errorMessage ?? '不明なエラー'}\n\n` +
            '時間をおいてもう一度お試しください。',
        })
        return
      }

      // まだ処理中なので続行
    } catch (error) {
      console.error(`Polling error for ${generationId}:`, error)
      // エラーでも続行（一時的なエラーの可能性）
    }
  }

  // タイムアウト
  console.warn(`Music generation polling timed out: ${generationId}`)
}
