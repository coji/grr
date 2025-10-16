import type {
  SlackApp,
  SlackAppContextWithOptionalRespond,
  SlackEdgeAppEnv,
} from 'slack-cloudflare-workers'
import dayjs from '~/lib/dayjs'
import { db } from '~/services/db'
import { TOKYO_TZ } from './utils'

export function registerSlashCommandHandler(app: SlackApp<SlackEdgeAppEnv>) {
  app.command('/diary', async ({ payload, context }) => {
    const command = payload
    const userId = command.user_id
    const text = command.text.trim()
    const args = text.split(/\s+/)
    const subcommand = args[0]?.toLowerCase() || 'help'

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

  await context.respond?.({
    text: `*${date} の日記*\n気分: ${mood}\n\n${detail}`,
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

  const entries = await db
    .selectFrom('diaryEntries')
    .selectAll()
    .where('userId', '=', userId)
    .where('detail', 'like', `%${keyword}%`)
    .orderBy('entryDate', 'desc')
    .limit(10)
    .execute()

  if (entries.length === 0) {
    await context.respond?.({
      text: `「${keyword}」を含むエントリは見つかりませんでした。`,
      response_type: 'ephemeral',
    })
    return
  }

  const results = entries
    .map((entry) => {
      const date = dayjs(entry.entryDate).format('M月D日(ddd)')
      const mood = entry.moodEmoji || '😶'
      const preview =
        entry.detail && entry.detail.length > 80
          ? `${entry.detail.slice(0, 80)}...`
          : entry.detail || '_詳細なし_'
      return `• *${date} ${mood}*\n  ${preview}`
    })
    .join('\n\n')

  await context.respond?.({
    text: `*「${keyword}」の検索結果 (${entries.length}件)*\n\n${results}`,
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

async function handleHelpCommand(context: SlackAppContextWithOptionalRespond) {
  const help = `*日記コマンドヘルプ*

\`/diary today\` - 今日の日記を表示
\`/diary search キーワード\` - 日記を検索
\`/diary stats\` - 統計を表示
\`/diary export\` - CSVエクスポート
\`/diary help\` - このヘルプを表示
`

  await context.respond?.({
    text: help,
    response_type: 'ephemeral',
  })
}
