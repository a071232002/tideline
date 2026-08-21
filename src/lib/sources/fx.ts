import { fetchYahooDailyBars } from './yahoo'
import type { Bar } from '../types'

/**
 * 美元兌台幣匯率（PLAN §13.2）。
 *
 * 為什麼模擬帳戶需要它：美股帳戶的本金是「5 萬台幣換算成美元」，帳內用美元記帳，
 * 顯示合計時再換回台幣。少了匯率，台股與美股的報酬率沒辦法放在同一張表上比。
 *
 * 兩個安靜的失敗模式，都會無聲汙染所有美股帳戶的台幣淨值：
 *
 * 一、**缺一天**。假日、抓取失敗都會缺。缺了要沿用**之前**最後一筆已知匯率
 *     （`rateOn`），不能沿用之後的——那是偷看未來，會讓歷史淨值悄悄變好看。
 * 二、**數字荒謬**。來源回 0 或 3215（單位搞錯）不會有任何錯誤訊息，
 *     但會讓台幣淨值變成千分之一或一百倍。用合理區間擋在寫入之前。
 */

export const FX_PAIR = 'USDTWD'

/**
 * 合理區間。台幣兌美元近三十年沒有離開過 24–35，取 20–50 留足餘裕——
 * 這道關卡要擋的是「單位錯了」與「來源掛了」，不是預測匯率。
 */
export const FX_RANGE = { min: 20, max: 50 } as const

export type FxRates = Record<string, number>

export function plausible(rate: number): boolean {
  return Number.isFinite(rate) && rate >= FX_RANGE.min && rate <= FX_RANGE.max
}

/** 日線收盤價就是當日匯率。不合理的直接不收，寧可缺一天讓 `rateOn` 沿用。 */
export function ratesFromBars(bars: readonly Bar[]): FxRates {
  const out: FxRates = {}
  for (const b of bars) {
    if (plausible(b.c)) out[b.date] = b.c
  }
  return out
}

/**
 * 某一天的匯率。當天沒有就往**前**找最近的一筆。
 *
 * 「往前找」這三個字是這個函式的全部重點。往後找看起來只差一兩天，
 * 但那是用還沒發生的匯率去計算過去的淨值——跟 `backfill.ts` 的
 * 「不偷看未來」是同一條規矩，而且同樣不會有任何錯誤訊息。
 */
export function rateOn(rates: FxRates, date: string): number | null {
  const known = Object.keys(rates).filter((d) => d <= date)
  if (known.length === 0) return null
  known.sort()
  return rates[known[known.length - 1]!] ?? null
}

/** 抓 USD/TWD 日線。Yahoo 的 `TWD=X` 就是 1 美元兌多少台幣。 */
export async function fetchUsdTwd(range = '1y'): Promise<FxRates> {
  const r = await fetchYahooDailyBars('TWD=X', range)
  return ratesFromBars(r.bars)
}
