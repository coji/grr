import type {
  ButtonAction,
  MessageBlockAction,
  SlackApp,
  SlackEdgeAppEnv,
} from 'slack-cloudflare-workers'
import type { Respond } from 'slack-edge'
import dayjs from '~/lib/dayjs'
import type {
  CharacterAction,
  CharacterEmotion,
} from '~/services/ai/character-generation'
import { generateCharacterMessage } from '~/services/ai/character-generation'
import { getAttachmentStats, getEntryAttachments } from '~/services/attachments'
import {
  characterToConcept,
  getBondLevelDisplay,
  getCharacter,
  getProgressBar,
  recordInteraction,
  type InteractionType,
} from '~/services/character'
import { db } from '~/services/db'
import {
  buildCharacterImageBlock,
  buildInteractiveCharacterImageBlock,
} from '~/slack-app/character-blocks'
import { getFileTypeEmoji } from './file-utils'
import { TOKYO_TZ } from './utils'

export function registerHomeTabHandler(app: SlackApp<SlackEdgeAppEnv>) {
  app.event('app_home_opened', async ({ payload, context }) => {
    const event = payload
    if (event.tab !== 'home') return

    const userId = event.user

    // 今日の日付
    const today = dayjs().tz(TOKYO_TZ).format('YYYY-MM-DD')

    // 最近7日分のエントリを取得
    const recentEntries = await db
      .selectFrom('diaryEntries')
      .selectAll()
      .where('userId', '=', userId)
      .orderBy('entryDate', 'desc')
      .limit(7)
      .execute()

    // 今週の気分統計
    const weekStart = dayjs().tz(TOKYO_TZ).startOf('week').format('YYYY-MM-DD')
    const weekEntries = recentEntries.filter(
      (entry) => entry.entryDate >= weekStart,
    )

    const moodCounts = weekEntries.reduce(
      (acc, entry) => {
        if (entry.moodValue) {
          acc[entry.moodValue] = (acc[entry.moodValue] || 0) + 1
        }
        return acc
      },
      {} as Record<number, number>,
    )

    const moodStats =
      Object.keys(moodCounts).length > 0
        ? Object.entries(moodCounts)
            .map(([value, count]) => {
              const label =
                value === '3'
                  ? 'ほっと安心'
                  : value === '2'
                    ? 'ふつうの日'
                    : 'おつかれさま'
              return `${label}: ${count}日`
            })
            .join(' | ')
        : '今週はまだ記録がありません'

    // ユーザーのキャラクターを取得
    const character = await getCharacter(userId)

    // Home Tab のビューを構築
    // biome-ignore lint/suspicious/noExplicitAny: dynamic block types
    const blocks: any[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '📔 あなたの日記',
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `こんにちは！\n今週の気分: ${moodStats}`,
        },
      },
    ]

    // キャラクターセクション
    if (character) {
      const happinessBar = getProgressBar(character.happiness)
      const energyBar = getProgressBar(character.energy)
      const bondLevel = getBondLevelDisplay(character.bondLevel)

      blocks.push(
        {
          type: 'divider',
        },
        buildCharacterImageBlock(userId, `${character.characterName}の画像`),
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*あなたの相棒* ${character.characterEmoji}\n*${character.characterName}* (${character.characterSpecies})`,
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `💗 ${happinessBar} ${character.happiness}% | ⚡ ${energyBar} ${character.energy}% | 🤝 絆 Lv.${bondLevel}`,
            },
          ],
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: 'なでる 🤚',
                emoji: true,
              },
              action_id: 'character_pet',
            },
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: '話しかける 💬',
                emoji: true,
              },
              action_id: 'character_talk',
            },
          ],
        },
      )
    }

    // メインアクションセクション
    blocks.push(
      {
        type: 'divider',
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '今日の日記を書く',
              emoji: true,
            },
            style: 'primary',
            action_id: 'open_diary_modal',
            value: today,
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '設定',
              emoji: true,
            },
            action_id: 'open_settings_modal',
          },
        ],
      },
      {
        type: 'divider',
      },
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '最近のエントリ',
          emoji: true,
        },
      },
    )

    // 最近のエントリをリスト表示
    if (recentEntries.length === 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '_まだエントリがありません。日記を書き始めましょう！_',
        },
      })
    } else {
      for (const entry of recentEntries) {
        const date = dayjs(entry.entryDate).format('M月D日(ddd)')
        const mood = entry.moodEmoji || '😶'
        const preview =
          entry.detail && entry.detail.length > 100
            ? `${entry.detail.slice(0, 100)}...`
            : entry.detail || '_詳細なし_'

        // Get attachment stats for this entry
        const stats = await getAttachmentStats(entry.id)
        const attachmentInfo =
          stats.total > 0
            ? ` 📎 ${stats.total}個のファイル${stats.images > 0 ? ` (画像${stats.images})` : ''}`
            : ''

        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${date} ${mood}*${attachmentInfo}\n${preview}`,
          },
        })
        blocks.push({
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: '見る',
                emoji: true,
              },
              action_id: 'view_diary_entry',
              value: entry.id,
              style: 'primary',
            },
          ],
        })
      }
    }

    await context.client.views.publish({
      user_id: userId,
      view: {
        type: 'home',
        blocks: blocks,
      },
    })
  })

  // ボタンアクションのハンドラー
  app.action('open_diary_modal', async ({ payload, context }) => {
    const action = payload as MessageBlockAction<ButtonAction>

    await context.client.views.open({
      trigger_id: action.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'diary_entry_modal',
        title: {
          type: 'plain_text',
          text: '日記を書く',
        },
        submit: {
          type: 'plain_text',
          text: '保存',
        },
        close: {
          type: 'plain_text',
          text: 'キャンセル',
        },
        blocks: [
          {
            type: 'input',
            block_id: 'entry_date',
            label: {
              type: 'plain_text',
              text: '日付',
            },
            element: {
              type: 'datepicker',
              action_id: 'date_value',
              initial_date: action.actions[0].value,
            },
          },
          {
            type: 'input',
            block_id: 'mood',
            label: {
              type: 'plain_text',
              text: '今日の気分',
            },
            element: {
              type: 'static_select',
              action_id: 'mood_value',
              placeholder: {
                type: 'plain_text',
                text: '気分を選択',
              },
              options: [
                {
                  text: {
                    type: 'plain_text',
                    text: '😄 ほっと安心',
                    emoji: true,
                  },
                  value: 'smile',
                },
                {
                  text: {
                    type: 'plain_text',
                    text: '😐 ふつうの日',
                    emoji: true,
                  },
                  value: 'neutral_face',
                },
                {
                  text: {
                    type: 'plain_text',
                    text: '😫 おつかれさま',
                    emoji: true,
                  },
                  value: 'tired_face',
                },
              ],
            },
          },
          {
            type: 'input',
            block_id: 'detail',
            label: {
              type: 'plain_text',
              text: '詳細',
            },
            element: {
              type: 'plain_text_input',
              action_id: 'detail_value',
              multiline: true,
              placeholder: {
                type: 'plain_text',
                text: '今日あったこと、感じたことを自由に書いてください',
              },
            },
            optional: true,
          },
        ],
      },
    })
  })

  app.action('open_settings_modal', async ({ payload, context }) => {
    const action = payload as MessageBlockAction<ButtonAction>
    const userId = action.user.id

    // 現在の設定を取得
    const settings = await db
      .selectFrom('userDiarySettings')
      .selectAll()
      .where('userId', '=', userId)
      .executeTakeFirst()

    const reminderHour = settings?.reminderHour ?? 13
    const reminderEnabled = settings?.reminderEnabled ?? 1
    const skipWeekends = settings?.skipWeekends ?? 0

    await context.client.views.open({
      trigger_id: action.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'diary_settings_modal',
        title: {
          type: 'plain_text',
          text: '日記設定',
        },
        submit: {
          type: 'plain_text',
          text: '保存',
        },
        close: {
          type: 'plain_text',
          text: 'キャンセル',
        },
        blocks: [
          {
            type: 'input',
            block_id: 'reminder_enabled',
            label: {
              type: 'plain_text',
              text: 'リマインダー',
            },
            element: {
              type: 'radio_buttons',
              action_id: 'reminder_enabled_value',
              initial_option: {
                text: {
                  type: 'plain_text',
                  text: reminderEnabled ? '有効' : '無効',
                },
                value: reminderEnabled.toString(),
              },
              options: [
                {
                  text: {
                    type: 'plain_text',
                    text: '有効',
                  },
                  value: '1',
                },
                {
                  text: {
                    type: 'plain_text',
                    text: '無効',
                  },
                  value: '0',
                },
              ],
            },
          },
          {
            type: 'input',
            block_id: 'reminder_hour',
            label: {
              type: 'plain_text',
              text: 'リマインダー時刻',
            },
            element: {
              type: 'static_select',
              action_id: 'reminder_hour_value',
              initial_option: {
                text: {
                  type: 'plain_text',
                  text: `${reminderHour}:00`,
                },
                value: reminderHour.toString(),
              },
              options: Array.from({ length: 24 }, (_, i) => ({
                text: {
                  type: 'plain_text',
                  text: `${i}:00`,
                },
                value: i.toString(),
              })),
            },
          },
          {
            type: 'input',
            block_id: 'skip_weekends',
            label: {
              type: 'plain_text',
              text: '週末スキップ',
            },
            element: {
              type: 'checkboxes',
              action_id: 'skip_weekends_value',
              initial_options: skipWeekends
                ? [
                    {
                      text: {
                        type: 'plain_text',
                        text: '土日はリマインダーを送らない',
                      },
                      value: '1',
                    },
                  ]
                : [],
              options: [
                {
                  text: {
                    type: 'plain_text',
                    text: '土日はリマインダーを送らない',
                  },
                  value: '1',
                },
              ],
            },
          },
        ],
      },
    })
  })

  app.action('view_diary_entry', async ({ payload, context }) => {
    const action = payload as MessageBlockAction<ButtonAction>
    const entryId = action.actions[0].value

    const entry = await db
      .selectFrom('diaryEntries')
      .selectAll()
      .where('id', '=', entryId)
      .executeTakeFirst()

    if (!entry) return

    const date = dayjs(entry.entryDate).format('YYYY年M月D日(ddd)')
    const mood = entry.moodLabel || '未記録'
    const detail = entry.detail || '_詳細なし_'

    // Fetch attachments for this entry
    const attachments = await getEntryAttachments(entryId)

    // Build blocks with attachments
    // biome-ignore lint/suspicious/noExplicitAny: dynamic block types
    const blocks: any[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*日付:* ${date}\n*気分:* ${mood}\n\n${detail}`,
        },
      },
    ]

    // Add attachment blocks
    if (attachments.length > 0) {
      blocks.push({
        type: 'divider',
      })

      // Add inline images
      const images = attachments.filter((a) => a.fileType === 'image')
      for (const image of images) {
        if (image.slackUrlPrivate) {
          blocks.push({
            type: 'image',
            image_url: image.slackUrlPrivate,
            alt_text: image.fileName,
          })
        }
      }

      // Add file links for videos and documents
      const files = attachments.filter((a) => a.fileType !== 'image')
      if (files.length > 0) {
        const fileLinks = files
          .map((file) => {
            const emoji = getFileTypeEmoji(file.fileType)
            const link = file.slackPermalink || file.slackUrlPrivate
            return `${emoji} <${link}|${file.fileName}>`
          })
          .join('\n')

        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*添付ファイル:*\n${fileLinks}`,
          },
        })
      }
    }

    await context.client.views.open({
      trigger_id: action.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'view_diary_entry_modal',
        title: {
          type: 'plain_text',
          text: '日記を見る',
        },
        close: {
          type: 'plain_text',
          text: '閉じる',
        },
        // biome-ignore lint/suspicious/noExplicitAny: dynamic block types
        blocks: blocks as any,
      },
    })
  })

  // キャラクターインタラクション: なでる
  app.action('character_pet', async ({ payload, context }) => {
    const action = payload as MessageBlockAction<ButtonAction>
    await handleCharacterInteraction(action.user.id, context.respond, {
      interactionType: 'pet',
      messageContext: 'pet',
      emotion: 'love',
      action: 'pet',
      altText: (name) => `${name}が撫でられている`,
    })
  })

  // キャラクターインタラクション: 話しかける
  app.action('character_talk', async ({ payload, context }) => {
    const action = payload as MessageBlockAction<ButtonAction>
    const emotions: CharacterEmotion[] = ['happy', 'excited', 'shy']
    const randomEmotion = emotions[Math.floor(Math.random() * emotions.length)]

    await handleCharacterInteraction(action.user.id, context.respond, {
      interactionType: 'talk',
      messageContext: 'talk',
      emotion: randomEmotion,
      action: 'talk',
      altText: (name) => `${name}が話している`,
    })
  })
}

