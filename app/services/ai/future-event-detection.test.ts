import { beforeEach, describe, expect, it, vi } from 'vitest'
import { detectFutureEvents } from './future-event-detection'

// Mock AI SDK
vi.mock('@ai-sdk/google', () => ({
  google: vi.fn(() => 'mock-model'),
}))

vi.mock('ai', () => ({
  generateObject: vi.fn(),
}))

import { generateObject } from 'ai'

describe('detectFutureEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should detect tomorrow event', async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        events: [
          {
            description: 'プレゼン',
            daysUntilEvent: 1,
          },
        ],
      },
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 20 },
      rawCall: { rawPrompt: null, rawSettings: {} },
      warnings: undefined,
      request: {},
      // biome-ignore lint/suspicious/noExplicitAny: Mock object for testing
    } as any)

    const result = await detectFutureEvents({
      entryText: '明日、大事なプレゼンがあります',
      currentDate: '2026-02-19',
    })

    expect(result).toHaveLength(1)
    expect(result[0].description).toBe('プレゼン')
    expect(result[0].eventDate).toBe('2026-02-20') // Tomorrow
    expect(result[0].followUpDate).toBe('2026-02-21') // Day after the event
    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'mock-model',
        schema: expect.any(Object),
        system: expect.stringContaining('未来のイベント'),
        prompt: expect.stringContaining('明日、大事なプレゼンがあります'),
      }),
    )
  })

  it('should detect multiple events', async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        events: [
          { description: '面接', daysUntilEvent: 2 },
          { description: 'デート', daysUntilEvent: 3 },
        ],
      },
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 20 },
      rawCall: { rawPrompt: null, rawSettings: {} },
      warnings: undefined,
      request: {},
      // biome-ignore lint/suspicious/noExplicitAny: Mock object for testing
    } as any)

    const result = await detectFutureEvents({
      entryText: '明後日に面接、3日後にデートがある',
      currentDate: '2026-02-19',
    })

    expect(result).toHaveLength(2)
    expect(result[0].description).toBe('面接')
    expect(result[0].eventDate).toBe('2026-02-21')
    expect(result[0].followUpDate).toBe('2026-02-22')
    expect(result[1].description).toBe('デート')
    expect(result[1].eventDate).toBe('2026-02-22')
    expect(result[1].followUpDate).toBe('2026-02-23')
  })

  it('should return empty array for no future events', async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        events: [],
      },
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 20 },
      rawCall: { rawPrompt: null, rawSettings: {} },
      warnings: undefined,
      request: {},
      // biome-ignore lint/suspicious/noExplicitAny: Mock object for testing
    } as any)

    const result = await detectFutureEvents({
      entryText: '今日は疲れました',
      currentDate: '2026-02-19',
    })

    expect(result).toHaveLength(0)
  })

  it('should return empty array for empty text', async () => {
    const result = await detectFutureEvents({
      entryText: '',
      currentDate: '2026-02-19',
    })

    expect(result).toHaveLength(0)
    expect(generateObject).not.toHaveBeenCalled()
  })

  it('should return empty array for whitespace-only text', async () => {
    const result = await detectFutureEvents({
      entryText: '   ',
      currentDate: '2026-02-19',
    })

    expect(result).toHaveLength(0)
    expect(generateObject).not.toHaveBeenCalled()
  })

  it('should return empty array on API error', async () => {
    vi.mocked(generateObject).mockRejectedValue(new Error('API error'))

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await detectFutureEvents({
      entryText: '明日のプレゼン',
      currentDate: '2026-02-19',
    })

    expect(result).toHaveLength(0)
    expect(consoleSpy).toHaveBeenCalledWith(
      'detectFutureEvents failed',
      expect.any(Error),
    )

    consoleSpy.mockRestore()
  })

  it('should include current date and day of week in system prompt', async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: { events: [] },
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 20 },
      rawCall: { rawPrompt: null, rawSettings: {} },
      warnings: undefined,
      request: {},
      // biome-ignore lint/suspicious/noExplicitAny: Mock object for testing
    } as any)

    await detectFutureEvents({
      entryText: 'テスト',
      currentDate: '2026-02-19',
    })

    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining('2026-02-19'),
      }),
    )
  })
})
