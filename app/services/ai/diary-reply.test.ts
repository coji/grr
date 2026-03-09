import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock all dependencies
vi.mock('./genai', () => ({
  generateText: vi.fn(),
}))

vi.mock('./diary-intent', () => ({
  inferDiaryReplyIntent: vi.fn(),
}))

vi.mock('./keyword-extraction', () => ({
  extractKeywordsWithAI: vi.fn(),
}))

vi.mock('./persona', () => ({
  getPersonaWithCharacter: vi.fn().mockReturnValue('standard-persona'),
  getPersonaShortWithCharacter: vi.fn().mockReturnValue('short-persona'),
  getPersonaBackground: vi.fn().mockReturnValue('persona-bg'),
}))

vi.mock('./personality', () => ({
  getUserPersonality: vi.fn(),
}))

vi.mock('~/services/diary-search', () => ({
  getSearchContextForAI: vi.fn(),
  formatSearchContextForPrompt: vi.fn(),
}))

vi.mock('~/services/memory-retrieval', () => ({
  getMemoryContextForReply: vi.fn(),
}))

import { getMemoryContextForReply } from '~/services/memory-retrieval'
import { inferDiaryReplyIntent } from './diary-intent'
import { generateDiaryReply } from './diary-reply'
import { generateText } from './genai'
import { extractKeywordsWithAI } from './keyword-extraction'
import {
  getPersonaShortWithCharacter,
  getPersonaWithCharacter,
} from './persona'
import { getUserPersonality } from './personality'

describe('generateDiaryReply', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getMemoryContextForReply).mockResolvedValue({
      summary: '',
      memories: [],
      tokenEstimate: 0,
    })
  })

  describe('isFollowupReply = true', () => {
    it('should use short persona and thinkingLevel low', async () => {
      vi.mocked(generateText).mockResolvedValue({
        text: 'いいね、楽しそう！',
        usage: { inputTokens: 10, outputTokens: 20, thinkingTokens: 5 },
      })

      await generateDiaryReply({
        userId: 'U123',
        mentionMessage: '悪くなかったよ。',
        isFollowupReply: true,
      })

      // Should use short persona (per prompting guide for followups)
      expect(getPersonaShortWithCharacter).toHaveBeenCalled()
      expect(getPersonaWithCharacter).not.toHaveBeenCalled()

      // Should use thinkingLevel: 'low'
      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          thinkingLevel: 'low',
        }),
      )
    })

    it('should skip expensive operations (intent, personality, keywords)', async () => {
      vi.mocked(generateText).mockResolvedValue({
        text: 'そうなんだ！',
        usage: { inputTokens: 10, outputTokens: 10, thinkingTokens: 5 },
      })

      await generateDiaryReply({
        userId: 'U123',
        mentionMessage: 'テスト',
        isFollowupReply: true,
      })

      // These expensive operations should NOT be called for followup replies
      expect(inferDiaryReplyIntent).not.toHaveBeenCalled()
      expect(getUserPersonality).not.toHaveBeenCalled()
      expect(extractKeywordsWithAI).not.toHaveBeenCalled()
    })

    it('should still fetch memory context', async () => {
      vi.mocked(getMemoryContextForReply).mockResolvedValue({
        summary: 'ユーザーはラーメンが好き',
        memories: [],
        tokenEstimate: 50,
      })
      vi.mocked(generateText).mockResolvedValue({
        text: 'ラーメン食べたいね',
        usage: { inputTokens: 10, outputTokens: 10, thinkingTokens: 5 },
      })

      await generateDiaryReply({
        userId: 'U123',
        mentionMessage: 'おなかすいた',
        isFollowupReply: true,
      })

      expect(getMemoryContextForReply).toHaveBeenCalledWith('U123', 500)
      // Memory context should be included in the system prompt
      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          system: expect.stringContaining('ユーザーはラーメンが好き'),
        }),
      )
    })

    it('should return generated text', async () => {
      vi.mocked(generateText).mockResolvedValue({
        text: '充実した時間だったんだね！',
        usage: { inputTokens: 10, outputTokens: 15, thinkingTokens: 5 },
      })

      const result = await generateDiaryReply({
        userId: 'U123',
        mentionMessage: '楽しかったよ',
        isFollowupReply: true,
      })

      expect(result).toBe('充実した時間だったんだね！')
    })

    it('should include imageAttachments in contents when provided', async () => {
      vi.mocked(generateText).mockResolvedValue({
        text: 'いい写真だね！',
        usage: { inputTokens: 100, outputTokens: 10, thinkingTokens: 5 },
      })

      const testImage = {
        buffer: Buffer.from('fake-image-data'),
        mimeType: 'image/png',
        fileName: 'test.png',
      }

      await generateDiaryReply({
        userId: 'U123',
        mentionMessage: '写真送るね',
        isFollowupReply: true,
        imageAttachments: [testImage],
      })

      // Should include image in contents parts
      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          contents: expect.arrayContaining([
            expect.objectContaining({
              parts: expect.arrayContaining([
                expect.objectContaining({
                  inlineData: expect.objectContaining({
                    mimeType: 'image/png',
                  }),
                }),
              ]),
            }),
          ]),
        }),
      )
    })
  })

  describe('isFollowupReply = false (default)', () => {
    it('should use standard persona and thinkingLevel medium', async () => {
      vi.mocked(inferDiaryReplyIntent).mockResolvedValue({
        intent: 'comfort',
        rationale: 'test',
      })
      vi.mocked(generateText).mockResolvedValue({
        text: '今日もお疲れ様。ゆっくり休んでね。',
        usage: { inputTokens: 50, outputTokens: 30, thinkingTokens: 20 },
      })

      await generateDiaryReply({
        userId: 'U123',
        latestEntry: '今日は疲れた',
      })

      // Should use standard persona
      expect(getPersonaWithCharacter).toHaveBeenCalled()
      expect(getPersonaShortWithCharacter).not.toHaveBeenCalled()

      // Should use thinkingLevel: 'medium'
      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          thinkingLevel: 'medium',
        }),
      )

      // Should call intent analysis
      expect(inferDiaryReplyIntent).toHaveBeenCalled()
    })
  })
})
