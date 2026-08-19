import type { Bar } from '../types.js'

/**
 * Yahoo Finance chart API。**美股的主來源**；台股只當備援與除權息事件來源。
 *
 * 非官方端點，是美股這一側最大的單點風險（PLAN §9）。所以：
 * - 抓不到就讓上層顯示「資料未更新」，絕不寫空資料或猜出來的數字
 * - null 的 K 棒直接丟掉，不要用前一天補（Yahoo 自己就是這樣造出幽靈 K 棒的）
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart'

export interface YahooResult {
  symbol: string
  name: string | null
  currency: string
  exchange: string
  bars: Bar[]
  /** 除權息事件，`{ '2026-07-21': 0.6 }`。用來判斷還原價要不要回溯改寫。 */
  dividends: Record<string, number>
  /** 分割事件，`{ '2026-06-10': 4 }` 代表 1 拆 4。 */
  splits: Record<string, number>
}

interface ChartJson {
  chart: {
    error: { code: string; description: string } | null
    result?: [{
      meta: { currency?: string; exchangeName?: string; longName?: string; shortName?: string }
      timestamp?: number[]
      events?: {
        dividends?: Record<string, { amount: number; date: number }>
        splits?: Record<string, { numerator: number; denominator: number; date: number }>
      }
      indicators: {
        quote: [{ open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]
                  close?: (number | null)[]; volume?: (number | null)[] }]
        adjclose?: [{ adjclose?: (number | null)[] }]
      }
    }]
  }
}

function isoDay(epochSec: number): string {
  return new Date(epochSec * 1000).toISOString().slice(0, 10)
}

/** 抓日線。`range` 用 Yahoo 的寫法：`6mo` / `1y` / `2y`。 */
export async function fetchYahooDailyBars(symbol: string, range = '1y'): Promise<YahooResult> {
  const url = `${BASE}/${encodeURIComponent(symbol)}`
    + `?range=${range}&interval=1d&events=div%2Csplit`
  const res = await fetch(url, { headers: { 'User-Agent': UA } })

  // 404 帶著 JSON 錯誤訊息，要讀出來才知道是「查無此標的」還是別的問題
  const json = (await res.json()) as ChartJson
  const err = json.chart?.error
  if (err) throw new Error(`Yahoo ${symbol}: ${err.code} — ${err.description}`)

  const r = json.chart?.result?.[0]
  if (!r || !r.timestamp) throw new Error(`Yahoo ${symbol}: 回應沒有資料`)

  const q = r.indicators.quote[0]
  const bars: Bar[] = []
  for (let i = 0; i < r.timestamp.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i]
    // Yahoo 會出現整根都是 null 的洞（實測 0050.TW 的 2026-08-18）。
    // 丟掉比補值安全——補出來的假 K 棒會無聲汙染所有指標。
    if (o == null || h == null || l == null || c == null) continue
    bars.push({ date: isoDay(r.timestamp[i]!), o, h, l, c, v: q.volume?.[i] ?? 0 })
  }

  const dividends: Record<string, number> = {}
  for (const d of Object.values(r.events?.dividends ?? {})) {
    dividends[isoDay(d.date)] = d.amount
  }
  const splits: Record<string, number> = {}
  for (const s of Object.values(r.events?.splits ?? {})) {
    splits[isoDay(s.date)] = s.numerator / s.denominator
  }

  return {
    symbol,
    name: r.meta.longName ?? r.meta.shortName ?? null,
    currency: r.meta.currency ?? 'USD',
    exchange: r.meta.exchangeName ?? '',
    bars: bars.sort((a, b) => (a.date < b.date ? -1 : 1)),
    dividends,
    splits,
  }
}

/** 代號驗證：加入觀察清單時當場打一次，回不到資料就擋下（PLAN §9）。 */
export async function validateSymbol(symbol: string): Promise<
  { ok: true; name: string | null; currency: string; exchange: string } | { ok: false; reason: string }
> {
  try {
    const r = await fetchYahooDailyBars(symbol, '1mo')
    if (r.bars.length === 0) return { ok: false, reason: '查得到代號但沒有任何日線資料' }
    return { ok: true, name: r.name, currency: r.currency, exchange: r.exchange }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}
