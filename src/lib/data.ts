import { unstable_cache, revalidateTag } from 'next/cache'
import { createClient } from './supabase/server'
import { createAdminClient } from './supabase/admin'
import { CHART_BARS } from './pipeline'
import { marketFreshness, taipeiToday, type MarketFreshness } from './freshness'

/**
 * 讀取層。資料一天只變一次，非常適合快取——但也因此**快取沒清就是整天看到舊資料**。
 *
 * 規矩（PLAN §3）：任何寫入 daily_analysis / watchlist 的路徑，寫完必須清 tag。
 */

export const TAGS = {
  analysis: 'analysis',
  watchlist: (userId: string) => `watchlist:${userId}`,
}

export interface WatchRow {
  symbol_id: string
  market: 'TW' | 'US'
  code: string
  name: string | null
  currency: string
  d: string | null
  close: number | null
  chg_pct: number | null
  k: number | null
  d_val: number | null
  /** 定調那半句（「短線轉弱、波段中性」），價位另外用 levels 呈現 */
  tone: string | null
  levels: { kind: 'sell' | 'stop' | 'add'; lo: number; hi?: number }[]
  /**
   * 模擬帳戶（PLAN §13.7）。
   *
   * 放進清單而不是只留在個股頁：績效要能**並排比較**才有意義，
   * 一檔一檔點進去看記不住上一檔是多少。而「明天要做什麼」更是
   * 一進站就該看到的東西，不該藏在第二層。
   */
  sim: {
    retPct: number
    excessPct: number
    shares: number
    currency: string
    /** 明日動作的理由，或「今天為什麼不做」 */
    /** 換算成台幣的現值與本金，用來算跨市場的合計 */
    equityTwd: number | null
    initialTwd: number
    pending: { buy: boolean; sell: boolean; triggers: string[] } | null
  } | null
}

/**
 * 全站的資料新鮮度。每列各自寫「資料日期」不夠——排程整個沒跑時四列會一起
 * 顯示舊日期，使用者只會以為今天休市（PLAN §7）。
 */
export async function getFreshness(): Promise<MarketFreshness[]> {
  const db = createAdminClient()
  const { data: jobs } = await db.from('job_runs')
    .select('finished_at').eq('ok', true)
    .order('finished_at', { ascending: false }).limit(1)
  const lastOkAt = (jobs?.[0]?.finished_at as string) ?? null
  const today = taipeiToday()

  // 每個市場各自問「你最新的那根 K 棒是哪天」——共用一個日期會讓人
  // 以為兩邊看的是同一場交易
  const out: MarketFreshness[] = []
  for (const market of ['TW', 'US'] as const) {
    const { data: syms } = await db.from('symbols').select('id').eq('market', market)
    const ids = (syms ?? []).map((x) => x.id as string)
    if (ids.length === 0) continue

    const { data: bars } = await db.from('daily_bars')
      .select('d').in('symbol_id', ids)
      .order('d', { ascending: false }).limit(1)

    out.push(marketFreshness(market, {
      lastOkAt, latestBarDate: (bars?.[0]?.d as string) ?? null, today,
    }))
  }
  return out
}

/** 觀察清單總覽：一列一檔含當日狀態。走使用者身分，RLS 保證看不到別人的。 */
/** 台幣化。美股帳戶內部記美元，合計要換回台幣才能加總（PLAN §13.2） */
async function latestFxRate(): Promise<number | null> {
  const db = createAdminClient()
  const { data } = await db.from('fx_rates')
    .select('rate').eq('pair', 'USDTWD')
    .order('d', { ascending: false }).limit(1).maybeSingle()
  return data ? Number(data.rate) : null
}

