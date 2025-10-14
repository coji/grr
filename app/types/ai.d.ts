declare module '@ai-sdk/google' {
  export interface GoogleGenerativeAIConfig {
    apiKey: string
  }

  export interface LanguageModel {
    generate: (input: unknown, options?: unknown) => Promise<{ text: string }>
  }

  export function createGoogleGenerativeAI(
    config: GoogleGenerativeAIConfig,
  ): (modelId: string) => LanguageModel
}

declare module 'ai' {
  import type { LanguageModel } from '@ai-sdk/google'

  export interface GenerateTextOptions {
    model: LanguageModel
    prompt: string
    system?: string
    maxOutputTokens?: number
  }

  export interface GenerateTextResult {
    text: string
  }

  export function generateText(
    options: GenerateTextOptions,
  ): Promise<GenerateTextResult>
}