// ============================================
// Interaction Handler Helper
// ============================================

async function handleCharacterInteraction(
  userId: string,
  respond: Respond | undefined,
  opts: {
    interactionType: InteractionType
    messageContext: 'pet' | 'talk'
    emotion: CharacterEmotion
    action: CharacterAction
    altText: (characterName: string) => string
  },
): Promise<void> {
  const character = await getCharacter(userId)
  if (!character) {
    if (respond) {
      await respond({
        text: 'まだキャラクターがいないよ。日記を書いて育ててみよう！',
        response_type: 'ephemeral',
      })
    }
    return
  }

  const { pointsEarned } = await recordInteraction({
    userId,
    interactionType: opts.interactionType,
  })

  const concept = characterToConcept(character)
  const message = await generateCharacterMessage({
    concept,
    evolutionStage: character.evolutionStage,
    happiness: character.happiness,
    energy: character.energy,
    context: opts.messageContext,
  })

  if (respond) {
    await respond({
      text: `${character.characterName}: ${message} (+${pointsEarned}ポイント)`,
      response_type: 'ephemeral',
      blocks: [
        buildInteractiveCharacterImageBlock(
          userId,
          opts.altText(character.characterName),
        ),
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${character.characterName}*: ${message}`,
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `_+${pointsEarned}ポイント獲得！_`,
            },
          ],
        },
      ],
    })
  }
}
