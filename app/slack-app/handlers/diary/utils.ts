export const TOKYO_TZ = 'Asia/Tokyo'

export const sanitizeText = (text: string | undefined) =>
  text
    ?.replace(/<@[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim() ?? ''

/**
 * Get the display name for a Slack user.
 * Falls back to 'ユーザー' if the user cannot be fetched.
 */
export async function getUserDisplayName(
  userId: string,
  // biome-ignore lint/suspicious/noExplicitAny: Slack client type
  client: any,
): Promise<string> {
  try {
    const result = await client.users.info({ user: userId })
    if (result.ok && result.user) {
      return (
        result.user.profile?.display_name ||
        result.user.profile?.real_name ||
        result.user.name ||
        'ユーザー'
      )
    }
  } catch (error) {
    console.error(`Failed to fetch user info for ${userId}:`, error)
  }
  return 'ユーザー'
}
