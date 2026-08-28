/**
 * 一筆都沒成交的帳戶，畫面上該說什麼。
 *
 * ## 為什麼需要這個
 *
 * 沒成交過的時候，「報酬率 0.00%」與「獲益 +0」是版面上最大的兩個數字，
 * 而它們都是**定義上的 0**，不是量出來的 0。它們每天都一樣，而每天真正
 * 會變的那句話（離進場還差多少）在小字裡。字級跟資訊量剛好顛倒。
 *
 * 更糟的是 0.00% 蓋掉了一個真實的差別。實測 2026-08-29 的正式站：
 *
 *     0050  跑了兩天、條件沒成立、刻意空手       → 0.00%
 *     NVDA  只有一個交易日、連對照組都還沒成交   → 0.00%
 *
 * 前者是「規則正在照規則做事」，後者是「還沒開始」。要的下一步完全不同，
 * 畫面上卻長得一模一樣。
 *
 * ## 為什麼差距可以是 null
 *
 * 進場要四件事同時成立（回過低檔、金叉架起訊號、價格回到加碼區、%b 夠低）。
 * 價格已經在加碼區裡卻還沒買，代表擋住的是別的條件——這時候硬算距離會印出
 * 「還要跌 −1.5%」，那句話沒有意義，而且看起來像算錯。寧可不講。
 */

export interface WaitingInput {
  totalDays: number
  trades: number
  daysInMarket: number
  /** 買了不動那條軌道的成交數。它是 0 就代表連對照組都還沒開始 */
  holdTrades: number
  /** 加碼區上緣。沒有分析資料時是 null */
  addHi: number | null
  /** 最新收盤 */
  close: number | null
}

export type Waiting =
  /** 有成交過，數字有意義，這裡不插手 */
  | { kind: 'trading' }
  /** 連買了不動都還沒成交——所有數字都還不是結果 */
  | { kind: 'not-started' }
  /** 跑著，但一直空手。`gapPct` 是「還要跌幾 % 才進加碼區」 */
  | { kind: 'flat'; gapPct: number | null }

export function waitingState(i: WaitingInput): Waiting {
  if (i.trades > 0 || i.daysInMarket > 0) return { kind: 'trading' }
  if (i.totalDays === 0 || i.holdTrades === 0) return { kind: 'not-started' }

  const { addHi, close } = i
  if (addHi === null || close === null || close <= addHi) {
    return { kind: 'flat', gapPct: null }
  }
  return { kind: 'flat', gapPct: ((close - addHi) / close) * 100 }
}
