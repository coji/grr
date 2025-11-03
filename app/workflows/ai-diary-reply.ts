/**
 * Cloudflare Workflow for processing AI diary replies with image attachments
 *
 * This workflow handles the time-intensive process of:
 * 1. Downloading image attachments from Slack
 * 2. Generating AI replies with image context
 * 3. Posting the reply back to Slack
 *
 * Using Workflows allows us to exceed the 30-second waitUntil limit
 * and provides automatic retry logic for each step.
 */

import {
  env,
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from 'cloudflare:workers'
import { SlackAPIClient } from 'slack-edge'
import { generateDiaryReply, generateSupportiveReaction } from '~/services/ai'
import type { ImageAttachment } from '~/services/ai/diary-reply'
import { getEntryAttachments } from '~/services/attachments'
import { downloadSlackFiles } from '~/services/slack-file-downloader'

// Import constants directly to avoid path issues
const DIARY_PERSONA_NAME = 'ほたる'
const SUPPORTIVE_REACTIONS = [
  'sparkles',
  'star',
  'heart',
  'two_hearts',
  'cherry_blossom',
  'herb',
  'four_leaf_clover',
  'seedling',
]

export interface AiDiaryReplyParams {
  entryId: string
  userId: string
  channel: string
  messageTs: string
  threadTs: string | undefined
  moodLabel: string | null
  latestEntry: string | null
  previousEntry: string | null
  mentionMessage: string | null
  mention: string
}

export class AiDiaryReplyWorkflow extends WorkflowEntrypoint<
  Env,
  AiDiaryReplyParams
> {
  async run(
    event: WorkflowEvent<AiDiaryReplyParams>,
    step: WorkflowStep,
  ): Promise<void> {
    const params = event.payload

    // Step 1: Download image attachments
    const imageAttachments = await step.do(
      'download-images',
      {
        retries: {
          limit: 3,
          delay: '5 seconds',
        },
      },
      async (): Promise<ImageAttachment[] | undefined> => {
        try {
          const attachments = await getEntryAttachments(params.entryId)
          const images = attachments
            .filter((a) => a.fileType === 'image')
            .slice(0, 3) // Limit to 3 images for memory safety

          if (images.length === 0) {
            console.log('No image attachments found')
            return undefined
          }

          console.log(
            `Attempting to download ${images.length} images for AI context`,
          )

          // Get fresh URLs from Slack API (event payload URLs may be stale)
          const slackClient = new SlackAPIClient(env.SLACK_BOT_TOKEN)
          const fileUrls: Array<{ urlPrivate: string; fileName: string }> = []

          for (const img of images) {
            try {
              const fileInfo = await slackClient.files.info({
                file: img.slackFileId,
              })

              if (fileInfo.ok && fileInfo.file?.url_private) {
                fileUrls.push({
                  urlPrivate: fileInfo.file.url_private,
                  fileName: img.fileName,
                })
                console.log(
                  `Got fresh URL for ${img.fileName}: ${fileInfo.file.url_private.substring(0, 100)}...`,
                )
              } else {
                console.warn(
                  `Failed to get file info for ${img.slackFileId}: ${fileInfo.error || 'unknown error'}`,
                )
              }
            } catch (error) {
              console.error(
                `Error fetching file info for ${img.slackFileId}:`,
                error,
              )
            }
          }

          if (fileUrls.length === 0) {
            console.warn('No valid file URLs obtained from Slack API')
            return undefined
          }

          const downloaded = await downloadSlackFiles(
            fileUrls,
            env.SLACK_BOT_TOKEN,
          )

          if (downloaded.length === 0) {
            console.warn('No images were successfully downloaded')
            return undefined
          }

          console.log(`Successfully downloaded ${downloaded.length} images`)

          // Log MIME types for debugging
          downloaded.forEach((d, idx) => {
            console.log(
              `Image ${idx + 1}: ${d.fileName}, MIME: ${d.mimeType}, size: ${d.size} bytes`,
            )
          })

          // Filter out non-image MIME types (safety check)
          const validImages = downloaded.filter((d) =>
            d.mimeType.startsWith('image/'),
          )

          if (validImages.length < downloaded.length) {
            console.warn(
              `Filtered out ${downloaded.length - validImages.length} files with invalid MIME types`,
            )
          }

          if (validImages.length === 0) {
            console.warn('No valid image files after MIME type filtering')
            return undefined
          }

          return validImages.map((d) => ({
            buffer: d.buffer,
            mimeType: d.mimeType,
            fileName: d.fileName,
          }))
        } catch (error) {
          console.error('Failed to download image attachments:', error)
          // Return undefined to continue without images
          return undefined
        }
      },
    )

    // Step 2: Generate AI reply
    const aiReply = await step.do(
      'generate-ai-reply',
      {
        retries: {
          limit: 2,
          delay: '10 seconds',
        },
      },
      async (): Promise<string> => {
        return await generateDiaryReply({
          personaName: DIARY_PERSONA_NAME,
          userId: params.userId,
          moodLabel: params.moodLabel,
          latestEntry: params.latestEntry,
          previousEntry: params.previousEntry,
          mentionMessage: params.mentionMessage,
          imageAttachments,
        })
      },
    )

    // Step 3: Post message to Slack
    await step.do(
      'post-slack-message',
      {
        retries: {
          limit: 3,
          delay: '2 seconds',
        },
      },
      async (): Promise<void> => {
        const message = `${params.mention} ${aiReply}`.trim()

        const response = await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
          },
          body: JSON.stringify({
            channel: params.channel,
            thread_ts: params.threadTs ?? params.messageTs,
            text: message,
          }),
        })

        if (!response.ok) {
          throw new Error(
            `Failed to post message: ${response.status} ${response.statusText}`,
          )
        }

        const result = (await response.json()) as {
          ok: boolean
          error?: string
        }
        if (!result.ok) {
          throw new Error(`Slack API error: ${result.error}`)
        }

        console.log('Successfully posted AI reply to Slack')
      },
    )

    // Step 4: Remove processing reaction
    await step.do('remove-processing-reaction', async (): Promise<void> => {
      try {
        const response = await fetch('https://slack.com/api/reactions.remove', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
          },
          body: JSON.stringify({
            channel: params.channel,
            timestamp: params.messageTs,
            name: 'eyes',
          }),
        })

        if (!response.ok) {
          console.warn(`Failed to remove reaction: ${response.status}`)
          return
        }

        const result = (await response.json()) as {
          ok: boolean
          error?: string
        }
        if (!result.ok && result.error !== 'no_reaction') {
          console.warn(`Slack API error removing reaction: ${result.error}`)
        }
      } catch (error) {
        // Ignore errors when removing reaction
        console.warn('Error removing processing reaction:', error)
      }
    })

    // Step 5: Add supportive reaction
    await step.do('add-supportive-reaction', async (): Promise<void> => {
      try {
        const reactionName = await generateSupportiveReaction({
          personaName: DIARY_PERSONA_NAME,
          userId: params.userId,
          messageText: params.mentionMessage || '',
          moodLabel: params.moodLabel,
          availableReactions: SUPPORTIVE_REACTIONS,
        })

        const response = await fetch('https://slack.com/api/reactions.add', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
          },
          body: JSON.stringify({
            channel: params.channel,
            timestamp: params.messageTs,
            name: reactionName,
          }),
        })

        if (!response.ok) {
          console.warn(`Failed to add reaction: ${response.status}`)
          return
        }

        const result = (await response.json()) as {
          ok: boolean
          error?: string
        }
        if (!result.ok && result.error !== 'already_reacted') {
          console.warn(`Slack API error adding reaction: ${result.error}`)
        }
      } catch (error) {
        // Ignore errors when adding reaction
        console.warn('Error adding supportive reaction:', error)
      }
    })
  }
}
