import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock AI SDK
vi.mock('@ai-sdk/google', () => ({
  google: vi.fn(() => 'mock-model'),
}))

vi.mock('ai', () => ({
  generateObject: vi.fn(),
}))

// Mock memory and personality services
vi.mock('~/services/memory', () => ({
  getActiveMemories: vi.fn(),
}))

vi.mock('./personality', () => ({
  getUserPersonality: vi.fn(),
}))

vi.mock('cloudflare:workers', () => ({
  env: { GOOGLE_GENERATIVE_AI_API_KEY: 'test-key' },
}))

const mockGenerateContent = vi.fn()
vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class MockGoogleGenAI {
      models = { generateContent: mockGenerateContent }
    },
  }
})

import { generateObject } from 'ai'
import { getActiveMemories } from '~/services/memory'
import {
  generateCharacterConcept,
  generateCharacterImage,
  generateCharacterMessage,
  type CharacterConcept,
} from './character-generation'
import { getUserPersonality } from './personality'

const mockConcept: CharacterConcept = {
  name: 'モカ',
  species: 'コーヒー豆の妖精',
  emoji: '☕',
  appearance: '茶色くて丸い体、小さな羽がある',
  personality: '穏やかで温かい',
  catchphrase: 'ほっと一息☕',
}

// biome-ignore lint/suspicious/noExplicitAny: Mock response helper
const mockGenerateObjectResponse = (object: any) => ({
  object,
  finishReason: 'stop',
  usage: { promptTokens: 10, completionTokens: 20 },
  rawCall: { rawPrompt: null, rawSettings: {} },
  warnings: undefined,
  request: {},
})

describe('generateCharacterConcept', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should generate a character concept from user memories', async () => {
    vi.mocked(getActiveMemories).mockResolvedValue([
      {
        id: 'm1',
        userId: 'U123',
        memoryType: 'preference',
        category: 'hobby',
        content: 'コーヒーが好き',
        confidence: 0.9,
        importance: 8,
        firstObservedAt: '2024-01-01',
        lastConfirmedAt: '2024-01-01',
        mentionCount: 3,
        isActive: 1,
        supersededBy: null,
        userConfirmed: 0,
        sourceEntryIds: null,
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
      },
    ])
    vi.mocked(getUserPersonality).mockResolvedValue(null)
    // biome-ignore lint/suspicious/noExplicitAny: Mock response
    vi.mocked(generateObject).mockResolvedValue(
      mockGenerateObjectResponse(mockConcept) as any,
    )

    const result = await generateCharacterConcept('U123')

    expect(result).toEqual(mockConcept)
    expect(getActiveMemories).toHaveBeenCalledWith('U123')
    expect(getUserPersonality).toHaveBeenCalledWith('U123')
    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'mock-model',
        schema: expect.any(Object),
        system: expect.stringContaining('オリジナルキャラクター'),
        prompt: expect.stringContaining('コーヒーが好き'),
      }),
    )
  })

  it('should handle empty memories gracefully', async () => {
    vi.mocked(getActiveMemories).mockResolvedValue([])
    vi.mocked(getUserPersonality).mockResolvedValue(null)
    // biome-ignore lint/suspicious/noExplicitAny: Mock response
    vi.mocked(generateObject).mockResolvedValue(
      mockGenerateObjectResponse(mockConcept) as any,
    )

    const result = await generateCharacterConcept('U123')

    expect(result).toEqual(mockConcept)
    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('まだ記憶がありません'),
      }),
    )
  })

  it('should include personality in prompt when available', async () => {
    vi.mocked(getActiveMemories).mockResolvedValue([])
    vi.mocked(getUserPersonality).mockResolvedValue({
      summary: 'クリエイティブな性格',
      traits: ['創造的', '好奇心旺盛'],
      interests: ['プログラミング', '音楽'],
      expressions: ['なるほど〜', 'わくわく！'],
      changeNote: null,
    })
    // biome-ignore lint/suspicious/noExplicitAny: Mock response
    vi.mocked(generateObject).mockResolvedValue(
      mockGenerateObjectResponse(mockConcept) as any,
    )

    await generateCharacterConcept('U123')

    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('クリエイティブな性格'),
      }),
    )
  })
})

