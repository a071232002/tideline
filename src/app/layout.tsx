import type { Metadata } from 'next'
import './globals.css'
import { THEME_KEY } from '@/lib/theme'

export const metadata: Metadata = {
  // 讓瀏覽器知道兩種配色都支援：捲動過頭的橡皮筋區、表單控制項才會跟著換色
  other: { 'color-scheme': 'light dark' },
  title: 'Tideline',
  description: '個人股票技術分析站。指標與價位由程式計算，僅供參考，非投資建議。',
}

/**
 * 在任何東西畫出來之前先把存好的主題套上去。
 * 沒有這段，手動選深色的人每次載入都會先閃一下淺色。
 */
const THEME_INIT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});
if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}})()`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant" suppressHydrationWarning>
      <body>
        {/* 這段必須在內容之前執行，否則手動選深色的人每次載入都會先閃一下淺色。
            放在 <head> 沒有用——App Router 會把手寫 head 的內容丟掉。 */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        {children}
      </body>
    </html>
  )
}
