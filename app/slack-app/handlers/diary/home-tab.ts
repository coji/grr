import type {
  ButtonAction,
  MessageBlockAction,
  SlackApp,
  SlackEdgeAppEnv,
} from 'slack-cloudflare-workers'
import dayjs from '~/lib/dayjs'
import { pickRandom } from '~/lib/utils'
import type {
  CharacterAction,
  CharacterEmotion,
} from '~/services/ai/character-generation'
import {
  generateCharacterReaction,
  type CharacterMessageContext,
} from '~/services/ai/character-generation'
import { getAttachmentStats, getEntryAttachments } from '~/services/attachments'
import {
  characterToConcept,
  getBondLevelDisplay,
  getCharacter,
  getProgressBar,
  recordInteraction,
  type InteractionType,
} from '~/services/character'
import { extractImageId, pickRandomPoolKey } from '~/services/character-image'
import { getHeldItems } from '~/services/character-items'
import {
  countUnreadEncounters,
  ensureWorkspaceId,
  getLatestAdventure,
  getRecentEncounters,
  markAdventureRead,
  markEncountersRead,
} from '~/services/character-social'
import { db } from '~/services/db'
import { getActiveMemories } from '~/services/memory'
import { buildCharacterImageBlockFromPoolId } from '~/slack-app/character-blocks'
import { getFileTypeEmoji } from './file-utils'
import { buildOnboardingBlocks } from './onboarding'
import { TOKYO_TZ } from './utils'

export function registerHomeTabHandler(app: SlackApp<SlackEdgeAppEnv>) {
  app.event('app_home_opened', async ({ payload, context }) => {
    const event = payload
    if (event.tab !== 'home') return

    const userId = event.user

    // ユーザーの設定を確認（オンボーディング判定のため）
    const settings = await db
      .selectFrom('userDiarySettings')
      .select('diaryChannelId')
      .where('userId', '=', userId)
      .executeTakeFirst()

    // diaryChannelId が設定されていない場合はオンボーディング画面を表示
    if (!settings?.diaryChannelId) {
      await context.client.views.publish({
        user_id: userId,
        view: {
          type: 'home',
          blocks: buildOnboardingBlocks(),
        },
      })
      return
    }

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

      // Pick a specific pool image for consistent display on tap-to-enlarge
      const homeTabPoolKey = await pickRandomPoolKey(
        userId,
        character.evolutionStage,
      )
      const homeTabImageId = homeTabPoolKey
        ? extractImageId(homeTabPoolKey)
        : null
      const homeTabImageBlock = buildCharacterImageBlockFromPoolId(
        userId,
        homeTabImageId,
        `${character.characterName}の画像`,
      )

      blocks.push(
        {
          type: 'divider',
        },
        homeTabImageBlock,
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

    // Track workspace ID for social features
    if (character) {
      // team_id is available in the raw event payload but not in the typed interface
      const teamId = (payload as unknown as { team_id?: string }).team_id
      if (teamId) {
        ensureWorkspaceId(userId, teamId).catch((err) =>
          console.error('Failed to update workspace ID:', err),
        )
      }
    }

    // ============================================
    // Social Events Section (encounters, adventures, items)
    // ============================================
    if (character) {
      const socialBlocks = await buildSocialBlocks(userId)
      blocks.push(...socialBlocks)
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

    // ユーザーのタイムゾーンを取得
    let userTimezone = 'Asia/Tokyo'
    try {
      const userInfo = await context.client.users.info({ user: userId })
      if (userInfo.ok && userInfo.user?.tz) {
        userTimezone = userInfo.user.tz
      }
    } catch (error) {
      console.error('Failed to get user timezone:', error)
    }

    // タイムゾーンの短縮表示名を作成
    const tzShortName =
      userTimezone.split('/').pop()?.replace('_', ' ') || userTimezone

    const reminderHour = settings?.reminderHour ?? 21
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
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `🌍 タイムゾーン: *${tzShortName}* (Slackの設定に連動)`,
              },
            ],
          },
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
            hint: {
              type: 'plain_text',
              text: `あなたのタイムゾーン (${tzShortName}) での時刻`,
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
    // Pick a random spot to pet for variety
    const petFlavor = pickRandom(PET_FLAVORS)

    await handleCharacterInteractionModal(
      action.user.id,
      action.trigger_id,
      context.client,
      {
        interactionType: 'pet',
        messageContext: 'pet',
        emotion: 'love',
        action: 'pet',
        altText: (name) => `${name}の${petFlavor.spot}をなでている`,
        flavorDescription: petFlavor.description,
        flavorSpot: petFlavor.spot,
      },
    )
  })

  // キャラクターインタラクション: 話しかける
  app.action('character_talk', async ({ payload, context }) => {
    const action = payload as MessageBlockAction<ButtonAction>
    // Pick a random conversation topic for variety
    const talkFlavor = pickRandom(TALK_FLAVORS)
    const talkEmotions: CharacterEmotion[] = ['happy', 'excited', 'shy']
    const randomEmotion = pickRandom(talkEmotions)

    await handleCharacterInteractionModal(
      action.user.id,
      action.trigger_id,
      context.client,
      {
        interactionType: 'talk',
        messageContext: 'talk',
        emotion: randomEmotion,
        action: 'talk',
        altText: (name) => `${name}と会話している`,
        flavorDescription: talkFlavor.description,
        flavorTopic: talkFlavor.topic,
      },
    )
  })
}