export async function getWatchlist(): Promise<WatchRow[]> {
  const supabase = await createClient()
  const { data: rows, error } = await supabase
    .from('watchlist')
    .select('symbol_id, sort_order, symbols(market, code, name_zh, name_en, currency)')
    .order('sort_order')
  if (error || !rows) return []

  const ids = rows.map((r) => r.symbol_id as string)
  if (ids.length === 0) return []

  // 每檔最新的**有 K 棒撐著的**那一天。
  //
  // 不能直接拿最新的 daily_analysis：分析依 PLAN §11 永不刪除，而 K 棒會被
  // 抓取流程回收（保留視窗、以及「比最新一根還新」的清理）。實測 2026-08-22
  // 就出現 0050 最新 K 棒 08-19、最新分析 08-21 的孤兒列——清單會顯示一個
  // 我們沒有價格的日期，而且不會有任何錯誤訊息。
  const { data: barTops } = await supabase
    .from('daily_bars').select('symbol_id, d').in('symbol_id', ids)
    .order('d', { ascending: false })
  const latestBar = new Map<string, string>()
  for (const b of barTops ?? []) {
    const id = b.symbol_id as string
    if (!latestBar.has(id)) latestBar.set(id, b.d as string)
  }

  const { data: latest } = await supabase
    .from('daily_analysis')
    .select('symbol_id, d, close, chg_pct, k, d_val, verdict, levels')
    .in('symbol_id', ids)
    .order('d', { ascending: false })

  const newest = new Map<string, Record<string, unknown>>()
  for (const a of latest ?? []) {
    const id = a.symbol_id as string
    if (newest.has(id)) continue
    const bar = latestBar.get(id)
    if (bar && (a.d as string) > bar) continue   // 孤兒，跳過
    newest.set(id, a)
  }

  // 模擬帳戶：規則軌道的績效 ＋ 買進持有當對照。走使用者身分，RLS 保證
  // 只讀得到自己的（實測第二個帳號打開同一頁完全看不到，見 e2e）。
  const { data: accounts } = await supabase
    .from('sim_accounts')
    .select('id, symbol_id, track, initial_twd, initial_cash, currency, pending')
    .in('symbol_id', ids)

  const accIds = (accounts ?? []).map((a) => a.id as string)
  const lastEquity = new Map<string, { equity: number; shares: number; retPct: number }>()
  if (accIds.length > 0) {
    const { data: eq } = await supabase
      .from('sim_equity').select('account_id, d, equity, shares, ret_pct')
      .in('account_id', accIds).order('d', { ascending: false })
    for (const e of eq ?? []) {
      const id = e.account_id as string
      if (lastEquity.has(id)) continue
      lastEquity.set(id, {
        equity: Number(e.equity), shares: Number(e.shares), retPct: Number(e.ret_pct),
      })
    }
  }

  const fx = (accounts ?? []).some((a) => a.currency !== 'TWD') ? await latestFxRate() : null

  const simBySymbol = new Map<string, WatchRow['sim']>()
  for (const a of accounts ?? []) {
    if (a.track !== 'rule') continue
    const symbolId = a.symbol_id as string
    const rule = lastEquity.get(a.id as string)
    if (!rule) continue
    const holdAcc = (accounts ?? []).find(
      (x) => x.symbol_id === symbolId && x.track === 'hold')
    const hold = holdAcc ? lastEquity.get(holdAcc.id as string) : undefined
    const cur = a.currency as string
    simBySymbol.set(symbolId, {
      retPct: rule.retPct,
      excessPct: hold ? rule.retPct - hold.retPct : 0,
      shares: rule.shares,
      currency: cur,
      equityTwd: cur === 'TWD' ? rule.equity : (fx !== null ? rule.equity * fx : null),
      initialTwd: Number(a.initial_twd),
      pending: (a.pending as WatchRow['sim'] extends null ? never
        : NonNullable<WatchRow['sim']>['pending']) ?? null,
    })
  }

  return rows.map((r) => {
    const s = r.symbols as unknown as {
      market: 'TW' | 'US'; code: string; name_zh: string | null
      name_en: string | null; currency: string
    }
    const a = newest.get(r.symbol_id as string)
    const verdict = a?.verdict as { headline?: string } | undefined
    const lv = a?.levels as {
      sell?: { lo: number; hi: number } | null
      stop?: { price: number } | null
      add?: { lo: number; hi: number }
    } | undefined

    const levels: WatchRow['levels'] = []
    if (lv?.sell) levels.push({ kind: 'sell', lo: lv.sell.lo, hi: lv.sell.hi })
    if (lv?.stop) levels.push({ kind: 'stop', lo: lv.stop.price })
    if (lv?.add) levels.push({ kind: 'add', lo: lv.add.lo, hi: lv.add.hi })

    // headline 前半段是定調、後半段是價位；清單只留定調，價位用 LevelInline 排開
    const tone = verdict?.headline ? (verdict.headline.split('。')[0] ?? null) : null
    const sim = simBySymbol.get(r.symbol_id as string) ?? null
    return {
      symbol_id: r.symbol_id as string,
      market: s.market, code: s.code,
      name: s.name_zh ?? s.name_en ?? null,
      currency: s.currency,
      d: (a?.d as string) ?? null,
      close: (a?.close as number) ?? null,
      chg_pct: (a?.chg_pct as number) ?? null,
      k: (a?.k as number) ?? null,
      d_val: (a?.d_val as number) ?? null,
      tone,
      levels,
      sim,
    }
  })
}

