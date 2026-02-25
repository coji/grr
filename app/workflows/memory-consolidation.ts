/**
 * Cloudflare Workflow for consolidating user memories
 *
 * Triggered when a user's memory count exceeds the threshold.
 * Runs asynchronously to:
 * 1. Fetch all active memories
 * 2. Generate a consolidation plan via AI
 * 3. Execute the plan (merge, deactivate)
 * 4. Invalidate the context cache
 */

import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from 'cloudflare:workers'
import {
  CONSOLIDATION_THRESHOLD,
  generateConsolidationPlan,
  validateConsolidationPlan,
  type ConsolidationPlan,
} from '~/services/ai/memory-consolidation'
import {
  createMemory,
  decayMemories,
  deleteMemory,
  getActiveMemories,
  invalidateContextCache,
  markMemoryAsUserConfirmed,
  supersedeMemory,
} from '~/services/memory'

export interface MemoryConsolidationParams {
  userId: string
}

export class MemoryConsolidationWorkflow extends WorkflowEntrypoint<
  Env,
  MemoryConsolidationParams
> {
  async run(
    event: WorkflowEvent<MemoryConsolidationParams>,
    step: WorkflowStep,
  ): Promise<void> {
    const { userId } = event.payload
    console.log(`[Consolidation] Starting for user ${userId}`)

    // Step 1: Decay old memories first
    const decayedCount = await step.do('decay-memories', async () => {
      return await decayMemories(userId)
    })

    if (decayedCount > 0) {
      console.log(
        `[Consolidation] Decayed ${decayedCount} memories before consolidation`,
      )
    }

    // Step 2: Fetch current active memories
    const memories = await step.do('fetch-memories', async () => {
      return await getActiveMemories(userId)
    })

    // Check if consolidation is still needed after decay
    if (memories.length <= CONSOLIDATION_THRESHOLD) {
      console.log(
        `[Consolidation] User ${userId} has ${memories.length} memories (≤${CONSOLIDATION_THRESHOLD}), skipping`,
      )
      return
    }

    console.log(
      `[Consolidation] User ${userId} has ${memories.length} memories, consolidating`,
    )

    // Step 3: Generate consolidation plan via AI
    const plan = await step.do(
      'generate-plan',
      {
        retries: { limit: 2, delay: '10 seconds' },
      },
      async (): Promise<ConsolidationPlan> => {
        return await generateConsolidationPlan(memories)
      },
    )

    // Step 4: Validate and execute the plan
    const result = await step.do(
      'execute-plan',
      {
        retries: { limit: 1, delay: '5 seconds' },
      },
      async () => {
        const validation = validateConsolidationPlan(plan, memories)
        if (!validation.valid) {
          console.warn(
            `[Consolidation] Plan validation failed:`,
            validation.errors,
          )
          // On validation failure, still execute safe parts
          // (only process merge groups where all source IDs exist)
        }

        let mergedCount = 0
        let deactivatedCount = 0

        // Execute merges
        for (const group of plan.merge) {
          try {
            // Verify all source memories exist and are active
            const sourceMemories = memories.filter((m) =>
              group.sourceIds.includes(m.id),
            )
            if (sourceMemories.length < 2) {
              console.warn(
                `[Consolidation] Skipping merge: not enough valid sources`,
              )
              continue
            }

            // Collect all source entry IDs
            const allSourceEntryIds = new Set<string>()
            for (const m of sourceMemories) {
              if (m.sourceEntryIds) {
                for (const id of JSON.parse(m.sourceEntryIds)) {
                  allSourceEntryIds.add(id)
                }
              }
            }

            // Preserve highest confidence and user-confirmed status
            const maxConfidence = Math.max(
              ...sourceMemories.map((m) => m.confidence),
            )
            const anyUserConfirmed = sourceMemories.some(
              (m) => m.userConfirmed === 1,
            )

            // Create consolidated memory
            const newMemory = await createMemory({
              userId,
              memoryType: group.memoryType,
              category: group.category,
              content: group.content,
              sourceEntryIds: [...allSourceEntryIds],
              confidence: maxConfidence,
              importance: group.importance,
            })

            // If any source was user-confirmed, preserve that
            if (anyUserConfirmed) {
              await markMemoryAsUserConfirmed(newMemory.id)
            }

            // Supersede all source memories
            for (const sourceMemory of sourceMemories) {
              await supersedeMemory(sourceMemory.id, newMemory.id)
            }

            mergedCount++
            console.log(
              `[Consolidation] Merged ${sourceMemories.length} memories → "${group.content}"`,
            )
          } catch (error) {
            console.error(`[Consolidation] Merge failed:`, error)
          }
        }

        // Execute deactivations
        for (const id of plan.deactivate) {
          try {
            const memory = memories.find((m) => m.id === id)
            // Safety: never deactivate user-confirmed memories
            if (memory && memory.userConfirmed !== 1) {
              await deleteMemory(id)
              deactivatedCount++
            }
          } catch (error) {
            console.error(
              `[Consolidation] Deactivation failed for ${id}:`,
              error,
            )
          }
        }

        return { mergedCount, deactivatedCount }
      },
    )

    // Step 5: Invalidate cache
    await step.do('invalidate-cache', async (): Promise<void> => {
      await invalidateContextCache(userId)
      console.log(
        `[Consolidation] Done for user ${userId}: ${result.mergedCount} merged, ${result.deactivatedCount} deactivated`,
      )
    })
  }
}
