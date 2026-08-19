import { unstable_cache, revalidateTag } from 'next/cache'
import { createClient } from './supabase/server'
import { createAdminClient } from './supabase/admin'
import { CHART_BARS } from './pipeline'

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
  bars: { d: string; o: number; h: number; l: number; c: number }[]
  bands: { d: string; mid: number; up: number; lo: number }[]
  kd: { d: string; k: number; d_val: number }[]
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
