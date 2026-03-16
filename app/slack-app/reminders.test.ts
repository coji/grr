import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock all external dependencies
vi.mock('nanoid', () => ({ nanoid: vi.fn().mockReturnValue('test-id') }))

const mockChatPostMessage = vi.fn()
const mockUsersInfo = vi.fn()
const mockUsersList = vi.fn()
const mockAuthTest = vi.fn()

vi.mock('slack-edge', () => {
  return {
    SlackAPIClient: class MockSlackAPIClient {
      auth = { test: mockAuthTest }
      users = { list: mockUsersList, info: mockUsersInfo }
      chat = { postMessage: mockChatPostMessage }
    },
  }
})

vi.mock('~/services/ai', () => ({
  generateDiaryReminder: vi.fn().mockResolvedValue('今日の気分は？'),
}))

vi.mock('~/services/db', () => ({
  db: {
    selectFrom: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    selectAll: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insertInto: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue([]),
    executeTakeFirst: vi.fn().mockResolvedValue(null),
    fn: { count: vi.fn().mockReturnValue({ as: vi.fn() }) },
  },
}))

vi.mock('~/services/proactive-messages', () => ({
  countConsecutiveNoResponseDays: vi.fn().mockResolvedValue(0),
  getUserMilestones: vi.fn().mockResolvedValue(null),
}))

vi.mock('~/services/character', () => ({
  getCharacterPersonaInfoSafe: vi.fn().mockResolvedValue(null),
}))

import { db } from '~/services/db'
import { countConsecutiveNoResponseDays } from '~/services/proactive-messages'
import { sendDailyDiaryReminders } from './reminders'

// Helper to set up a user that would normally receive a reminder
function setupUserWhoShouldReceiveReminder() {
  // Reset all Slack mocks
  mockAuthTest.mockResolvedValue({ ok: true, user_id: 'BOT' })
  mockUsersList.mockResolvedValue({
    ok: true,
    members: [{ id: 'U1', is_bot: false, deleted: false }],
  })
  mockUsersInfo.mockResolvedValue({ ok: true, user: { tz: 'Asia/Tokyo' } })
  mockChatPostMessage.mockResolvedValue({ ok: true, ts: '123.456' })

  // Current hour matches reminder hour (21)
  vi.useFakeTimers()
  // Set to 21:00 JST (12:00 UTC)
  vi.setSystemTime(new Date('2026-03-02T12:00:00Z'))

  let diaryEntriesCallCount = 0

  const mockSelectFrom = vi.fn().mockImplementation((table: string) => {
    const createChain = () => {
      const chainObj: Record<string, unknown> = {}
      chainObj.select = vi.fn().mockReturnValue(chainObj)
      chainObj.selectAll = vi.fn().mockReturnValue(chainObj)
      chainObj.where = vi.fn().mockReturnValue(chainObj)
      chainObj.orderBy = vi.fn().mockReturnValue(chainObj)
      chainObj.limit = vi.fn().mockReturnValue(chainObj)
      chainObj.execute = vi.fn().mockResolvedValue([])
      chainObj.executeTakeFirst = vi.fn().mockResolvedValue(null)
      return chainObj
    }

    const chain = createChain()

    if (table === 'userDiarySettings') {
      chain.executeTakeFirst = vi.fn().mockResolvedValue({
        reminderEnabled: 1,
        reminderHour: 21,
        skipWeekends: 0,
        diaryChannelId: 'C1',
      })
    } else if (table === 'diaryEntries') {
      // Track call order to return different results
      diaryEntriesCallCount++
      if (diaryEntriesCallCount === 1) {
        // First call: check existing entry for today (return null = no entry)
        chain.executeTakeFirst = vi.fn().mockResolvedValue(null)
      } else if (diaryEntriesCallCount === 2) {
        // Second call: get previous entry for channel
        chain.executeTakeFirst = vi.fn().mockResolvedValue({ channelId: 'C1' })
      }
    }

    return chain
  })

  vi.mocked(db.selectFrom).mockImplementation(mockSelectFrom)

  const mockInsertChain = {
    values: vi.fn().mockReturnValue({
      execute: vi.fn().mockResolvedValue([]),
    }),
  }
  vi.mocked(db.insertInto).mockReturnValue(mockInsertChain as never)
}

describe('sendDailyDiaryReminders - throttling', () => {
  const env = { SLACK_BOT_TOKEN: 'xoxb-test' } as Env

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('should skip reminder when user has 3+ consecutive no-response days', async () => {
    setupUserWhoShouldReceiveReminder()
    vi.mocked(countConsecutiveNoResponseDays).mockResolvedValue(3)

    await sendDailyDiaryReminders(env)

    expect(countConsecutiveNoResponseDays).toHaveBeenCalledWith('U1')
    expect(mockChatPostMessage).not.toHaveBeenCalled()

    vi.useRealTimers()
  })

  it('should send reminder when user has fewer than 3 no-response days', async () => {
    setupUserWhoShouldReceiveReminder()
    vi.mocked(countConsecutiveNoResponseDays).mockResolvedValue(2)

    await sendDailyDiaryReminders(env)

    expect(countConsecutiveNoResponseDays).toHaveBeenCalledWith('U1')
    expect(mockChatPostMessage).toHaveBeenCalled()

    vi.useRealTimers()
  })

  it('should send reminder when user has 0 no-response days', async () => {
    setupUserWhoShouldReceiveReminder()
    vi.mocked(countConsecutiveNoResponseDays).mockResolvedValue(0)

    await sendDailyDiaryReminders(env)

    expect(mockChatPostMessage).toHaveBeenCalled()

    vi.useRealTimers()
  })
})
