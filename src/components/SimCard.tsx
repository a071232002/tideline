import type { SimTrack } from '@/lib/data'
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

  /**
   * 起算日之後還沒有任何交易日。
   *
   * 週末或收盤前加進來的標的就是這樣。這時候整張卡的每個數字都是 0，
   * 印出來會被讀成「跑過了、結果是零」——但實際上是還沒開始。
   * 講一句話就好，不要給一張全是零的成績單。
   */
  if (lead.totalDays === 0) {
    return (
      <section className="card sim" data-testid="sim-card">
        <div className="simhead"><h2>如果照建議做</h2></div>
        <p className="simlede" data-testid="sim-not-started">
          從 <b className="tnum">{lead.startedOn}</b> 起追蹤，
          用 <b className="tnum">{money(lead.initialTwd, 'TWD')} 元</b> 模擬。
          <b>還沒有交易日</b>——下一個開盤日抓到資料之後就會開始，
          AI 的第一筆判斷也在那時。
        </p>
      </section>
    )
  }

  /**
   * 樣本太短。
   *
   * 三個交易日的「差距 −0.29%」用 24px 粗體印出來，旁邊還配一句肯定的
   * 「照建議進出，反而比買了不動少賺 0.29%」——那個語氣不是資料支持的。
   * 樣本數本來就有顯示，但它在最底下的灰字裡，份量跟結論句差了一個數量級。
   *
   * 十天這個界線跟清單頁首同一個（WatchList 的「還看不出結果」），
   * 不是另訂一套。短的時候：數字降一級、結論句換成但書。
   */
  const tooShort = lead.totalDays < 10

  // 一次都沒買過、也一天都沒持股。這種狀態不需要三段文字加一組全是 0 的統計
  const nothingHappened = lead.trades === 0 && lead.daysInMarket === 0

  // 賺賠多少錢。報酬率在五萬塊的本金上是抽象的，金額不是。
  const profit = lead.equity - lead.initialCash

  // 每批買不到 14,036 元就一直在撞最低手續費，那不是在測規則是在測手續費（§13.2）
  const perBatch = rule.initialCash / 3
  const tooSmall = market === 'TW' && perBatch < 14036

  return (
    <section className="card sim" data-testid="sim-card">
      <div className="simhead">
        <h2>如果照建議做</h2>
      </div>

      {/* **三件事：觀察多久、本金多少、現在賺賠多少。**
          原本這裡是「照建議做／買了不動／差距」三個並排的百分比。
          那個設計的用意是防止自我欺騙（大盤漲 10% 而你賺 4% 不是準），
          但實際使用下來，每天要回答的問題不是「有沒有贏大盤」，
          是「我這筆錢現在怎麼樣」。
          買了不動那條軌道仍然照算，移到下面的「更多數字與設定」裡，
          §11 的回顧也照樣用得到——拿掉的是版面，不是資料。 */}
      <p className="simlede" data-testid="sim-lede">
        <b className="tnum">{lead.startedOn}</b> 起追蹤{' '}
        <b className="tnum">{lead.totalDays}</b> 個交易日・本金{' '}
        <b className="tnum">{money(lead.initialTwd, 'TWD')} 元</b>
      </p>

      <div className={`simscores two${tooShort ? ' short' : ''}`}>
        <div className="simscore lead">
          <div className="lab">報酬率</div>
          <div className={`num tnum ${lead.retPct >= 0 ? 'chg-up' : 'chg-down'}`}
            data-testid="sim-ret">{pct(lead.retPct)}</div>
        </div>
        <div className="simscore">
          {/* 百分比在幾千塊的本金上很難有體感。金額才是「賺賠多少」 */}
          <div className="lab">獲益</div>
          <div className={`num tnum ${profit >= 0 ? 'chg-up' : 'chg-down'}`}
            data-testid="sim-profit">
            {profit >= 0 ? '+' : '−'}{money(Math.abs(profit), cur)}
          </div>
        </div>
      </div>

      {tooShort && (
        <p className="simwhy" data-testid="sim-verdict">
          樣本只有 {lead.totalDays} 個交易日，還讀不出結果。
        </p>
      )}

      {/* 第三條軌道。
          原本只有一句「AI 那條還沒開始」——但它已經開始了，天天在判斷，
          只是判斷的結果是不進場。把它講成「還沒開始」，等於把主角的決定
          說成缺席。有幾天、決定了什麼、所以帳戶是多少，三件事講清楚。 */}
      {/* **一次都沒動過的時候，只說一句。**
          原本這裡有三段各自在講同一件事：AI 那句「都選擇不進場」、
          統計裡的「有股票的天數 0/4」、以及「期間內未觸發任何進場條件」。
          三段都是真的，但它們是同一個事實的三種說法。 */}
      {nothingHappened ? (
        <p className="simidle" data-testid="sim-idle">
          {lead.totalDays} 個交易日全程空手，進場條件一直沒有同時成立
          {ai?.ai && ai.ai.days > 0 ? `；AI 判斷 ${ai.ai.days} 天也都選擇不進場` : ''}。
        </p>
      ) : (
        <>
          {ai?.ai && ai.ai.days > 0 && (
            <p className="simai3" data-testid="sim-ai-track">
              {aiLive
                ? `規則那條同期是 ${pct(rule.retPct)}。`
                : `AI 已經判斷 ${ai.ai.days} 天，到目前為止都選擇不進場——`
                  + `它的帳戶因此還是 ${pct(ai.retPct)}，整筆放在現金。`}
            </p>
          )}

          {/* 「現在持股」與「現金」搬到上面的「明天開盤」那一行去了——
              那是動作的前提，不是回顧的統計。這裡只留跟「準不準」有關的。 */}
          <dl className="simstats tnum">
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
        </>
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

      {/* 細部統計收進摺疊區。它們回答「為什麼會這樣」，是第二層問題——
          攤開來會讓讀者先花力氣找重點。原本這些在 /review，
          但那一頁只是把同一件事再畫一次，反而要在頁面之間換算日期。 */}
      {/* 細節與設定共用一個摺疊區。
          本金是**設定**，不是每天要讀的東西——它攤開來佔 89px，
          而這張卡在手機上已經是最大的一塊（657px）。 */}
      <details className="revdetails">
        <summary>更多數字與設定</summary>
        <dl className="revstats">
          <div><dt>中途最多虧</dt>
            <dd className="tnum">−{lead.stats.maxDrawdownPct.toFixed(2)}%</dd></div>
          {/* §11 的規矩：次數少的時候不寫百分比。「12 次裡 7 次」比「勝率 58%」誠實 */}
          <div><dt>賣出賺錢</dt>
            <dd className="tnum">
              {lead.stats.closed > 0 ? `${lead.stats.closed} 次裡 ${lead.stats.wins} 次` : '—'}
            </dd></div>
          <div><dt>觸發停損</dt><dd className="tnum">{lead.stats.stopped} 次</dd></div>
          {/* 買了不動與差距從卡片正面搬到這裡。
              那個對照的用意是防止自我欺騙（大盤漲 10% 而你賺 4% 不是準），
              所以**軌道照算、數字照留**，只是每天要回答的問題不是「有沒有
              贏大盤」，是「我這筆錢現在怎麼樣」。§11 的回顧仍然用得到它。 */}
          <div><dt>買了不動</dt><dd className="tnum">{pct(hold.retPct)}</dd></div>
          <div><dt>與買了不動的差距</dt>
            <dd className={`tnum ${excess >= 0 ? 'chg-up' : 'chg-down'}`}>{pct(excess)}</dd></div>
          {market === 'TW' && (
            <div><dt>股利稅負</dt><dd className="tnum">未計入</dd></div>
          )}
        </dl>
        <CapitalForm symbolId={symbolId} current={lead.initialTwd} market={market} />
      </details>

      {/* §13.9：假設一定要揭露，這一段不能收起來。
          但「未扣股利所得稅與二代健保」是細節的細節，
          而「AI 軌道尚未開始」是狀態不是假設——前者移進摺疊區，後者上移到結論那句。 */}
      <p className="fine" data-testid="sim-assumptions">
        收盤後決定、次日開盤成交・含手續費與證交稅・未計滑價
        {market === 'TW' ? '・以零股計算・配息以現金入帳' : '・允許小數股'}
        ・樣本 {rule.totalDays} 個交易日・<b>不代表實際可獲得之報酬</b>
      </p>
    </section>
  )
}