describe('generateCharacterMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should generate a message for pet context', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: Mock response
    vi.mocked(generateObject).mockResolvedValue(
      mockGenerateObjectResponse({ message: 'きもちいい〜☕' }) as any,
    )

    const result = await generateCharacterMessage({
      concept: mockConcept,
      evolutionStage: 3,
      happiness: 80,
      energy: 60,
      context: 'pet',
    })

    expect(result).toBe('きもちいい〜☕')
    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining('モカ'),
        prompt: expect.stringContaining('撫でられた'),
      }),
    )
  })

  it('should generate a message for talk context', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: Mock response
    vi.mocked(generateObject).mockResolvedValue(
      mockGenerateObjectResponse({ message: 'なになに？☕' }) as any,
    )

    const result = await generateCharacterMessage({
      concept: mockConcept,
      evolutionStage: 2,
      happiness: 50,
      energy: 50,
      context: 'talk',
    })

    expect(result).toBe('なになに？☕')
  })

  it('should include character stats in system prompt', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: Mock response
    vi.mocked(generateObject).mockResolvedValue(
      mockGenerateObjectResponse({ message: 'test' }) as any,
    )

    await generateCharacterMessage({
      concept: mockConcept,
      evolutionStage: 4,
      happiness: 30,
      energy: 90,
      context: 'greeting',
    })

    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining('30/100'),
      }),
    )
  })

  it('should include additionalContext when provided', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: Mock response
    vi.mocked(generateObject).mockResolvedValue(
      mockGenerateObjectResponse({ message: 'やったね！☕' }) as any,
    )

    await generateCharacterMessage({
      concept: mockConcept,
      evolutionStage: 3,
      happiness: 80,
      energy: 60,
      context: 'diary_response',
      additionalContext: '良い一日だった',
    })

    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('良い一日だった'),
      }),
    )
  })
})

describe('generateCharacterImage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should generate image via Gemini Pro Image and return ArrayBuffer', async () => {
    vi.mocked(getActiveMemories).mockResolvedValue([])

    const mockImageData = btoa('fake-png-data')
    mockGenerateContent.mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  data: mockImageData,
                  mimeType: 'image/png',
                },
              },
            ],
          },
        },
      ],
      usageMetadata: {
        promptTokenCount: 200,
        candidatesTokenCount: 1000,
        totalTokenCount: 2200,
        thoughtsTokenCount: 1000,
      },
    })

    const result = await generateCharacterImage({
      userId: 'U_TEST',
      concept: mockConcept,
      evolutionStage: 1,
    })

    expect(result).toBeInstanceOf(ArrayBuffer)
    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3-pro-image-preview',
        config: {
          responseModalities: ['image', 'text'],
        },
      }),
    )
  })

  it('should throw when no image data in response', async () => {
    vi.mocked(getActiveMemories).mockResolvedValue([])

    mockGenerateContent.mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [{ text: 'No image generated' }],
          },
        },
      ],
    })

    await expect(
      generateCharacterImage({
        userId: 'U_TEST',
        concept: mockConcept,
        evolutionStage: 1,
      }),
    ).rejects.toThrow('No image data in response')
  })

  it('should include emotion and action in prompt', async () => {
    vi.mocked(getActiveMemories).mockResolvedValue([])

    const mockImageData = btoa('fake-png-data')
    mockGenerateContent.mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  data: mockImageData,
                  mimeType: 'image/png',
                },
              },
            ],
          },
        },
      ],
      usageMetadata: {
        promptTokenCount: 200,
        candidatesTokenCount: 1000,
        totalTokenCount: 1200,
      },
    })

    await generateCharacterImage({
      userId: 'U_TEST',
      concept: mockConcept,
      evolutionStage: 3,
      emotion: 'love',
      action: 'pet',
    })

    const call = mockGenerateContent.mock.calls[0][0]
    // contents is an array; the last element is the text prompt
    const prompt = call.contents[call.contents.length - 1] as string
    expect(prompt).toContain('heart eyes')
    expect(prompt).toContain('being petted')
  })
})
