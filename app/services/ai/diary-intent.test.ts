import { beforeEach, describe, expect, it, vi } from 'vitest'
import { inferDiaryReplyIntent } from './diary-intent'

// Mock genai wrapper
vi.mock('./genai', () => ({
  generateObject: vi.fn(),
}))

import { generateObject } from './genai'

describe('inferDiaryReplyIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return comfort intent for supportive context', async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        intent: 'comfort',
        rationale: 'ユーザーが疲れを表現している',
      },
      usage: { inputTokens: 10, outputTokens: 20, thinkingTokens: 0 },
    })

    const result = await inferDiaryReplyIntent({
      personaName: 'Hotaru',
      userId: 'U123',
      latestEntry: '今日は疲れました',
    })

    expect(result.intent).toBe('comfort')
    expect(result.rationale).toBe('ユーザーが疲れを表現している')
    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3-flash-preview',
        schema: expect.any(Object),
        system: expect.stringContaining('## タスク'),
        prompt: expect.stringContaining('U123'),
      }),
    )
  })

  it('should return praise intent for achievement', async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        intent: 'praise',
        rationale: 'ユーザーが成果を報告している',
      },
      usage: { inputTokens: 10, outputTokens: 20, thinkingTokens: 0 },
    })

    const result = await inferDiaryReplyIntent({
      personaName: 'Hotaru',
      userId: 'U123',
      latestEntry: 'プロジェクトが完了しました!',
    })

    expect(result.intent).toBe('praise')
    expect(result.rationale).toBe('ユーザーが成果を報告している')
  })

  it('should return tough_feedback intent when user asks for feedback', async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        intent: 'tough_feedback',
        rationale: 'ユーザーが率直な意見を求めている',
      },
      usage: { inputTokens: 10, outputTokens: 20, thinkingTokens: 0 },
    })

    const result = await inferDiaryReplyIntent({
      personaName: 'Hotaru',
      userId: 'U123',
      mentionMessage: '率直な意見をください',
    })

    expect(result.intent).toBe('tough_feedback')
    expect(result.rationale).toBe('ユーザーが率直な意見を求めている')
  })

  it('should return reprimand intent when user asks for motivation', async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        intent: 'reprimand',
        rationale: 'ユーザーが叱咤激励を求めている',
      },
      usage: { inputTokens: 10, outputTokens: 20, thinkingTokens: 0 },
    })

    const result = await inferDiaryReplyIntent({
      personaName: 'Hotaru',
      userId: 'U123',
      mentionMessage: '叱ってください',
    })

    expect(result.intent).toBe('reprimand')
    expect(result.rationale).toBe('ユーザーが叱咤激励を求めている')
  })

  it('should return fallback (comfort) when no context provided', async () => {
    const result = await inferDiaryReplyIntent({
      personaName: 'Hotaru',
      userId: 'U123',
    })

    expect(result.intent).toBe('comfort')
    expect(result.rationale).toBeNull()
    expect(generateObject).not.toHaveBeenCalled()
  })

  it('should return fallback on API error', async () => {
    vi.mocked(generateObject).mockRejectedValue(new Error('API error'))

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await inferDiaryReplyIntent({
      personaName: 'Hotaru',
      userId: 'U123',
      latestEntry: 'test entry',
    })

    expect(result.intent).toBe('comfort')
    expect(result.rationale).toBeNull()
    expect(consoleSpy).toHaveBeenCalledWith(
      'inferDiaryReplyIntent failed',
      expect.any(Error),
    )

    consoleSpy.mockRestore()
  })

  it('should include both latestEntry and mentionMessage in prompt', async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        intent: 'comfort',
        rationale: 'テスト',
      },
      usage: { inputTokens: 10, outputTokens: 20, thinkingTokens: 0 },
    })

    await inferDiaryReplyIntent({
      personaName: 'Hotaru',
      userId: 'U123',
      latestEntry: '日記の内容',
      mentionMessage: 'メンションのメッセージ',
    })

    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('日記の内容'),
      }),
    )
    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('メンションのメッセージ'),
      }),
    )
  })
})
