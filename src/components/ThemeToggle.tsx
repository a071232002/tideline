'use client'
import { useEffect, useState } from 'react'
import { Icon, type IconName } from './Icon'

import { THEME_KEY, type Theme } from '@/lib/theme'

/**
 * 深淺色切換：**一顆按鈕，循環三種狀態**。
 *
 * 原本是三顆並排的分段按鈕。三顆按鈕永遠佔著位置，但其中兩顆在任何時刻
 * 都是「我現在不是這個」——真正需要的資訊只有一個：現在是哪一個。
 *
 * 「跟隨系統」仍然是一個真的狀態，不能省。少了它，使用者換了系統主題之後，
 * 這個站會固執地維持舊的配色。所以是循環而不是二選一。
 *
 * 按鈕上顯示**目前**的狀態（圖示），`title` 與 `aria-label` 同時說出
 * 現在是什麼、按下去會變成什麼——循環式按鈕最大的問題就是猜不到下一步，
 * 那要用文字補，不能靠使用者試。
 */
const ORDER: Theme[] = ['system', 'light', 'dark']
const META: Record<Theme, { icon: IconName; label: string }> = {
  system: { icon: 'auto', label: '跟隨系統' },
  light: { icon: 'sun', label: '淺色' },
  dark: { icon: 'moon', label: '深色' },
}

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

  const nextTheme = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]!
  const label = `配色：${META[theme].label}（點擊切換為${META[nextTheme].label}）`

  return (
    <button type="button" className="iconbtn themecycle"
      title={label}
      aria-label={label}
      data-testid="theme-cycle"
      data-theme-state={theme}
      onClick={() => apply(nextTheme)}>
      <Icon name={META[theme].icon} size={18} />
    </button>
  )
}
