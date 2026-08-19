import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Tideline',
  description: '個人股票技術分析站。指標與價位由程式計算，僅供參考，非投資建議。',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  )
}
