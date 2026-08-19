import type { Bar } from '../types.js'

/**
 * TWSE 個股日成交（上市）。**台股的主來源**。
 *
 * 不用 Yahoo 抓台股的理由見 PLAN §2：實測 0050.TW 六個月，Yahoo 同時出現
 * 幽靈 K 棒（2026-07-10 交易所休市卻有一根）與 null 破洞（2026-08-18）。
 * 一根假 K 棒會無聲地汙染 20 日布林、9 日 KD 與 60MA。
 *
 * 代價：一次只回一個月，所以補齊九個月要九次請求。
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
const BASE = 'https://www.twse.com.tw/exchangeReport/STOCK_DAY'

interface TwseResponse {
  stat: string
  title?: string
  data?: string[][]
  fields?: string[]
}

/** `115/08/19` → `2026-08-19`。TWSE 回的是民國年。 */
export function rocToIso(roc: string): string {
  const parts = roc.trim().split('/')
  if (parts.length !== 3) throw new Error(`看不懂的 TWSE 日期：${roc}`)
  const [y, m, d] = parts
  return `${Number(y) + 1911}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`
}

/** TWSE 的數字帶千分位逗號；停牌那天可能是 `--`。 */
function num(s: string | undefined): number | null {
  if (s === undefined) return null
  const t = s.replace(/,/g, '').trim()
  if (t === '' || t === '--' || t === 'X') return null
  const v = Number(t)
  return Number.isFinite(v) ? v : null
}

/** 抓某一個月的日線。`yyyymm` 例如 `202608`。 */
export async function fetchTwseMonth(stockNo: string, yyyymm: string): Promise<Bar[]> {
  const url = `${BASE}?response=json&date=${yyyymm}01&stockNo=${encodeURIComponent(stockNo)}`
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`TWSE ${stockNo} ${yyyymm} HTTP ${res.status}`)

  const json = (await res.json()) as TwseResponse
  if (json.stat !== 'OK') {
    // 未來的月份或不存在的代號會回這個，不是錯誤
    if (/沒有符合條件|查無資料/.test(json.stat ?? '')) return []
    throw new Error(`TWSE ${stockNo} ${yyyymm}: ${json.stat}`)
  }

  const rows = json.data ?? []
  const bars: Bar[] = []
  for (const r of rows) {
    const o = num(r[3]), h = num(r[4]), l = num(r[5]), c = num(r[6])
    // 停牌日四個價位可能全是 `--`，這種列直接跳過，不要寫成 0
    if (o === null || h === null || l === null || c === null) continue
    bars.push({ date: rocToIso(r[0]!), o, h, l, c, v: num(r[1]) ?? 0 })
  }
  return bars
}

/** 產生從今天往回數 `months` 個月的 `yyyymm` 陣列，由舊到新。 */
export function recentMonths(months: number, from = new Date()): string[] {
  const out: string[] = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - i, 1))
    out.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

/**
 * 抓最近 `months` 個月的日線，由舊到新，已去重排序。
 *
 * 每次請求之間留 `delayMs` 的間隔——TWSE 沒有公開速率限制，保守一點。
 */
export async function fetchTwseDailyBars(
  stockNo: string,
  months = 9,
  delayMs = 400,
): Promise<Bar[]> {
  const byDate = new Map<string, Bar>()
  for (const ym of recentMonths(months)) {
    const bars = await fetchTwseMonth(stockNo, ym)
    for (const b of bars) byDate.set(b.date, b)
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
}
