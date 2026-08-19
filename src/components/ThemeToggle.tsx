'use client'
import { useEffect, useState } from 'react'
import { Icon, type IconName } from './Icon'


import { THEME_KEY, type Theme } from '@/lib/theme'

const OPTIONS: { key: Theme; icon: IconName; title: string }[] = [
  { key: 'system', icon: 'auto', title: '跟隨系統設定' },
  { key: 'light', icon: 'sun', title: '固定淺色' },
  { key: 'dark', icon: 'moon', title: '固定深色' },
]

/**
 * 深淺色切換。三種狀態而不是兩種——「跟隨系統」要是一個真的選項，
 * 不然使用者換了系統主題之後，這個站會固執地維持舊的。
 *
 * 實際套用是把 data-theme 寫到 <html>；配色規則見 globals.css。
 * 首次載入由 layout 裡的 inline script 先套好，避免閃一下錯的顏色。
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system')

  useEffect(() => {
    const saved = localStorage.getItem(THEME_KEY) as Theme | null
    if (saved === 'light' || saved === 'dark' || saved === 'system') setTheme(saved)
  }, [])

  function apply(next: Theme) {
    setTheme(next)
    localStorage.setItem(THEME_KEY, next)
    const root = document.documentElement
    if (next === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', next)
  }

  return (
    <div className="themetoggle" role="group" aria-label="配色">
      {OPTIONS.map((o) => (
        <button key={o.key} type="button"
          className={`themebtn${theme === o.key ? ' on' : ''}`}
          aria-pressed={theme === o.key}
          title={o.title}
          aria-label={o.title}
          data-testid={`theme-${o.key}`}
          onClick={() => apply(o.key)}>
          <Icon name={o.icon} size={16} />
        </button>
      ))}
    </div>
  )
}
