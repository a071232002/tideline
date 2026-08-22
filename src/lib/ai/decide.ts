/**
 * AI 決策的解析與驗證（PLAN §5、§13.5）。
 *
 * 這個檔案存在的唯一理由：**AI 只寫關於數字的文字，不寫數字本身。**
 *
 * 動作是固定選單，沒有價格欄也沒有股數欄——沒有欄位可以填數字，就沒有機會
 * 編數字。實際股數由引擎按成交價算，成交價由引擎取次日開盤。
 *
 * 但 `reason` 是自由文字，模型還是可能寫出「布林中軌 102.8」這種我們沒算過的
 * 價位，而使用者會照著它下單。所以每個出現在理由裡的數字都要能對回程式算出來的
 * 那組值，對不上就**整段退回**——不是把那個數字刪掉，是整個決策不採用。
 */

/**
 * 受限動作選單。百分比是**固定選項不是自由輸入**：
 * `buy_50` 代表「用掉一半現金」，實際金額與股數由引擎算。
 */
export const ACTIONS = [
  'hold',
  'buy_25', 'buy_50', 'buy_100',
  'sell_25', 'sell_50', 'sell_100',
] as const
export type AiAction = (typeof ACTIONS)[number]

export const CONFIDENCES = ['low', 'med', 'high'] as const
export type AiConfidence = (typeof CONFIDENCES)[number]

/** 理由是一句話。超過就是模型在寫作文，不是在做決策 */
const MAX_REASON_CHARS = 120

/**
 * 絕對不能出現的欄位。模型「順手」多回一個 price 或 qty 就是在產生數字，
 * 即使我們不讀它——留著它就是留著一個之後有人會去讀的洞。
 */
const FORBIDDEN_KEYS = ['price', 'qty', 'quantity', 'shares', 'amount', 'target', 'stop_price']

export interface AiDecision {
  action: AiAction
  confidence: AiConfidence
  agreeWithRule: boolean
  reason: string
}

/**
 * 把文字裡的數字抓出來。
 *
 * 日期要先拿掉——`2026-08-19` 拆成三個數字去驗，只會製造假警報。
 * 千分位逗號要還原，否則 `2,310.00` 會被讀成 2 和 310。
 */
export function extractNumbers(text: string): string[] {
  const withoutDates = text.replace(/\d{4}-\d{2}-\d{2}/g, ' ')
  const out: string[] = []
  // 千分位**只有三位一組才算**。用 [\d,]* 會把 `KD(9,3,3)` 併成 933，
  // 於是驗證器對著一個不存在的數字報警（屬性測試抓到的）。
  for (const m of withoutDates.matchAll(/-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?/g)) {
    out.push(m[0].replace(/,/g, ''))
  }
  return out
}

export interface NumberCheck {
  ok: boolean
  /** 對不上的數字，全部列出來——只回報第一個會讓人以為修掉它就沒事了 */
  unknown: string[]
}

/**
 * 每個數字都要對得回程式算出來的值。
 *
 * 比對用「四捨五入到它寫的位數」：模型把 58.1 寫成 58 是合理的口語表達，
 * 但 102.8 不能當成 102.42——那是另一個價位。
 */
export function checkNumbers(text: string, allowed: readonly number[]): NumberCheck {
  const unknown: string[] = []
  for (const raw of extractNumbers(text)) {
    const written = Number(raw)
    if (!Number.isFinite(written)) continue
    const dp = raw.includes('.') ? raw.split('.')[1]!.length : 0
    const hit = allowed.some((a) => Number(a.toFixed(dp)) === Number(written.toFixed(dp)))
    if (!hit) unknown.push(raw)
  }
  return { ok: unknown.length === 0, unknown }
}

export type ParseResult =
  | { ok: true; decision: AiDecision }
  | { ok: false; reason: string }

/** 模型很常把 JSON 包在 ```json 圍欄裡，或前後加一句客套話 */
function extractJson(raw: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw)
  const body = fenced ? fenced[1]! : raw
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  return body.slice(start, end + 1)
}

export function parseDecision(raw: string, allowed: readonly number[]): ParseResult {
  const json = extractJson(raw)
  if (!json) return { ok: false, reason: '回應裡找不到 JSON' }

  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(json) as Record<string, unknown>
  } catch {
    return { ok: false, reason: 'JSON 解析失敗' }
  }

  const extra = FORBIDDEN_KEYS.filter((k) => k in obj)
  if (extra.length > 0) {
    // 多回一個 price 就是在產生數字，即使我們不讀它
    return { ok: false, reason: `回應含有不允許的欄位：${extra.join('、')}` }
  }

  const action = obj.action
  if (typeof action !== 'string' || !ACTIONS.includes(action as AiAction)) {
    return { ok: false, reason: `action「${String(action)}」不在選單裡` }
  }

  const confidence = obj.confidence
  if (typeof confidence !== 'string' || !CONFIDENCES.includes(confidence as AiConfidence)) {
    return { ok: false, reason: `confidence「${String(confidence)}」不在選單裡` }
  }

  const reason = obj.reason
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    return { ok: false, reason: '沒有理由。沒有理由的決策等於沒有決策' }
  }
  if (reason.length > MAX_REASON_CHARS) {
    return { ok: false, reason: `理由 ${reason.length} 字，超過 ${MAX_REASON_CHARS} 字上限` }
  }

  const nums = checkNumbers(reason, allowed)
  if (!nums.ok) {
    return {
      ok: false,
      reason: `理由裡出現我們沒算過的數字：${nums.unknown.join('、')}`,
    }
  }

  return {
    ok: true,
    decision: {
      action: action as AiAction,
      confidence: confidence as AiConfidence,
      agreeWithRule: obj.agree_with_rule === true,
      reason: reason.trim(),
    },
  }
}
