import { SlackAPIClient } from 'slack-edge'
import dayjs from '~/lib/dayjs'
import { generateWeeklyDigest } from '~/services/ai'
import { getCharacter, getCharacterPersonaInfo } from '~/services/character'
import { extractImageId, pickRandomPoolKey } from '~/services/character-image'
import { db } from '~/services/db'
import { buildCharacterImageBlockFromPoolId } from './character-blocks'

const TOKYO_TZ = 'Asia/Tokyo'

/**
 * 週次ダイジェストを送信する
 * 毎週金曜日の夜に実行
 */
export const sendWeeklyDigest = async (env: Env) => {
  console.log('sendWeeklyDigest started')
  const client = new SlackAPIClient(env.SLACK_BOT_TOKEN)

  const tokyoNow = dayjs().tz(TOKYO_TZ)
  const weekStart = tokyoNow.startOf('week').format('YYYY-MM-DD')
  const weekEnd = tokyoNow.endOf('week').format('YYYY-MM-DD')

  // 今週エントリがあるユーザーを取得
  const usersWithEntries = await db
    .selectFrom('diaryEntries')
    .select('userId')
    .distinct()
    .where('entryDate', '>=', weekStart)
    .where('entryDate', '<=', weekEnd)
    .execute()

  for (const { userId } of usersWithEntries) {
    try {
      // 今週のエントリを取得
      const entries = await db
        .selectFrom('diaryEntries')
        .selectAll()
        .where('userId', '=', userId)
        .where('entryDate', '>=', weekStart)
        .where('entryDate', '<=', weekEnd)
        .orderBy('entryDate', 'asc')
        .execute()

      if (entries.length === 0) continue

      // Get character info for personalized digest
      const characterInfo = await getCharacterPersonaInfo(userId)

      // AIでダイジェストを生成
      const digestMessage = await generateWeeklyDigest({
        characterInfo,
        userId,
        entries: entries.map((e) => ({
          date: e.entryDate,
          moodLabel: e.moodLabel,
          detail: e.detail,
        })),
        weekStart,
        weekEnd,
      })

      // ユーザーの日記チャンネルを取得
      const channelId = entries[0].channelId

      // Build character image block if user has a character
      const character = await getCharacter(userId)
      // biome-ignore lint/suspicious/noExplicitAny: Slack Block Kit dynamic types
      let characterBlocks: any[] = []
      if (character) {
        const poolKey = await pickRandomPoolKey(
          userId,
          character.evolutionStage,
        )
        const imageId = poolKey ? extractImageId(poolKey) : null
        characterBlocks = [buildCharacterImageBlockFromPoolId(userId, imageId)]
      }

      // ダイジェストメッセージを送信
      await client.chat.postMessage({
        channel: channelId,
        text: `<@${userId}> ${digestMessage}`,
        blocks: [
          ...characterBlocks,
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: `📅 今週の振り返り (${dayjs(weekStart).format('M/D')} - ${dayjs(weekEnd).format('M/D')})`,
              emoji: true,
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `<@${userId}> ${digestMessage}`,
            },
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `今週は ${new Set(entries.map((e) => e.entryDate)).size}日記録しました`,
              },
            ],
          },
        ],
      })

      console.log(`Weekly digest sent to user ${userId}`)
    } catch (error) {
      console.error(`Failed to send weekly digest to user ${userId}`, error)
    }
  }

  console.log('sendWeeklyDigest completed')
}
