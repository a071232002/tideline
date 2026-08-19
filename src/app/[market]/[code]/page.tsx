import { notFound } from 'next/navigation'
import { getStockPage } from '@/lib/data'
import { PriceChart, KdChart } from '@/components/Charts'
import { NavLink } from '@/components/NavLink'
import { LevelStrip, type StripLevel } from '@/components/LevelStrip'
import { levelStatus } from '@/lib/status'
import { Icon } from '@/components/Icon'
import { TopBar } from '@/components/TopBar'
import { ValuationCard } from '@/components/ValuationCard'
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

      <LevelStrip levels={strip} close={close} />

      <section className="tiles">
        <div className="tile">
          <div className="lab">收盤價</div>
          {/* 台股紅漲綠跌——與參考範本相反，那份用的是美式配色 */}
          <div className={`val tnum ${down ? 'chg-down' : 'chg-up'}`}
            data-testid="close" data-dir={down ? 'down' : 'up'}>{fmt(close)}</div>
          <div className="det tnum">
            {down ? '▼' : '▲'}{fmt(Math.abs(chg ?? 0))}（{chgPct === null ? '—' : `${chgPct >= 0 ? '+' : ''}${chgPct.toFixed(2)}%`}）
            　開 {fmt(n(a.o))}｜高 {fmt(n(a.h))}｜低 {fmt(n(a.l))}
          </div>
        </div>

        <div className="tile">
          <div className="lab">KD（9,3,3）</div>
          <div className="val tnum" data-testid="kd">K {fmt(kv, 1)} / D {fmt(dv, 1)}</div>
          <div className="det">{kv !== null && dv !== null && kv < dv ? 'K 在 D 之下' : ''}</div>
        </div>

        <div className="tile">
          <div className="lab">布林通道（20,2σ）</div>
          <div className="val tnum">%b {fmt(pctB)}</div>
          <div className="det tnum">
            上軌 {fmt(up)}｜中軌 {fmt(mid)}｜下軌 {fmt(loB)}，帶寬 {bw === null ? '—' : `${(bw * 100).toFixed(1)}%`}
          </div>
        </div>

        <div className="tile">
          <div className="lab">技術合理價區</div>
          <div className="val tnum">
            {levels.fair ? `${levels.fair.lo.toFixed(2)}～${levels.fair.hi.toFixed(2)}` : '—'}
          </div>
          <div className="det tnum">布林中軌 {fmt(mid)} ～ 季線（60MA） {fmt(ma60)}</div>
        </div>
      </section>

      <section className="card">
        <p className="headline" data-testid="headline">{verdict.headline ?? '—'}</p>
        <ul className="clist">
          {(verdict.reasons ?? []).map((r) => <li key={r}>{r}</li>)}
        </ul>
        <p className="fine" data-testid="disclaimer">
          資料來源：{page.symbol.market === 'TW' ? 'TWSE 個股日成交資訊' : 'Yahoo Finance'}。
          指標由每日收盤價自行計算（KD 9,3,3；布林 20,2σ；60 日均線）。
          結論由{verdict.source === 'rule' ? '規則' : 'AI'}產生。
          本報告為自動化技術分析，<b>僅供參考，非投資建議</b>；投資人應自行評估風險。
        </p>
      </section>

      <ValuationCard valuation={page.valuation} market={page.symbol.market}
        code={page.symbol.code} />

      <section className="card">
        <h2>近 6 個月收盤價與布林通道</h2>
        <PriceChart
          bars={page.bars}
          bands={page.bands}
          levels={{
            sell: levels.sell ? [levels.sell.lo, levels.sell.hi] : null,
            stop: levels.stop?.price ?? null,
            add: levels.add ? [levels.add.lo, levels.add.hi] : null,
          }}
          currency={cur}
          history={page.levelHistory}
        />
      </section>

      <section className="card">
        <h2>KD 指標（9,3,3）</h2>
        <KdChart points={kdPoints} />
      </section>
    </main>
  )
}
