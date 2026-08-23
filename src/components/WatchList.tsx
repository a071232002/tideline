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

/** 金額用整數就好，清單放不下小數，也不需要 */
const money0 = (v: number) => Math.round(v).toLocaleString('en-US')

/** AI 今天決定了什麼，用白話寫。`buy_50` 這種內部代號不能直接端上桌 */
const AI_ACTION: Record<string, string> = {
  hold: '觀望',
  buy_25: '買進 ¼ 現金', buy_50: '買進 ½ 現金', buy_100: '全部買進',
  sell_25: '賣出 ¼ 持股', sell_50: '賣出 ½ 持股', sell_100: '全部賣出',
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
  const [query, setQuery] = useState('')

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
   * 清單頂上這一條講的是**今天要做什麼**，不是總報酬。
   *
   * 原本這裡放跨標的的金額合計。拿掉的理由不是版面，是那個數字不誠實：
   * 每一檔的起算日不同（各自從加入追蹤那天算）、本金可以個別調整，
   * 把它們加起來得到的既不是投組報酬、也不是任何一段期間的報酬，
   * 只是一堆不同尺規的數字相加。要看整體請到回顧頁，那裡分得開。
   */
  const summary = useMemo(() => {
    const withSim = rows.filter((r) => r.sim)
    const aiLed = withSim.filter((r) => r.sim!.lead === 'ai').length

    /**
     * 每一列都一樣的東西，上移到頁首講一次。
     *
     * 實測四列的模擬格裡有三行字完全相同（AI 觀望／現金 50,000／
     * 追蹤 3 天（08-19 起），太短）——十二行重複。
     *
     * 這個站已經有處理它的先例：資料日期只在「這一檔跟其他檔不同步」時才印，
     * 因為四列印同一個日期是廢話。同一個模式套到起算日與追蹤天數。
     */
    const starts = withSim.map((r) => r.sim!.startedOn)
    const days = withSim.map((r) => r.sim!.days)
    const uniformStart = starts.length > 0 && starts.every((d) => d === starts[0])
    const uniformDays = days.length > 0 && days.every((d) => d === days[0])
    // 全部都還沒投入時，「未投入」印四遍是廢話——同一條規則
    const allFlat = withSim.length > 0 && withSim.every((r) => r.sim!.cost === 0)
    return {
      n: withSim.length, aiLed, allFlat,
      commonStart: uniformStart ? starts[0]! : null,
      commonDays: uniformDays ? days[0]! : null,
    }
  }, [rows])

  // `pending` 不動作時也存在（要帶「為什麼不做」的理由），所以一律看 buy/sell。
  // 這個判斷在三個地方都要一致：排序、列上的徽章、這裡的合計。
  const todoCount = useMemo(
    () => rows.filter((r) => r.sim?.pending && (r.sim.pending.buy || r.sim.pending.sell)).length,
    [rows])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = rows
      .filter((r) => filter === 'ALL' || r.market === filter)
      // 代號與名稱都比對。使用者記得的可能是「台積電」也可能是 2330，
      // 只比對其中一種就會有一半的時候找不到
      .filter((r) => q === ''
        || r.code.toLowerCase().includes(q)
        || (r.name ?? '').toLowerCase().includes(q))
    return sortRows(filtered, sort)
  }, [rows, filter, sort, query])

  return (
    <>
      <div className="listbar">
        <MarketFilter counts={counts} onChange={setFilter} />
        {/* 搜尋。清單長到十幾檔就只能用眼睛找，而市場篩選只有兩個維度。
            Esc 清空——這是暫時的縮小範圍，不是設定。 */}
        <div className="searchwrap">
          <input
            type="search"
            className="input searchinput"
            data-testid="search"
            placeholder="找代號或名稱"
            aria-label="搜尋觀察清單"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setQuery('') }}
          />
        </div>

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

      {summary.n > 0 && (
        <div className="simtotal" data-testid="sim-total">
          <div className="simtotalmain">
            <span className="lab">明天開盤</span>
            <span className={`simtotalpct ${todoCount > 0 ? 'chg-up' : ''}`}>
              {todoCount > 0 ? `${todoCount} 檔要動作` : '沒有要動作的'}
            </span>
          </div>
          <span className="fine">
            {/* 「N 檔在模擬・N 檔由 AI 判斷」拿掉了：下面每一列都有 AI 徽章，
                檔數用數的就知道。這裡只留**別的地方都沒講**的東西——
                全部一樣的起算日與追蹤天數。 */}
            {summary.commonStart && summary.commonDays !== null
              ? `都自 ${summary.commonStart.slice(5)} 起追蹤 ${summary.commonDays} 天`
                + (summary.commonDays < 10 ? '，還看不出結果' : '')
              : `${summary.n} 檔在模擬`}
            {summary.allFlat && '・都還沒進場'}
          </span>
        </div>
      )}

      {shown.length > 0 && (
        <div className="listhead" aria-hidden="true">
          <span>標的</span>
          <span>收盤</span>
          {/* 標籤已經貼在每個數字旁邊（賣／止／加），表頭不必再排三個 */}
          <span>關鍵價位</span>
          <span>照建議做</span>
          <span />
        </div>
      )}

      {shown.length === 0 ? (
        <div className="card">
          <p className="empty" data-testid="empty-filtered">
            {rows.length === 0
              ? '清單還是空的。上面選好市場、輸入代號，加入第一檔。'
              : query.trim() !== ''
                ? `沒有符合「${query.trim()}」的標的。`
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
                  {/* K/D 拿掉了。它是指標細節不是決策：真正要做什麼由狀態徽章
                      與 AI 的動作回答，KD 只決定「什麼時候可以按下去」，
                      那是點進去才需要看的東西。 */}
                </div>
              </div>

              <div className="rwhy">
                <LevelInline levels={r.levels} />
                {/* 資料日期只在**這一檔落後了**的時候才顯示。四列都印同一個日期
                    是廢話，頁首已經說過；真正要提醒的是「這檔跟其他檔不同步」。 */}
                {/* 定調句拿掉了。實測四列全部是「短線回檔、波段偏多」——
                    每列都一樣的句子沒有分辨力，只是把版面填滿。
                    它留在個股頁，那裡才是要讀理由的地方。
                    這裡只留真正的異常：這一檔跟其他檔不同步。 */}
                {((r.d && r.d !== latestByMarket[r.market]) || !r.d) && (
                  <div className="rmeta">
                    <span className="lagging">
                      {r.d ? `停在 ${r.d}` : '尚無資料'}
                    </span>
                  </div>
                )}
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
                    {/* AI 今天的判斷放最上面——它是這個站的主角，
                        不該只出現在點進去之後的第二層 */}
                    <div className="rsimai" data-testid={`ai-${r.code}`}>
                      {r.sim.aiToday
                        ? <><span className="rsimailab">AI</span>{' '}
                          {AI_ACTION[r.sim.aiToday.action] ?? r.sim.aiToday.action}</>
                        : <span className="rsimsub">AI 尚未判斷</span>}
                    </div>

                    {/* 投入多少錢比報酬率更早該回答——0% 可能是空手，也可能是真的沒賺。
                        但全部都沒投入時只在頁首講一次。 */}
                    {(r.sim.cost > 0 || !summary.allFlat) && (
                      <div className="rsimsub tnum">
                        {r.sim.cost > 0 ? `投入 ${money0(r.sim.cost)}` : '未投入'}
                      </div>
                    )}

                    {/* 追蹤天數太少時，報酬率是雜訊不是結果，不要讓它當主角。
                        **但只在跟其他檔不同步時才印**——每列都一樣的話，
                        頁首那一行已經講過了。 */}
                    {r.sim.days < 10 ? (
                      summary.commonDays === null && (
                        <div className="rsimsub" data-testid={`young-${r.code}`}>
                          追蹤 {r.sim.days} 天（{r.sim.startedOn.slice(5)} 起），太短
                        </div>
                      )
                    ) : (
                      <>
                        {/* 這個數字是哪一條軌道的，一定要標出來——
                            同一個位置在不同標的上可能代表不同軌道 */}
                        <div className={`rsimret tnum ${r.sim.retPct >= 0 ? 'chg-up' : 'chg-down'}`}>
                          <span className="rsimwho">{r.sim.lead === 'ai' ? 'AI' : '規則'}</span>
                          {pct(r.sim.retPct)}
                        </div>
                        <div className="rsimsub tnum">
                          vs 不動 <span className={r.sim.excessPct >= 0 ? 'chg-up' : 'chg-down'}>
                            {pct(r.sim.excessPct)}
                          </span>
                        </div>
                        {/* AI 當主角時，規則降成參考 */}
                        {r.sim.lead === 'ai' && (
                          <div className="rsimsub tnum">規則 {pct(r.sim.ruleRetPct)}</div>
                        )}
                      </>
                    )}

                    {/* 起算日同上：只有跟其他檔不同才需要指出來 */}
                    {r.sim.days >= 10 && summary.commonStart === null && (
                      <div className="rsimsub">自 {r.sim.startedOn.slice(5)}</div>
                    )}
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
