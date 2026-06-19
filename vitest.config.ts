import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    projects: [
      {
        // Node environment for server, scripts, and integration tests
        resolve: {
          alias: {
            // Nuxt auto-import shim for server-side unit tests (push.ts uses useRuntimeConfig).
            '#imports': resolve(__dirname, 'test/server/__stubs__/nuxt-imports.ts'),
          },
        },
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
        // happy-dom environment for client composables and component tests (browser APIs, Vue mounts)
        plugins: [vue()],
        resolve: {
          alias: {
            // Nuxt auto-import shims — pages and composables use these aliases at runtime.
            // Vitest doesn't run the Nuxt layer, so we map them to real paths.
            '~': resolve(__dirname, 'app'),
            '#app': resolve(__dirname, 'test/app/__stubs__/nuxt-app.ts'),
          },
        },
        test: {
          name: 'happy-dom',
          environment: 'happy-dom',
          setupFiles: [resolve(__dirname, 'test/app/__stubs__/setup.ts')],
          include: ['test/app/**/*.test.ts', 'app/components/__tests__/**/*.test.ts'],
          env: {
            DATABASE_URL: ':memory:',
          },
        },
      },
    ],
  },
})
