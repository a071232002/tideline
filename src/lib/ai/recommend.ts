/**
 * 「今天全世界有什麼值得看一眼」——發現層。
 *
 * ## 跟每日買賣決策是兩件事
 *
 * `decide.ts` 那條線刻意**不給新聞**：模擬帳戶要可重播，餵它事後資訊會讓
 * 那條曲線變得漂亮又沒有意義（§13.1 四）。它的保證是「理由裡的每個數字都
 * 存在於我們算出來的事實集合裡」。
 *
 * 這條線相反：它的用途就是**跳出使用者自己的清單**，所以非得靠網路上的
 * 題材與新聞不可。代價是那些數字我們驗不了——「營收年增 85%」不在我們的
 * 資料庫裡，驗證器對它無能為力。
 *
 * 所以換一種保證：**每一條敘述都必須帶著它的來源網址**，而畫面上要說清楚
 * 這一區沒有經過這個站的價位分析。一個沒有出處的題材，跟憑空捏造分不出來。
 *
 * ## 為什麼還要驗代號
 *
 * 模型可能給出一個不存在的代號，或是上櫃股（這個站只支援上市）。那種列
 * 寫進資料庫之後，使用者按「加入追蹤」會失敗，而失敗的原因看起來像我們的
 * 抓取壞了。所以代號要先過一次來源驗證，過不了的整列丟掉。
 */

/**
 * 題材的長度上限。
 *
 * 原本是 120 字。在 375px 的螢幕上、12px 的字，一行大約 28 個中文字——
 * 120 字就是四行多，而版面只給兩行，於是每一條題材都在句子中間被切斷。
 * **一句被切斷的話比沒有那句話更糟**：讀者不知道後面還有什麼，
 * 也不知道那個逗號後面會不會是「但是」。
 *
 * 50 字剛好兩行，完整。要更詳細的就點出處——那是它存在的理由。
 */
export const MAX_THEME_CHARS = 50

export interface RawPick {
  code: string
  name: string | null
  theme: string
  source: string
}

export interface Picks {
  tw: RawPick[]
  us: RawPick[]
}

/**
 * 台股代號：4～6 碼數字，可帶一個字母尾碼。
 *
 * 不是「四碼」——個股是四碼（2330），但 ETF 有 0050（四碼）、006208（六碼）、
 * 00981A（五碼加尾碼）。寫成四碼的話 00981A 會被丟掉，而那是清單裡真的
 * 有的一檔（測試就是這樣抓到的）。
 *
 * 美股：1～5 個大寫字母。
 */
const TW_CODE = /^[0-9]{4,6}[A-Z]?$/
const US_CODE = /^[A-Z]{1,5}$/

function looksLikeUrl(s: string): boolean {
  return /^https?:\/\/[^\s]+\.[^\s]+/.test(s)
}

function cleanOne(raw: unknown, market: 'TW' | 'US'): RawPick | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>

  const code = typeof o.code === 'string' ? o.code.trim().toUpperCase() : ''
  if (!(market === 'TW' ? TW_CODE : US_CODE).test(code)) return null

  const theme = typeof o.theme === 'string' ? o.theme.trim() : ''
  if (theme.length === 0) return null

  // 沒有來源的題材不收。這一條不能放寬——它是這一層唯一的保證。
  const source = typeof o.source === 'string' ? o.source.trim() : ''
  if (!looksLikeUrl(source)) return null

  const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : null

  return { code, name, theme: theme.slice(0, MAX_THEME_CHARS), source }
}

/**
 * 從模型的回應裡取出候選。
 *
 * 容忍前後多餘的文字（模型偶爾會加一句「以下是結果：」），但**不容忍**
 * 缺來源、代號格式不對、或整串不是 JSON。寧可這一天沒有推薦，
 * 也不要一列看起來很正常但代號是編的。
 */
export function parsePicks(raw: string): { ok: true; picks: Picks } | { ok: false; reason: string } {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return { ok: false, reason: '回應裡找不到 JSON' }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch (e) {
    return { ok: false, reason: `JSON 解析失敗：${e instanceof Error ? e.message : String(e)}` }
  }
  if (typeof parsed !== 'object' || parsed === null) return { ok: false, reason: '不是物件' }

  const o = parsed as Record<string, unknown>
  const pick = (key: 'tw' | 'us', market: 'TW' | 'US'): RawPick[] => {
    const list = Array.isArray(o[key]) ? (o[key] as unknown[]) : []
    const out: RawPick[] = []
    const seen = new Set<string>()
    for (const item of list) {
      const c = cleanOne(item, market)
      if (!c || seen.has(c.code)) continue   // 同一天同一個代號只留第一次
      seen.add(c.code)
      out.push(c)
    }
    return out
  }

  const picks = { tw: pick('tw', 'TW'), us: pick('us', 'US') }
  if (picks.tw.length === 0 && picks.us.length === 0) {
    return { ok: false, reason: '兩個市場都沒有通過檢查的候選' }
  }
  return { ok: true, picks }
}

/**
 * 問模型的話。
 *
 * 三件事寫死在提示裡，因為它們都出過或會出問題：
 *
 * 1. **只限上市**——這個站不支援上櫃／興櫃，收進來只會在加入時失敗。
 * 2. **來源必須是真的查到的**——沒有這句，模型會憑記憶給一個看起來合理的
 *    網址。有這句加上後面的格式檢查，至少擋掉編造的那些。
 * 3. **不要投資建議**——這是發現層，它的工作是「這檔最近為什麼受關注」，
 *    不是「該不該買」。該不該買由使用者加入追蹤之後，用這個站自己算的
 *    價位來回答。
 */
export function buildRecommendPrompt(perMarket: number, exclude: string[]): string {
  const skip = exclude.length > 0
    ? `\n已經在追蹤的不要再推薦：${exclude.join('、')}。`
    : ''
  return `你是股票研究助理。請用網路搜尋找出「最近市場關注度高、值得納入觀察」的標的。

台股 ${perMarket} 檔、美股 ${perMarket} 檔。只限**台灣上市**（不含上櫃、興櫃）與**美國主要交易所掛牌**。${skip}

只輸出 JSON，不要任何其他文字：
{"tw":[{"code":"2330","name":"台積電","theme":"一句話題材","source":"網址"}],
 "us":[{"code":"NVDA","name":"NVIDIA","theme":"一句話題材","source":"網址"}]}

規則：
- code 必須是真實可交易代號，台股四碼數字、美股英文代號
- theme **一句話、${MAX_THEME_CHARS} 字以內**，講「為什麼最近受關注」，不要給投資建議
  （寫不下的細節不要硬塞，讀者要細節會點 source）
- source 必須是你這次真的查到的網址，不能憑記憶編造
- 查不到就給空陣列，不要用印象填`
}