export interface StockPage {
  symbol: { id: string; market: 'TW' | 'US'; code: string; name: string | null; currency: string }
  analysis: Record<string, unknown> | null
  valuation: {
    pe: number | null; forwardPe: number | null; pb: number | null
    dividendYield: number | null; d: string
  } | null
  bars: { d: string; o: number; h: number; l: number; c: number }[]
  bands: { d: string; mid: number; up: number; lo: number }[]
  kd: { d: string; k: number; d_val: number }[]
  /** 當時每天說的價位，用來疊在走勢上回顧（PLAN §11） */
  levelHistory: {
    d: string; sellLo: number | null; stop: number | null
    addLo: number | null; addHi: number | null; origin: string
  }[]
  /** 當日有沒有成功跑過排程——用來分辨「休市」與「資料未更新」（PLAN §7） */
  lastJobOk: boolean
}

/**
 * 個股頁的所有資料。全站共用（不含使用者資訊），所以可以放進快取。
 * 用 service role 讀是因為這裡沒有任何 per-user 內容。
 */
export const getStockPage = unstable_cache(
  async (market: string, code: string): Promise<StockPage | null> => {
    const db = createAdminClient()

    const { data: sym } = await db
      .from('symbols')
      .select('id, market, code, name_zh, name_en, currency')
      .eq('market', market).eq('code', code).maybeSingle()
    if (!sym) return null

    const { data: bars } = await db
      .from('daily_bars').select('d, o, h, l, c')
      .eq('symbol_id', sym.id).order('d', { ascending: true })

    // 只取「有 K 棒撐著」的最新分析。分析永不刪除、K 棒會被回收，
    // 兩者的最新日期會脫節——實測 0050 分析到 08-21、K 棒只到 08-19，
    // 頁面標題就寫著一個我們沒有價格的日期（sanity.ts 的 checkOrphanAnalysis）。
    const latestBarDate = (bars ?? [])[(bars ?? []).length - 1]?.d as string | undefined
    let analysisQuery = db.from('daily_analysis').select('*').eq('symbol_id', sym.id)
    if (latestBarDate) analysisQuery = analysisQuery.lte('d', latestBarDate)
    const { data: analysis } = await analysisQuery
      .order('d', { ascending: false }).limit(1).maybeSingle()

    const { data: val } = await db
      .from('daily_valuation').select('*')
      .eq('symbol_id', sym.id).order('d', { ascending: false }).limit(1).maybeSingle()

    // 歷史建議：畫成疊圖才看得出「當時說的價位」後來有沒有意義
    const { data: hist } = await db
      .from('daily_analysis').select('d, levels, origin')
      .eq('symbol_id', sym.id).order('d', { ascending: true })

    const { data: jobs } = await db
      .from('job_runs').select('ok, finished_at')
      .order('started_at', { ascending: false }).limit(1)

    const all = bars ?? []
    const series = all.slice(-CHART_BARS)

    // 圖上的通道要逐點算，不能只有最後一天那一組
    const closes = all.map((b) => b.c as number)
    const bands: StockPage['bands'] = []
    const offset = all.length - series.length
    for (let i = 0; i < series.length; i++) {
      const end = offset + i
      if (end < 19) continue
      const w = closes.slice(end - 19, end + 1)
      const mid = w.reduce((a, b) => a + b, 0) / 20
      const sd = Math.sqrt(w.reduce((a, b) => a + (b - mid) ** 2, 0) / 20)
      bands.push({ d: series[i]!.d as string, mid, up: mid + 2 * sd, lo: mid - 2 * sd })
    }

    return {
      symbol: {
        id: sym.id as string, market: sym.market as 'TW' | 'US', code: sym.code as string,
        name: (sym.name_zh as string) ?? (sym.name_en as string) ?? null,
        currency: sym.currency as string,
      },
      analysis: analysis ?? null,
      valuation: val ? {
        pe: val.pe === null ? null : Number(val.pe),
        forwardPe: val.forward_pe === null ? null : Number(val.forward_pe),
        pb: val.pb === null ? null : Number(val.pb),
        dividendYield: val.dividend_yield === null ? null : Number(val.dividend_yield),
        d: val.d as string,
      } : null,
      bars: series.map((b) => ({
        d: b.d as string, o: b.o as number, h: b.h as number,
        l: b.l as number, c: b.c as number,
      })),
      bands,
      kd: [],
      levelHistory: (hist ?? []).map((h) => {
        const lv = h.levels as {
          sell?: { lo: number } | null; stop?: { price: number } | null
          add?: { lo: number; hi: number } | null
        }
        return {
          d: h.d as string,
          sellLo: lv?.sell?.lo ?? null,
          stop: lv?.stop?.price ?? null,
          addLo: lv?.add?.lo ?? null,
          addHi: lv?.add?.hi ?? null,
          origin: (h.origin as string) ?? 'live',
        }
      }),
      lastJobOk: Boolean(jobs?.[0]?.ok),
    }
  },
  ['stock-page'],
  { tags: [TAGS.analysis], revalidate: 3600 },
)

