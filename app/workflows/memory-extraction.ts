/**
 * Cloudflare Workflow for extracting memories from diary entries
 *
 * This workflow handles the process of:
 * 1. Gathering context (current entry, recent entries, existing memories)
 * 2. Extracting new memories via AI
 * 3. Processing and storing extracted memories
 * 4. Invalidating the context cache
 *
 * Using a Workflow allows this to run asynchronously without blocking
 * the user-facing response.
 */

import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from 'cloudflare:workers'
import {
  extractMemoriesFromEntry,
  validateExtractedMemory,
  type ExtractedMemory,
} from '~/services/ai/memory-extraction'
import { db } from '~/services/db'
import {
  confirmMemory,
  createMemory,
  getActiveMemories,
  getMemoryById,
  invalidateContextCache,
  markExtractionCompleted,
  supersedeMemory,
} from '~/services/memory'

export interface MemoryExtractionParams {
  extractionId: string
  entryId: string
  userId: string
}

export class MemoryExtractionWorkflow extends WorkflowEntrypoint<
  Env,
  MemoryExtractionParams
> {
  async run(
    event: WorkflowEvent<MemoryExtractionParams>,
    step: WorkflowStep,
  ): Promise<void> {
    const params = event.payload
    console.log(`Starting memory extraction for entry ${params.entryId}`)

    // Step 1: Gather context
    const context = await step.do(
      'gather-context',
      {
        retries: { limit: 2, delay: '5 seconds' },
      },
      async () => {
        // Get the current entry
        const entry = await db
          .selectFrom('diaryEntries')
          .select(['id', 'entryDate', 'detail', 'moodLabel'])
          .where('id', '=', params.entryId)
          .executeTakeFirst()

        if (!entry) {
          throw new Error(`Entry not found: ${params.entryId}`)
        }

        // Get recent entries for context (last 7 days)
        const recentEntries = await db
          .selectFrom('diaryEntries')
          .select(['entryDate', 'detail', 'moodLabel'])
          .where('userId', '=', params.userId)
          .where('id', '!=', params.entryId)
          .orderBy('entryDate', 'desc')
          .limit(5)
          .execute()

        // Get existing memories
        const existingMemories = await getActiveMemories(params.userId)

        return {
          entry: {
            id: entry.id,
            entryDate: entry.entryDate,
            detail: entry.detail,
            moodLabel: entry.moodLabel,
          },
          recentEntries: recentEntries.map((e) => ({
            entryDate: e.entryDate,
            detail: e.detail,
            moodLabel: e.moodLabel,
          })),
          existingMemories,
        }
      },
    )

    // Step 2: Extract memories via AI
    const extractedMemories = await step.do(
      'extract-memories',
      {
        retries: { limit: 2, delay: '10 seconds' },
      },
      async (): Promise<ExtractedMemory[]> => {
        return await extractMemoriesFromEntry({
          currentEntry: context.entry,
          recentEntries: context.recentEntries,
          existingMemories: context.existingMemories,
        })
      },
    )

    // Step 3: Process and store memories
    const processedCount = await step.do(
      'store-memories',
      {
        retries: { limit: 2, delay: '5 seconds' },
      },
      async (): Promise<number> => {
        let count = 0

        for (const memory of extractedMemories) {
          // Validate memory
          if (!validateExtractedMemory(memory)) {
            console.warn('Invalid memory, skipping:', memory)
            continue
          }

          try {
            if (memory.action === 'new') {
              // Create new memory
              await createMemory({
                userId: params.userId,
                memoryType: memory.type,
                category: memory.category,
                content: memory.content,
                sourceEntryIds: [params.entryId],
                confidence: memory.confidence,
                importance: memory.importance,
              })
              count++
              console.log(`Created new memory: ${memory.content}`)
            } else if (memory.action === 'update' && memory.relatedMemoryId) {
              // Update existing memory
              const existing = await getMemoryById(memory.relatedMemoryId)
              if (existing) {
                // Create new memory and supersede old one
                const newMemory = await createMemory({
                  userId: params.userId,
                  memoryType: memory.type,
                  category: memory.category,
                  content: memory.content,
                  sourceEntryIds: [
                    ...(existing.sourceEntryIds
                      ? JSON.parse(existing.sourceEntryIds)
                      : []),
                    params.entryId,
                  ],
                  confidence: memory.confidence,
                  importance: memory.importance,
                })
                await supersedeMemory(memory.relatedMemoryId, newMemory.id)
                count++
                console.log(`Updated memory: ${memory.content}`)
              }
            } else if (memory.action === 'confirm' && memory.relatedMemoryId) {
              // Confirm existing memory
              await confirmMemory(memory.relatedMemoryId)
              console.log(`Confirmed memory: ${memory.relatedMemoryId}`)
            }
          } catch (error) {
            console.error(`Failed to process memory:`, error)
          }
        }

        return count
      },
    )

    // Step 4: Update extraction record and invalidate cache
    await step.do('finalize', async (): Promise<void> => {
      // Mark extraction as completed
      await markExtractionCompleted(
        params.extractionId,
        extractedMemories,
        `Processed ${processedCount} memories`,
      )

      // Invalidate context cache if new memories were added
      if (processedCount > 0) {
        await invalidateContextCache(params.userId)
      }

      console.log(
        `Memory extraction completed. Extracted: ${extractedMemories.length}, Stored: ${processedCount}`,
      )
    })
  }
}
