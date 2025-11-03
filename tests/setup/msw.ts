import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { handlers } from './msw-handlers'

/**
 * MSW server setup for integration tests.
 * This intercepts HTTP requests and returns mocked responses.
 */
export const server = setupServer(...handlers)

// Setup MSW
beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers())