// ============================================
// Interaction Handler Helper (Modal version for Home Tab)
// ============================================

// Reaction tiers with probabilities and multipliers
// Titles are now LLM-generated, so we only store probability/multiplier
interface ReactionTier {
  name: 'normal' | 'good' | 'great' | 'legendary'
  probability: number
  multiplier: number
}

const REACTION_TIERS: ReactionTier[] = [
  { name: 'normal', probability: 0.5, multiplier: 1 },
  { name: 'good', probability: 0.3, multiplier: 1.5 },
  { name: 'great', probability: 0.15, multiplier: 2 },
  { name: 'legendary', probability: 0.05, multiplier: 3 },
]

// Pet reaction flavors for LLM context - physical/sensory reactions
const PET_FLAVORS = [
  {
    mood: 'headpat',
    description: '頭をなでられている。気持ちよさそう、目を細めている',
    spot: '頭',
  },
  {
    mood: 'cheek',
    description: 'ほっぺをなでられている。ぷにぷに、照れて赤くなる',
    spot: 'ほっぺ',
  },
  {
    mood: 'chin',
    description: 'あごの下をなでられている。うっとり、ゴロゴロ言いそう',
    spot: 'あご',
  },
  {
    mood: 'back',
    description: '背中をなでられている。安心してリラックス',
    spot: '背中',
  },
  {
    mood: 'belly',
    description: 'おなかをなでられている。くすぐったいけど嬉しい',
    spot: 'おなか',
  },
  {
    mood: 'fluffy',
    description: 'ふわふわの部分をもふもふされている。幸せそう',
    spot: 'ふわふわ',
  },
]

// Talk reaction flavors for LLM context - conversation starters
const TALK_FLAVORS = [
  {
    mood: 'greeting',
    description: '挨拶から始まる会話。時間帯に合わせた声かけ',
    topic: '挨拶',
  },
  {
    mood: 'question',
    description: 'ユーザーに質問したい。今日のこと、最近のこと',
    topic: '質問',
  },
  {
    mood: 'share',
    description: '自分のことを話したい。今日見つけたこと、考えたこと',
    topic: 'シェア',
  },
  {
    mood: 'encourage',
    description: '応援・励まし。ユーザーの頑張りを認める',
    topic: '応援',
  },
  {
    mood: 'playful',
    description: 'なぞなぞやクイズを出したい。遊び心',
    topic: '遊び',
  },
  {
    mood: 'memory',
    description: 'ユーザーの過去の日記や思い出について話す',
    topic: '思い出',
  },
]

function pickReactionTier(): ReactionTier {
  const roll = Math.random()
  let cumulative = 0
  for (const tier of REACTION_TIERS) {
    cumulative += tier.probability
    if (roll < cumulative) return tier
  }
  return REACTION_TIERS[0]
}

interface SlackClient {
  views: {
    open: (params: {
      trigger_id: string
      // biome-ignore lint/suspicious/noExplicitAny: Slack view type
      view: any
      // biome-ignore lint/suspicious/noExplicitAny: Slack response type
    }) => Promise<{ ok: boolean; view?: { id?: string }; [key: string]: any }>
    update: (params: {
      view_id: string
      // biome-ignore lint/suspicious/noExplicitAny: Slack view type
      view: any
    }) => Promise<unknown>
  }
}

