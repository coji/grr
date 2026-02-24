/**
 * Utility functions for onboarding flow
 * Extracted for testability
 */

/**
 * メッセージテキストから紹介パターンを検出
 * 例: "@ほたる @田中さん に案内して"
 * Returns: { isReferral: true, newUserId: 'U12345' }
 */
export function detectReferralPattern(
  text: string,
  senderId: string,
  botUserId: string,
): {
  isReferral: boolean
  newUserId?: string
} {
  // テキスト内のユーザーメンションを抽出 (<@U12345> 形式)
  const userMentions = text.match(/<@([A-Z0-9]+)>/g) || []
  const mentionedUserIds = userMentions
    .map((m) => m.replace(/<@|>/g, ''))
    .filter((id) => id !== botUserId) // ボット自身を除外

  // 送信者以外のユーザーがメンションされていれば紹介パターン
  const otherUsers = mentionedUserIds.filter((id) => id !== senderId)

  if (otherUsers.length > 0) {
    return {
      isReferral: true,
      newUserId: otherUsers[0], // 最初にメンションされたユーザーを対象
    }
  }

  return { isReferral: false }
}
