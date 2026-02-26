import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock genai wrapper
vi.mock('./genai', () => ({
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

import { getActiveMemories } from '~/services/memory'
import {
  generateCharacterConcept,
  generateCharacterImage,
  generateCharacterMessage,
  generateCharacterReaction,
  generateWeeklyTheme,
  getWeeklyTheme,
  type CharacterConcept,
} from './character-generation'
import { generateObject } from './genai'
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
  usage: { inputTokens: 10, outputTokens: 20, thinkingTokens: 0 },
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
    vi.mocked(generateObject).mockResolvedValue(
      mockGenerateObjectResponse(mockConcept),
    )

    const result = await generateCharacterConcept('U123')

    expect(result).toEqual(mockConcept)
    expect(getActiveMemories).toHaveBeenCalledWith('U123')
    expect(getUserPersonality).toHaveBeenCalledWith('U123')
    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3-flash-preview',
        schema: expect.any(Object),
        system: expect.stringContaining('オリジナルキャラクター'),
        prompt: expect.stringContaining('コーヒーが好き'),
      }),
    )
  })

  it('should handle empty memories gracefully', async () => {
    vi.mocked(getActiveMemories).mockResolvedValue([])
    vi.mocked(getUserPersonality).mockResolvedValue(null)
    vi.mocked(generateObject).mockResolvedValue(
      mockGenerateObjectResponse(mockConcept),
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
    vi.mocked(generateObject).mockResolvedValue(
      mockGenerateObjectResponse(mockConcept),
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
    vi.mocked(generateObject).mockResolvedValue(
      mockGenerateObjectResponse({ message: 'きもちいい〜☕' }),
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
    vi.mocked(generateObject).mockResolvedValue(
      mockGenerateObjectResponse({ message: 'なになに？☕' }),
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
    vi.mocked(generateObject).mockResolvedValue(
      mockGenerateObjectResponse({ message: 'test' }),
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
    vi.mocked(generateObject).mockResolvedValue(
      mockGenerateObjectResponse({ message: 'やったね！☕' }),
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

  it('should generate image via Gemini Flash Image and return ArrayBuffer', async () => {
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
        model: 'gemini-3.1-flash-image-preview',
        config: {
          responseModalities: ['image', 'text'],
          imageConfig: {
            aspectRatio: '1:1',
            imageSize: '0.5K',
          },
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

describe('generateCharacterReaction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should generate a reaction with message, title, and emoji', async () => {
    vi.mocked(generateObject).mockResolvedValue(
      mockGenerateObjectResponse({
        message: 'きもちいいね〜☕',
        reactionTitle: 'もふもふ',
        reactionEmoji: '😊',
      }),
    )

    const result = await generateCharacterReaction({
      concept: mockConcept,
      evolutionStage: 3,
      happiness: 80,
      energy: 60,
      context: 'pet',
      reactionIntensity: 'normal',
    })

    expect(result.message).toBe('きもちいいね〜☕')
    expect(result.reactionTitle).toBe('もふもふ')
    expect(result.reactionEmoji).toBe('😊')
  })

  it('should include tierCelebration for legendary intensity', async () => {
    vi.mocked(generateObject).mockResolvedValue(
      mockGenerateObjectResponse({
        message: 'さいこう！！☕',
        reactionTitle: 'きゅん',
        reactionEmoji: '💖',
        tierCelebration: '奇跡だよ！',
      }),
    )

    const result = await generateCharacterReaction({
      concept: mockConcept,
      evolutionStage: 5,
      happiness: 100,
      energy: 100,
      context: 'pet',
      reactionIntensity: 'legendary',
    })

    expect(result.tierCelebration).toBe('奇跡だよ！')
    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('tierCelebration'),
      }),
    )
  })

  it('should not request tierCelebration for normal intensity', async () => {
    vi.mocked(generateObject).mockResolvedValue(
      mockGenerateObjectResponse({
        message: 'うんうん☕',
        reactionTitle: 'ほのぼの',
        reactionEmoji: '😌',
      }),
    )

    await generateCharacterReaction({
      concept: mockConcept,
      evolutionStage: 2,
      happiness: 50,
      energy: 50,
      context: 'talk',
      reactionIntensity: 'normal',
    })

    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.not.stringContaining('tierCelebration'),
      }),
    )
  })

  it('should include rich context when provided', async () => {
    vi.mocked(generateObject).mockResolvedValue(
      mockGenerateObjectResponse({
        message: 'おはよ〜☕',
        reactionTitle: 'ぽかぽか',
        reactionEmoji: '🌅',
      }),
    )

    await generateCharacterReaction({
      concept: mockConcept,
      evolutionStage: 3,
      happiness: 70,
      energy: 80,
      context: 'pet',
      reactionIntensity: 'good',
      timeOfDay: 'morning',
      recentMood: '😄 ほっと安心',
      userMemories: ['コーヒーが好き', '朝型'],
    })

    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining('朝'),
      }),
    )
  })

  it('should pass additionalContext as flavor description', async () => {
    vi.mocked(generateObject).mockResolvedValue(
      mockGenerateObjectResponse({
        message: 'えへへ☕',
        reactionTitle: 'てれてれ',
        reactionEmoji: '😳',
      }),
    )

    await generateCharacterReaction({
      concept: mockConcept,
      evolutionStage: 3,
      happiness: 80,
      energy: 60,
      context: 'pet',
      reactionIntensity: 'normal',
      additionalContext: '照れている、恥ずかしそう',
    })

    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('照れている'),
      }),
    )
  })
})