async function handleCharacterInteractionModal(
  userId: string,
  triggerId: string,
  client: SlackClient,
  opts: {
    interactionType: InteractionType
    messageContext: 'pet' | 'talk'
    emotion: CharacterEmotion
    action: CharacterAction
    altText: (characterName: string) => string
    flavorDescription?: string
    flavorSpot?: string
    flavorTopic?: string
  },
): Promise<void> {
  // Quick check for character existence (fast, no AI call)
  const character = await getCharacter(userId)
  if (!character) {
    await client.views.open({
      trigger_id: triggerId,
      view: {
        type: 'modal',
        title: { type: 'plain_text', text: 'あれ？' },
        close: { type: 'plain_text', text: '閉じる' },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '🥚 まだキャラクターがいないよ。\n日記を書いて育ててみよう！',
            },
          },
        ],
      },
    })
    return
  }

  // Pick a specific pool image to use consistently throughout this interaction
  const poolKey = await pickRandomPoolKey(userId, character.evolutionStage)
  const poolImageId = poolKey ? extractImageId(poolKey) : null

  // Open a loading modal immediately to avoid 3-second timeout
  const isPet = opts.messageContext === 'pet'
  const loadingEmoji = isPet ? '🤚' : '💬'

  // More engaging loading states
  const petLoadingTexts = [
    `${character.characterName}の${opts.flavorSpot || '頭'}をなでなで...`,
    `${opts.flavorSpot || '頭'}に手を伸ばして...`,
    `そーっとなでてみる...`,
  ]
  const talkLoadingTexts = [
    `${character.characterName}がこっちを見てる...`,
    `${character.characterName}の方を向いて...`,
    `おーい、${character.characterName}...`,
  ]
  const loadingText = isPet
    ? pickRandom(petLoadingTexts)
    : pickRandom(talkLoadingTexts)

  // Helper to build image block - uses specific pool image if available
  const buildImageBlock = (altText: string) =>
    buildCharacterImageBlockFromPoolId(userId, poolImageId, altText)

  const openResult = await client.views.open({
    trigger_id: triggerId,
    view: {
      type: 'modal',
      title: { type: 'plain_text', text: `${loadingEmoji} ...` },
      close: { type: 'plain_text', text: '閉じる' },
      blocks: [
        buildImageBlock(`${character.characterName}の画像`),
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${character.characterName}* ${character.characterEmoji}\n_${loadingText}_`,
          },
        },
      ],
    },
  })

  // Get the view_id for updating later
  const viewId = openResult.view?.id
  if (!viewId) {
    console.error('Failed to get view_id from modal open response')
    return
  }

  // Now do the heavy work (AI generation, etc.)
  try {
    // Pick reaction tier and flavor
    const tier = pickReactionTier()
    const flavor =
      opts.messageContext === 'pet'
        ? pickRandom(PET_FLAVORS)
        : pickRandom(TALK_FLAVORS)

    const { pointsEarned } = await recordInteraction({
      userId,
      interactionType: opts.interactionType,
    })

    // Apply bonus points based on tier multiplier
    const bonusInteractions = Math.floor(tier.multiplier) - 1
    for (let i = 0; i < bonusInteractions; i++) {
      await recordInteraction({
        userId,
        interactionType: opts.interactionType,
        metadata: { bonus: true, tier: tier.name },
      })
    }

    const totalPoints = Math.floor(pointsEarned * tier.multiplier)
    const concept = characterToConcept(character)

    // Build rich context for varied responses
    const richContext = await buildRichContext(userId, character)

    // Generate reaction with LLM (message + title + emoji)
    const reactionContext: CharacterMessageContext & {
      reactionIntensity: ReactionTier['name']
    } = {
      concept,
      evolutionStage: character.evolutionStage,
      happiness: character.happiness,
      energy: character.energy,
      context: opts.messageContext,
      additionalContext: opts.flavorDescription || flavor.description,
      userId,
      reactionIntensity: tier.name,
      ...richContext,
    }
    const reaction = await generateCharacterReaction(reactionContext)

    // Use LLM-generated title, with emoji for special tiers
    const modalTitle =
      tier.name === 'legendary'
        ? `✨${reaction.reactionTitle}✨`
        : tier.name === 'great'
          ? `🎉${reaction.reactionTitle}`
          : reaction.reactionTitle

    // Build reaction blocks - different layout for pet vs talk
    // Use the same pool image from the loading modal for consistent image
    // biome-ignore lint/suspicious/noExplicitAny: Slack block types
    const blocks: any[] = [
      buildImageBlock(opts.altText(character.characterName)),
    ]

    if (opts.messageContext === 'pet') {
      // Pet: emphasize physical sensation and sound
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${character.characterName}* ${reaction.reactionEmoji}\n\n> ${reaction.message}`,
        },
      })
    } else {
      // Talk: more conversational with speech bubble style
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${character.characterName}* ${reaction.reactionEmoji}`,
        },
      })
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `💬 「${reaction.message}」`,
        },
      })
    }

    // Add tier celebration for good reactions (using LLM-generated text)
    if (tier.name !== 'normal' && reaction.tierCelebration) {
      const celebrationEmoji =
        tier.name === 'legendary' ? '🌟' : tier.name === 'great' ? '🎉' : '💫'
      const multiplierText =
        tier.multiplier > 1 ? ` (${tier.multiplier}倍ボーナス！)` : ''
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `${celebrationEmoji} *${reaction.tierCelebration}*${multiplierText}`,
          },
        ],
      })
    }

    // Add points and stats
    const updatedCharacter = await getCharacter(userId)
    const happiness = updatedCharacter?.happiness ?? character.happiness
    const energy = updatedCharacter?.energy ?? character.energy

    blocks.push(
      { type: 'divider' },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `🎁 *+${totalPoints}ポイント*　　💗 ${happiness}%　　⚡ ${energy}%`,
          },
        ],
      },
    )

    // Update the modal with the actual content
    await client.views.update({
      view_id: viewId,
      view: {
        type: 'modal',
        title: { type: 'plain_text', text: modalTitle },
        close: { type: 'plain_text', text: '閉じる' },
        blocks,
      },
    })
  } catch (error) {
    console.error('Error generating character reaction:', error)
    // Update modal with error message
    await client.views.update({
      view_id: viewId,
      view: {
        type: 'modal',
        title: { type: 'plain_text', text: 'エラー' },
        close: { type: 'plain_text', text: '閉じる' },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `😢 ${character.characterName}の反応を生成できませんでした。\nもう一度試してみてね！`,
            },
          },
        ],
      },
    })
  }
}

// ============================================
// Rich Context Builder for Varied Responses
// ============================================

type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night'

function getTimeOfDay(): TimeOfDay {
  const hour = dayjs().tz(TOKYO_TZ).hour()
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 17) return 'afternoon'
  if (hour >= 17 && hour < 21) return 'evening'
  return 'night'
}

interface RichContext {
  timeOfDay: TimeOfDay
  recentMood?: string
  daysSinceLastInteraction?: number
  userMemories?: string[]
}

async function buildRichContext(
  userId: string,
  character: { lastInteractedAt: string | null },
): Promise<RichContext> {
  const context: RichContext = {
    timeOfDay: getTimeOfDay(),
  }

  // Get recent diary mood
  const recentEntry = await db
    .selectFrom('diaryEntries')
    .select(['moodLabel', 'moodEmoji'])
    .where('userId', '=', userId)
    .orderBy('entryDate', 'desc')
    .limit(1)
    .executeTakeFirst()

  if (recentEntry?.moodLabel) {
    context.recentMood =
      `${recentEntry.moodEmoji || ''} ${recentEntry.moodLabel}`.trim()
  }

  // Calculate days since last interaction
  if (character.lastInteractedAt) {
    const lastInteraction = dayjs(character.lastInteractedAt)
    const now = dayjs().tz(TOKYO_TZ)
    const daysSince = now.diff(lastInteraction, 'day')
    if (daysSince > 0) {
      context.daysSinceLastInteraction = daysSince
    }
  }

  // Get user memories for personalization
  const memories = await getActiveMemories(userId)
  if (memories.length > 0) {
    context.userMemories = memories
      .filter((m) => ['preference', 'fact', 'pattern'].includes(m.memoryType))
      .slice(0, 5)
      .map((m) => m.content)
  }

  return context
}

// ============================================
// Social Blocks Builder
// ============================================

// biome-ignore lint/suspicious/noExplicitAny: dynamic Slack block types
async function buildSocialBlocks(userId: string): Promise<any[]> {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic block types
  const blocks: any[] = []

  // --- Recent Encounters ---
  const encounters = await getRecentEncounters(userId, 3)
  const unreadCount = await countUnreadEncounters(userId)

  if (encounters.length > 0) {
    const headerText =
      unreadCount > 0
        ? `おでかけレポート (${unreadCount}件の新着)`
        : 'おでかけレポート'

    blocks.push(
      { type: 'divider' },
      {
        type: 'header',
        text: { type: 'plain_text', text: headerText, emoji: true },
      },
    )

    for (const encounter of encounters) {
      const isUserA = encounter.characterAUserId === userId
      const otherUserId = isUserA
        ? encounter.characterBUserId
        : encounter.characterAUserId
      const isUnread = isUserA ? !encounter.readByA : !encounter.readByB

      // Get other character's info
      const otherChar = await db
        .selectFrom('userCharacters')
        .select(['characterName', 'characterEmoji'])
        .where('userId', '=', otherUserId)
        .executeTakeFirst()

      const otherName = otherChar
        ? `${otherChar.characterEmoji} ${otherChar.characterName}`
        : 'だれか'

      const locationTag = encounter.locationName
        ? ` _${encounter.locationName}にて_`
        : ''

      const dateStr = dayjs(encounter.createdAt).tz(TOKYO_TZ).format('M/D')
      const newBadge = isUnread ? ' *NEW*' : ''

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${newBadge} *${dateStr}* ${otherName}と会ったよ！${locationTag}\n${encounter.episodeText}`,
        },
      })
    }

    // Mark as read after displaying
    markEncountersRead(userId).catch((err) =>
      console.error('Failed to mark encounters read:', err),
    )
  }

  // --- Latest Adventure ---
  const adventureData = await getLatestAdventure(userId)
  if (adventureData) {
    const { adventure, participation } = adventureData
    const isUnread = !participation.isRead
    const adventureHeader = isUnread
      ? `${adventure.themeEmoji} 冒険レポート *NEW*`
      : `${adventure.themeEmoji} 冒険レポート`

    blocks.push(
      { type: 'divider' },
      {
        type: 'header',
        text: { type: 'plain_text', text: adventureHeader, emoji: true },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${adventure.themeName}*\n${adventure.mainEpisode}`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `あなたの役割: ${participation.roleText}\n${participation.highlightText}`,
          },
        ],
      },
    )

    if (isUnread) {
      markAdventureRead(adventure.id, userId).catch((err) =>
        console.error('Failed to mark adventure read:', err),
      )
    }
  }

  // --- Held Items ---
  const items = await getHeldItems(userId)
  if (items.length > 0) {
    // Separate decorated and regular items
    const decoratedItems = items.filter((item) => item.isDecorated === 1)
    const regularItems = items.filter((item) => item.isDecorated !== 1)

    blocks.push(
      { type: 'divider' },
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `もちもの (${items.length})`,
          emoji: true,
        },
      },
    )

    // Show decorated items first with special styling
    if (decoratedItems.length > 0) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `✨ *おへやにかざってるもの* (${decoratedItems.length})`,
          },
        ],
      })

      for (const item of decoratedItems.slice(0, 3)) {
        const origin = item.receivedFromUserId
          ? 'もらいもの'
          : '散歩中に見つけた'

        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🏠 ${item.itemEmoji} *${item.itemName}*  _${origin}_`,
          },
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: 'しまう', emoji: true },
            action_id: 'decorate_item_select',
            value: item.id,
          },
        })
      }
    }

    // Show regular items with appropriate actions
    for (const item of regularItems.slice(0, 5)) {
      const isReceived = !!item.receivedFromUserId
      const origin = isReceived ? 'もらいもの' : '散歩中に見つけた'

      if (isReceived) {
        // Received items: show たべる and かざる buttons
        blocks.push(
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${item.itemEmoji} *${item.itemName}*  _${origin}_`,
            },
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: 'たべる 🍴', emoji: true },
                action_id: 'eat_item_select',
                value: item.id,
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: 'かざる 🏠', emoji: true },
                action_id: 'decorate_item_select',
                value: item.id,
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: 'あげる', emoji: true },
                action_id: 'gift_item_select',
                value: item.id,
              },
            ],
          },
        )
      } else {
        // Found items: show あげる button only
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${item.itemEmoji} *${item.itemName}*  _${origin}_`,
          },
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: 'あげる', emoji: true },
            action_id: 'gift_item_select',
            value: item.id,
          },
        })
      }
    }
  }

  return blocks
}
