/**
 * 主題常數放在中性模組（沒有 'use client'）。
 *
 * 從標了 'use client' 的檔案匯出常數、再被 server component 匯入，
 * 在伺服器端算出來會是 undefined——實測 layout 的 inline script
 * 就變成 `localStorage.getItem(undefined)`，主題永遠讀不回來。
 */
export const THEME_KEY = 'tideline-theme'
export type Theme = 'system' | 'light' | 'dark'
