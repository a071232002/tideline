import { getReview, type ReviewSymbol, type ReviewTrack } from '@/lib/data'
import { EquityChart } from '@/components/EquityChart'
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
 * 所以每一區塊都以超額報酬（規則 − 買進持有）領銜，不是報酬率。
 */

const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`

function excessOf(s: ReviewSymbol): number | null {
  const rule = s.tracks.find((t) => t.track === 'rule')
  const hold = s.tracks.find((t) => t.track === 'hold')
  if (!rule || !hold) return null
  return rule.stats.retPct - hold.stats.retPct
}

function Stats({ rule, hold }: { rule: ReviewTrack; hold: ReviewTrack }) {
  const s = rule.stats
  const excess = s.retPct - hold.stats.retPct
  const inMarket = s.totalDays > 0 ? Math.round((s.daysInMarket / s.totalDays) * 100) : 0
  return (
    <dl className="revstats">
      <div className="lead">
        <dt>差距</dt>
        <dd className={`tnum ${excess >= 0 ? 'chg-up' : 'chg-down'}`}>{pct(excess)}</dd>
      </div>
      <div><dt>照建議做</dt><dd className="tnum">{pct(s.retPct)}</dd></div>
      <div><dt>買了不動</dt><dd className="tnum">{pct(hold.stats.retPct)}</dd></div>
      {/* 這些標籤原本是行話（在市、超額、回落）。同一個數字，
          用讀者的話寫才看得懂在比什麼 */}
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
                    這一檔<b>一次都沒有進場</b>——期間內進場條件從未同時成立，
                    全程是現金。下面的差距是「沒參與」跟「一直抱著」的落差，
                    不是買賣做得好不好。
                  </p>
                )}

                <Stats rule={rule} hold={hold} />

                <EquityChart series={[
                  { track: 'rule', curve: rule.curve },
                  ...(aiLive ? [{ track: 'ai' as const, curve: ai!.curve }] : []),
                  { track: 'hold', curve: hold.curve },
                ]} />

                {!aiLive && (
                  <p className="fine" data-testid={`review-ai-${r.code}`}>
                    {/* 星號是 markdown，不是 HTML——寫在 JSX 裡會原樣印出來 */}
                    AI 判斷那條還沒有資料。它<b>不能回補</b>
                    （事後看歷史等於偷看未來），只能從開始跑的那天往後長。
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
