import { vi } from 'vitest'

// Mock genai wrapper functions
export const mockGenerateText = vi.fn(async () => ({
  text: 'Mock AI response text',
  usage: { inputTokens: 10, outputTokens: 20, thinkingTokens: 0 },
}))

export const mockGenerateObject = vi.fn(async () => ({
  object: {
    intent: 'comfort',
    rationale: 'Mock intent classification',
  },
  usage: { inputTokens: 10, outputTokens: 20, thinkingTokens: 0 },
}))

// Setup mocks - call this in test files
export const setupAIMocks = () => {
  vi.mock('~/services/ai/genai', () => ({
    generateText: mockGenerateText,
    generateObject: mockGenerateObject,
  }))
}
