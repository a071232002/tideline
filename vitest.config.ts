import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Next.js 用的是 automatic runtime（不必 import React）。vitest 的 esbuild
  // 預設是 classic，會在 .tsx 測試裡噴「React is not defined」。
  esbuild: { jsx: 'automatic' },
  test: {
    // 只跑單元測試。e2e/ 是 Playwright 的地盤，讓 vitest 去收會炸在 import。
    // .tsx 也收：元件的渲染結果（例如買賣三角）用 renderToStaticMarkup 驗，
    // 比為了看一眼而往正式資料塞假成交乾淨得多。
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    exclude: ['node_modules', '.next', 'e2e'],
  },
})
