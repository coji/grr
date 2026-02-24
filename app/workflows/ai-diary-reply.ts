/**
 * Cloudflare Workflow for processing AI diary replies with image attachments
 *
 * This workflow handles the time-intensive process of:
 * 1. Downloading image attachments and generating AI replies (combined step)
 * 2. Generating character image and uploading to R2
 * 3. Posting the reply back to Slack
 * 4. Removing processing reaction
 * 5. Adding supportive reaction
 *
 * Using Workflows allows us to exceed the 30-second waitUntil limit
 * and provides automatic retry logic for each step.
 *
 * Note: Download and AI generation are combined into one step to avoid
 * the 1MiB output limit for step results (image data would exceed this).
 */

import {
  env,
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from 'cloudflare:workers'
import { SlackAPIClient } from 'slack-edge'
import { generateDiaryReply, generateSupportiveReaction } from '~/services/ai'
import { generateCharacterImage } from '~/services/ai/character-generation'
import type { ImageAttachment } from '~/services/ai/diary-reply'
import { getEntryAttachments } from '~/services/attachments'
import { characterToConcept, getCharacter } from '~/services/character'
import {
  addToPool,
  countTodayGenerations,
  DAILY_GENERATION_CAP,
  getBaseImage,
  putBaseImage,
} from '~/services/character-image'
import { downloadSlackFiles } from '~/services/slack-file-downloader'
import {
  CHARACTER_IMAGE_BASE_URL,
  getCacheBuster,
  MESSAGE_CHARACTER_STYLES,
} from '~/slack-app/character-blocks'

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
  isFirstDiary?: boolean // True when this is the user's first diary entry (onboarding)
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
    const slackClient = new SlackAPIClient(env.SLACK_BOT_TOKEN)

    // Step 1: Download images and generate AI reply
    // Note: Combined into single step to avoid 1MiB output limit for image data
    const aiReply = await step.do(
      'download-and-generate-reply',
      {
        retries: {
          limit: 2,
          delay: '10 seconds',
        },
      },
      async (): Promise<string> => {
        let imageAttachments: ImageAttachment[] | undefined
        try {
          const attachments = await getEntryAttachments(params.entryId)
          const images = attachments
            .filter((a) => a.fileType === 'image')
            .slice(0, 3) // Limit to 3 images for memory safety

          if (images.length === 0) {
            imageAttachments = undefined
          } else {
            console.log(
              `Attempting to download ${images.length} images for AI context`,
            )

            // Get fresh URLs from Slack API (event payload URLs may be stale)
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
              imageAttachments = undefined
            } else {
              const downloaded = await downloadSlackFiles(
                fileUrls,
                env.SLACK_BOT_TOKEN,
              )

              if (downloaded.length === 0) {
                console.warn('No images were successfully downloaded')
                imageAttachments = undefined
              } else {
                console.log(
                  `Successfully downloaded ${downloaded.length} images`,
                )

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
                  imageAttachments = undefined
                } else {
                  imageAttachments = validImages.map((d) => ({
                    buffer: d.buffer,
                    mimeType: d.mimeType,
                    fileName: d.fileName,
                  }))
                }
              }
            }
          }
        } catch (error) {
          console.error('Failed to download image attachments:', error)
          // Continue without images
          imageAttachments = undefined
        }

        // Generate AI reply with downloaded images (if any)
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

    // Step 2: Generate character image and add to pool
    // Pre-generates the image so the PNG route can serve it instantly
    // when Slack fetches the image_url from the block.
    const characterImageUrl = await step.do(
      'generate-character-image',
      {
        retries: {
          limit: 2,
          delay: '5 seconds',
        },
      },
      async (): Promise<string | null> => {
        const character = await getCharacter(params.userId)
        if (!character) return null

        const imageUrl = `${CHARACTER_IMAGE_BASE_URL}/character/${params.userId}.png?d=${getCacheBuster()}`

        // Check daily generation cap
        const todayCount = await countTodayGenerations(params.userId)
        if (todayCount >= DAILY_GENERATION_CAP) {
          console.log(
            `Daily generation cap reached for ${params.userId} (${todayCount}/${DAILY_GENERATION_CAP})`,
          )
          return imageUrl
        }

        try {
          const concept = characterToConcept(character)
          const style = MESSAGE_CHARACTER_STYLES.diary_reply
          const baseImage = (await getBaseImage(params.userId)) ?? undefined

          const pngData = await generateCharacterImage({
            userId: params.userId,
            concept,
            evolutionStage: character.evolutionStage,
            emotion: style.emotion,
            action: style.action,
            baseImage,
          })

          // Store as base image if none exists (e.g. pre-pool-system characters)
          if (!baseImage) {
            await putBaseImage(params.userId, pngData)
            console.log(`Stored base image for ${params.userId}`)
          }

          const poolKey = await addToPool(
            params.userId,
            character.evolutionStage,
            pngData,
          )
          console.log(
            `Added character image to pool: ${poolKey} (${pngData.byteLength} bytes)`,
          )

          return imageUrl
        } catch (error) {
          console.error('Failed to generate character image:', error)
          return imageUrl
        }
      },
    )

    // Step 3: Post message to Slack (with character image if available)
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

        // biome-ignore lint/suspicious/noExplicitAny: Slack Block Kit dynamic types
        const blocks: any[] = []

        if (characterImageUrl) {
          blocks.push({
            type: 'image',
            image_url: characterImageUrl,
            alt_text: 'キャラクターの画像',
          })
        }

        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: message,
          },
        })

        // For first diary: Add character introduction message
        if (params.isFirstDiary) {
          const character = await getCharacter(params.userId)
          if (character) {
            blocks.push({
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: `${character.characterEmoji} あなたとの会話から *${character.characterName}* (${character.characterSpecies}) が生まれました！日記を続けると成長していきます。`,
                },
              ],
            })
          }
        }

        const result = await slackClient.chat.postMessage({
          channel: params.channel,
          thread_ts: params.threadTs ?? params.messageTs,
          text: message,
          blocks,
        })

        if (!result.ok) {
          throw new Error(`Slack API error: ${result.error}`)
        }

        console.log('Successfully posted AI reply to Slack')
      },
    )

    // Step 4: Remove processing reaction
    await step.do('remove-processing-reaction', async (): Promise<void> => {
      try {
        const result = await slackClient.reactions.remove({
          channel: params.channel,
          timestamp: params.messageTs,
          name: 'eyes',
        })

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

        const result = await slackClient.reactions.add({
          channel: params.channel,
          timestamp: params.messageTs,
          name: reactionName,
        })

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
