import type { Bar, BollingerBands, KdValue } from './types.js'

/**
 * 技術指標。全部是確定性計算，不經過語言模型（PLAN §5）。
 *
 * 期望值來自 docs/reference 的 0050 範本，已逐點驗證：
 * 布林 103 點、KD 121 點，見 test/indicators.test.ts。
 */

/** 簡單移動平均。視窗不足回 `null`，不要用不完整的資料硬算。 */
export function sma(values: readonly number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null
  let sum = 0
  for (let i = values.length - period; i < values.length; i++) sum += values[i]!
  return sum / period
}

/**
 * 布林通道。
 *
 * **標準差用母體（÷N），不是樣本（÷N−1）。**
 * 這是最容易寫錯又最不容易發現的地方：0050 在 2026-08-19，
 * 母體 σ 給上軌 109.72（正確），樣本 σ 給 109.91（錯）。
 */
export function bollinger(
  closes: readonly number[],
  period = 20,
  mult = 2,
): BollingerBands | null {
  const mid = sma(closes, period)
  if (mid === null) return null

  let sq = 0
  for (let i = closes.length - period; i < closes.length; i++) {
    const dev = closes[i]! - mid
    sq += dev * dev
  }
  const sigma = Math.sqrt(sq / period) // ← ÷N，母體

  return { upper: mid + mult * sigma, mid, lower: mid - mult * sigma }
}

/**
 * KD 隨機指標 (9,3,3)。
 *
 * **RSV 用的是盤中高低價**，不是收盤價的高低——這點寫錯的話
 * 數字會很接近但永遠對不上，很難查。
 *
 * ```
 * RSV = (C − L9) / (H9 − L9) × 100
 * K   = (1−α)·K(前) + α·RSV      α = 1/kSmooth，初始 K = D = 50
 * D   = (1−α)·D(前) + α·K
 * ```
 *
 * 回傳陣列與 `bars` 等長；前 `period−1` 根還沒暖機完，該位置是 `null`。
 */
export function kd(
  bars: readonly Bar[],
  period = 9,
  kSmooth = 3,
  dSmooth = 3,
): (KdValue | null)[] {
  const out: (KdValue | null)[] = new Array(bars.length).fill(null)
  const aK = 1 / kSmooth
  const aD = 1 / dSmooth

  let k = 50
  let d = 50

  for (let i = 0; i < bars.length; i++) {
    if (i < period - 1) continue

    let hi = -Infinity
    let lo = Infinity
    for (let j = i - period + 1; j <= i; j++) {
      const b = bars[j]!
      if (b.h > hi) hi = b.h
      if (b.l < lo) lo = b.l
    }

    // 高低相同（例如整段漲停鎖死）時分母為 0，用 50 代表「不偏多也不偏空」
    const rsv = hi === lo ? 50 : ((bars[i]!.c - lo) / (hi - lo)) * 100

    k = (1 - aK) * k + aK * rsv
    d = (1 - aD) * d + aD * k
    out[i] = { k, d }
  }

  return out
}

/** `%b = (close − lower) / (upper − lower)`。通道被壓成一條線時回 0.5。 */
export function percentB(close: number, upper: number, lower: number): number {
  const span = upper - lower
  if (span === 0) return 0.5
  return (close - lower) / span
}

/** `帶寬 = (upper − lower) / mid`，回傳小數（0.1425 = 14.25%）。 */
export function bandwidth(upper: number, lower: number, mid: number): number {
  if (mid === 0) return 0
  return (upper - lower) / mid
}
