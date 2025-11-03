import { env } from 'cloudflare:workers'
import { beforeAll } from 'vitest'

// Try importing with absolute path from project root
import migration0001 from '/migrations/0001_init.sql?raw'
import migration0002 from '/migrations/0002_diary_entries.sql?raw'
import migration0003 from '/migrations/0003_allow_multiple_entries_per_day.sql?raw'
import migration0004 from '/migrations/0004_diary_settings_and_tags.sql?raw'
import migration0005 from '/migrations/0005_ai_daily_reflections.sql?raw'

/**
 * Setup for integration tests.
 * Applies D1 migrations to the test database before running tests.
 *
 * IMPORTANT: When you add a new migration file:
 * 1. Add the import statement above (e.g., import migration0006 from '/migrations/0006_xxx.sql?raw')
 * 2. Add it to the migrations array below
 *
 * This approach ensures:
 * - Migrations are automatically loaded from actual migration files
 * - No need to manually duplicate SQL
 * - Schema stays in sync with production migrations
 */
beforeAll(async () => {
  const migrations = [
    migration0001,
    migration0002,
    migration0003,
    migration0004,
    migration0005,
  ]

  for (const [index, sql] of migrations.entries()) {
    // Split SQL file into statements
    // Remove comment lines and empty lines
    const lines = sql.split('\n')
    const cleanedLines = lines.filter(
      (line: string) =>
        !line.trim().startsWith('--') &&
        !line.trim().match(/^Migration number:/) &&
        line.trim().length > 0,
    )
    const cleanedSql = cleanedLines.join('\n')

    // Split by semicolon
    const statements = cleanedSql
      .split(';')
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0)

    for (const statement of statements) {
      if (statement) {
        try {
          await env.DB.prepare(statement).run()
        } catch (error) {
          // Ignore errors for idempotent statements (DROP INDEX IF NOT EXISTS, etc.)
          if (!(error instanceof Error && error.message.includes('no such'))) {
            console.warn(`Warning in migration ${index + 1}: ${error}`)
          }
        }
      }
    }
  }
})
