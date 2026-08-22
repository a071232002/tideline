'use client'
import { useState } from 'react'
import { PriceChart, KdChart, W_NARROW } from './Charts'
import { GapPanel } from './GapPanel'

/**
 * 圖是主體，技術與回顧是**可以切換的圖層**。
 *
 * 原本這一頁有兩張獨立的圖（價格、KD），另外還有一整個 `/review` 頁面畫
 * 「價格＋買賣點＋差距」。同一件事被畫在三個地方，而讀者要在頁面之間
 * 換算日期才對得起來。
 *
 * 現在只有一張主圖：**收盤價與買賣點**。其餘都是它的圖層，開關在圖上方——
 * 布林通道、關鍵價位、KD、與買了不動的差距。預設只開買賣點，
 * 因為那是「這個帳戶做了什麼」，其他都是佐證。
 *
 * 切換狀態不寫進網址也不存起來：這是「我現在想多看一眼」的臨時動作，
 * 不是設定。留下來反而會讓下次打開時看到一張自己不記得為什麼長這樣的圖。
 */

export interface Layer {
  key: 'trades' | 'bands' | 'levels' | 'gap' | 'kd'
  label: string
}

const LAYERS: Layer[] = [
  { key: 'trades', label: '買賣點' },
  { key: 'bands', label: '布林通道' },
  { key: 'levels', label: '關鍵價位' },
  { key: 'gap', label: 'vs 買了不動' },
  { key: 'kd', label: 'KD' },
]

export function ChartBoard({
  bars, bands, levels, currency, marks, gap, kd, hasAccount,
}: {
  bars: { d: string; o: number; h: number; l: number; c: number }[]
  bands: { d: string; mid: number; up: number; lo: number }[]
  levels: { sell?: [number, number] | null; stop?: number | null; add?: [number, number] | null }
  currency: string
  marks: { d: string; side: 'buy' | 'sell'; price: number; stop: boolean }[]
  gap: { d: string; gap: number }[]
  kd: { d: string; k: number; d_val: number }[]
  /** 沒有模擬帳戶時，買賣點與差距兩個圖層沒有意義，不要給空開關 */
  hasAccount: boolean
}) {
  const [on, setOn] = useState<Record<Layer['key'], boolean>>({
    trades: true, bands: false, levels: false, gap: false, kd: false,
  })

  const available = LAYERS.filter((l) =>
    hasAccount || (l.key !== 'trades' && l.key !== 'gap'))

  const toggle = (k: Layer['key']) => setOn((p) => ({ ...p, [k]: !p[k] }))

  const shownLevels = on.levels ? levels : { sell: null, stop: null, add: null }
  const shownMarks = on.trades ? marks : []
  const shownBands = on.bands ? bands : []

  return (
    <>
      <div className="layerbar" role="group" aria-label="圖層">
        {available.map((l) => (
          <button key={l.key} type="button"
            data-testid={`layer-${l.key}`}
            aria-pressed={on[l.key]}
            className={`layerbtn${on[l.key] ? ' on' : ''}`}
            onClick={() => toggle(l.key)}>
            {l.label}
          </button>
        ))}
      </div>

      {/* 寬窄兩份 viewBox，用 CSS 切換。920 寬塞進 375px 螢幕，
          軸標籤實測只剩 3.6px——那不是小，是看不見。 */}
      {[undefined, W_NARROW].map((w) => (
        <div key={w ?? 'wide'} className={w ? 'chart-narrow' : 'chart-wide'}>
          <PriceChart bars={bars} bands={shownBands} levels={shownLevels}
            currency={currency} marks={shownMarks} width={w} />
          {on.gap && gap.length > 1 && (
            <GapPanel points={gap} width={w} id={`${w ? 'n' : 'w'}`} />
          )}
          {on.kd && kd.length > 0 && <KdChart points={kd} width={w} />}
        </div>
      ))}
    </>
  )
}
