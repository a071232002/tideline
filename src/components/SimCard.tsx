import type { SimTrack } from '@/lib/data'
import { NavLink } from './NavLink'
import { CapitalForm } from './CapitalForm'

/**
 * 模擬帳戶（PLAN §13.7）。
 *
 * 兩個設計決定，兩個都是為了不讓人誤讀自己的績效：
 *
 * 一、**報酬率一定要跟買進持有並排，字級一樣大。** 大盤漲 10% 而你賺 4%，
 *     那不是準，是拖後腿。只放單一個報酬率等於鼓勵自己誤讀，所以
 *     「準不準」的答案掛在**超額報酬**上，不是報酬率本身。
 *
 * 二、**這張卡只講歷史。** 「明日開盤將執行」已經拆到 `SimNext.tsx`，
 *     放在決策條正下方——量出來它原本在手機上位於 y=1604，視窗只有 780px，
 *     要捲兩個螢幕才看得到，而那是整頁唯一可以照做的指令。
 */

/**
 * 軌道的名字要用**讀者的話**，不是我們內部的名字。
 *
 * 「規則」「買進持有」是實作用語：前者其實是「照這個站的建議做」，
 * 後者是「第一天買了就不動」。把內部命名直接搬到畫面上，
 * 讀者得先猜這兩個詞是什麼意思，才談得上看懂數字。
 */
const LABEL: Record<SimTrack['track'], string> = {
  ai: 'AI 判斷', rule: '照建議做', hold: '買了不動',
}

