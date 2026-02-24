/**
 * AI API cost logging service
 *
 * Records token usage and estimated costs for all AI API calls.
 * Supports both Vercel AI SDK (generateText/generateObject) and
 * Google GenAI SDK (generateContent) response formats.
 */

import { nanoid } from 'nanoid'
import { db } from '~/services/db'

// Pricing per million tokens (USD)
// Source: https://ai.google.dev/gemini-api/docs/pricing
const MODEL_PRICING: Record<
  string,
  { input: number; output: number; thinking: number }
> = {
  // Gemini 3 series (preview)
  'gemini-3-pro-image-preview': { input: 2.0, output: 12.0, thinking: 2.0 },
  'gemini-3-flash-preview': { input: 0.5, output: 3.0, thinking: 0.5 },
  'gemini-3.1-pro-preview': { input: 2.0, output: 12.0, thinking: 2.0 },
  // Gemini 2.5 series
  'gemini-2.5-pro': { input: 1.25, output: 10.0, thinking: 1.25 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5, thinking: 0.3 },
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4, thinking: 0.1 },
  // Gemini 2.0 series
  'gemini-2.0-flash': { input: 0.1, output: 0.4, thinking: 0.1 },
  'gemini-2.0-flash-lite': { input: 0.075, output: 0.3, thinking: 0.075 },
  'gemini-flash-lite-latest': { input: 0.075, output: 0.3, thinking: 0.075 },
}

export interface AiCostLogInput {
  userId?: string | null
  operation: string
  model: string
  inputTokens: number
  outputTokens: number
  thinkingTokens?: number
  metadata?: Record<string, unknown>
}

function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  thinkingTokens: number,
): number {
  const pricing = MODEL_PRICING[model]
  if (!pricing) {
    console.warn(
      `[ai-cost] Unknown model "${model}" - cost will be recorded as 0`,
    )
    return 0
  }
  return (
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output +
    (thinkingTokens / 1_000_000) * pricing.thinking
  )
}

/**
 * Log an AI API call's cost to the database.
 * Fire-and-forget: errors are caught and logged, never thrown.
 */
export async function logAiCost(input: AiCostLogInput): Promise<void> {
  const thinkingTokens = input.thinkingTokens ?? 0
  const costUsd = calculateCost(
    input.model,
    input.inputTokens,
    input.outputTokens,
    thinkingTokens,
  )

  try {
    await db
      .insertInto('aiCostLogs')
      .values({
        id: nanoid(),
        userId: input.userId ?? null,
        operation: input.operation,
        model: input.model,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        thinkingTokens,
        costUsd,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
        createdAt: new Date().toISOString(),
      })
      .execute()

    console.log(
      `[ai-cost] ${input.operation} (${input.model})`,
      `| tokens: in=${input.inputTokens} out=${input.outputTokens} think=${thinkingTokens}`,
      `| $${costUsd.toFixed(4)} (≈${Math.round(costUsd * 150)}円)`,
    )
  } catch (error) {
    console.error('[ai-cost] Failed to log cost:', error)
  }
}
