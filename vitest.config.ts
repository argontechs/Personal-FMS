import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'server/**/*.test.ts', 'scripts/**/*.test.ts'],
    env: {
      DATABASE_URL: ':memory:',
    },
  },
})