/** 寫完資料一定要呼叫，否則整天看到舊的 */
export function invalidateAnalysis(): void {
  revalidateTag(TAGS.analysis)
}

/**
 * 模擬帳戶（PLAN §13.7）。走使用者身分——帳戶是 per-user 的，
 * 所以**不能**放進 `getStockPage` 那個全站共用的快取裡。
 */
export interface SimTrack {
  track: 'rule' | 'ai' | 'hold'
  initialTwd: number
  initialCash: number
  currency: string
  retPct: number
  equity: number
  cash: number
  shares: number
  daysInMarket: number
  totalDays: number
  totalFees: number
  trades: number
  curve: { d: string; retPct: number }[]
  recent: {
    signalD: string; fillD: string; side: 'buy' | 'sell'
    qty: number; price: number; fee: number; tax: number
    triggers: string[]; reason: string | null
  }[]
  marks: { d: string; side: 'buy' | 'sell'; price: number; stop: boolean }[]
  /** 明天開盤要做的事。這是整張卡最重要的一行——一句可以照做的指令 */
  pending: {
    signalD: string; buy: boolean; sell: boolean
    triggers: string[]; reason: string | null
    /** 用今日收盤估的明日成交量。不動作時是 null */
    estimate: { side: 'buy' | 'sell'; refPrice: number; qty: number; amount: number } | null
  } | null
}

export async function getSim(symbolId: string): Promise<SimTrack[]> {
  const supabase = await createClient()
  const { data: accounts } = await supabase
    .from('sim_accounts')
    .select('id, track, initial_twd, initial_cash, currency, pending')
    .eq('symbol_id', symbolId)
  if (!accounts || accounts.length === 0) return []

  const out: SimTrack[] = []
  for (const acc of accounts) {
    const id = acc.id as string
    const { data: eq } = await supabase
      .from('sim_equity').select('d, cash, shares, equity, ret_pct')
      .eq('account_id', id).order('d', { ascending: true })
    const { data: tr } = await supabase
      .from('sim_trades')
      .select('signal_d, fill_d, side, qty, price, fee, tax, triggers, reason')
      .eq('account_id', id).order('signal_d', { ascending: true })

    const curve = (eq ?? []).map((e) => ({ d: e.d as string, retPct: Number(e.ret_pct) }))
    const last = (eq ?? [])[eq!.length - 1]
    const trades = tr ?? []

    out.push({
      track: acc.track as SimTrack['track'],
      initialTwd: Number(acc.initial_twd),
      initialCash: Number(acc.initial_cash),
      currency: acc.currency as string,
      retPct: last ? Number(last.ret_pct) : 0,
      equity: last ? Number(last.equity) : Number(acc.initial_cash),
      cash: last ? Number(last.cash) : Number(acc.initial_cash),
      shares: last ? Number(last.shares) : 0,
      daysInMarket: (eq ?? []).filter((e) => Number(e.shares) > 0).length,
      totalDays: (eq ?? []).length,
      totalFees: trades.reduce((s, t) => s + Number(t.fee) + Number(t.tax), 0),
      trades: trades.length,
      curve,
      recent: trades.slice(-3).reverse().map((t) => ({
        signalD: t.signal_d as string, fillD: t.fill_d as string,
        side: t.side as 'buy' | 'sell',
        qty: Number(t.qty), price: Number(t.price),
        fee: Number(t.fee), tax: Number(t.tax),
        triggers: (t.triggers as string[]) ?? [],
        reason: (t.reason as string) ?? null,
      })),
      marks: trades.map((t) => ({
        d: t.fill_d as string,
        side: t.side as 'buy' | 'sell',
        price: Number(t.price),
        stop: ((t.triggers as string[]) ?? []).includes('stop'),
      })),
      pending: (acc.pending as SimTrack['pending']) ?? null,
    })
  }
  return out
}
