import { vi } from 'vitest'

// Mock @ai-sdk/google
export const mockGoogle = vi.fn(() => 'mock-model')

// Mock AI SDK functions
export const mockGenerateText = vi.fn(async () => ({
  text: 'Mock AI response text',
  finishReason: 'stop' as const,
  usage: { promptTokens: 10, completionTokens: 20 },
  rawCall: { rawPrompt: null, rawSettings: {} },
  warnings: undefined,
  request: {},
}))

export const mockGenerateObject = vi.fn(async ({ schema }) => ({
  object: {
    intent: 'comfort',
    rationale: 'Mock intent classification',
  },
  finishReason: 'stop' as const,
  usage: { promptTokens: 10, completionTokens: 20 },
  rawCall: { rawPrompt: null, rawSettings: {} },
  warnings: undefined,
  request: {},
}))

// Setup mocks - call this in test files
export const setupAIMocks = () => {
  vi.mock('@ai-sdk/google', () => ({
    google: mockGoogle,
  }))

  vi.mock('ai', () => ({
    generateText: mockGenerateText,
    generateObject: mockGenerateObject,
  }))
}
