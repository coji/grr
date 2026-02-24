import type {
  ButtonAction,
  MessageBlockAction,
  SlackApp,
  SlackEdgeAppEnv,
} from 'slack-cloudflare-workers'
import dayjs from '~/lib/dayjs'
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
import { db } from '~/services/db'
import { getActiveMemories } from '~/services/memory'
import {
  buildCharacterImageBlock,
  buildInteractiveCharacterImageBlock,
} from '~/slack-app/character-blocks'
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
    await handleCharacterInteractionModal(
      action.user.id,
      action.trigger_id,
      context.client,
      {
        interactionType: 'pet',
        messageContext: 'pet',
        emotion: 'love',
        action: 'pet',
        altText: (name) => `${name}が撫でられている`,
      },
    )
  })

  // キャラクターインタラクション: 話しかける
  app.action('character_talk', async ({ payload, context }) => {
    const action = payload as MessageBlockAction<ButtonAction>
    const emotions: CharacterEmotion[] = ['happy', 'excited', 'shy']
    const randomEmotion = emotions[Math.floor(Math.random() * emotions.length)]

    await handleCharacterInteractionModal(
      action.user.id,
      action.trigger_id,
      context.client,
      {
        interactionType: 'talk',
        messageContext: 'talk',
        emotion: randomEmotion,
        action: 'talk',
        altText: (name) => `${name}が話している`,
      },
    )
  })
}

// ============================================
// Interaction Handler Helper (Modal version for Home Tab)
// ============================================

// Reaction tiers with probabilities and multipliers
interface ReactionTier {
  name: string
  probability: number
  multiplier: number
  petTitles: string[]
  talkTitles: string[]
  emoji: string
}

const REACTION_TIERS: ReactionTier[] = [
  {
    name: 'normal',
    probability: 0.5,
    multiplier: 1,
    petTitles: ['なでなで', 'よしよし', 'いいこいいこ'],
    talkTitles: ['おしゃべり', 'ふむふむ', 'うんうん'],
    emoji: '',
  },
  {
    name: 'good',
    probability: 0.3,
    multiplier: 1.5,
    petTitles: ['気持ちいい〜', 'うっとり', 'ほわわ〜ん'],
    talkTitles: ['話が弾む！', '楽しいね', 'わくわく'],
    emoji: '💫',
  },
  {
    name: 'great',
    probability: 0.15,
    multiplier: 2,
    petTitles: ['ご機嫌MAX！', 'しあわせ〜', 'とろける〜'],
    talkTitles: ['大盛り上がり！', '最高の会話！', 'すごく楽しい！'],
    emoji: '🎉',
  },
  {
    name: 'legendary',
    probability: 0.05,
    multiplier: 3,
    petTitles: ['✨奇跡のなでなで✨', '💖運命の瞬間💖', '🌟伝説のもふもふ🌟'],
    talkTitles: ['✨心が通じた✨', '💫魂の会話💫', '🌟運命の出会い🌟'],
    emoji: '✨',
  },
]

// Pet reaction flavors for LLM context
const PET_FLAVORS = [
  { mood: 'happy', description: '喜んでいる、嬉しそう' },
  { mood: 'shy', description: '照れている、恥ずかしそう' },
  { mood: 'ticklish', description: 'くすぐったがっている' },
  { mood: 'sleepy', description: '眠くなってきた、うとうと' },
  { mood: 'loving', description: '甘えている、大好き' },
  { mood: 'playful', description: 'はしゃいでいる、遊びたい' },
]

// Talk reaction flavors for LLM context
const TALK_FLAVORS = [
  { mood: 'curious', description: '興味津々、もっと聞きたい' },
  { mood: 'excited', description: 'テンション高い、わくわく' },
  { mood: 'thoughtful', description: '考え込んでいる、なるほど' },
  { mood: 'cheerful', description: '明るい、楽しそう' },
  { mood: 'supportive', description: '励ましてくれる、応援' },
  { mood: 'gossipy', description: '内緒話っぽい、ひそひそ' },
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

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

interface SlackClient {
  views: {
    open: (params: {
      trigger_id: string
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
  },
): Promise<void> {
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

  // Map tier name to reaction intensity
  const reactionIntensity = tier.name as 'normal' | 'good' | 'great' | 'legendary'

  // Generate reaction with LLM (message + title + emoji)
  const reactionContext: CharacterMessageContext & {
    reactionIntensity: 'normal' | 'good' | 'great' | 'legendary'
  } = {
    concept,
    evolutionStage: character.evolutionStage,
    happiness: character.happiness,
    energy: character.energy,
    context: opts.messageContext,
    additionalContext: flavor.description,
    userId,
    reactionIntensity,
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

  // Build reaction blocks
  // biome-ignore lint/suspicious/noExplicitAny: Slack block types
  const blocks: any[] = [
    buildInteractiveCharacterImageBlock(
      userId,
      opts.altText(character.characterName),
    ),
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${character.characterName}* ${reaction.reactionEmoji}\n「${reaction.message}」`,
      },
    },
  ]

  // Add tier celebration for good reactions (using LLM-generated text)
  if (tier.name !== 'normal' && reaction.tierCelebration) {
    const celebrationEmoji =
      tier.name === 'legendary' ? '🌟' : tier.name === 'great' ? '🎉' : '💫'
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `${celebrationEmoji} *${reaction.tierCelebration}* ${celebrationEmoji} ポイント${tier.multiplier}倍！`,
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

  await client.views.open({
    trigger_id: triggerId,
    view: {
      type: 'modal',
      title: { type: 'plain_text', text: modalTitle },
      close: { type: 'plain_text', text: '閉じる' },
      blocks,
    },
  })
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
    context.recentMood = `${recentEntry.moodEmoji || ''} ${recentEntry.moodLabel}`.trim()
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
