import type {
  SlackApp,
  SlackAppContextWithOptionalRespond,
  SlackEdgeAppEnv,
} from 'slack-cloudflare-workers'
import dayjs from '~/lib/dayjs'
import { getAttachmentStats } from '~/services/attachments'
import { ensureWorkspaceId } from '~/services/character-social'
import { db } from '~/services/db'
import {
  isFtsAvailable,
  searchDiaryEntries,
  searchDiaryEntriesFallback,
} from '~/services/diary-search'
import {
  CATEGORY_LABELS,
  clearAllMemories,
  deleteMemory,
  getActiveMemories,
  type MemoryCategory,
} from '~/services/memory'
import { getMemoryStats } from '~/services/memory-retrieval'
import { handleMusicCommand } from './music-command'
import { TOKYO_TZ } from './utils'

export function registerSlashCommandHandler(app: SlackApp<SlackEdgeAppEnv>) {
  app.command('/diary', async ({ payload, context }) => {
    const command = payload
    const userId = command.user_id
    const text = command.text.trim()
    const args = text.split(/\s+/)
    const subcommand = args[0]?.toLowerCase() || 'help'

    // Track workspace ID for social features (fire-and-forget)
    const teamId = (command as unknown as { team_id?: string }).team_id
    if (teamId) {
      ensureWorkspaceId(userId, teamId).catch((err) =>
        console.error('Failed to update workspace ID:', err),
      )
    }

    try {
      switch (subcommand) {
        case 'today':
          return await handleTodayCommand(userId, context)
        case 'search':
          return await handleSearchCommand(
            userId,
            args.slice(1).join(' '),
            context,
          )
        case 'stats':
          return await handleStatsCommand(userId, context)
        case 'export':
          return await handleExportCommand(userId, context)
        case 'reflection':
          return await handleReflectionCommand(userId, args.slice(1), context)
        case 'memory':
          return await handleMemoryCommand(userId, args.slice(1), context)
        case 'music':
          return await handleMusicCommand(
            userId,
            args.slice(1),
            context,
            undefined,
            context.client,
          )
        default:
          return await handleHelpCommand(context)
      }
    } catch (error) {
      console.error('Slash command error:', error)
      await context.respond({
        text: 'エラーが発生しました。もう一度お試しください。',
        response_type: 'ephemeral',
      })
    }
  })
}

async function handleTodayCommand(
  userId: string,
  context: SlackAppContextWithOptionalRespond,
) {
  const today = dayjs().tz(TOKYO_TZ).format('YYYY-MM-DD')

  const entry = await db
    .selectFrom('diaryEntries')
    .selectAll()
    .where('userId', '=', userId)
    .where('entryDate', '=', today)
    .executeTakeFirst()

  if (!entry) {
    await context.respond?.({
      text: '今日の日記はまだ書かれていません。',
      response_type: 'ephemeral',
    })
    return
  }

  const mood = entry.moodLabel || '未記録'
  const detail = entry.detail || '_詳細なし_'
  const date = dayjs(entry.entryDate).format('YYYY年M月D日(ddd)')

  // Get attachment stats
  const stats = await getAttachmentStats(entry.id)
  const attachmentInfo =
    stats.total > 0
      ? `\n📎 添付: ${stats.images > 0 ? `画像${stats.images}枚` : ''}${stats.videos > 0 ? ` 動画${stats.videos}本` : ''}${stats.documents > 0 ? ` ドキュメント${stats.documents}個` : ''} (計${stats.total}ファイル)`
      : ''

  await context.respond?.({
    text: `*${date} の日記*\n気分: ${mood}${attachmentInfo}\n\n${detail}`,
    response_type: 'ephemeral',
  })
}

