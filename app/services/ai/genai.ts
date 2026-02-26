/**
 * Thin wrapper around @google/genai for text and structured output generation.
 *
 * Replaces the Vercel AI SDK (ai + @ai-sdk/google) with direct Google GenAI
 * SDK calls, keeping a similar API surface for easy migration.
 */

import { GoogleGenAI, type ThinkingLevel } from '@google/genai'
import { env } from 'cloudflare:workers'
import { z } from 'zod'

// Map lowercase thinking levels (used throughout the codebase) to SDK enum values
const THINKING_LEVELS: Record<string, ThinkingLevel> = {
  minimal: 'MINIMAL' as ThinkingLevel,
  low: 'LOW' as ThinkingLevel,
  medium: 'MEDIUM' as ThinkingLevel,
}

export interface UsageInfo {
  inputTokens: number
  outputTokens: number
  thinkingTokens: number
}

// ---- generateText ----

export interface GenerateTextOptions {
  model: string
  system?: string
  prompt?: string
  /** For multimodal input — pass Google GenAI SDK content parts directly */
  // biome-ignore lint/suspicious/noExplicitAny: Google GenAI SDK content union type
  contents?: any
  thinkingLevel?: 'minimal' | 'low' | 'medium'
}

export async function generateText(
  options: GenerateTextOptions,
): Promise<{ text: string; usage: UsageInfo }> {
  const client = new GoogleGenAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY })

  const response = await client.models.generateContent({
    model: options.model,
    contents: options.contents ?? options.prompt ?? '',
    config: {
      systemInstruction: options.system,
      thinkingConfig: options.thinkingLevel
        ? { thinkingLevel: THINKING_LEVELS[options.thinkingLevel] }
        : undefined,
    },
  })

  const usage = response.usageMetadata
  return {
    text: response.text ?? '',
    usage: {
      inputTokens: usage?.promptTokenCount ?? 0,
      outputTokens: usage?.candidatesTokenCount ?? 0,
      thinkingTokens: usage?.thoughtsTokenCount ?? 0,
    },
  }
}

// ---- generateObject (structured output with Zod) ----

export interface GenerateObjectOptions<T extends z.ZodType> {
  model: string
  schema: T
  system?: string
  prompt?: string
  thinkingLevel?: 'minimal' | 'low' | 'medium'
}

export async function generateObject<T extends z.ZodType>(
  options: GenerateObjectOptions<T>,
): Promise<{ object: z.output<T>; usage: UsageInfo }> {
  const client = new GoogleGenAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY })

  const jsonSchema = z.toJSONSchema(options.schema)

  const response = await client.models.generateContent({
    model: options.model,
    contents: options.prompt ?? '',
    config: {
      systemInstruction: options.system,
      responseMimeType: 'application/json',
      responseJsonSchema: jsonSchema,
      thinkingConfig: options.thinkingLevel
        ? { thinkingLevel: THINKING_LEVELS[options.thinkingLevel] }
        : undefined,
    },
  })

  const text = response.text ?? '{}'
  const parsed = JSON.parse(text)
  const validated = options.schema.parse(parsed)

  const usage = response.usageMetadata
  return {
    object: validated,
    usage: {
      inputTokens: usage?.promptTokenCount ?? 0,
      outputTokens: usage?.candidatesTokenCount ?? 0,
      thinkingTokens: usage?.thoughtsTokenCount ?? 0,
    },
  }
}
