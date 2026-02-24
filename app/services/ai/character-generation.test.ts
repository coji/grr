import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock AI SDK
vi.mock('@ai-sdk/google', () => ({
  google: vi.fn(() => 'mock-model'),
}))

vi.mock('ai', () => ({
  generateObject: vi.fn(),
  generateText: vi.fn(),
}))

// Mock memory and personality services
vi.mock('~/services/memory', () => ({
  getActiveMemories: vi.fn(),
}))

vi.mock('./personality', () => ({
  getUserPersonality: vi.fn(),
}))

import { generateObject, generateText } from 'ai'
import { getActiveMemories } from '~/services/memory'
import {
  generateCharacterConcept,
  generateCharacterMessage,
  generateCharacterSvg,
  generateMessageSvg,
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

// biome-ignore lint/suspicious/noExplicitAny: Mock response helper
const mockGenerateTextResponse = (text: string) => ({
  text,
  finishReason: 'stop' as const,
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

describe('generateCharacterSvg', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should generate clean SVG from AI response', async () => {
    const svgContent =
      '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><circle cx="100" cy="100" r="50" fill="#FFB6C1"/></svg>'
    // biome-ignore lint/suspicious/noExplicitAny: Mock response
    vi.mocked(generateText).mockResolvedValue(
      mockGenerateTextResponse(svgContent) as any,
    )

    const result = await generateCharacterSvg({
      concept: mockConcept,
      evolutionStage: 1,
    })

    expect(result).toBe(svgContent)
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'mock-model',
        prompt: expect.stringContaining('モカ'),
      }),
    )
  })

  it('should strip markdown code blocks from SVG output', async () => {
    const rawSvg =
      '```svg\n<svg viewBox="0 0 200 200"><circle r="50"/></svg>\n```'
    // biome-ignore lint/suspicious/noExplicitAny: Mock response
    vi.mocked(generateText).mockResolvedValue(
      mockGenerateTextResponse(rawSvg) as any,
    )

    const result = await generateCharacterSvg({
      concept: mockConcept,
      evolutionStage: 2,
    })

    expect(result).toBe('<svg viewBox="0 0 200 200"><circle r="50"/></svg>')
  })

  it('should extract SVG when preceded by extra text', async () => {
    const rawSvg = 'Here is the SVG:\n<svg viewBox="0 0 200 200"><rect/></svg>'
    // biome-ignore lint/suspicious/noExplicitAny: Mock response
    vi.mocked(generateText).mockResolvedValue(
      mockGenerateTextResponse(rawSvg) as any,
    )

    const result = await generateCharacterSvg({
      concept: mockConcept,
      evolutionStage: 1,
    })

    expect(result).toBe('<svg viewBox="0 0 200 200"><rect/></svg>')
  })

  it('should truncate content after closing svg tag', async () => {
    const rawSvg =
      '<svg viewBox="0 0 200 200"><circle/></svg>\n\nExtra text here'
    // biome-ignore lint/suspicious/noExplicitAny: Mock response
    vi.mocked(generateText).mockResolvedValue(
      mockGenerateTextResponse(rawSvg) as any,
    )

    const result = await generateCharacterSvg({
      concept: mockConcept,
      evolutionStage: 1,
    })

    expect(result).toBe('<svg viewBox="0 0 200 200"><circle/></svg>')
  })

  it('should include evolution stage in prompt', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: Mock response
    vi.mocked(generateText).mockResolvedValue(
      mockGenerateTextResponse('<svg viewBox="0 0 200 200"></svg>') as any,
    )

    await generateCharacterSvg({ concept: mockConcept, evolutionStage: 5 })

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('段階5'),
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

describe('generateMessageSvg', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should generate SVG with emotion and action context', async () => {
    const svgContent =
      '<svg viewBox="0 0 200 200"><circle cx="100" cy="100" r="50" fill="#FFB6C1"/></svg>'
    // biome-ignore lint/suspicious/noExplicitAny: Mock response
    vi.mocked(generateText).mockResolvedValue(
      mockGenerateTextResponse(svgContent) as any,
    )

    const result = await generateMessageSvg({
      concept: mockConcept,
      evolutionStage: 3,
      emotion: 'love',
      action: 'pet',
    })

    expect(result).toBe(svgContent)
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'mock-model',
        prompt: expect.stringContaining('love'),
      }),
    )
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('pet'),
      }),
    )
  })

  it('should include emotion descriptions in prompt', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: Mock response
    vi.mocked(generateText).mockResolvedValue(
      mockGenerateTextResponse('<svg viewBox="0 0 200 200"></svg>') as any,
    )

    await generateMessageSvg({
      concept: mockConcept,
      evolutionStage: 2,
      emotion: 'shy',
      action: 'talk',
    })

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('照れて頬を赤らめている'),
      }),
    )
  })

  it('should include action descriptions in prompt', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: Mock response
    vi.mocked(generateText).mockResolvedValue(
      mockGenerateTextResponse('<svg viewBox="0 0 200 200"></svg>') as any,
    )

    await generateMessageSvg({
      concept: mockConcept,
      evolutionStage: 4,
      emotion: 'excited',
      action: 'dance',
    })

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('楽しそうに踊っている'),
      }),
    )
  })

  it('should clean up markdown code blocks from SVG output', async () => {
    const rawSvg =
      '```xml\n<svg viewBox="0 0 200 200"><circle r="30"/></svg>\n```'
    // biome-ignore lint/suspicious/noExplicitAny: Mock response
    vi.mocked(generateText).mockResolvedValue(
      mockGenerateTextResponse(rawSvg) as any,
    )

    const result = await generateMessageSvg({
      concept: mockConcept,
      evolutionStage: 1,
      emotion: 'happy',
      action: 'wave',
    })

    expect(result).toBe('<svg viewBox="0 0 200 200"><circle r="30"/></svg>')
  })

  it('should include character concept in prompt', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: Mock response
    vi.mocked(generateText).mockResolvedValue(
      mockGenerateTextResponse('<svg viewBox="0 0 200 200"></svg>') as any,
    )

    await generateMessageSvg({
      concept: mockConcept,
      evolutionStage: 3,
      emotion: 'sleepy',
      action: 'sparkle',
    })

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('コーヒー豆の妖精'),
      }),
    )
  })
})
