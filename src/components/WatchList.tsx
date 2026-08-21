'use client'
import { useMemo, useState } from 'react'
import { NavLink } from './NavLink'
import { SubmitButton } from './SubmitButton'
import { LevelInline } from './LevelStrip'
import { MarketFilter, type Filter } from './MarketFilter'
import { Icon } from './Icon'
import { levelStatus } from '@/lib/status'
import { sortRows, type SortMode } from '@/lib/sorting'
import type { WatchRow } from '@/lib/data'

function pct(v: number | null): string {
  if (v === null) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

function money(v: number | null): string {
  if (v === null) return '—'
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const SORTS: { key: SortMode; label: string }[] = [
  { key: 'attention', label: '該注意的' },
  { key: 'sim', label: '報酬' },
  { key: 'change', label: '跌幅' },
  { key: 'code', label: '代號' },
]

/** 明日動作的短標。清單一行放不下理由，只放方向——理由點進去看 */
function todoLabel(p: NonNullable<NonNullable<WatchRow['sim']>['pending']>): string {
  if (p.triggers.includes('stop')) return '明天賣光'
  if (p.buy && p.sell) return '明天調整'
  if (p.sell) return '明天賣一半'
  return '明天買進'
}

export function WatchList({
  rows,
  removeAction,
}: {
  rows: WatchRow[]
  removeAction: (formData: FormData) => void
}) {
  const [filter, setFilter] = useState<Filter>('ALL')
  const [sort, setSort] = useState<SortMode>('attention')

  const counts = useMemo(() => ({
    ALL: rows.length,
    TW: rows.filter((r) => r.market === 'TW').length,
    US: rows.filter((r) => r.market === 'US').length,
  }), [rows])

  // 每個市場最新的資料日期。列上只在落後時才標日期。
  const latestByMarket = useMemo(() => {
    const out: Record<string, string> = {}
    for (const r of rows) {
      if (!r.d) continue
      if (!out[r.market] || r.d > out[r.market]!) out[r.market] = r.d
    }
    return out
  }, [rows])

  /**
   * 合計。**跨市場只有換成同一個幣別才加得起來**，所以美股用最新匯率換台幣；
   * 匯率缺漏時那一檔不計入，並在畫面上說明少算了幾檔——寧可少算也不要
   * 用一個猜的匯率湊出一個看起來很完整的數字。
   */
  const total = useMemo(() => {
    let cost = 0, value = 0, skipped = 0, n = 0
    for (const r of rows) {
      if (!r.sim) continue
      if (r.sim.equityTwd === null) { skipped++; continue }
      cost += r.sim.initialTwd
      value += r.sim.equityTwd
      n++
    }
    if (n === 0) return null
    return { cost, value, pct: ((value - cost) / cost) * 100, n, skipped }
  }, [rows])

  // `pending` 不動作時也存在（要帶「為什麼不做」的理由），所以一律看 buy/sell。
  // 這個判斷在三個地方都要一致：排序、列上的徽章、這裡的合計。
  const todoCount = useMemo(
    () => rows.filter((r) => r.sim?.pending && (r.sim.pending.buy || r.sim.pending.sell)).length,
    [rows])

  const shown = useMemo(() => {
    const filtered = filter === 'ALL' ? rows : rows.filter((r) => r.market === filter)
    return sortRows(filtered, sort)
  }, [rows, filter, sort])

  return (
    <>
      <div className="listbar">
        <MarketFilter counts={counts} onChange={setFilter} />
        <div className="sortbar" role="group" aria-label="排序">
          {SORTS.map((s) => (
            <button key={s.key} type="button"
              data-testid={`sort-${s.key}`}
              aria-pressed={sort === s.key}
              className={`sorttag${sort === s.key ? ' on' : ''}`}
              onClick={() => setSort(s.key)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {total && (
        <div className="simtotal" data-testid="sim-total">
          <div className="simtotalmain">
            <span className="lab">照建議做的話</span>
            <span className="tnum">
              {Math.round(total.cost).toLocaleString('en-US')} →{' '}
              <b>{Math.round(total.value).toLocaleString('en-US')}</b> 元
            </span>
            <span className={`tnum simtotalpct ${total.pct >= 0 ? 'chg-up' : 'chg-down'}`}>
              {total.pct >= 0 ? '+' : ''}{total.pct.toFixed(2)}%
            </span>
          </div>
          <span className="fine">
            {total.n} 檔
            {total.skipped > 0 && `（${total.skipped} 檔缺匯率未計入）`}
            {todoCount > 0 ? `・明日有 ${todoCount} 檔要動作` : '・明日無動作'}
            {/* 回顧的入口就放在合計旁邊——看到總報酬之後，
                下一個問題一定是「所以這套規則到底行不行」 */}
            <NavLink href="/review" className="revlink" data-testid="review-link">
              回顧 →
            </NavLink>
          </span>
        </div>
      )}

      {shown.length > 0 && (
        <div className="listhead" aria-hidden="true">
          <span>標的</span>
          <span>收盤</span>
          <span className="lvlhead"><span>波段賣出</span><span>止跌</span><span>加碼</span></span>
          <span>照建議做</span>
          <span />
        </div>
      )}

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
                {/* 市場用極小的灰字，不用有框的徽章——上面的篩選列已經在講市場，
                    每列再來一顆膠囊只是視覺噪音 */}
                <span className="mkt">{r.market}</span>
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

              {/* 漲跌幅獨立一行：跟收盤價並排的話，四位數的高價股（2330 約 2,350）
                  會把百分比擠到下一行，各列就對不齊了。 */}
              <div className="rprice tnum">
                <div className="rclose">{money(r.close)}</div>
                <div className="rchgline">
                  {/* 台股紅漲綠跌 */}
                  <span className={r.chg_pct !== null && r.chg_pct < 0 ? 'chg-down' : 'chg-up'}
                    data-dir={r.chg_pct !== null && r.chg_pct < 0 ? 'down' : 'up'}>
                    {pct(r.chg_pct)}
                  </span>
                  {r.k !== null && r.d_val !== null && (
                    <span className="rkd">K {r.k.toFixed(1)} / D {r.d_val.toFixed(1)}</span>
                  )}
                </div>
              </div>

              <div className="rwhy">
                <LevelInline levels={r.levels} />
                {/* 資料日期只在**這一檔落後了**的時候才顯示。四列都印同一個日期
                    是廢話，頁首已經說過；真正要提醒的是「這檔跟其他檔不同步」。 */}
                <div className="rmeta">
                  {r.tone ?? ''}
                  {r.d && r.d !== latestByMarket[r.market] && (
                    <span className="lagging">　停在 {r.d}</span>
                  )}
                  {!r.d && <span className="lagging">　尚無資料</span>}
                </div>
              </div>

              {/* 模擬帳戶。欄位順序要跟表頭一致——一開始把它放在價位**前面**，
                  於是三個價位被擠進 118px 的格子裡疊成一團（截圖立刻看得出來，
                  但每一個數字都是對的，所以量測抓不到）。 */}
              <div className="rsim" data-testid={`sim-${r.code}`}>
                {r.sim ? (
                  <>
                    {/* `pending` 不動作時也存在（要帶理由），所以要看 buy/sell */}
                    {r.sim.pending && (r.sim.pending.buy || r.sim.pending.sell) && (
                      <span className="todobadge" data-testid={`todo-${r.code}`}>
                        {todoLabel(r.sim.pending)}
                      </span>
                    )}
                    <div className={`rsimret tnum ${r.sim.retPct >= 0 ? 'chg-up' : 'chg-down'}`}>
                      {pct(r.sim.retPct)}
                    </div>
                    {/* 報酬率自己不能回答「準不準」——旁邊一定要有超額 */}
                    {/* 「超額」是行話。這裡要說的是「跟買了不動比，差多少」 */}
                    <div className="rsimsub tnum">
                      vs 不動 <span className={r.sim.excessPct >= 0 ? 'chg-up' : 'chg-down'}>
                        {pct(r.sim.excessPct)}
                      </span>
                    </div>
                    <div className="rsimsub">
                      {r.sim.shares > 0 ? '目前有股票' : '目前是現金'}
                    </div>
                  </>
                ) : (
                  <span className="rsimsub">還沒開始模擬</span>
                )}
              </div>

              {/* 移除是破壞性動作，做成低調的圖示鈕並要求確認，
                  不要跟主要動作搶注意力 */}
              <form action={removeAction} className="rowaction"
                onSubmit={(e) => {
                  if (!confirm(`從觀察清單移除 ${r.code}？`)) e.preventDefault()
                }}>
                <input type="hidden" name="symbol_id" value={r.symbol_id} />
                <SubmitButton className="iconbtn danger"
                  aria-label={`從觀察清單移除 ${r.code}`}
                  title={`從觀察清單移除 ${r.code}`} pendingText="…">
                  <Icon name="minusCircle" />
                </SubmitButton>
              </form>
            </div>
            )
          })}
        </div>
      )}
    </>
  )
}
