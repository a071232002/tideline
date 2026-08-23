/**
 * 主題常數放在中性模組（沒有 'use client'）。
 *
 * 從標了 'use client' 的檔案匯出常數、再被 server component 匯入，
 * 在伺服器端算出來會是 undefined——實測 layout 的 inline script
 * 就變成 `localStorage.getItem(undefined)`，主題永遠讀不回來。
 */
export const THEME_KEY = 'tideline-theme'
export type Theme = 'system' | 'light' | 'dark'

/**
 * 圖層開關也記住。
 *
 * 原本刻意不存，理由是「這是我現在想多看一眼的臨時動作，不是設定」。
 * 但如果每次進頁面都要重開同樣那幾個，那它就是設定——判斷標準是使用者
 * 的行為，不是我對它的分類。
 *
 * 跟主題一樣放中性模組：從 'use client' 檔案匯出的常數在伺服器端是 undefined。
 */
export const LAYERS_KEY = 'tideline-layers'
