import type { Bar } from './types'

/**
 * 還原價：把除權息與分割造成的「假跌」從價格序列裡拿掉（PLAN §13.3）。
 *
 * **這一段在寫模擬帳戶之前是壞的。** `pipeline.ts` 原本把 `*_adj` 寫成原始價的
 * 複本、`adj_factor` 恆為 1。對指標而言影響有限（除息當天看起來像小跌），
 * 對模擬帳戶而言是**系統性低估**：帳戶白白吃掉除息那段跌幅，卻收不到股利。
 * 0050 一年配息數次，半年下來足以讓「規則帳戶輸給買進持有」這個結論整個反過來。
 *
 * ## 方向：回溯改寫，不是往前推
 *
 * 除息日**之前**的價格全部乘上一個小於 1 的係數，讓那道跳空消失；
 * 除息日當天與之後不動。因此：
 *
 *   **最後一根的係數永遠是 1，最新的還原價永遠等於最新的原始價。**
 *
 * 這句話是判斷有沒有寫反的最快檢查，也是為什麼頁面顯示「今天的開高低收」時
 * 用哪一套都一樣——差別只在歷史那一段。
 *
 * ## 事件係數
 *
 * - 配息 A（除息日 D）：`1 − A / C`，其中 C 是 D **之前**最後一根的收盤價
 * - 分割 R（1 股變 R 股）：`1 / R`
 *
 * 跨過多個事件就累乘。成交量不動——我們沒有存還原量，指標也沒有用到量。
 */

export interface AdjustedBar extends Bar {
  o_adj: number
  h_adj: number
  l_adj: number
  c_adj: number
  /** 這一根的原始價要乘上多少才是還原價。恆 > 0，最後一根恆為 1 */
  adj_factor: number
}

/** `{ '2026-07-21': 0.6 }` — 除息日 → 每股配息 */
export type Dividends = Record<string, number>
/** `{ '2026-06-10': 10 }` — 分割日 → 1 股變幾股 */
export type Splits = Record<string, number>

/**
 * 每一根的累積還原係數。
 *
 * 由新到舊走一次：碰到事件日就把係數乘進去，套用在**比它更早**的每一根上。
 */
export function adjFactors(
  bars: readonly Bar[],
  dividends: Dividends,
  splits: Splits,
): number[] {
  const out = new Array<number>(bars.length).fill(1)
  if (bars.length === 0) return out

  let cum = 1
  for (let i = bars.length - 1; i >= 0; i--) {
    out[i] = cum

    // 這一根**本身**是事件日的話，係數要套在它之前的那些根上，
    // 所以先記錄再累乘——順序寫反的話會把事件日自己也打折。
    const date = bars[i]!.date

    const r = splits[date]
    if (r !== undefined && r > 0) cum /= r

    const a = dividends[date]
    if (a !== undefined && a > 0) {
      const prevClose = bars[i - 1]?.c
      // 沒有前一根就沒有基準，跳過。硬算會需要用事件日自己的收盤，
      // 那個價格已經扣過息了，算出來的係數是錯的。
      if (prevClose !== undefined && prevClose > 0) {
        // 配息大於前一日收盤是不可能的，但來源給錯時不能算出 0 或負的係數——
        // 那會讓所有歷史價格變成 0 或負數，而且指標照算不誤。
        const f = 1 - a / prevClose
        if (f > 0) cum *= f
      }
    }
  }

  return out
}

/** 原始價一個字都不動，另外掛上四個還原欄位。 */
export function adjustBars(
  bars: readonly Bar[],
  dividends: Dividends,
  splits: Splits,
): AdjustedBar[] {
  const factors = adjFactors(bars, dividends, splits)
  return bars.map((b, i) => {
    const f = factors[i]!
    return {
      ...b,
      o_adj: b.o * f,
      h_adj: b.h * f,
      l_adj: b.l * f,
      c_adj: b.c * f,
      adj_factor: f,
    }
  })
}
