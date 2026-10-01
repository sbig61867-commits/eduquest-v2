import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // Test-environment setting only — it changes how this suite runs on a
    // memory-constrained machine, NOT the platform's performance.
    // Four workers, not one per core. Every worker boots its own jsdom; on the
    // 8 GB / 12-core dev machine the default (~11 workers) drove free memory to
    // 0.09 GB under a concurrent `next build`, render tests slowed ~4x (987 ms →
    // 3 947 ms) and some crossed the 5 s test timeout — the intermittent
    // "Test timed out" failures of 2026-09-30. With 4 workers the same load
    // leaves 1.5 GB free and the slowest render test takes 0.7 s; the whole run
    // costs ~10 s more when idle. CI runners have fewer cores than this anyway.
    maxWorkers: 4,
    setupFiles: ['./src/__tests__/setup.ts'],
    css: false,
    exclude: ['**/node_modules/**', '**/tests/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
