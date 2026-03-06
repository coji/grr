import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies
vi.mock('./ai', () => ({
  generateGentleReengagementMessage: vi.fn(),
  generateAutoPauseMessage: vi.fn(),
}))

vi.mock('./db', () => ({
  db: {
    updateTable: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock('./character', () => ({
  getCharacterPersonaInfoBatch: vi.fn().mockResolvedValue(
    new Map([
      [
        'U1',
        {
          name: 'テストキャラ',
          species: 'テスト',
          personality: 'テスト性格',
          catchphrase: 'テストフレーズ',
        },
      ],
    ]),
  ),
}))

vi.mock('./proactive-messages', () => ({
  getActiveUsers: vi.fn(),
  hasEverWrittenDiary: vi.fn(),
  countConsecutiveNoResponseDays: vi.fn(),
  getReengagementCount: vi.fn(),
  getLastMessageOfType: vi.fn(),
  wasMessageSent: vi.fn(),
  recordProactiveMessage: vi.fn(),
}))

vi.mock('./seasonal-events', () => ({
  getSeasonalEventsForDate: vi.fn().mockReturnValue([]),
}))

import {
  generateAutoPauseMessage,
  generateGentleReengagementMessage,
} from './ai'
import {
  evaluateAutoPauseReminders,
  evaluateGentleReengagementMessages,
} from './heartbeat-evaluators'
import {
  countConsecutiveNoResponseDays,
  getActiveUsers,
  getLastMessageOfType,
  getReengagementCount,
  hasEverWrittenDiary,
  wasMessageSent,
} from './proactive-messages'

describe('evaluateGentleReengagementMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(generateGentleReengagementMessage).mockResolvedValue(
      '元気にしてる？',
    )
  })

  it('should send message when user has 5+ no-response days', async () => {
    vi.mocked(getActiveUsers).mockResolvedValue([
      { userId: 'U1', channelId: 'C1' },
    ])
    vi.mocked(hasEverWrittenDiary).mockResolvedValue(true)
    vi.mocked(countConsecutiveNoResponseDays).mockResolvedValue(7)
    vi.mocked(getReengagementCount).mockResolvedValue(0)
    vi.mocked(getLastMessageOfType).mockResolvedValue(undefined)
    vi.mocked(wasMessageSent).mockResolvedValue(false)

    const results = await evaluateGentleReengagementMessages()

    expect(results).toHaveLength(1)
    expect(results[0].userId).toBe('U1')
    expect(results[0].messageType).toBe('gentle_reengagement')
    expect(results[0].text).toBe('元気にしてる？')
  })

  it('should skip user who never wrote a diary', async () => {
    vi.mocked(getActiveUsers).mockResolvedValue([
      { userId: 'U1', channelId: 'C1' },
    ])
    vi.mocked(hasEverWrittenDiary).mockResolvedValue(false)

    const results = await evaluateGentleReengagementMessages()

    expect(results).toHaveLength(0)
    expect(countConsecutiveNoResponseDays).not.toHaveBeenCalled()
  })

  it('should skip user with fewer than 5 no-response days', async () => {
    vi.mocked(getActiveUsers).mockResolvedValue([
      { userId: 'U1', channelId: 'C1' },
    ])
    vi.mocked(hasEverWrittenDiary).mockResolvedValue(true)
    vi.mocked(countConsecutiveNoResponseDays).mockResolvedValue(3)

    const results = await evaluateGentleReengagementMessages()

    expect(results).toHaveLength(0)
  })

  it('should skip user who already received 3 re-engagements', async () => {
    vi.mocked(getActiveUsers).mockResolvedValue([
      { userId: 'U1', channelId: 'C1' },
    ])
    vi.mocked(hasEverWrittenDiary).mockResolvedValue(true)
    vi.mocked(countConsecutiveNoResponseDays).mockResolvedValue(10)
    vi.mocked(getReengagementCount).mockResolvedValue(3)

    const results = await evaluateGentleReengagementMessages()

    expect(results).toHaveLength(0)
  })

  it('should skip user within 14-day cooldown', async () => {
    vi.mocked(getActiveUsers).mockResolvedValue([
      { userId: 'U1', channelId: 'C1' },
    ])
    vi.mocked(hasEverWrittenDiary).mockResolvedValue(true)
    vi.mocked(countConsecutiveNoResponseDays).mockResolvedValue(10)
    vi.mocked(getReengagementCount).mockResolvedValue(1)
    // Last message sent 5 days ago (within 14-day cooldown)
    vi.mocked(getLastMessageOfType).mockResolvedValue({
      id: 'msg1',
      userId: 'U1',
      channelId: 'C1',
      messageType: 'gentle_reengagement',
      messageKey: null,
      metadata: null,
      messageTs: null,
      sentAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
    })

    const results = await evaluateGentleReengagementMessages()

    expect(results).toHaveLength(0)
  })

  it('should send when cooldown has elapsed', async () => {
    vi.mocked(getActiveUsers).mockResolvedValue([
      { userId: 'U1', channelId: 'C1' },
    ])
    vi.mocked(hasEverWrittenDiary).mockResolvedValue(true)
    vi.mocked(countConsecutiveNoResponseDays).mockResolvedValue(20)
    vi.mocked(getReengagementCount).mockResolvedValue(1)
    // Last message sent 15 days ago (past 14-day cooldown)
    vi.mocked(getLastMessageOfType).mockResolvedValue({
      id: 'msg1',
      userId: 'U1',
      channelId: 'C1',
      messageType: 'gentle_reengagement',
      messageKey: null,
      metadata: null,
      messageTs: null,
      sentAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
    })
    vi.mocked(wasMessageSent).mockResolvedValue(false)

    const results = await evaluateGentleReengagementMessages()

    expect(results).toHaveLength(1)
    expect(results[0].metadata).toEqual({
      noResponseDays: 20,
      attemptNumber: 2,
    })
  })

  it('should include attempt number in metadata', async () => {
    vi.mocked(getActiveUsers).mockResolvedValue([
      { userId: 'U1', channelId: 'C1' },
    ])
    vi.mocked(hasEverWrittenDiary).mockResolvedValue(true)
    vi.mocked(countConsecutiveNoResponseDays).mockResolvedValue(5)
    vi.mocked(getReengagementCount).mockResolvedValue(2)
    vi.mocked(getLastMessageOfType).mockResolvedValue({
      id: 'msg1',
      userId: 'U1',
      channelId: 'C1',
      messageType: 'gentle_reengagement',
      messageKey: null,
      metadata: null,
      messageTs: null,
      sentAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
    })
    vi.mocked(wasMessageSent).mockResolvedValue(false)

    const results = await evaluateGentleReengagementMessages()

    expect(results).toHaveLength(1)
    expect(results[0].metadata?.attemptNumber).toBe(3)
  })
})