const pct = (v: number | null) =>
  v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`

const money = (v: number, currency: string) =>
  currency === 'TWD'
    ? Math.round(v).toLocaleString('en-US')
    : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function SimCard({ tracks, market, symbolId }: {
  tracks: SimTrack[]
  market: 'TW' | 'US'
  symbolId: string
}) {
  if (tracks.length === 0) return null

  const by = (t: SimTrack['track']) => tracks.find((x) => x.track === t)
  const rule = by('rule')
  const hold = by('hold')
  const ai = by('ai')
  if (!rule || !hold) return null

  // AI 那條不能回補（§13.1 四），所以上線前它是空的。空的時候不要假裝有績效
  const aiLive = ai !== undefined && ai.trades > 0
  const lead = aiLive ? ai! : rule
  const excess = lead.retPct - hold.retPct

  const cur = rule.currency
  const inMarketPct = rule.totalDays > 0
    ? Math.round((rule.daysInMarket / rule.totalDays) * 100) : 0
  const feePct = rule.initialCash > 0 ? (rule.totalFees / rule.initialCash) * 100 : 0

  /**
   * 空手多久了。
   *
   * 沒有這一句，卡片就只是丟出三個七月的日期——今天是八月底，看起來像資料壞掉。
   * 實際上那是規則照著跑的結果：止損出清之後，「回低檔→金叉」的進場訊號
   * 一直沒有重新架起，所以什麼都不該做。**「什麼都沒做」需要被說出來**，
   * 否則沉默會被讀成故障。
   */
  const last = lead.recent[0]
  const idleDays = last
    ? lead.curve.filter((p) => p.d > last.fillD).length
    : lead.curve.length
  const idleWhy = last?.triggers.includes('stop') ? '止損出清後' : '上次減碼後'

  // 每批買不到 14,036 元就一直在撞最低手續費，那不是在測規則是在測手續費（§13.2）
  const perBatch = rule.initialCash / 3
  const tooSmall = market === 'TW' && perBatch < 14036

  return (
    <section className="card sim" data-testid="sim-card">
      <div className="simhead">
        <h2>如果照建議做</h2>
        <NavLink href="/review" className="revlink">全部回顧 →</NavLink>
      </div>

      {/* 一句話說清楚這張卡在算什麼。少了它，下面每個數字都要讀者自己猜前提 */}
      <p className="simlede">
        假設從 {lead.curve[0]?.d ?? '—'} 起、用{' '}
        <b className="tnum">{money(lead.initialTwd, 'TWD')} 元</b>
        完全照這一頁的價位買賣（不加碼、不追高），到今天會變成：
      </p>

      {/* 「明日開盤將執行」不在這張卡裡——它被移到決策條下方（SimNext.tsx）。
          這張卡是回顧，那一行是指令，兩種閱讀狀態不要混在一起。 */}
      <div className="simscores">
        <div className="simscore lead">
          <div className="lab">{LABEL[lead.track]}</div>
          <div className={`num tnum ${lead.retPct >= 0 ? 'chg-up' : 'chg-down'}`}
            data-testid="sim-ret">{pct(lead.retPct)}</div>
        </div>
        <div className="simscore">
          <div className="lab">{LABEL.hold}</div>
          <div className={`num tnum ${hold.retPct >= 0 ? 'chg-up' : 'chg-down'}`}
            data-testid="sim-hold">{pct(hold.retPct)}</div>
        </div>
        <div className="simscore">
          {/* 「準不準」的答案在這一格，不在左邊那格。
              「超額報酬」是行話——寫成「差距」才看得懂在比什麼 */}
          <div className="lab">差距</div>
          <div className={`num tnum ${excess >= 0 ? 'chg-up' : 'chg-down'}`}
            data-testid="sim-excess">{pct(excess)}</div>
        </div>
      </div>

      {/* 一句話的結論，而且要說出**多賺還是少賺**，不要只丟一個正負號 */}
      <p className="simwhy">
        {excess >= 0
          ? `照建議進出，比買了不動多賺 ${excess.toFixed(2)}%。`
          : `照建議進出，反而比買了不動少賺 ${Math.abs(excess).toFixed(2)}%。`}
      </p>

      <dl className="simstats tnum">
        <div><dt>現在持股</dt><dd>{market === 'TW' ? Math.round(lead.shares) : lead.shares.toFixed(4)} 股</dd></div>
        <div><dt>現金</dt><dd>{money(lead.cash, cur)}</dd></div>
        {/* 「在市」是行話。真正要說的是「有幾天手上真的有股票，其餘都是現金」 */}
        <div><dt>有股票的天數</dt><dd>{lead.daysInMarket}/{lead.totalDays}（{inMarketPct}%）</dd></div>
        <div><dt>買賣次數</dt><dd>{lead.trades} 次</dd></div>
        <div><dt>手續費與稅</dt><dd>{money(rule.totalFees, cur)}（{feePct.toFixed(2)}%）</dd></div>
      </dl>

      {lead.shares === 0 && idleDays > 0 && (
        <p className="simidle" data-testid="sim-idle">
          {last
            ? `${last.fillD} ${idleWhy}空手 ${idleDays} 個交易日——進場條件一直沒有同時成立。`
            : `期間內未觸發任何進場條件，${idleDays} 個交易日全程空手。`}
        </p>
      )}

      {lead.recent.length > 0 && (
        <ul className="simtrades">
          {lead.recent.map((t) => (
            <li key={`${t.signalD}-${t.side}`}>
              <span className="tnum simtradehead">
                <span className="simtraded">{t.fillD.slice(5)}</span>
                {/* 買賣用 --buy / --sell，不要借漲跌色：
                    那兩個是「該做什麼」，漲跌是「走了哪個方向」 */}
                <span className={`simside ${t.side}`}>{t.side === 'buy' ? '買' : '賣'}</span>
                <span>{market === 'TW' ? Math.round(t.qty) : t.qty.toFixed(4)}</span>
                <span className="quiet">@{t.price.toFixed(2)}</span>
              </span>
              {/* 沒有理由的成交紀錄等於沒有紀錄——原本這裡只有 `add`／`stop` */}
              {t.reason && <span className="simtradewhy">{t.reason}</span>}
            </li>
          ))}
        </ul>
      )}

      {tooSmall && (
        <p className="simwarn" data-testid="sim-too-small">
          本金過小：每批 {money(perBatch, cur)} 元低於 14,036，
          每一筆都會撞到 20 元最低手續費（實際費率 {((20 / perBatch) * 100).toFixed(2)}%，
          標準費率的 {(20 / perBatch / 0.001425).toFixed(1)} 倍）。建議至少 50,000 元。
        </p>
      )}

      <CapitalForm symbolId={symbolId} current={lead.initialTwd} market={market} />

      <p className="fine" data-testid="sim-assumptions">
        次日開盤成交・含手續費與證交稅・未計滑價
        {market === 'TW' ? '・以零股計算・配息以現金入帳（未扣股利所得稅與二代健保）' : '・允許小數股'}
        ・樣本 {rule.totalDays} 個交易日・<b>不代表實際可獲得之報酬</b>
        {aiLive || !ai ? '' : '・AI 軌道尚未開始（不回補）'}
      </p>
    </section>
  )
}
