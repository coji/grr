/// <reference types="@cloudflare/workers-types" />
/// <reference types="@cloudflare/vitest-pool-workers" />

import type { D1Migration } from '@cloudflare/vitest-pool-workers/config'

/**
 * Type definitions for test environment bindings.
 * These extend the ProvidedEnv interface from cloudflare:test module.
 */
declare module 'cloudflare:test' {
  interface ProvidedEnv {
    // D1 database binding from wrangler.jsonc
    DB: D1Database
    // Test-only binding for migrations (injected in vitest.integration.config.ts)
    TEST_MIGRATIONS: D1Migration[]
  }
}
