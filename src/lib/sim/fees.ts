import type { Market } from '../levels'
import type { FeeParams } from './params'
import { DEFAULT_FEES } from './params'

/**
 * 交易成本（PLAN §13.2、§13.3）。
 *
 * 不算費用就等於宣告「進出是免費的」，而這套規則的進出並不少。
 * 但真正會歪掉結論的不是費率本身，是**台股的最低手續費**：
 * 低於 `MIN_FEE_THRESHOLD_TWD` 的每一筆，實際費率都不是 0.1425%，
 * 而是「最低費 ÷ 成交金額」。本金 1 萬分 3 批時那是 0.6%，
 * 是標準費率的四倍多——那不是在測規則，是在測手續費。
 *
 * 這就是 §13.2 把預設本金定在 5 萬的全部理由。
 */

/** 最低手續費不再綁住的成交金額：20 ÷ 0.1425% ≈ 14,035 元 */
export const MIN_FEE_THRESHOLD_TWD =
  DEFAULT_FEES.twMinFee / (DEFAULT_FEES.twFeeRate * DEFAULT_FEES.twFeeDiscount)

/** 台股可交易的最小單位：1 股（盤中零股）。美股允許小數股 */
const QTY_STEP: Record<Market, number> = { TW: 1, US: 0.0001 }

/**
 * 小於半個可交易單位的餘額是**灰塵，不是部位**。
 *
 * `roundQty` 的乘除在浮點數上不可逆，多買多賣幾次之後，「全數出清」會留下
 * 像 8.88e-16 這種殘值。它大於 0，於是所有 `shares > 0` 的判斷都會成立：
 * 止損條件天天觸發、產生假的「明日全部賣出」指令、在市天數灌水、
 * 清單顯示「持有中」——實測 NVDA 就是這樣（2026-08-22）。
 *
 * 沒有這道清理，錯誤不會有任何訊息，只會安靜地天天叫你賣一個空帳戶。
 */
export function isDust(market: Market, qty: number): boolean {
  return qty < QTY_STEP[market] / 2
}

export function buyFee(market: Market, gross: number, p: FeeParams): number {
  if (!(gross > 0)) return 0
  if (market === 'US') return Math.max(p.usMinFee, gross * p.usFeeRate)
  return Math.max(p.twMinFee, gross * p.twFeeRate * p.twFeeDiscount)
}

/** 賣出：手續費 ＋ 證交稅。ETF 0.1%、個股 0.3%，差三倍 */
export function sellCost(
  market: Market, gross: number, isEtf: boolean, p: FeeParams,
): { fee: number; tax: number } {
  if (!(gross > 0)) return { fee: 0, tax: 0 }
  if (market === 'US') return { fee: Math.max(p.usMinFee, gross * p.usFeeRate), tax: 0 }
  return {
    fee: Math.max(p.twMinFee, gross * p.twFeeRate * p.twFeeDiscount),
    tax: gross * (isEtf ? p.twTaxEtf : p.twTaxStock),
  }
}

/** 吸附到可交易單位，一律**無條件捨去**——寧可少買一股，不要多花不存在的錢 */
export function roundQty(market: Market, qty: number): number {
  if (!Number.isFinite(qty) || qty <= 0) return 0
  const step = QTY_STEP[market]
  // 先進位到 step 的整數倍再捨去，避開 0.1+0.2 那類浮點誤差把 5.5401 變成 5.5400
  return Math.floor(Number((qty / step).toFixed(6))) * step
}

/**
 * 這些現金買得起幾股——**含手續費**。
 *
 * 不含手續費的話，帳戶會在買進的瞬間出現負現金，而且金額小到不會有人發現。
 * 台股的最低手續費讓它沒有漂亮的解析解（費用在門檻兩側是不同的函數），
 * 所以先用費率估一次，再往下退到真的付得起為止。
 */
export function affordableQty(
  market: Market, cash: number, price: number, p: FeeParams,
): number {
  if (!(cash > 0) || !(price > 0)) return 0

  const rate = market === 'US' ? p.usFeeRate : p.twFeeRate * p.twFeeDiscount
  let qty = roundQty(market, cash / (price * (1 + rate)))

  const step = QTY_STEP[market]
  // 退的次數有上限：估算最多低估一兩個 step，這裡留足餘裕但不會無限迴圈
  for (let i = 0; i < 8 && qty > 0; i++) {
    const gross = qty * price
    if (gross + buyFee(market, gross, p) <= cash + 1e-9) return qty
    qty = roundQty(market, qty - step)
  }
  return qty > 0 ? qty : 0
}
