'use client'
import { useEffect, useState } from 'react'
import { Icon, type IconName } from './Icon'

import { THEME_KEY, type Theme } from '@/lib/theme'

/**
 * 深淺色切換：**一顆按鈕，兩個狀態。**
 *
 * 原本是三態循環，第三態是「跟隨系統」。拿掉了：使用者要的是「現在給我
 * 深色」或「現在給我淺色」，而「跟隨系統」是一個**設定**，不是一個外觀。
 * 把設定塞進外觀的循環裡，代價是每次都要多按一下才走得到想要的那個，
 * 而且按鈕上顯示的圖示還不一定等於眼睛看到的顏色——「跟隨系統」的圖示
 * 說不出現在到底是深是淺。
 *
 * 系統偏好仍然是**預設值**：沒有存過選擇的人，第一次進站看到的就是
 * 系統的配色（CSS 的 `prefers-color-scheme` 負責，見 globals.css）。
 * 差別只在按下去之後就以人的選擇為準，不再繞回去。
 *
 * 按鈕顯示**目前**的狀態，`title` 與 `aria-label` 同時說出現在是什麼、
 * 按下去會變成什麼——只有一個圖示的話沒人知道它是狀態還是動作。
 */
const META: Record<Theme, { icon: IconName; label: string }> = {
  light: { icon: 'sun', label: '淺色' },
  dark: { icon: 'moon', label: '深色' },
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light')

  // 伺服器端沒有 localStorage 也沒有 matchMedia，初次渲染兩邊必須一致，
  // 所以讀取放在 effect 裡。沒存過就跟著系統——那是預設值，不是第三個狀態。
  useEffect(() => {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'light' || saved === 'dark') { setTheme(saved); return }
    setTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  }, [])

  function apply(next: Theme) {
    setTheme(next)
    localStorage.setItem(THEME_KEY, next)
    document.documentElement.setAttribute('data-theme', next)
  }

  const next: Theme = theme === 'dark' ? 'light' : 'dark'
  const label = `配色：${META[theme].label}（點擊切換為${META[next].label}）`

  return (
    <button type="button" className="iconbtn themecycle"
      title={label}
      aria-label={label}
      data-testid="theme-cycle"
      data-theme-state={theme}
      onClick={() => apply(next)}>
      <Icon name={META[theme].icon} size={18} />
    </button>
  )
}
