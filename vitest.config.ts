import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  test: {
    globals: true,
    projects: [
      {
        // Node environment for server, scripts, and integration tests
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'server/**/*.test.ts',
            'scripts/**/*.test.ts',
            'test/server/**/*.test.ts',
            'test/config/**/*.test.ts',
            'test/smoke/**/*.test.ts',
          ],
          env: {
            DATABASE_URL: ':memory:',
          },
        },
      },
      {
        // happy-dom environment for client composables that use browser APIs (IndexedDB, etc.)
        plugins: [vue()],
        test: {
          name: 'happy-dom',
          environment: 'happy-dom',
          include: ['test/app/**/*.test.ts'],
          env: {
            DATABASE_URL: ':memory:',
          },
        },
      },
    ],
  },
})
