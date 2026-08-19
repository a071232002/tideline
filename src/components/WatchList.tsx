'use client'
import { useMemo, useState } from 'react'
import { NavLink } from './NavLink'
import { SubmitButton } from './SubmitButton'
import { LevelInline } from './LevelStrip'
import { MarketFilter, type Filter } from './MarketFilter'
import { levelStatus } from '@/lib/status'
import type { WatchRow } from '@/lib/data'

function pct(v: number | null): string {
  if (v === null) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

function money(v: number | null): string {
  if (v === null) return '—'
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function WatchList({
  rows,
  removeAction,
}: {
  rows: WatchRow[]
  removeAction: (formData: FormData) => void
}) {
  const [filter, setFilter] = useState<Filter>('ALL')

  const counts = useMemo(() => ({
    ALL: rows.length,
    TW: rows.filter((r) => r.market === 'TW').length,
    US: rows.filter((r) => r.market === 'US').length,
  }), [rows])

  const shown = filter === 'ALL' ? rows : rows.filter((r) => r.market === filter)

  return (
    <>
      <MarketFilter counts={counts} onChange={setFilter} />

      {shown.length === 0 ? (
        <div className="card">
          <p className="empty" data-testid="empty-filtered">
            {rows.length === 0
              ? '清單還是空的。上面選好市場、輸入代號，加入第一檔。'
              : `目前的篩選（${filter === 'TW' ? '台股' : '美股'}）沒有標的。`}
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          {shown.map((r) => {
            const st = levelStatus(r.close, {
              sell: r.levels.find((l) => l.kind === 'sell') as never,
              stop: r.levels.find((l) => l.kind === 'stop')?.lo ?? null,
              add: r.levels.find((l) => l.kind === 'add') as never,
            })
            return (
            <div key={r.symbol_id} className="row" data-testid={`watch-row-${r.code}`}
              data-market={r.market}>
              <div>
                {/* 連結包代號，::after 把可點範圍撐滿整列——觸控時不用瞄準那幾個字 */}
                <NavLink className="rowlink rcode" href={`/${r.market.toLowerCase()}/${r.code}`}>
                  {r.code}
                </NavLink>
                <span className="badge" style={{ marginLeft: 6 }}>
                  {r.market === 'TW' ? '台股' : '美股'}
                </span>
                <div className="rname">{r.name ?? ''}</div>
                {st.kind !== 'none' && (
                  <span className={`statusbadge tone-${st.tone}`} data-testid={`status-${r.code}`}>
                    {st.label}
                    {st.distancePct !== null && (
                      <span className="tnum"> {st.distancePct > 0 ? '+' : ''}{st.distancePct.toFixed(1)}%</span>
                    )}
                  </span>
                )}
              </div>

              <div className="rprice tnum">
                <span className="rclose">{money(r.close)}</span>
                <span className={r.chg_pct !== null && r.chg_pct < 0 ? 'down' : 'upc'}
                  style={{ marginLeft: 8, fontSize: '.9rem', fontWeight: 600 }}>
                  {pct(r.chg_pct)}
                </span>
                <div className="rkd">
                  {r.k !== null && r.d_val !== null
                    ? `K ${r.k.toFixed(1)} / D ${r.d_val.toFixed(1)}`
                    : ''}
                </div>
              </div>

              <div className="rwhy">
                <LevelInline levels={r.levels} />
                <div className="rmeta">
                  {r.tone ?? ''}
                  {r.d ? `　資料日期 ${r.d}` : '　資料未更新'}
                </div>
              </div>

              {/* 移除是破壞性動作，做成低調的文字鈕並要求確認，
                  不要跟主要動作搶注意力 */}
              <form action={removeAction} className="rowaction"
                onSubmit={(e) => {
                  if (!confirm(`從觀察清單移除 ${r.code}？`)) e.preventDefault()
                }}>
                <input type="hidden" name="symbol_id" value={r.symbol_id} />
                <SubmitButton className="btnquiet" pendingText="移除中…">移除</SubmitButton>
              </form>
            </div>
            )
          })}
        </div>
      )}
    </>
  )
}
