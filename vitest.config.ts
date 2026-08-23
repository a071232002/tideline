import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // `@/` 是 tsconfig 的路徑別名，Next 認得、vitest 不認得。少了這一條，
  // 任何用 `@/` import 的元件在單元測試裡都會炸在 resolve，
  // 而那跟元件本身對不對完全無關。
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
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
