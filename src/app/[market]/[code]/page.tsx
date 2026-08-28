import { notFound } from 'next/navigation'
import { getStockPage, getSim } from '@/lib/data'
import { ChartBoard } from '@/components/ChartBoard'
import { gapSeries } from '@/components/GapPanel'
import { NavLink } from '@/components/NavLink'
import { LevelStrip, type StripLevel } from '@/components/LevelStrip'
import { levelStatus } from '@/lib/status'
import { Icon } from '@/components/Icon'
import { TopBar } from '@/components/TopBar'
import { FreshWatch } from '@/components/FreshWatch'
import { ValuationCard } from '@/components/ValuationCard'
import { SimCard } from '@/components/SimCard'
import { SimNext } from '@/components/SimNext'
import { kd as computeKd } from '@/lib/indicators'

export const dynamic = 'force-dynamic'

interface Zone { lo: number; hi: number }
interface LevelsJson {
  sell?: (Zone & { kind: string }) | null
  stop?: { price: number } | null
  add?: Zone
  fair?: Zone
  why?: Record<string, string>
}

function n(v: unknown): number | null {
  const x = typeof v === 'string' ? Number(v) : (v as number)
  return typeof x === 'number' && Number.isFinite(x) ? x : null
}

export default async function StockPage({
  params,
}: {
  params: Promise<{ market: string; code: string }>
}) {
  const { market, code } = await params
  const page = await getStockPage(market.toUpperCase(), code.toUpperCase())
  if (!page) notFound()

  // 模擬帳戶是 per-user 的，所以在共用快取之外單獨讀（PLAN §13.7）
  const sim = await getSim(page.symbol.id)
  const simLead = sim.find((t) => t.track === 'ai' && t.trades > 0)
    ?? sim.find((t) => t.track === 'rule')
  // 與「買了不動」的差距，當成主圖的一個圖層。回顧不再是另一頁。
  const simHold = sim.find((t) => t.track === 'hold')
  const gapCurve = simLead && simHold ? gapSeries(simLead.curve, simHold.curve) : []

  const a = page.analysis
  const cur = page.symbol.currency
  const fmt = (v: number | null, d = 2) => (v === null ? '—' : v.toFixed(d))

  // 沒有分析資料時分辨「休市」與「故障」（PLAN §7）
  if (!a) {
    return (
      <main className="wrap">
        <TopBar />
      <NavLink href="/" className="backlink"><Icon name="back" /><span>觀察清單</span></NavLink>
        <h1>{page.symbol.code} {page.symbol.name ?? ''}</h1>
        <div className="card">
          <p className="empty" data-testid="no-analysis">
            {page.lastJobOk
              ? '今日休市或尚未收盤，目前沒有新的分析資料。'
              : '資料未更新——最近一次排程沒有成功。'}
          </p>
        </div>
      </main>
    )
  }

  const levels = (a.levels ?? {}) as LevelsJson
  const verdict = (a.verdict ?? {}) as { headline?: string; reasons?: string[]; source?: string }
  const why = levels.why ?? {}

  const close = n(a.close)
  const chg = n(a.chg)
  const chgPct = n(a.chg_pct)
  const kv = n(a.k)
  const dv = n(a.d_val)
  const mid = n(a.bb_mid)
  const up = n(a.bb_up)
  const loB = n(a.bb_lo)
  const pctB = n(a.pct_b)
  const bw = n(a.bandwidth)
  const ma60 = n(a.ma60)

  const down = (chg ?? 0) < 0

  // 三個關鍵價位抽到最前面。判斷句留在下面當佐證，不再是唯一的入口。
  const strip: StripLevel[] = []
  if (levels.sell) strip.push({ kind: 'sell', lo: levels.sell.lo, hi: levels.sell.hi, why: why.sell })
  if (levels.stop) strip.push({ kind: 'stop', lo: levels.stop.price, why: why.stop })
  if (levels.add) strip.push({ kind: 'add', lo: levels.add.lo, hi: levels.add.hi, why: why.add })

  // 與清單共用同一份判斷，兩邊才不會對同一檔講出不一樣的話
  const status = levelStatus(close, {
    sell: levels.sell ? { lo: levels.sell.lo, hi: levels.sell.hi } : null,
    stop: levels.stop?.price ?? null,
    add: levels.add ?? null,
  })

  // KD 曲線：從已存的 bars 重算（daily_analysis 只存最後一天那一組）。
  // RSV 必須吃**盤中高低價**，用收盤價當高低會算出很接近但永遠對不上的數字。
  const kdPoints = page.bars.length >= 9
    ? computeKd(
        page.bars.map((b) => ({ date: b.d, o: b.o, h: b.h, l: b.l, c: b.c, v: 0 })),
        9, 3, 3,
      ).map((v, i) => (v ? { d: page.bars[i]!.d, k: v.k, d_val: v.d } : null))
        .filter((x): x is { d: string; k: number; d_val: number } => x !== null)
    : []

  return (
    <main className="wrap">
      <FreshWatch />
      <TopBar />
      <NavLink href="/" className="backlink"><Icon name="back" /><span>觀察清單</span></NavLink>

      <header className="pagehead">
        <span className="eyebrow">
          {page.symbol.market === 'TW' ? '台股' : '美股'}　{page.symbol.code}
        </span>
        <h1>{page.symbol.name ?? page.symbol.code}</h1>
        <p className="sub">
          資料日期 {String(a.d)}
          <span className="badge">僅供參考，非投資建議</span>
        </p>
      </header>

      {status.kind !== 'none' && (
        <p className={`pagestatus tone-${status.tone}`} data-testid="page-status">
          {status.label}
          {status.distancePct !== null
            && `　距離 ${status.distancePct > 0 ? '+' : ''}${status.distancePct.toFixed(1)}%`}
        </p>
      )}

      {/* ---------------------------------------------------------------
          建議與技術分析要分開。

          原本是交錯的：價位（建議）→ 明日動作（建議）→ 四格摘要（技術）
          → 判斷句（技術）→ 模擬帳戶（建議的成績）→ 兩張圖（技術）。
          讀者每往下一段就要切換一次心智狀態，資訊自然顯得雜。

          分成三段，每段一個標題：**今天怎麼做 → 這些建議準不準 → 技術面依據**。
          --------------------------------------------------------------- */}
      <h2 className="secttl" data-testid="sect-do">今天怎麼做</h2>

      {/* 明日動作放在價位之前：那是結論，價位是它的依據。
          原本它在手機上位於第三屏（y=1604，視窗 780）。 */}
      <SimNext track={simLead} ai={sim.find((t) => t.track === 'ai')}
        market={page.symbol.market}
        latestBar={page.bars[page.bars.length - 1]?.d} />

      <LevelStrip levels={strip} close={close} />

      {/* ---------------------------------------------------------------
          圖是主體，技術與回顧是它的圖層。

          原本這一頁有兩張獨立的圖（價格、KD），另外還有一整個 /review 頁面
          畫「價格＋買賣點＋差距」——同一件事畫在三個地方，而讀者要在頁面之間
          換算日期才對得起來。現在只有這一張，其餘都是可以開關的圖層。
          --------------------------------------------------------------- */}
      <h2 className="secttl" data-testid="sect-chart">走勢與買賣</h2>
      <section className="card chartcard">
        <ChartBoard
          bars={page.bars}
          bands={page.bands}
          levels={{
            sell: levels.sell ? [levels.sell.lo, levels.sell.hi] : null,
            stop: levels.stop?.price ?? null,
            add: levels.add ? [levels.add.lo, levels.add.hi] : null,
          }}
          currency={cur}
          marks={simLead?.marks ?? []}
          gap={gapCurve}
          kd={kdPoints}
          hasAccount={simLead !== undefined}
        />
      </section>

      <h2 className="secttl" data-testid="sect-check">這些建議準不準</h2>
      <SimCard tracks={sim} market={page.symbol.market} symbolId={page.symbol.id} />

      <h2 className="secttl" data-testid="sect-why">技術面依據</h2>

      {/* **一塊，不是兩塊。**
          原本是四格摘要（307px）＋判斷句卡（217px），而那兩塊把同一組數字
          印了兩次：K 36.9、D 51.1、%b 0.58、中軌 102.68、季線 104.31
          全部出現兩遍。四格給的是數字，判斷句給的是「往哪邊動」——
          那是同一件事的兩半，本來就該在一起。

          合併之後每個數字只出現一次，順序是：先說結論，再說怎麼看出來的，
          最後才是原始數值。 */}
      <section className="card tech">
        <p className="headline" data-testid="headline">{verdict.headline ?? '—'}</p>
        <ul className="clist">
          {(verdict.reasons ?? []).map((r) => <li key={r}>{r}</li>)}
        </ul>

        {/* 原始數值。判斷句裡已經解釋過它們的意義，這裡只負責「確切是多少」，
            所以壓成兩行密排的小字，不再做成四張卡。 */}
        <dl className="techraw tnum">
          <div>
            <dt>收盤</dt>
            <dd>
              {/* 價格與漲跌分開兩個元素：`close` 這個 testid 一直以來只包價格，
                  把漲跌塞進同一個元素會讓「顏色對不對」與「格式對不對」
                  兩個測試同時看錯東西。 */}
              <span className={down ? 'chg-down' : 'chg-up'} data-testid="close"
                data-dir={down ? 'down' : 'up'}>{fmt(close)}</span>
              <span className={`techchg ${down ? 'chg-down' : 'chg-up'}`}>
                　{down ? '▼' : '▲'}{fmt(Math.abs(chg ?? 0))}
                （{chgPct === null ? '—' : `${chgPct >= 0 ? '+' : ''}${chgPct.toFixed(2)}%`}）
              </span>
            </dd>
          </div>
          <div><dt>開高低</dt><dd>{fmt(n(a.o))}／{fmt(n(a.h))}／{fmt(n(a.l))}</dd></div>
          <div><dt>KD（9,3,3）</dt>
            <dd data-testid="kd">K {fmt(kv, 1)}／D {fmt(dv, 1)}</dd></div>
          <div><dt>布林（20,2σ）</dt>
            <dd>%b {fmt(pctB)}　{fmt(loB)}－{fmt(mid)}－{fmt(up)}
              　帶寬 {bw === null ? '—' : `${(bw * 100).toFixed(1)}%`}</dd></div>
          <div><dt>季線 60MA</dt><dd>{fmt(ma60)}</dd></div>
          <div><dt>技術合理價區</dt>
            <dd>{levels.fair ? `${levels.fair.lo.toFixed(2)}～${levels.fair.hi.toFixed(2)}` : '—'}</dd></div>
        </dl>

        {/* 原本這裡有 90 個字，其中「KD 9,3,3；布林 20,2σ；60 日均線」上面
            四格摘要的標題已經寫過一次，「僅供參考、非投資建議」頁首的徽章也寫過。
            重複的字不會讓人更謹慎，只會讓真正該讀的那幾行沉下去。
            留下唯一不重複的資訊：來源，以及**這句話是規則拼的還是 AI 權衡的**。 */}
        <p className="fine" data-testid="disclaimer">
          {page.symbol.market === 'TW' ? 'TWSE 收盤價' : 'Yahoo Finance'}
          ・由{verdict.source === 'rule' ? '程式規則' : 'AI'}產生
          ・<b>非投資建議</b>
        </p>
      </section>

      {/* 估值是**基本面**，跟上面整段技術分析不是同一件事——
          它自己一段，才不會被當成價位的依據之一。
          §3 也明講過：估值不參與價位計算。

          但沒有估值可講的時候（ETF 永遠如此），一個段落標題加一張卡去裝
          一句「這裡沒有東西」是本末倒置——三行外框裝一行內容。
          那種情況下標題收起來，只留那一句。 */}
      {page.valuation && (
        <h2 className="secttl" data-testid="sect-value">另一個角度：估值</h2>
      )}
      <ValuationCard valuation={page.valuation} market={page.symbol.market}
        code={page.symbol.code} />
    </main>
  )
}
