import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 只跑單元測試。e2e/ 是 Playwright 的地盤，讓 vitest 去收會炸在 import。
    include: ['test/**/*.test.ts'],
    exclude: ['node_modules', '.next', 'e2e'],
  },
})
