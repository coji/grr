/**
 * Slack action handlers for character social features.
 *
 * Handles:
 * - Gift item selection (pick recipient)
 * - Gift confirmation
 * - Interaction toggle in settings
 */

import type {
  ButtonAction,
  MessageBlockAction,
  SlackApp,
  SlackEdgeAppEnv,
} from 'slack-cloudflare-workers'
import { getCharacter } from '~/services/character'
import { giftItem } from '~/services/character-items'
import { getWorkspaceCharacters } from '~/services/character-social'
import { db } from '~/services/db'

export function registerSocialActionHandlers(app: SlackApp<SlackEdgeAppEnv>) {
  // Gift item: show recipient selector
  app.action('gift_item_select', async ({ payload, context }) => {
    const action = payload as MessageBlockAction<ButtonAction>
    const userId = action.user.id
    const itemDbId = action.actions[0].value

    // Get the item
    const item = await db
      .selectFrom('characterItems')
      .selectAll()
      .where('id', '=', itemDbId)
      .where('ownerUserId', '=', userId)
      .where('giftedToUserId', 'is', null)
      .executeTakeFirst()

    if (!item) return

    // Get the user's character for workspace ID
    const character = await getCharacter(userId)
    if (!character?.workspaceId) return

    // Get other characters in the workspace
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

    // Build options for recipient selection
    const options = otherChars.slice(0, 10).map((c) => ({
      text: {
        type: 'plain_text' as const,
        text: `${c.characterEmoji} ${c.characterName}`,
        emoji: true as const,
      },
      value: c.userId,
    }))

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
  app.view('gift_item_confirm', async ({ payload }) => {
    const userId = payload.user.id

    const metadata = JSON.parse(payload.view.private_metadata || '{}')
    const itemDbId = metadata.itemDbId as string
    const recipientUserId =
      payload.view.state?.values?.recipient?.recipient_value?.selected_option
        ?.value

    if (!itemDbId || !recipientUserId) return

    const success = await giftItem(itemDbId, userId, recipientUserId)

    if (success) {
      // Get both characters for a nice message
      const myChar = await getCharacter(userId)
      const theirChar = await getCharacter(recipientUserId)
      const item = await db
        .selectFrom('characterItems')
        .select(['itemName', 'itemEmoji'])
        .where('id', '=', itemDbId)
        .executeTakeFirst()

      if (myChar && theirChar && item) {
        console.log(
          `${myChar.characterName} gifted ${item.itemEmoji} ${item.itemName} to ${theirChar.characterName}`,
        )
      }
    }
  })
}
