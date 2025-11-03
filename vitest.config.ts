import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    include: ['app/**/*.test.ts'],
    exclude: [
      'node_modules',
      'dist',
      'build',
      'app/**/*.integration.test.ts',
      'app/**/*.e2e.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['app/**/*.ts'],
      exclude: [
        'app/**/*.test.ts',
        'app/**/*.integration.test.ts',
        'app/**/*.e2e.test.ts',
        'app/routes/**/*',
        '**/*.d.ts',
      ],
    },
  },
})