describe('getWeeklyTheme (base theme)', () => {
  it('should return winter/Valentine theme for late February', () => {
    // February 26th - should be week 4 (days 22+) = 'ぬくぬく' (cozy indoor)
    const feb26 = new Date(2026, 1, 26) // month is 0-indexed, so 1 = February
    const theme = getWeeklyTheme(feb26)

    expect(theme.label).toBe('ぬくぬく')
    expect(theme.desc).toContain('cozy')
  })

  it('should return Valentine theme for early February', () => {
    // February 5th - should be week 1 (days 1-7) = 'バレンタイン'
    const feb5 = new Date(2026, 1, 5)
    const theme = getWeeklyTheme(feb5)

    expect(theme.label).toBe('バレンタイン')
    expect(theme.desc).toContain('Valentine')
  })

  it('should return Hinamatsuri theme for early March', () => {
    // March 3rd - should be week 1 = 'ひなまつり'
    const mar3 = new Date(2026, 2, 3)
    const theme = getWeeklyTheme(mar3)

    expect(theme.label).toBe('ひなまつり')
    expect(theme.desc).toContain('Hinamatsuri')
  })

  it('should return summer festival theme for August', () => {
    // August 10th - should be week 2 = '夏祭り'
    const aug10 = new Date(2026, 7, 10)
    const theme = getWeeklyTheme(aug10)

    expect(theme.label).toBe('夏祭り')
    expect(theme.desc).toContain('summer festival')
  })

  it('should return fireworks theme for early August', () => {
    // August 1st - should be week 1 = '花火'
    const aug1 = new Date(2026, 7, 1)
    const theme = getWeeklyTheme(aug1)

    expect(theme.label).toBe('花火')
    expect(theme.desc).toContain('fireworks')
  })

  it('should return Christmas theme for December', () => {
    // December 1st - should be week 1 = 'クリスマス'
    const dec1 = new Date(2026, 11, 1)
    const theme = getWeeklyTheme(dec1)

    expect(theme.label).toBe('クリスマス')
    expect(theme.desc).toContain('Christmas')
  })

  it('should return New Year theme for January', () => {
    // January 1st - should be week 1 = 'お正月'
    const jan1 = new Date(2026, 0, 1)
    const theme = getWeeklyTheme(jan1)

    expect(theme.label).toBe('お正月')
    expect(theme.desc).toContain('New Year')
  })

  it('should cycle through 4 themes within a month', () => {
    // Test all 4 weeks of February
    const week1 = getWeeklyTheme(new Date(2026, 1, 1)) // days 1-7
    const week2 = getWeeklyTheme(new Date(2026, 1, 8)) // days 8-14
    const week3 = getWeeklyTheme(new Date(2026, 1, 15)) // days 15-21
    const week4 = getWeeklyTheme(new Date(2026, 1, 22)) // days 22+

    expect(week1.label).toBe('バレンタイン')
    expect(week2.label).toBe('冬の夜空')
    expect(week3.label).toBe('梅の花')
    expect(week4.label).toBe('ぬくぬく')
  })

  it('should handle day 28, 29, 30, 31 as week 4', () => {
    // All late month dates should return week 4 theme
    const day28 = getWeeklyTheme(new Date(2026, 0, 28)) // January 28
    const day31 = getWeeklyTheme(new Date(2026, 0, 31)) // January 31

    expect(day28.label).toBe('こたつ') // Week 4 January theme
    expect(day31.label).toBe('こたつ') // Same week 4 theme
  })
})

describe('generateWeeklyTheme (AI-enhanced)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should enhance base theme with AI-generated flavor', async () => {
    vi.mocked(generateObject).mockResolvedValue(
      mockGenerateObjectResponse({
        label: '粉雪の朝',
        desc: 'gentle snowflakes falling at dawn, warm light through frosted window',
      }),
    )

    const theme = await generateWeeklyTheme(new Date(2026, 0, 15)) // January week 3

    expect(theme.label).toBe('粉雪の朝')
    expect(theme.desc).toContain('snowflakes')
    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('雪景色'), // Base theme for Jan week 3
      }),
    )
  })

  it('should fall back to base theme if AI fails', async () => {
    vi.mocked(generateObject).mockRejectedValue(new Error('AI unavailable'))

    const theme = await generateWeeklyTheme(new Date(2026, 1, 5)) // February week 1

    // Should return the base theme
    expect(theme.label).toBe('バレンタイン')
    expect(theme.desc).toContain('Valentine')
  })
})
