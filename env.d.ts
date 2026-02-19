/// <reference types="@cloudflare/workers-types" />
/// <reference types="@cloudflare/vitest-pool-workers" />

import type { D1Migration } from '@cloudflare/vitest-pool-workers/config'

/**
 * Extend the Cloudflare.Env interface with secrets that are not in wrangler.jsonc
 * These are set as Cloudflare secrets in production.
 * Note: wrangler types generates `interface Env extends Cloudflare.Env {}`,
 * so we augment Cloudflare.Env to add secrets.
 */
declare global {
  namespace Cloudflare {
    interface Env {
      SLACK_SIGNING_SECRET: string
      SLACK_BOT_TOKEN: string
      GOOGLE_GENERATIVE_AI_API_KEY: string
    }
  }
}

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
