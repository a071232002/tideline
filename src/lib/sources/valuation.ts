/**
 * 估值：本益比、殖利率、股價淨值比。
 *
 * **這一層不參與 §4 的價位計算。** 估值回答「現在貴不貴」，技術價位回答
 * 「現在在哪裡」——兩套邏輯混進同一個數字，出錯時分不出是哪一邊錯。
 * 頁面上也分開呈現。
 *
 * 覆蓋範圍（2026-08-19 實測）：
 *   台股個股  TWSE BWIBBU，免 key            ✓ 2330 本益比 27.24
 *   台股 ETF  沒有本益比這個概念              ✗ 回 null，頁面說明原因
 *   美股      Yahoo quoteSummary，要 crumb   ✓ NVDA 本益比 33.55
 */

export interface Valuation {
  date: string | null
  /** 本益比（trailing）。虧損或無意義時為 null，不填 0 */
  pe: number | null
  /** 預估本益比，只有美股有 */
  forwardPe: number | null
  /** 股價淨值比 */
  pb: number | null
  /** 殖利率，單位是百分比（0.94 代表 0.94%） */
  dividendYield: number | null
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0 Safari/537.36'

/** TWSE 的 `-` 或 `0` 代表沒有意義，不要當成數值 */
function twNum(v: string | undefined, zeroIsNull = false): number | null {
  if (!v) return null
  const t = v.replace(/,/g, '').trim()
  if (t === '' || t === '-' || t === '--') return null
  const n = Number(t)
  if (!Number.isFinite(n)) return null
  if (zeroIsNull && n <= 0) return null
  return n
}

interface TwseBwibbu {
  total?: number
  stat: string
  fields?: string[]
  data?: string[][]
}

export function parseTwseValuation(json: TwseBwibbu): Valuation | null {
  if (json.stat !== 'OK' || !json.data || json.data.length === 0) return null
  const row = json.data[json.data.length - 1]!
  const [roc, dy, , pe, pb] = row
  if (!roc) return null

  const parts = roc.split('/')
  const date = parts.length === 3
    ? `${Number(parts[0]) + 1911}-${parts[1]!.padStart(2, '0')}-${parts[2]!.padStart(2, '0')}`
    : null

  return {
    date,
    // 本益比 0 代表虧損或無資料，那不是「本益比等於零」
    pe: twNum(pe, true),
    forwardPe: null,
    pb: twNum(pb, true),
    dividendYield: twNum(dy, true),
  }
}

interface YahooQs {
  quoteSummary?: { result?: {
    summaryDetail?: Record<string, { raw?: number } | undefined>
    defaultKeyStatistics?: Record<string, { raw?: number } | undefined>
  }[] }
  finance?: { error?: unknown }
}

function raw(x: { raw?: number } | undefined): number | null {
  return typeof x?.raw === 'number' && Number.isFinite(x.raw) && x.raw > 0 ? x.raw : null
}

export function parseYahooValuation(json: YahooQs): Valuation | null {
  if (json.finance?.error) return null
  const r = json.quoteSummary?.result?.[0]
  if (!r) return null

  const sd = r.summaryDetail ?? {}
  const ks = r.defaultKeyStatistics ?? {}
  const dy = raw(sd.dividendYield)

  return {
    date: null,
    pe: raw(sd.trailingPE),
    forwardPe: raw(sd.forwardPE),
    pb: raw(ks.priceToBook),
    // Yahoo 給的是小數（0.0046 = 0.46%），台股那邊給的已經是百分比，統一成百分比
    dividendYield: dy === null ? null : dy * 100,
  }
}

// ------------------------------------------------------------------ 抓取

export async function fetchTwseValuation(stockNo: string, yyyymm: string): Promise<Valuation | null> {
  const url = 'https://www.twse.com.tw/exchangeReport/BWIBBU'
    + `?response=json&date=${yyyymm}01&stockNo=${encodeURIComponent(stockNo)}`
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
  if (!res.ok) return null
  const text = (await res.text()).trim()
  if (!text.startsWith('{')) return null // 被限流時回的是 HTML
  return parseTwseValuation(JSON.parse(text) as TwseBwibbu)
}

/**
 * Yahoo 的 quoteSummary 現在擋沒有憑證的請求（回 `Invalid Crumb`）。
 * 要先跟 fc.yahoo.com 拿 cookie，再用那個 cookie 換一枚 crumb。
 */
async function yahooCrumb(): Promise<{ cookie: string; crumb: string } | null> {
  const seed = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': UA } })
  const cookie = (seed.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(';')[0])
    .join('; ')
  if (!cookie) return null

  const res = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, Cookie: cookie },
  })
  const crumb = (await res.text()).trim()
  if (!crumb || crumb.includes('<')) return null
  return { cookie, crumb }
}

export async function fetchYahooValuation(symbol: string): Promise<Valuation | null> {
  const auth = await yahooCrumb()
  if (!auth) return null

  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`
    + `?modules=summaryDetail%2CdefaultKeyStatistics&crumb=${encodeURIComponent(auth.crumb)}`
  const res = await fetch(url, { headers: { 'User-Agent': UA, Cookie: auth.cookie } })
  const json = (await res.json()) as YahooQs
  return parseYahooValuation(json)
}
