/**
 * Utilities for fetching Slack unfurl (link preview) information from messages.
 *
 * When a user shares a URL in Slack, Slack "unfurls" it by fetching the page
 * and showing a preview with title, description, etc. This module fetches
 * that unfurl data from the Slack API so it can be used as context for
 * memory extraction.
 */

import type { SlackAPIClient } from 'slack-edge'

export interface UnfurlInfo {
  url: string
  title: string | null
  description: string | null
  siteName: string | null
}

/**
 * Slack attachment object shape (subset relevant to unfurls).
 * When Slack unfurls a URL, it adds an attachment with `original_url`.
 */
interface SlackAttachment {
  original_url?: string
  title?: string
  text?: string
  service_name?: string
  [key: string]: unknown
}

/**
 * Fetch unfurl information from a Slack message's attachments.
 *
 * Uses `conversations.replies` for threaded messages or
 * `conversations.history` for top-level messages to retrieve
 * the message with its attachments (which contain unfurl data).
 *
 * Returns an empty array if no unfurls are found or if the API call fails.
 */
export async function fetchUnfurlsFromMessage(
  client: SlackAPIClient,
  channel: string,
  messageTs: string,
  threadTs?: string,
): Promise<UnfurlInfo[]> {
  try {
    let attachments: SlackAttachment[] = []

    if (threadTs) {
      // Message is in a thread — use conversations.replies
      const result = await client.conversations.replies({
        channel,
        ts: threadTs,
        latest: messageTs,
        oldest: messageTs,
        inclusive: true,
        limit: 1,
      })

      const messages = (
        result as {
          messages?: Array<{ ts?: string; attachments?: SlackAttachment[] }>
        }
      ).messages
      const targetMessage = messages?.find((m) => m.ts === messageTs)
      attachments = targetMessage?.attachments ?? []
    } else {
      // Top-level message — use conversations.history
      const result = await client.conversations.history({
        channel,
        latest: messageTs,
        oldest: messageTs,
        inclusive: true,
        limit: 1,
      })

      const messages = (
        result as { messages?: Array<{ attachments?: SlackAttachment[] }> }
      ).messages
      attachments = messages?.[0]?.attachments ?? []
    }

    return extractUnfurlsFromAttachments(attachments)
  } catch (error) {
    console.warn('[Unfurl] Failed to fetch unfurls from message:', error)
    return []
  }
}

/**
 * Extract UnfurlInfo from Slack message attachments.
 *
 * Only attachments with `original_url` are URL unfurls.
 * Other attachments (file uploads, bot messages, etc.) are filtered out.
 */
export function extractUnfurlsFromAttachments(
  attachments: SlackAttachment[],
): UnfurlInfo[] {
  return attachments
    .filter(
      (a): a is SlackAttachment & { original_url: string } =>
        typeof a.original_url === 'string' && a.original_url.length > 0,
    )
    .map((a) => ({
      url: a.original_url,
      title: a.title ?? null,
      description: a.text ?? null,
      siteName: a.service_name ?? null,
    }))
}
