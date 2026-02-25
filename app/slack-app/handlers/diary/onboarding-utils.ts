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

  // 送信者以外のユーザーがちょうど1人メンションされていれば紹介パターン
  // 複数人メンションは日記として扱う（紹介は通常1人ずつ行う）
  const otherUsers = mentionedUserIds.filter((id) => id !== senderId)

  if (otherUsers.length === 1) {
    return {
      isReferral: true,
      newUserId: otherUsers[0],
    }
  }

  return { isReferral: false }
}
