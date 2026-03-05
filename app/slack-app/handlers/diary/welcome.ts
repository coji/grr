import type { AnyMessageBlock } from 'slack-cloudflare-workers'
import type { CharacterPersonaInfo } from '~/services/ai/persona'
import { DEFAULT_PERSONA_NAME } from '~/services/ai/persona'

/**
 * 初回ユーザー向けの歓迎メッセージを構築
 * (最初のメンション時に送信)
 *
 * キャラクターがいない場合は汎用的なアシスタントとして自己紹介し、
 * キャラクターが生成されることを予告する。
 */
export function buildWelcomeMessage(
  userName?: string,
  characterInfo?: CharacterPersonaInfo | null,
): {
  text: string
  blocks: AnyMessageBlock[]
} {
  const greeting = userName ? `${userName}さん、` : ''

  // キャラクターがいる場合はキャラクターとして自己紹介
  if (characterInfo) {
    const text = `${greeting}はじめまして！${characterInfo.name}です。`

    return {
      text,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${greeting}はじめまして！ *${characterInfo.name}* (${characterInfo.species}) です。`,
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

  // キャラクターがいない場合（新規ユーザー）
  const text = `${greeting}はじめまして！${DEFAULT_PERSONA_NAME}です。`

  return {
    text,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${greeting}はじめまして！`,
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
          text: '日記を書き続けると、あなただけのキャラクターが生まれますよ。\nよければ、今日あったことを教えてください。',
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
  characterInfo?: CharacterPersonaInfo | null,
): {
  text: string
  blocks: AnyMessageBlock[]
} {
  // キャラクターがいる場合
  if (characterInfo) {
    const text = `${newUserName}さん、${referrerName}さんから紹介いただきました！${characterInfo.name}です。`

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
            text: `私は *${characterInfo.name}* (${characterInfo.species}) です。\n毎日の出来事や気持ちを書いてもらえると、寄り添って返事を書きます。`,
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

  // キャラクターがいない場合
  const text = `${newUserName}さん、${referrerName}さんから紹介いただきました！`

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
          text: '毎日の出来事や気持ちを書いてもらえると、寄り添って返事を書きます。\n日記を続けると、あなただけのキャラクターが生まれますよ。',
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
          text: `${characterEmoji} あなたとの会話から *${characterName}* (${characterSpecies}) が生まれました！\nこれからは私があなたの日記に寄り添います。日記を続けると、一緒に成長していきます。`,
        },
      },
    ],
  }
}