describe('evaluateAutoPauseReminders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(generateAutoPauseMessage).mockResolvedValue(
      'お休みにしておくね。',
    )
  })

  it('should auto-pause after 3 re-engagements with no response', async () => {
    vi.mocked(getActiveUsers).mockResolvedValue([
      { userId: 'U1', channelId: 'C1' },
    ])
    vi.mocked(getReengagementCount).mockResolvedValue(3)
    // No auto_pause sent yet
    vi.mocked(getLastMessageOfType).mockImplementation(
      async (_userId, messageType) => {
        if (messageType === 'auto_pause') return undefined
        if (messageType === 'gentle_reengagement') {
          return {
            id: 'msg3',
            userId: 'U1',
            channelId: 'C1',
            messageType: 'gentle_reengagement',
            messageKey: null,
            metadata: null,
            messageTs: null,
            sentAt: new Date(
              Date.now() - 15 * 24 * 60 * 60 * 1000,
            ).toISOString(),
            createdAt: new Date().toISOString(),
          }
        }
        return undefined
      },
    )
    vi.mocked(countConsecutiveNoResponseDays).mockResolvedValue(50)

    const results = await evaluateAutoPauseReminders()

    expect(results).toHaveLength(1)
    expect(results[0].messageType).toBe('auto_pause')
  })

  it('should skip if re-engagement count is not exactly 3', async () => {
    vi.mocked(getActiveUsers).mockResolvedValue([
      { userId: 'U1', channelId: 'C1' },
    ])
    vi.mocked(getReengagementCount).mockResolvedValue(2)

    const results = await evaluateAutoPauseReminders()

    expect(results).toHaveLength(0)
  })

  it('should skip if auto_pause already sent', async () => {
    vi.mocked(getActiveUsers).mockResolvedValue([
      { userId: 'U1', channelId: 'C1' },
    ])
    vi.mocked(getReengagementCount).mockResolvedValue(3)
    vi.mocked(getLastMessageOfType).mockImplementation(
      async (_userId, messageType) => {
        if (messageType === 'auto_pause') {
          return {
            id: 'msg4',
            userId: 'U1',
            channelId: 'C1',
            messageType: 'auto_pause',
            messageKey: null,
            metadata: null,
            messageTs: null,
            sentAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          }
        }
        return undefined
      },
    )

    const results = await evaluateAutoPauseReminders()

    expect(results).toHaveLength(0)
  })

  it('should skip if user responded (noResponseDays < 5)', async () => {
    vi.mocked(getActiveUsers).mockResolvedValue([
      { userId: 'U1', channelId: 'C1' },
    ])
    vi.mocked(getReengagementCount).mockResolvedValue(3)
    vi.mocked(getLastMessageOfType).mockImplementation(
      async (_userId, messageType) => {
        if (messageType === 'auto_pause') return undefined
        if (messageType === 'gentle_reengagement') {
          return {
            id: 'msg3',
            userId: 'U1',
            channelId: 'C1',
            messageType: 'gentle_reengagement',
            messageKey: null,
            metadata: null,
            messageTs: null,
            sentAt: new Date(
              Date.now() - 15 * 24 * 60 * 60 * 1000,
            ).toISOString(),
            createdAt: new Date().toISOString(),
          }
        }
        return undefined
      },
    )
    // User responded recently
    vi.mocked(countConsecutiveNoResponseDays).mockResolvedValue(2)

    const results = await evaluateAutoPauseReminders()

    expect(results).toHaveLength(0)
  })
})