async function handleSearchCommand(
  userId: string,
  keyword: string,
  context: SlackAppContextWithOptionalRespond,
) {
  if (!keyword) {
    await context.respond?.({
      text: '検索キーワードを指定してください。\n使い方: `/diary search キーワード`',
      response_type: 'ephemeral',
    })
    return
  }

  // Use FTS5 search if available, fallback to LIKE search
  const ftsEnabled = await isFtsAvailable()
  const searchResults = ftsEnabled
    ? await searchDiaryEntries(userId, keyword, 10)
    : await searchDiaryEntriesFallback(userId, keyword, 10)

  if (searchResults.length === 0) {
    await context.respond?.({
      text: `「${keyword}」を含むエントリは見つかりませんでした。`,
      response_type: 'ephemeral',
    })
    return
  }

  // Get attachment stats for all entries
  const entryIds = searchResults.map((e) => e.entryId)
  const attachmentStats = await Promise.all(
    entryIds.map((id) => getAttachmentStats(id)),
  )

  const results = searchResults
    .map((entry, index) => {
      const date = dayjs(entry.entryDate).format('M月D日(ddd)')
      const preview =
        entry.detail && entry.detail.length > 80
          ? `${entry.detail.slice(0, 80)}...`
          : entry.detail || '_詳細なし_'
      const stats = attachmentStats[index]
      const attachmentIndicator =
        stats && stats.total > 0 ? ` 📎${stats.total}` : ''
      return `• *${date}*${attachmentIndicator}\n  ${preview}`
    })
    .join('\n\n')

  const searchMethodNote = ftsEnabled ? '' : '\n_（基本検索モード）_'
  await context.respond?.({
    text: `*「${keyword}」の検索結果 (${searchResults.length}件)*${searchMethodNote}\n\n${results}`,
    response_type: 'ephemeral',
  })
}

async function handleStatsCommand(
  userId: string,
  context: SlackAppContextWithOptionalRespond,
) {
  const allEntries = await db
    .selectFrom('diaryEntries')
    .selectAll()
    .where('userId', '=', userId)
    .execute()

  if (allEntries.length === 0) {
    await context.respond?.({
      text: 'まだ日記が記録されていません。',
      response_type: 'ephemeral',
    })
    return
  }

  const totalEntries = allEntries.length
  const entriesWithMood = allEntries.filter((e) => e.moodValue !== null)
  const avgMood =
    entriesWithMood.length > 0
      ? (
          entriesWithMood.reduce((sum, e) => sum + (e.moodValue || 0), 0) /
          entriesWithMood.length
        ).toFixed(2)
      : 'N/A'

  const moodCounts = entriesWithMood.reduce(
    (acc, entry) => {
      if (entry.moodValue) {
        acc[entry.moodValue] = (acc[entry.moodValue] || 0) + 1
      }
      return acc
    },
    {} as Record<number, number>,
  )

  const moodStats = Object.entries(moodCounts)
    .map(([value, count]) => {
      const label =
        value === '3'
          ? 'ほっと安心'
          : value === '2'
            ? 'ふつうの日'
            : 'おつかれさま'
      return `  ${label}: ${count}回`
    })
    .join('\n')

  const firstEntry = dayjs(allEntries[allEntries.length - 1].entryDate).format(
    'YYYY年M月D日',
  )
  const lastEntry = dayjs(allEntries[0].entryDate).format('YYYY年M月D日')

  const stats = `*📊 日記統計*

総エントリ数: ${totalEntries}件
期間: ${firstEntry} 〜 ${lastEntry}
平均気分: ${avgMood}

気分の内訳:
${moodStats || '  データなし'}
`

  await context.respond?.({
    text: stats,
    response_type: 'ephemeral',
  })
}

