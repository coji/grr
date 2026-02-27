/**
 * Slack action handlers for character social features.
 *
 * Handles:
 * - Gift item selection (pick recipient)
 * - Gift confirmation
 */

import type {
  ButtonAction,
  MessageBlockAction,
  SlackApp,
  SlackEdgeAppEnv,
} from 'slack-cloudflare-workers'
import { getCharacter, updateCharacter } from '~/services/character'
import {
  decorateItem,
  eatItem,
  getGiftableItem,
  getOwnedItem,
  giftItem,
  unDecorateItem,
} from '~/services/character-items'
import { getWorkspaceCharacters } from '~/services/character-social'
import { db } from '~/services/db'
import { getUserDisplayName } from './utils'

export function registerSocialActionHandlers(app: SlackApp<SlackEdgeAppEnv>) {
  // Gift item: show recipient selector
  app.action('gift_item_select', async ({ payload, context }) => {
    const action = payload as MessageBlockAction<ButtonAction>
    const userId = action.user.id
    const itemDbId = action.actions[0].value

    const item = await getGiftableItem(itemDbId, userId)
    if (!item) return

    const character = await getCharacter(userId)
    if (!character?.workspaceId) return

    const workspaceChars = await getWorkspaceCharacters(character.workspaceId)
    const otherChars = workspaceChars.filter((c) => c.userId !== userId)

    if (otherChars.length === 0) {
      await context.client.views.open({
        trigger_id: action.trigger_id,
        view: {
          type: 'modal',
          title: { type: 'plain_text', text: 'おすそわけ' },
          close: { type: 'plain_text', text: '閉じる' },
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: 'まだ他のキャラクターがいないみたい...\nワークスペースの仲間が日記を始めるのを待ってね！',
              },
            },
          ],
        },
      })
      return
    }

    // Fetch owner display names for each character
    const optionsWithNames = await Promise.all(
      otherChars.slice(0, 10).map(async (c) => {
        const ownerName = await getUserDisplayName(c.userId, context.client)
        return {
          text: {
            type: 'plain_text' as const,
            text: `${c.characterEmoji} ${c.characterName}（${ownerName}）`,
            emoji: true as const,
          },
          value: c.userId,
        }
      }),
    )
    const options = optionsWithNames

    await context.client.views.open({
      trigger_id: action.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'gift_item_confirm',
        private_metadata: JSON.stringify({ itemDbId }),
        title: { type: 'plain_text', text: 'おすそわけ' },
        submit: { type: 'plain_text', text: 'あげる！' },
        close: { type: 'plain_text', text: 'やめる' },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${item.itemEmoji} *${item.itemName}* を誰にあげる？`,
            },
          },
          {
            type: 'input',
            block_id: 'recipient',
            label: {
              type: 'plain_text',
              text: 'あげる相手',
            },
            element: {
              type: 'static_select',
              action_id: 'recipient_value',
              placeholder: {
                type: 'plain_text',
                text: 'キャラクターを選ぶ',
              },
              options,
            },
          },
        ],
      },
    })
  })

  // Gift item: confirm and execute
  app.view(
    'gift_item_confirm',
    async () => {
      // ack only - actual processing in lazy handler
      return
    },
    async ({ context, payload }) => {
      const userId = payload.user.id

      const metadata = JSON.parse(payload.view.private_metadata || '{}')
      const itemDbId = metadata.itemDbId as string
      const recipientUserId =
        payload.view.state?.values?.recipient?.recipient_value?.selected_option
          ?.value

      if (!itemDbId || !recipientUserId) return

      // Get item info before gifting (it will be marked as gifted after)
      const item = await getGiftableItem(itemDbId, userId)
      if (!item) return

      const success = await giftItem(itemDbId, userId, recipientUserId)

      if (success) {
        const myChar = await getCharacter(userId)
        const theirChar = await getCharacter(recipientUserId)

        if (myChar && theirChar) {
          console.log(
            `${myChar.characterName} gifted item to ${theirChar.characterName}`,
          )

          // Send notification to recipient
          const recipientChannelId = await getDiaryChannelId(recipientUserId)
          if (recipientChannelId) {
            try {
              await context.client.chat.postMessage({
                channel: recipientChannelId,
                text: `${item.itemEmoji} おすそわけがとどいたよ！`,
                blocks: [
                  {
                    type: 'section',
                    text: {
                      type: 'mrkdwn',
                      text: `🎁 *おすそわけがとどいたよ！*\n\n${myChar.characterEmoji} *${myChar.characterName}* から ${item.itemEmoji} *${item.itemName}* をもらったよ！`,
                    },
                  },
                ],
              })
            } catch (error) {
              console.error(
                'Failed to send gift notification to recipient:',
                error,
              )
            }
          }

          // Send confirmation to sender
          const senderChannelId = await getDiaryChannelId(userId)
          if (senderChannelId) {
            try {
              await context.client.chat.postMessage({
                channel: senderChannelId,
                text: `${item.itemEmoji} おすそわけしたよ！`,
                blocks: [
                  {
                    type: 'section',
                    text: {
                      type: 'mrkdwn',
                      text: `✨ ${theirChar.characterEmoji} *${theirChar.characterName}* に ${item.itemEmoji} *${item.itemName}* をあげたよ！`,
                    },
                  },
                ],
              })
            } catch (error) {
              console.error(
                'Failed to send gift confirmation to sender:',
                error,
              )
            }
          }
        }
      }
    },
  )

  // Eat item: show confirmation modal
  app.action('eat_item_select', async ({ payload, context }) => {
    const action = payload as MessageBlockAction<ButtonAction>
    const userId = action.user.id
    const itemDbId = action.actions[0].value

    const item = await getOwnedItem(itemDbId, userId)
    if (!item) return

    await context.client.views.open({
      trigger_id: action.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'eat_item_confirm',
        private_metadata: JSON.stringify({ itemDbId }),
        title: { type: 'plain_text', text: 'たべる' },
        submit: { type: 'plain_text', text: 'いただきます！' },
        close: { type: 'plain_text', text: 'やめる' },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${item.itemEmoji} *${item.itemName}* をたべる？\n\nたべると元気になるよ！`,
            },
          },
        ],
      },
    })
  })

  // Eat item: confirm and execute
  app.view(
    'eat_item_confirm',
    async () => {
      // ack only
      return
    },
    async ({ context, payload }) => {
      const userId = payload.user.id
      const metadata = JSON.parse(payload.view.private_metadata || '{}')
      const itemDbId = metadata.itemDbId as string

      if (!itemDbId) return

      const item = await getOwnedItem(itemDbId, userId)
      if (!item) return

      const { success, happinessBonus } = await eatItem(itemDbId, userId)

      if (success) {
        const character = await getCharacter(userId)
        if (character) {
          // Update happiness
          const newHappiness = Math.min(
            100,
            character.happiness + happinessBonus,
          )
          await updateCharacter(userId, { happiness: newHappiness })

          // Send message to diary channel
          const channelId = await getDiaryChannelId(userId)
          if (channelId) {
            const eatMessages = [
              `もぐもぐ... ${item.itemEmoji} *${item.itemName}* おいしかった！`,
              `${item.itemEmoji} *${item.itemName}* をぱくっ！しあわせ〜`,
              `${item.itemEmoji} ごちそうさまでした！元気もりもり！`,
            ]
            const message =
              eatMessages[Math.floor(Math.random() * eatMessages.length)]

            try {
              await context.client.chat.postMessage({
                channel: channelId,
                text: message,
                blocks: [
                  {
                    type: 'section',
                    text: {
                      type: 'mrkdwn',
                      text: `🍴 ${message}\n_しあわせ +${happinessBonus}！_`,
                    },
                  },
                ],
              })
            } catch (error) {
              console.error('Failed to send eat confirmation:', error)
            }
          }
        }
      }
    },
  )

  // Decorate item: show confirmation modal
  app.action('decorate_item_select', async ({ payload, context }) => {
    const action = payload as MessageBlockAction<ButtonAction>
    const userId = action.user.id
    const itemDbId = action.actions[0].value

    const item = await getOwnedItem(itemDbId, userId)
    if (!item) return

    const isDecorated = item.isDecorated === 1

    await context.client.views.open({
      trigger_id: action.trigger_id,
      view: {
        type: 'modal',
        callback_id: isDecorated
          ? 'undecorate_item_confirm'
          : 'decorate_item_confirm',
        private_metadata: JSON.stringify({ itemDbId }),
        title: { type: 'plain_text', text: isDecorated ? 'しまう' : 'かざる' },
        submit: {
          type: 'plain_text',
          text: isDecorated ? 'しまう' : 'かざる！',
        },
        close: { type: 'plain_text', text: 'やめる' },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: isDecorated
                ? `${item.itemEmoji} *${item.itemName}* をしまう？`
                : `${item.itemEmoji} *${item.itemName}* をおへやにかざる？`,
            },
          },
        ],
      },
    })
  })

  // Decorate item: confirm and execute
  app.view(
    'decorate_item_confirm',
    async () => {
      // ack only
      return
    },
    async ({ context, payload }) => {
      const userId = payload.user.id
      const metadata = JSON.parse(payload.view.private_metadata || '{}')
      const itemDbId = metadata.itemDbId as string

      if (!itemDbId) return

      const item = await getOwnedItem(itemDbId, userId)
      if (!item) return

      const success = await decorateItem(itemDbId, userId)

      if (success) {
        const channelId = await getDiaryChannelId(userId)
        if (channelId) {
          const decorateMessages = [
            `${item.itemEmoji} *${item.itemName}* をおへやにかざったよ！`,
            `きらきら✨ ${item.itemEmoji} *${item.itemName}* がおへやを彩るよ！`,
            `${item.itemEmoji} *${item.itemName}* 、いいところにかざれた！`,
          ]
          const message =
            decorateMessages[
              Math.floor(Math.random() * decorateMessages.length)
            ]

          try {
            await context.client.chat.postMessage({
              channel: channelId,
              text: message,
              blocks: [
                {
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: `🏠 ${message}`,
                  },
                },
              ],
            })
          } catch (error) {
            console.error('Failed to send decorate confirmation:', error)
          }
        }
      }
    },
  )

  // Undecorate item: confirm and execute
  app.view(
    'undecorate_item_confirm',
    async () => {
      // ack only
      return
    },
    async ({ context, payload }) => {
      const userId = payload.user.id
      const metadata = JSON.parse(payload.view.private_metadata || '{}')
      const itemDbId = metadata.itemDbId as string

      if (!itemDbId) return

      const item = await getOwnedItem(itemDbId, userId)
      if (!item) return

      const success = await unDecorateItem(itemDbId, userId)

      if (success) {
        const channelId = await getDiaryChannelId(userId)
        if (channelId) {
          try {
            await context.client.chat.postMessage({
              channel: channelId,
              text: `${item.itemEmoji} ${item.itemName} をしまったよ`,
              blocks: [
                {
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: `📦 ${item.itemEmoji} *${item.itemName}* をしまったよ`,
                  },
                },
              ],
            })
          } catch (error) {
            console.error('Failed to send undecorate confirmation:', error)
          }
        }
      }
    },
  )
}

/**
 * Get the diary channel ID for a user.
 */
async function getDiaryChannelId(userId: string): Promise<string | null> {
  const result = await db
    .selectFrom('userDiarySettings')
    .select('diaryChannelId')
    .where('userId', '=', userId)
    .executeTakeFirst()

  return result?.diaryChannelId ?? null
}
