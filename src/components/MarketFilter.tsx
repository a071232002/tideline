'use client'
import { useState } from 'react'

export type Filter = 'ALL' | 'TW' | 'US'

/**
 * 市場快速篩選。清單長起來之後，「今天只想看台股」是最常見的動作，
 * 所以做成一排 tag 直接點，不要藏進下拉選單。
 *
 * 篩選在 client 端做——資料本來就都在頁面上了，往返伺服器只會變慢。
 */
export function MarketFilter({
  counts,
  onChange,
}: {
  counts: { ALL: number; TW: number; US: number }
  onChange: (f: Filter) => void
}) {
  const [active, setActive] = useState<Filter>('ALL')

  const tabs: { key: Filter; label: string }[] = [
    { key: 'ALL', label: '全部' },
    { key: 'TW', label: '台股' },
    { key: 'US', label: '美股' },
  ]

  return (
    <div className="filters" role="tablist" aria-label="市場篩選">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={active === t.key}
          data-testid={`filter-${t.key}`}
          className={`filtertag${active === t.key ? ' on' : ''}`}
          disabled={counts[t.key] === 0 && t.key !== 'ALL'}
          onClick={() => { setActive(t.key); onChange(t.key) }}
        >
          {t.label}
          <span className="filtercount tnum">{counts[t.key]}</span>
        </button>
      ))}
    </div>
  )
}
