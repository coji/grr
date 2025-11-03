import { applyD1Migrations, env } from 'cloudflare:test'

/**
 * Setup for integration tests.
 * Applies D1 migrations to the test database before running tests.
 *
 * Uses Cloudflare's official migration APIs:
 * - readD1Migrations() in vitest.config.ts reads all migrations from /migrations
 * - applyD1Migrations() applies them to the test database
 *
 * Benefits:
 * - No need to manually import each migration file
 * - Automatic detection of new migrations
 * - Official support and maintenance
 * - Idempotent (safe to run multiple times)
 *
 * Note: Setup files run outside isolated storage, and applyD1Migrations() is
 * idempotent so it's safe to run in a beforeAll() or top-level await.
 */
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
