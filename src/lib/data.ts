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
export async function getWatchlist(): Promise<WatchRow[]> {
  const supabase = await createClient()
  const { data: rows, error } = await supabase
    .from('watchlist')
    .select('symbol_id, sort_order, symbols(market, code, name_zh, name_en, currency)')
    .order('sort_order')
  if (error || !rows) return []

  const ids = rows.map((r) => r.symbol_id as string)
  if (ids.length === 0) return []

  const { data: latest } = await supabase
    .from('daily_analysis')
    .select('symbol_id, d, close, chg_pct, k, d_val, verdict, levels')
    .in('symbol_id', ids)
    .order('d', { ascending: false })

  const newest = new Map<string, Record<string, unknown>>()
  for (const a of latest ?? []) {
    const id = a.symbol_id as string
    if (!newest.has(id)) newest.set(id, a)
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

    const { data: analysis } = await db
      .from('daily_analysis').select('*')
      .eq('symbol_id', sym.id).order('d', { ascending: false }).limit(1).maybeSingle()

    const { data: bars } = await db
      .from('daily_bars').select('d, o, h, l, c')
      .eq('symbol_id', sym.id).order('d', { ascending: true })

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
