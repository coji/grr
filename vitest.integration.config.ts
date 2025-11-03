import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'
import path from 'node:path'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineWorkersConfig({
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
          // Additional D1 bindings for testing
          d1Databases: ['DB'],
        },
      },
    },
  },
})
