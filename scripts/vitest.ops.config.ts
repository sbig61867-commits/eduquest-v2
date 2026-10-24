// One-off operations (not tests) that need the app's own code — run with:
//   node --env-file-if-exists=.env --env-file-if-exists=.env.local node_modules/vitest/vitest.mjs run --config scripts/vitest.ops.config.ts
// The normal suite never picks these up (*.ops.ts is not a test file name).
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['scripts/**/*.ops.ts'],
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '../src') },
  },
})
