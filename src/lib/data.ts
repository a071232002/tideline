import { unstable_cache, revalidateTag } from 'next/cache'
import { createClient } from './supabase/server'
import { createAdminClient } from './supabase/admin'
import { CHART_BARS } from './pipeline'
import { marketFreshness, taipeiToday, type MarketFreshness } from './freshness'
import { fetchPaged } from './supabase/paged'
import { trackStats, type StatTrade, type TrackStats } from './sim/stats'
import type { EquityPoint } from './sim/engine'

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
    /** 已投入的成本（含買進手續費）。0 代表目前空手 */
    cost: number
    /** 從哪一天開始追蹤這一檔。帳戶就是從這天起算 */
    startedOn: string
    /** 帳戶已經跑了幾個交易日。太短的時候不要拿報酬率出來說嘴 */
    days: number
    /** AI 今天的決策。這是這個站的主角，不該只出現在第二層 */
    aiToday: { d: string; action: string; confidence: string | null; reason: string | null } | null
    /**
     * 哪一條軌道是主角。
     *
     * **AI 開始判斷之後就以 AI 為準**（PLAN §13.5：AI 帳戶是主角，規則是對照）。
     * 還沒開始的時候退回規則，並且畫面要標出來——同一個位置在不同標的上
     * 代表不同軌道，不講清楚就是誤導。
     */
    lead: 'ai' | 'rule'
    /** 規則軌道的報酬率。lead 是 AI 時，這個降級成小字參考 */
    ruleRetPct: number
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
    .select('id, symbol_id, track, initial_twd, initial_cash, currency, pending, started_on')
    .in('symbol_id', ids)

  const accIds = (accounts ?? []).map((a) => a.id as string)
  const lastEquity = new Map<string, {
    equity: number; shares: number; retPct: number; cost: number
  }>()
  const dayCount = new Map<string, number>()
  if (accIds.length > 0) {
    // 只要每個帳戶最新的那一列。**不能不分頁**——這張表的總列數會超過
    // PostgREST 的 1000 列預設上限，而截斷不會有任何錯誤訊息（見 fetchPaged）。
    // 這裡先按帳戶、再按日期倒序，所以每個帳戶的第一列就是最新的。
    const eq = await fetchPaged((from, to) => supabase
      .from('sim_equity').select('account_id, d, equity, shares, cost, ret_pct')
      .in('account_id', accIds)
      .order('account_id').order('d', { ascending: false }).range(from, to))
    for (const e of eq) {
      const id = e.account_id as string
      dayCount.set(id, (dayCount.get(id) ?? 0) + 1)
      if (lastEquity.has(id)) continue
      lastEquity.set(id, {
        equity: Number(e.equity), shares: Number(e.shares), retPct: Number(e.ret_pct),
        cost: Number(e.cost ?? 0),
      })
    }
  }

  // AI 今天決定了什麼。這是這個站的主角，不該只出現在個股頁。
  const aiIds = (accounts ?? []).filter((a) => a.track === 'ai').map((a) => a.id as string)
  const aiToday = new Map<string, NonNullable<WatchRow['sim']>['aiToday']>()
  if (aiIds.length > 0) {
    const logs = await fetchPaged((from, to) => supabase
      .from('sim_ai_log').select('account_id, d, status, action, confidence, reason')
      .in('account_id', aiIds).eq('status', 'ok')
      .order('account_id').order('d', { ascending: false }).range(from, to))
    for (const l of logs) {
      const id = l.account_id as string
      if (aiToday.has(id)) continue
      aiToday.set(id, {
        d: l.d as string, action: (l.action as string) ?? 'hold',
        confidence: (l.confidence as string) ?? null,
        reason: (l.reason as string) ?? null,
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
    const aiAcc = (accounts ?? []).find(
      (x) => x.symbol_id === symbolId && x.track === 'ai')
    const aiEq = aiAcc ? lastEquity.get(aiAcc.id as string) : undefined
    const ai = aiAcc ? (aiToday.get(aiAcc.id as string) ?? null) : null

    // AI 一旦開始判斷就由它當主角。還沒開始才退回規則。
    const lead = ai !== null && aiEq ? 'ai' as const : 'rule' as const
    const main = lead === 'ai' ? aiEq! : rule

    const cur = a.currency as string
    simBySymbol.set(symbolId, {
      cost: main.cost,
      startedOn: a.started_on as string,
      days: dayCount.get(a.id as string) ?? 0,
      aiToday: ai,
      lead,
      ruleRetPct: rule.retPct,
      retPct: main.retPct,
      excessPct: hold ? main.retPct - hold.retPct : 0,
      shares: main.shares,
      currency: cur,
      equityTwd: cur === 'TWD' ? main.equity : (fx !== null ? main.equity * fx : null),
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
  /** 當日有沒有成功跑過排程——用來分辨「休市」與「資料未更新」（PLAN §7） */
  lastJobOk: boolean
}

/**
 * 有人在追蹤的標的。給抓取後暖快取用——不是給頁面用的，所以走 service role，
 * 而且**不看是誰在追蹤**：`getStockPage` 的內容本來就全站共用。
 */
export async function getWatchedSymbols(): Promise<{ market: string; code: string }[]> {
  const db = createAdminClient()
  const { data: w } = await db.from('watchlist').select('symbol_id')
  const ids = [...new Set((w ?? []).map((r) => r.symbol_id as string))]
  if (ids.length === 0) return []
  const { data } = await db.from('symbols').select('market, code').in('id', ids)
  return (data ?? []).map((r) => ({ market: r.market as string, code: r.code as string }))
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
  /** 手上這些股票花了多少錢。報酬率答不了「投入多少」——0% 可能是空手 */
  cost: number
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
  /** 完整統計（最大回落、賣出賺錢幾次、被止損幾次）。回顧收進個股頁之後才需要 */
  stats: TrackStats
  /**
   * 收盤後已經決定、還沒成交的那一張單。這是整張卡最重要的一行。
   *
   * 名字叫 pending 是因為**成交**還沒發生，不是因為決定還沒做——
   * 決定在第 i 天收盤後就定案了（engine.ts 開頭）。
   */
  pending: {
    signalD: string; buy: boolean; sell: boolean
    triggers: string[]; reason: string | null
    /** 用今日收盤估的明日成交量。不動作時是 null */
    estimate: { side: 'buy' | 'sell'; refPrice: number; qty: number; amount: number } | null
  } | null
  /**
   * AI 這條軌道的判斷紀錄。**只有 ai 軌道有。**
   *
   * 為什麼需要它：原本畫面判斷「AI 上線了沒」是看 `trades > 0`，
   * 於是 AI 天天判斷、天天決定觀望的時候，整個個股頁完全不會提到 AI——
   * 而這個站的主角就是 AI 的判斷。**「不進場」是一個決定，不是沒有決定。**
   */
  /** 帳戶從哪天起算。曲線還是空的時候，只有它說得出「在等什麼」 */
  startedOn: string
  ai?: {
    /** 已經判斷過幾天 */
    days: number
    /** 最新一次的判斷 */
    today: { d: string; action: string; confidence: string | null; reason: string | null } | null
  }
}

export interface Recommendation {
  market: 'TW' | 'US'
  code: string
  name: string | null
  theme: string
  source: string
  rank: number
  /** 這一批是哪一天問出來的。不一定是今天——週末不會有新的 */
  d: string
  /**
   * **當天我們自己算出來的**指標。跟 `theme` 裡那些來自新聞的數字不同：
   * 這些走的是跟清單、個股頁完全一樣的計算，那些沒有。
   */
  facts: {
    close: number; k: number; pctB: number; ma60: number | null
    add: { lo: number; hi: number }; stop: number | null; asOf: string
  } | null
  /** 已經在追蹤了。追蹤中的仍然顯示，但不給「加入」按鈕 */
  tracked: boolean
}

/**
 * AI 從全球資訊挑出來的觀察標的（最新一批）。
 *
 * **跟這個站其他的數字是兩種不同的東西。** 清單與個股頁的每個價位都是
 * 我們自己從 K 棒算出來的；這一區是模型上網查到的題材，我們驗的是
 * 「代號真的存在」與「敘述帶著來源網址」，**沒有驗那些數字**。
 * 畫面上必須講清楚，否則兩種保證會被讀成同一種。
 *
 * 取最新的那一天，不是取今天：週末與假日不會有新的，而昨天的題材
 * 今天還是有參考價值。日期照樣顯示出來，讓人自己判斷新不新。
 */
export async function getRecommendations(): Promise<Recommendation[]> {
  const supabase = await createClient()

  const { data: latest } = await supabase
    .from('recommendations').select('d')
    .order('d', { ascending: false }).limit(1).maybeSingle()
  if (!latest) return []

  const { data: rows } = await supabase
    .from('recommendations')
    .select('market, code, name, theme, source, rank, d, facts')
    .eq('d', latest.d as string)
    .order('market').order('rank')
  if (!rows || rows.length === 0) return []

  // 已經在追蹤的不給「加入」按鈕。走使用者身分，所以是**這個人**的清單
  const { data: watched } = await supabase.from('watchlist').select('symbol_id')
  const ids = (watched ?? []).map((w) => w.symbol_id as string)
  const { data: syms } = ids.length > 0
    ? await supabase.from('symbols').select('market, code').in('id', ids)
    : { data: [] as { market: string; code: string }[] }
  const mine = new Set((syms ?? []).map((s) => `${s.market}:${s.code}`))

  return rows.map((r) => ({
    market: r.market as 'TW' | 'US',
    code: r.code as string,
    name: (r.name as string) ?? null,
    theme: r.theme as string,
    source: r.source as string,
    rank: Number(r.rank),
    d: r.d as string,
    facts: (r.facts as Recommendation['facts']) ?? null,
    tracked: mine.has(`${r.market}:${r.code}`),
  }))
}

export async function getSim(symbolId: string): Promise<SimTrack[]> {
  const supabase = await createClient()

  /**
   * **移出清單之後就不要再顯示這個帳戶。**
   *
   * 帳戶不會隨著移出清單被刪掉（那會連 sim_ai_log 一起帶走，而那是唯一
   * 不能重建的東西）。但 `rebuildAll` 只跑清單裡的標的——所以移出之後
   * 帳戶就凍在那一天，畫面卻照樣把它當成現況。
   *
   * 實測 2026-08-23：dev 的 2454 早就移出清單，個股頁仍然顯示一個
   * 停在 08-19 的帳戶，旁邊卻掛著 08-21 的 AI 判斷——同一塊區域兩個日期，
   * 而且那個報酬率是兩天前的。凍結的數字比沒有數字更糟。
   */
  // 這兩個問題彼此不相干：「還在清單裡嗎」與「有哪些帳戶」。把它們排成
  // 一列只是把兩份網路延遲加起來。沒在清單裡的時候會多問一次帳戶——
  // 那是一次很小的查詢，換掉每一次開啟個股頁都要付的一趟往返。
  const [{ data: watched }, { data: accounts }] = await Promise.all([
    supabase.from('watchlist').select('symbol_id').eq('symbol_id', symbolId).maybeSingle(),
    supabase.from('sim_accounts')
      .select('id, track, initial_twd, initial_cash, currency, pending, started_on')
      .eq('symbol_id', symbolId),
  ])
  if (!watched) return []
  if (!accounts || accounts.length === 0) return []

  /**
   * **三個帳戶平行查，不要排隊。**
   *
   * 這裡原本是一個 for 迴圈，每個帳戶依序做 2～3 次查詢——三條軌道就是
   * 8～10 次**循序**往返。本機的 Supabase 在 localhost 所以看不出來，
   * 部署之後每一次都是真的網路往返：實測正式站的個股頁 1,034～2,108ms，
   * 而 `getStockPage` 的部分已經被 cron 暖過快取了，剩下的就是這裡。
   *
   * 這三個帳戶之間沒有任何依賴——rule、ai、hold 各查各的。排隊唯一的
   * 效果就是把三份延遲加起來。
   *
   * 同一個帳戶裡的三個查詢（淨值、成交、AI 紀錄）也一樣互不相干，
   * 所以一起發。實測對正式站的 Supabase（2330，三個帳戶，五次取中位）：
   *
   *     全循序          1,008ms
   *     只平行化帳戶      579ms
   *     三層都平行        351ms
   *
   * 這裡的絕對值含了本機到 Supabase 的往返，Vercel 那端會小得多；
   * 會等比例縮小的是**趟數**，從十趟變成兩趟。
   */
  // 回傳型別要標出來：少了它，物件字面值的 `reason: string | null`
  // 推不回 SimTrack 的 `reason: string`，而錯誤訊息會指到很遠的地方
  const out: SimTrack[] = await Promise.all(accounts.map(async (acc): Promise<SimTrack> => {
    const id = acc.id as string
    // 每個帳戶每個交易日一列，由舊到新——超過 1000 列之後截斷丟掉的是最新的，
    // 也就是曲線末端會停住，而畫面看起來完全正常
    const [eq, { data: tr }, logs] = await Promise.all([
      // 每個帳戶每個交易日一列，由舊到新——超過 1000 列之後截斷丟掉的是最新的，
      // 也就是曲線末端會停住，而畫面看起來完全正常
      fetchPaged((from, to) => supabase
        .from('sim_equity').select('d, cash, shares, cost, mark, equity, ret_pct')
        .eq('account_id', id).order('d', { ascending: true }).range(from, to)),
      supabase
        .from('sim_trades')
        .select('signal_d, fill_d, side, qty, price, fee, tax, cost_basis, triggers, reason')
        .eq('account_id', id).order('signal_d', { ascending: true }),
      // AI 的判斷紀錄。只查 ai 那一條——另外兩條沒有這種東西
      acc.track === 'ai'
        ? supabase
          .from('sim_ai_log').select('d, action, confidence, reason')
          .eq('account_id', id).eq('status', 'ok').order('d', { ascending: false })
          .then((r) => r.data ?? [])
        : Promise.resolve(null),
    ])

    const curve = eq.map((e) => ({ d: e.d as string, retPct: Number(e.ret_pct) }))
    const last = eq[eq.length - 1]
    const trades = tr ?? []

    let aiLog: SimTrack['ai']
    if (logs) {
      const top = logs[0]
      aiLog = {
        days: logs.length,
        today: top ? {
          d: top.d as string, action: (top.action as string) ?? 'hold',
          confidence: (top.confidence as string) ?? null,
          reason: (top.reason as string) ?? null,
        } : null,
      }
    }

    return {
      track: acc.track as SimTrack['track'],
      initialTwd: Number(acc.initial_twd),
      initialCash: Number(acc.initial_cash),
      currency: acc.currency as string,
      retPct: last ? Number(last.ret_pct) : 0,
      equity: last ? Number(last.equity) : Number(acc.initial_cash),
      cash: last ? Number(last.cash) : Number(acc.initial_cash),
      shares: last ? Number(last.shares) : 0,
      cost: last ? Number(last.cost ?? 0) : 0,
      daysInMarket: eq.filter((e) => Number(e.shares) > 0).length,
      totalDays: eq.length,
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
      stats: trackStats(
        eq.map((e) => ({
          d: e.d as string, cash: Number(e.cash), shares: Number(e.shares),
          cost: Number(e.cost ?? 0), mark: Number(e.mark),
          equity: Number(e.equity), retPct: Number(e.ret_pct),
        })),
        trades.map((t) => ({
          side: t.side as 'buy' | 'sell', qty: Number(t.qty), price: Number(t.price),
          fee: Number(t.fee), tax: Number(t.tax),
          costBasis: t.cost_basis === null ? null : Number(t.cost_basis),
          triggers: (t.triggers as string[]) ?? [],
        })),
        Number(acc.initial_cash),
      ),
      marks: trades.map((t) => ({
        d: t.fill_d as string,
        side: t.side as 'buy' | 'sell',
        price: Number(t.price),
        stop: ((t.triggers as string[]) ?? []).includes('stop'),
      })),
      pending: (acc.pending as SimTrack['pending']) ?? null,
      startedOn: acc.started_on as string,
      ai: aiLog,
    }
  }))
  return out
}

/**
 * 回顧頁（PLAN §11、§13.7）。
 *
 * 個股頁回答「今天怎麼做」，這一頁回答「過去做得怎麼樣」——
 * 兩種心智狀態不要混在一起，所以是獨立的一頁而不是塞進個股頁。
 */
export interface ReviewTrack {
  track: 'rule' | 'ai' | 'hold'
  curve: { d: string; retPct: number }[]
  stats: TrackStats
  /** 這條軌道的成交點，要標在價格圖上——看得出「在哪裡買、在哪裡賣」 */
  marks: { d: string; side: 'buy' | 'sell'; price: number; stop: boolean }[]
}

export interface ReviewSymbol {
  symbolId: string
  market: 'TW' | 'US'
  code: string
  name: string | null
  currency: string
  initialTwd: number
  tracks: ReviewTrack[]
  /** 收盤價走勢。回顧要把買賣點標在**價格**上，不是標在報酬率上 */
  bars: { d: string; c: number }[]
  /** AI 那條有幾天沒跑到。一半以上 missing 的曲線不能拿來比較（§13.5） */
  aiMissing: number
  /**
   * AI 做過幾天決策（含 hold）。
   *
   * **「有決策但都是觀望」跟「根本還沒開始」是兩件事。** 只看成交筆數會把
   * 前者說成後者——模型每天認真判斷、每天決定不動，那是有內容的紀錄，
   * 不是空白。
   */
  aiDecisions: number
}

export async function getReview(): Promise<ReviewSymbol[]> {
  const supabase = await createClient()

  // **只看還在清單裡的標的。**
  //
  // 帳戶不會因為移出清單就刪掉（那會連 sim_ai_log 一起帶走，而那是唯一
  // 不能重建的紀錄）。但它也不該繼續出現在回顧頁：實測 dev 帳號有一個
  // 2454 的殘留帳戶，起算日還停在舊邏輯的 2026-04-09，圖畫出來橫跨四到七月，
  // 跟其他檔完全對不起來，看起來像資料壞掉。
  const { data: watched } = await supabase.from('watchlist').select('symbol_id')
  const watchedIds = new Set((watched ?? []).map((w) => w.symbol_id as string))
  if (watchedIds.size === 0) return []

  const { data: allAccounts } = await supabase
    .from('sim_accounts')
    .select('id, symbol_id, track, initial_twd, initial_cash, currency')
  const accounts = (allAccounts ?? []).filter((a) => watchedIds.has(a.symbol_id as string))
  if (accounts.length === 0) return []

  const symbolIds = [...new Set(accounts.map((a) => a.symbol_id as string))]
  const { data: symRows } = await supabase
    .from('symbols').select('id, market, code, name_zh, name_en').in('id', symbolIds)
  const symById = new Map((symRows ?? []).map((r) => [r.id as string, r]))

  const ids = accounts.map((a) => a.id as string)
  // 一定要分頁：這三張表的列數輕易超過 PostgREST 的 1000 列預設上限
  const eqRows = await fetchPaged((from, to) => supabase
    .from('sim_equity').select('account_id, d, cash, shares, cost, mark, equity, ret_pct')
    .in('account_id', ids).order('account_id').order('d', { ascending: true })
    .range(from, to))
  const trRows = await fetchPaged((from, to) => supabase
    .from('sim_trades')
    .select('account_id, fill_d, side, qty, price, fee, tax, cost_basis, triggers')
    .in('account_id', ids).order('account_id').order('signal_d').range(from, to))
  const logRows = await fetchPaged((from, to) => supabase
    .from('sim_ai_log').select('account_id, status').in('account_id', ids)
    .order('account_id').order('d').range(from, to))

  const eqBy = new Map<string, EquityPoint[]>()
  for (const e of eqRows) {
    const id = e.account_id as string
    const list = eqBy.get(id) ?? []
    list.push({
      d: e.d as string, cash: Number(e.cash), shares: Number(e.shares),
      cost: Number(e.cost ?? 0),
      mark: Number(e.mark), equity: Number(e.equity), retPct: Number(e.ret_pct),
    })
    eqBy.set(id, list)
  }

  const markBy = new Map<string, ReviewTrack['marks']>()
  const trBy = new Map<string, StatTrade[]>()
  for (const t of trRows) {
    const id = t.account_id as string
    const marks = markBy.get(id) ?? []
    marks.push({
      d: t.fill_d as string,
      side: t.side as 'buy' | 'sell',
      price: Number(t.price),
      stop: ((t.triggers as string[]) ?? []).includes('stop'),
    })
    markBy.set(id, marks)
    const list = trBy.get(id) ?? []
    list.push({
      side: t.side as 'buy' | 'sell', qty: Number(t.qty), price: Number(t.price),
      fee: Number(t.fee), tax: Number(t.tax),
      costBasis: t.cost_basis === null ? null : Number(t.cost_basis),
      triggers: (t.triggers as string[]) ?? [],
    })
    trBy.set(id, list)
  }

  const missingBy = new Map<string, number>()
  const decidedBy = new Map<string, number>()
  for (const l of logRows) {
    const id = l.account_id as string
    if (l.status === 'ok') decidedBy.set(id, (decidedBy.get(id) ?? 0) + 1)
    else missingBy.set(id, (missingBy.get(id) ?? 0) + 1)
  }

  // 收盤價走勢。買賣點要標在價格上——標在報酬率上看不出「買在哪個位置」
  const barRows = await fetchPaged((from, to) => supabase
    .from('daily_bars').select('symbol_id, d, c').in('symbol_id', symbolIds)
    .order('symbol_id').order('d', { ascending: true }).range(from, to))
  const barsBy = new Map<string, { d: string; c: number }[]>()
  for (const b of barRows) {
    const id = b.symbol_id as string
    const list = barsBy.get(id) ?? []
    list.push({ d: b.d as string, c: Number(b.c) })
    barsBy.set(id, list)
  }

  const bySymbol = new Map<string, ReviewSymbol>()
  for (const a of accounts) {
    const sid = a.symbol_id as string
    const s = symById.get(sid)
    if (!s) continue
    if (!bySymbol.has(sid)) {
      bySymbol.set(sid, {
        symbolId: sid, market: s.market as 'TW' | 'US', code: s.code as string,
        name: (s.name_zh as string) ?? (s.name_en as string) ?? null,
        currency: a.currency as string,
        initialTwd: Number(a.initial_twd),
        tracks: [], bars: [], aiMissing: 0, aiDecisions: 0,
      })
    }
    const row = bySymbol.get(sid)!
    const curve = eqBy.get(a.id as string) ?? []
    if (row.bars.length === 0 && curve.length > 0) {
      const from = curve[0]!.d
      row.bars = (barsBy.get(sid) ?? []).filter((b) => b.d >= from)
    }
    row.tracks.push({
      track: a.track as ReviewTrack['track'],
      curve: curve.map((e) => ({ d: e.d, retPct: e.retPct })),
      stats: trackStats(curve, trBy.get(a.id as string) ?? [], Number(a.initial_cash)),
      marks: markBy.get(a.id as string) ?? [],
    })
    if (a.track === 'ai') {
      row.aiMissing = missingBy.get(a.id as string) ?? 0
      row.aiDecisions = decidedBy.get(a.id as string) ?? 0
    }
  }

  return [...bySymbol.values()].sort((a, b) => a.code.localeCompare(b.code, 'en'))
}
