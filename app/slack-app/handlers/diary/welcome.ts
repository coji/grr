import type { AnyMessageBlock } from 'slack-cloudflare-workers'
import { DIARY_PERSONA_NAME } from '../diary-constants'

/**
 * 初回ユーザー向けの歓迎メッセージを構築
 * (最初のメンション時に送信)
 */
export function buildWelcomeMessage(userName?: string): {
  text: string
  blocks: AnyMessageBlock[]
} {
  const greeting = userName ? `${userName}さん、` : ''

  const text = `${greeting}はじめまして！日記アシスタントの${DIARY_PERSONA_NAME}です。`

  return {
    text,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${greeting}はじめまして！日記アシスタントの *${DIARY_PERSONA_NAME}* です。`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '毎日の出来事や気持ちを書いてもらえると、私が寄り添って返事を書きます。',
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'よければ、今日あったことを教えてください。',
        },
      },
    ],
  }
}

/**
 * 紹介者が新しいユーザーを案内した時のメッセージを構築
 */
export function buildReferralWelcomeMessage(
  newUserName: string,
  referrerName: string,
): {
  text: string
  blocks: AnyMessageBlock[]
} {
  const text = `${newUserName}さん、${referrerName}さんから紹介いただきました！${DIARY_PERSONA_NAME}です。`

  return {
    text,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${newUserName}さん、${referrerName}さんから紹介いただきました！`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `私は *${DIARY_PERSONA_NAME}* という日記アシスタントです。\n毎日の出来事や気持ちを書いてもらえると、寄り添って返事を書きます。`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'よければ、今日あったことを教えてください。',
        },
      },
    ],
  }
}

/**
 * キャラクター生成後の紹介メッセージを構築
 */
export function buildCharacterIntroMessage(
  characterName: string,
  characterEmoji: string,
  characterSpecies: string,
): {
  text: string
  blocks: AnyMessageBlock[]
} {
  const text = `あなたとの会話から「${characterName}」というキャラが生まれました！`

  return {
    text,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${characterEmoji} あなたとの会話から *${characterName}* (${characterSpecies}) が生まれました！\n日記を続けると成長していきます。`,
        },
      },
    ],
  }
}