async function handleExportCommand(
  userId: string,
  context: SlackAppContextWithOptionalRespond,
) {
  const entries = await db
    .selectFrom('diaryEntries')
    .selectAll()
    .where('userId', '=', userId)
    .orderBy('entryDate', 'asc')
    .execute()

  if (entries.length === 0) {
    await context.respond?.({
      text: 'エクスポートする日記がありません。',
      response_type: 'ephemeral',
    })
    return
  }

  const csvData = entries
    .map((entry) => {
      const date = entry.entryDate
      const mood = entry.moodLabel || ''
      const detail = (entry.detail || '')
        .replace(/\n/g, ' ')
        .replace(/"/g, '""')
      return `"${date}","${mood}","${detail}"`
    })
    .join('\n')

  const csv = `"日付","気分","詳細"\n${csvData}`

  await context.respond?.({
    text: `*日記エクスポート (${entries.length}件)*\n\n\`\`\`\n${csv.slice(0, 2000)}${csv.length > 2000 ? '\n...(省略)' : ''}\n\`\`\`\n\n全データをコピーしてCSVファイルとして保存できます。`,
    response_type: 'ephemeral',
  })
}

async function handleReflectionCommand(
  userId: string,
  args: string[],
  context: SlackAppContextWithOptionalRespond,
) {
  const tokyoNow = dayjs().tz(TOKYO_TZ)

  const parseDateArg = (value: string) => {
    if (!value) return undefined
    if (value.toLowerCase() === 'today') return tokyoNow.format('YYYY-MM-DD')
    if (value.toLowerCase() === 'yesterday')
      return tokyoNow.subtract(1, 'day').format('YYYY-MM-DD')
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
    return null
  }

  const requestedDate = args[0]
  const parsed = requestedDate ? parseDateArg(requestedDate) : undefined

  if (parsed === null) {
    await context.respond?.({
      text: '日付は `YYYY-MM-DD` 形式、または `today` / `yesterday` で指定してください。',
      response_type: 'ephemeral',
    })
    return
  }

  const targetDate = parsed ?? tokyoNow.format('YYYY-MM-DD')

  let reflection = await db
    .selectFrom('aiDailyReflections')
    .selectAll()
    .where('userId', '=', userId)
    .where('entryDate', '=', targetDate)
    .executeTakeFirst()

  if (!reflection && !requestedDate) {
    reflection = await db
      .selectFrom('aiDailyReflections')
      .selectAll()
      .where('userId', '=', userId)
      .orderBy('entryDate', 'desc')
      .limit(1)
      .executeTakeFirst()
  }

  if (!reflection) {
    await context.respond?.({
      text: 'ふりかえりメモはまだ生成されていません。日記を記録すると翌日以降に振り返りが届きます。',
      response_type: 'ephemeral',
    })
    return
  }

  const displayDate = dayjs(reflection.entryDate)
    .tz(TOKYO_TZ)
    .format('YYYY年M月D日(ddd)')

  await context.respond?.({
    text: `*${displayDate} のふりかえりメモ*\n\n${reflection.reflection}\n\n別の日付を見るときは \`/diary reflection YYYY-MM-DD\` と入力してください。`,
    response_type: 'ephemeral',
  })
}

async function handleMemoryCommand(
  userId: string,
  args: string[],
  context: SlackAppContextWithOptionalRespond,
) {
  const action = args[0]?.toLowerCase() || 'list'

  switch (action) {
    case 'list':
      return await handleMemoryListCommand(userId, context)
    case 'delete':
      return await handleMemoryDeleteCommand(userId, args[1], context)
    case 'clear':
      return await handleMemoryClearCommand(userId, context)
    case 'stats':
      return await handleMemoryStatsCommand(userId, context)
    default:
      await context.respond?.({
        text: `*メモリーコマンドヘルプ*

\`/diary memory list\` - 覚えていることを一覧表示
\`/diary memory stats\` - メモリーの統計を表示
\`/diary memory delete <ID>\` - 特定のメモリーを削除
\`/diary memory clear\` - すべてのメモリーを削除
`,
        response_type: 'ephemeral',
      })
  }
}

async function handleMemoryListCommand(
  userId: string,
  context: SlackAppContextWithOptionalRespond,
) {
  const memories = await getActiveMemories(userId)

  if (memories.length === 0) {
    await context.respond?.({
      text: '覚えていることはまだありません。日記を書き続けると、あなたのことを少しずつ覚えていきます。',
      response_type: 'ephemeral',
    })
    return
  }

  // Group by category
  const grouped: Record<string, typeof memories> = {}
  for (const memory of memories) {
    const category = (memory.category ?? 'general') as MemoryCategory
    if (!grouped[category]) grouped[category] = []
    grouped[category].push(memory)
  }

  // Build display
  const sections: string[] = []
  const categoryOrder: MemoryCategory[] = [
    'work',
    'family',
    'personal',
    'health',
    'hobby',
    'general',
  ]

  for (const category of categoryOrder) {
    const categoryMemories = grouped[category]
    if (!categoryMemories || categoryMemories.length === 0) continue

    const label = CATEGORY_LABELS[category]
    const items = categoryMemories
      .map((m) => `  • ${m.content} \`[${m.id.slice(0, 8)}]\``)
      .join('\n')
    sections.push(`*${label}*\n${items}`)
  }

  const text = `*ほたるが覚えていること* (${memories.length}件)\n\n${sections.join('\n\n')}\n\n_削除するには \`/diary memory delete <ID>\` を使用してください_`

  await context.respond?.({
    text,
    response_type: 'ephemeral',
  })
}

async function handleMemoryDeleteCommand(
  userId: string,
  memoryId: string | undefined,
  context: SlackAppContextWithOptionalRespond,
) {
  if (!memoryId) {
    await context.respond?.({
      text: '削除するメモリーのIDを指定してください。\n使い方: `/diary memory delete <ID>`',
      response_type: 'ephemeral',
    })
    return
  }

  // Find the memory (support partial ID matching)
  const memories = await getActiveMemories(userId)
  const memory = memories.find(
    (m) => m.id === memoryId || m.id.startsWith(memoryId),
  )

  if (!memory) {
    await context.respond?.({
      text: `ID「${memoryId}」のメモリーが見つかりませんでした。\n\`/diary memory list\` で一覧を確認してください。`,
      response_type: 'ephemeral',
    })
    return
  }

  await deleteMemory(memory.id)

  await context.respond?.({
    text: `メモリーを削除しました:\n_${memory.content}_`,
    response_type: 'ephemeral',
  })
}

async function handleMemoryClearCommand(
  userId: string,
  context: SlackAppContextWithOptionalRespond,
) {
  const count = await clearAllMemories(userId)

  if (count === 0) {
    await context.respond?.({
      text: '削除するメモリーがありませんでした。',
      response_type: 'ephemeral',
    })
    return
  }

  await context.respond?.({
    text: `${count}件のメモリーをすべて削除しました。\nまた日記を書き始めると、新しく覚えていきます。`,
    response_type: 'ephemeral',
  })
}

async function handleMemoryStatsCommand(
  userId: string,
  context: SlackAppContextWithOptionalRespond,
) {
  const stats = await getMemoryStats(userId)

  if (stats.totalCount === 0) {
    await context.respond?.({
      text: '覚えていることはまだありません。',
      response_type: 'ephemeral',
    })
    return
  }

  const typeLabels: Record<string, string> = {
    fact: '事実',
    preference: '好み',
    pattern: 'パターン',
    relationship: '関係',
    goal: '目標',
    emotion_trigger: '感情トリガー',
  }

  const byTypeStr = Object.entries(stats.byType)
    .map(([type, count]) => `  ${typeLabels[type] || type}: ${count}件`)
    .join('\n')

  const byCategoryStr = Object.entries(stats.byCategory)
    .map(
      ([cat, count]) =>
        `  ${CATEGORY_LABELS[cat as MemoryCategory] || cat}: ${count}件`,
    )
    .join('\n')

  const oldest = stats.oldestMemory
    ? dayjs(stats.oldestMemory).format('YYYY年M月D日')
    : '不明'
  const newest = stats.newestMemory
    ? dayjs(stats.newestMemory).format('YYYY年M月D日')
    : '不明'

  const text = `*メモリー統計*

総数: ${stats.totalCount}件
期間: ${oldest} 〜 ${newest}

*種類別*
${byTypeStr}

*カテゴリ別*
${byCategoryStr}`

  await context.respond?.({
    text,
    response_type: 'ephemeral',
  })
}

async function handleHelpCommand(context: SlackAppContextWithOptionalRespond) {
  const help = `*日記コマンドヘルプ*

\`/diary today\` - 今日の日記を表示
\`/diary search キーワード\` - 日記を検索
\`/diary stats\` - 統計を表示
\`/diary export\` - CSVエクスポート
\`/diary reflection [日付]\` - AIふりかえりメモを表示
\`/diary memory\` - メモリー管理 (list/delete/clear/stats)
\`/diary music\` - 振り返りBGM生成 (generate/status/list)
\`/diary help\` - このヘルプを表示
`

  await context.respond?.({
    text: help,
    response_type: 'ephemeral',
  })
}
