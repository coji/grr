import { vi } from 'vitest'

export const createMockSlackClient = () => ({
  chat: {
    postMessage: vi.fn().mockResolvedValue({
      ok: true,
      channel: 'C123',
      ts: '1234567890.123456',
    }),
    update: vi.fn().mockResolvedValue({
      ok: true,
      channel: 'C123',
      ts: '1234567890.123456',
    }),
  },
  views: {
    open: vi.fn().mockResolvedValue({ ok: true }),
    update: vi.fn().mockResolvedValue({ ok: true }),
  },
  reactions: {
    add: vi.fn().mockResolvedValue({ ok: true }),
    remove: vi.fn().mockResolvedValue({ ok: true }),
  },
  users: {
    info: vi.fn().mockResolvedValue({
      ok: true,
      user: {
        id: 'U123',
        name: 'testuser',
        real_name: 'Test User',
      },
    }),
  },
})

export const createMockSlackContext = (overrides = {}) => ({
  client: createMockSlackClient(),
  cloudflare: {
    env: {},
    ctx: {
      waitUntil: vi.fn(),
    },
  },
  ...overrides,
})
