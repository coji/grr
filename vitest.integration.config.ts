import {
  defineWorkersConfig,
  readD1Migrations,
} from '@cloudflare/vitest-pool-workers/config'
import path from 'node:path'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineWorkersConfig(async () => {
  // Read all migrations in the `migrations` directory using official API
  const migrationsPath = path.join(__dirname, 'migrations')
  const migrations = await readD1Migrations(migrationsPath)

  return {
    plugins: [tsconfigPaths()],
    resolve: {
      alias: {
        '~': path.resolve(__dirname, './app'),
      },
    },
    test: {
      globals: true,
      include: ['app/**/*.integration.test.ts'],
      setupFiles: ['./tests/setup/integration-setup.ts'],
      poolOptions: {
        workers: {
          wrangler: { configPath: './wrangler.jsonc' },
          miniflare: {
            // Add a test-only binding for migrations, so we can apply them in setup file
            bindings: { TEST_MIGRATIONS: migrations },
            // D1 database binding from wrangler.jsonc
            d1Databases: ['DB'],
          },
        },
      },
    },
  }
})
