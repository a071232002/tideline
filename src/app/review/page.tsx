import { getReview, type ReviewSymbol, type ReviewTrack } from '@/lib/data'
import { GapChart, gapSeries, W_NARROW } from '@/components/GapChart'
import { TopBar } from '@/components/TopBar'
import { NavLink } from '@/components/NavLink'
import { Icon } from '@/components/Icon'

export const dynamic = 'force-dynamic'

/**
 * 回顧（PLAN §11、§13.7）。
 *
 * 個股頁回答「今天怎麼做」，這一頁回答「過去做得怎麼樣」——
 * §11 明講兩種心智狀態不要混在一起，所以獨立成一頁。
 *
 * 這一頁只有一個問題：**這套規則值不值得繼續相信。**
 *
 * 所以每一檔的第一層只有三樣東西：一個大數字（差距）、一句話（多賺還是少賺）、
 * 一條差距線。細部統計收進「更多數字」——攤開九格會讓讀者先花力氣找重點，
 * 而那九格回答的是「為什麼」，不是「有沒有幫助」。
 */

const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`

function excessOf(s: ReviewSymbol): number | null {
  const rule = s.tracks.find((t) => t.track === 'rule')
  const hold = s.tracks.find((t) => t.track === 'hold')
  if (!rule || !hold) return null
  return rule.stats.retPct - hold.stats.retPct
}

/**
 * 細部數字收進摺疊區。
 *
 * 九格統計攤開來，在手機上佔 245px，而它們回答的是「為什麼會這樣」——
 * 那是想深究時才需要的第二層。第一層只要回答「有沒有幫助」，
 * 由上面那句話與差距圖負責。攤開的東西越多，讀者越要花心思找重點。
 *
 * 但**該說的但書不能收**：假設揭露、樣本長度那些留在外面。
 * 收起來的是細節，不是警語。
 */
function Details({ rule, hold }: { rule: ReviewTrack; hold: ReviewTrack }) {
  const s = rule.stats
  const inMarket = s.totalDays > 0 ? Math.round((s.daysInMarket / s.totalDays) * 100) : 0
  return (
    <details className="revdetails">
      <summary>更多數字</summary>
      <dl className="revstats">
        <div><dt>照建議做</dt><dd className="tnum">{pct(s.retPct)}</dd></div>
        <div><dt>買了不動</dt><dd className="tnum">{pct(hold.stats.retPct)}</dd></div>
        <div><dt>有股票的天數</dt><dd className="tnum">{s.daysInMarket}/{s.totalDays}（{inMarket}%）</dd></div>
        <div><dt>買賣次數</dt><dd className="tnum">{s.trades} 次</dd></div>
        {/* §11 的規矩：次數少的時候不寫百分比。「12 次裡 7 次」比「勝率 58%」誠實 */}
        <div>
          <dt>賣出賺錢</dt>
          <dd className="tnum">{s.closed > 0 ? `${s.closed} 次裡 ${s.wins} 次` : '—'}</dd>
        </div>
        <div><dt>中途最多虧</dt><dd className="tnum">−{s.maxDrawdownPct.toFixed(2)}%</dd></div>
        <div><dt>手續費與稅</dt><dd className="tnum">{Math.round(s.totalFees).toLocaleString('en-US')}（{s.feesPct.toFixed(2)}%）</dd></div>
        <div><dt>觸發停損</dt><dd className="tnum">{s.stopped} 次</dd></div>
      </dl>
    </details>
  )
}

export default async function ReviewPage() {
  const rows = await getReview()

  const withBoth = rows.filter((r) =>
    r.tracks.some((t) => t.track === 'rule') && r.tracks.some((t) => t.track === 'hold'))
  const beat = withBoth.filter((r) => (excessOf(r) ?? 0) >= 0).length

  return (
    <main className="wrap">
      <TopBar />
      <NavLink href="/" className="backlink"><Icon name="back" /><span>觀察清單</span></NavLink>

      <header className="pagehead">
        <span className="eyebrow">模擬帳戶</span>
        <h1>回顧</h1>
        <p className="sub">
          每一檔都用同一筆本金跑兩種做法：<b>照這個站的建議買賣</b>，
          以及<b>第一天買了就不動</b>。差距為負，代表照建議進出反而少賺。
        </p>
      </header>

      {withBoth.length === 0 ? (
        <div className="card">
          <p className="empty" data-testid="review-empty">
            還沒有模擬帳戶。到觀察清單加入標的，隔天就會有第一段曲線。
          </p>
        </div>
      ) : (
        <>
          {/* 金額合計放這裡，不放清單。
              每一檔的起算日不同、本金可以個別調整，加起來得到的既不是投組報酬、
              也不是任何一段期間的報酬——但在「回顧」的脈絡下，
              旁邊有各檔明細撐著，它就有意義了。 */}
          {(() => {
            let cost = 0, value = 0, n = 0
            for (const r of withBoth) {
              const rule = r.tracks.find((t) => t.track === 'rule')
              if (!rule) continue
              cost += r.initialTwd
              value += r.initialTwd * (1 + rule.stats.retPct / 100)
              n++
            }
            if (n === 0) return null
            const p = ((value - cost) / cost) * 100
            return (
              <p className="revtotal" data-testid="review-total">
                <span className="lab">全部加起來</span>
                <span className="tnum">
                  {Math.round(cost).toLocaleString('en-US')} →{' '}
                  <b>{Math.round(value).toLocaleString('en-US')}</b> 元
                </span>
                <span className={`tnum revtotalpct ${p >= 0 ? 'chg-up' : 'chg-down'}`}>
                  {p >= 0 ? '+' : ''}{p.toFixed(2)}%
                </span>
                <span className="fine">
                  各檔起算日不同、本金可個別調整，所以這是各檔報酬的加總，
                  不是一段期間的投組報酬。要判斷好壞請看下面每一檔的差距。
                </span>
              </p>
            )
          })()}

          <p className="revverdict" data-testid="review-verdict">
            {/* 分子分母都寫出來。§11：樣本小的時候不要只給百分比 */}
            <b className="tnum">{withBoth.length} 檔裡 {beat} 檔</b>
            {' '}照建議做比買了不動賺得多。
            {beat === 0 && '　也就是說，目前沒有任何一檔因為進出而變好。'}
          </p>

          {withBoth.map((r) => {
            const rule = r.tracks.find((t) => t.track === 'rule')!
            const hold = r.tracks.find((t) => t.track === 'hold')!
            const ai = r.tracks.find((t) => t.track === 'ai')
            const aiLive = ai !== undefined && ai.stats.trades > 0
            return (
              <section className="card" key={r.symbolId} data-testid={`review-${r.code}`}>
                <div className="revhead">
                  <h2>
                    <NavLink href={`/${r.market.toLowerCase()}/${r.code}`}>
                      {r.code}
                    </NavLink>
                    <span className="revname">{r.name ?? ''}</span>
                  </h2>
                  <span className="fine tnum">
                    本金 {r.initialTwd.toLocaleString('en-US')} 元
                  </span>
                </div>

                {/* 一次都沒進場時，「差距 −137%」讀起來像策略慘敗，
                    但實際上是**從頭到尾沒參與**。那是完全不同的一件事，
                    要說出來，不能讓那個數字自己去暗示。 */}
                {rule.stats.trades === 0 && (
                  <p className="revnote" data-testid={`review-flat-${r.code}`}>
                    <b>一次都沒進場</b>，全程現金——下面的差距是「沒參與」的落差，
                    不是買賣做得好不好。
                  </p>
                )}

                {/* 第一層只回答一件事：有沒有幫助。
                    一句話 ＋ 一個大數字 ＋ 一條差距線，其餘收進「更多數字」。 */}
                {(() => {
                  const lead = aiLive ? ai! : rule
                  const leadLabel = aiLive ? 'AI 判斷' : '照建議做'
                  const gap = lead.stats.retPct - hold.stats.retPct
                  const points = gapSeries(lead.curve, hold.curve)
                  return (
                    <>
                      <p className="revanswer" data-testid={`answer-${r.code}`}>
                        <span className={`revgap tnum ${gap >= 0 ? 'chg-up' : 'chg-down'}`}>
                          {gap >= 0 ? '+' : ''}{gap.toFixed(2)}%
                        </span>
                        <span className="revanswertext">
                          {gap >= 0
                            ? `${leadLabel}比買了不動多賺這麼多`
                            : `${leadLabel}比買了不動少賺這麼多`}
                        </span>
                      </p>

                      {/* 寬窄兩份 viewBox，用 CSS 切換。920 寬的 viewBox 塞進 375px
                          螢幕，軸標籤實測只剩 3.6px——那不是小，是看不見。 */}
                      <div className="chart-wide">
                        <GapChart points={points} leadLabel={leadLabel} id={`w-${r.code}`} />
                      </div>
                      <div className="chart-narrow">
                        <GapChart points={points} leadLabel={leadLabel}
                          id={`n-${r.code}`} width={W_NARROW} />
                      </div>
                    </>
                  )
                })()}

                <Details rule={rule} hold={hold} />

                {!aiLive && (
                  <p className="fine" data-testid={`review-ai-${r.code}`}>
                    {/* 有決策但都是觀望 ≠ 還沒開始。只數成交筆數會把前者說成後者 */}
                    {r.aiDecisions > 0
                      ? `AI 已判斷 ${r.aiDecisions} 天，目前都選擇觀望，所以還沒有曲線。`
                      : 'AI 判斷那條還沒有資料。'}
                    　它<b>不能回補</b>（事後看歷史等於偷看未來），
                    只能從開始跑的那天往後長。
                    {r.aiMissing > 0 && `目前有 ${r.aiMissing} 天沒跑到。`}
                  </p>
                )}
              </section>
            )
          })}

          <p className="fine">
            次日開盤成交・含手續費與證交稅・未計滑價・不代表實際可獲得之報酬。
            樣本期間內只有一種市況，數字不足以證明規則好或壞——
            要抓的是<b>明顯錯的</b>，不是把參數調到最漂亮（PLAN §11）。
          </p>
        </>
      )}
    </main>
  )
}
