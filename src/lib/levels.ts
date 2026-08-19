import type { Bar, BollingerBands } from './types.js'

/**
 * 關鍵價位（PLAN §4）。
 *
 * 賣出區與加碼區的規則已驗證可完全重現範本；止跌點是這一節唯一的設計題，
 * 見下方 `stopLevel` 的註解。
 */

export interface Pivot {
  index: number
  date: string
  price: number
}

export interface PriceZone {
  lo: number
  hi: number
}

export interface Levels {
  sell: (PriceZone & {
    kind: 'swing' | 'band'
    basis: { swingHigh: number | null; swingHighDate: string | null; upper: number }
  }) | null
  stop: { price: number; basis: { swingLow: number; swingLowDate: string; round: number } } | null
  add: PriceZone & { basis: { mid: number } }
  fair: PriceZone
}

export type Market = 'TW' | 'US'

/**
 * 報價單位。**必須隨股價縮放**——固定 0.5 元在 0050（約 100 元）剛好，
 * 在 2330（約 2350 元）就荒謬了：那裡的一檔是 5 元，報 2336.00 這種價位掛不出去。
 *
 * 台股直接用證交所的分級表；美股用「約當 0.25% 股價」再吸附到 1/2/5 階梯。
 */
export function tickFor(price: number, market: Market = 'TW'): number {
  if (market === 'TW') {
    // 證交所股票的升降單位
    if (price < 10) return 0.01
    if (price < 50) return 0.05
    if (price < 100) return 0.1
    if (price < 500) return 0.5
    if (price < 1000) return 1
    return 5
  }
  // 美股沒有分級表，用 1/2/5 階梯取「不小於 0.25% 股價」的那一階
  const ladder = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50]
  const want = price * 0.0025
  return ladder.find((t) => t >= want) ?? 100
}

/**
 * 四捨五入到最接近的 tick。
 *
 * 範本的四個數字（107.5 / 108.5 / 101.5 / 102.5）全部是這樣取出來的：
 * 107.500→107.5、108.575→108.5、101.396→101.5、102.523→102.5
 * （0050 約 100 元，台股分級表給 0.5）。
 *
 * 注意不能用「無條件捨去」——加碼區下緣 101.396 會被捨成 101.0，與範本差 0.5。
 */
export function roundToTick(v: number, tick: number): number {
  return Math.round(v / tick) * tick
}

/**
 * 整數關卡。granularity 也要隨股價縮放：0050 的關卡是 100，
 * 2330 的關卡不可能是 2311。
 *
 * 規則：從 1/5/10/25/50/100… 這串裡挑**最大**的一階，
 * 條件是進位之後離原本的低點不超過 0.5%——關卡要「整」，但不能整到脫離現實。
 *
 * 0050：低點 99.75 → 進位到 100（+0.25%）✓ 與範本一致
 * 2330：低點 2310 → 100 階會變 2400（+3.9%，太遠）→ 退到 10 階 = 2310
 */
export function roundLevelAbove(low: number, tick: number): number {
  const ladder = [1, 5, 10, 25, 50, 100, 250, 500, 1000]
  let best: number | null = null
  for (const g of ladder) {
    const v = Math.ceil(low / g) * g
    if (v - low <= low * 0.005) best = v
  }
  // 低價股連 1 元關卡都超過 0.5%（8.3 → 9 是 +8.4%），
  // 這時候「整數關卡」沒有意義，直接用波段低點本身進位到一檔。
  if (best === null) return Math.ceil(low / tick - 1e-9) * tick
  return best
}

/**
 * 分形高點：第 i 根的高價是 [i−k, i+k] 裡最高的。
 *
 * 需要右側 k 根確認，所以最新的 pivot 至少是 k 天前的。這是正確行為——
 * 波段高點本來就要等價格轉頭才算數。
 */
export function pivotHighs(bars: readonly Bar[], k = 3): Pivot[] {
  const out: Pivot[] = []
  for (let i = k; i < bars.length - k; i++) {
    const h = bars[i]!.h
    let isMax = true
    for (let j = i - k; j <= i + k; j++) {
      if (bars[j]!.h > h) { isMax = false; break }
    }
    if (isMax) out.push({ index: i, date: bars[i]!.date, price: h })
  }
  return out
}

/** 分形低點，與 `pivotHighs` 對稱。 */
export function pivotLows(bars: readonly Bar[], k = 3): Pivot[] {
  const out: Pivot[] = []
  for (let i = k; i < bars.length - k; i++) {
    const l = bars[i]!.l
    let isMin = true
    for (let j = i - k; j <= i + k; j++) {
      if (bars[j]!.l < l) { isMin = false; break }
    }
    if (isMin) out.push({ index: i, date: bars[i]!.date, price: l })
  }
  return out
}

/** 找壓力時只看最近這段，太老的高點已經不構成賣壓 */
export const RESISTANCE_LOOKBACK = 60

/**
 * 波段賣出區 = [壓力價, min(壓力價 × 1.01, 布林上軌)]，取一檔。
 *
 * 壓力價**必須在現價之上**——這是實測 NVDA 才發現的坑：原本取「最近一個
 * pivot high」，但價格一旦突破，那個高點就變成支撐而不是壓力，於是算出
 * 「反彈 214–217 減碼」而現價已經是 219.74，等於叫人立刻賣在低點。
 *
 * 所以取的是「**時間上最近、而且還在現價之上**」的那一道：從新往舊找，
 * 跳過已經被價格突破的高點（那些是支撐不是壓力），第一個仍在現價之上的就是它。
 * 若近期所有高點都已被突破（創新高），就沒有前波壓力可用，改用布林上軌。
 *
 * 0050 在 2026-08-19：107.50 ~ 108.5，與範本一字不差。
 */
export function sellZone(bars: readonly Bar[], bb: BollingerBands, k = 3, market: Market = 'TW') {
  const close = bars[bars.length - 1]?.c
  if (close === undefined) return null

  const from = Math.max(0, bars.length - RESISTANCE_LOOKBACK)
  // 由新往舊找第一個仍在現價之上的 pivot high
  const nearest = pivotHighs(bars, k)
    .filter((p) => p.index >= from)
    .reverse()
    .find((p) => p.price > close) ?? null

  const anchor = nearest ? nearest.price : bb.upper
  if (anchor <= close) return null // 連上軌都在現價之下：極端超買，不給賣出區

  // 區間上緣：有前波高時往上到上軌為止；沒有前波高（用上軌當錨）時，
  // 上軌本身是一條線不是一個區間，要自己給寬度，否則會塌成 196.00~196.00。
  const rawHi = nearest ? Math.min(anchor * 1.01, bb.upper) : anchor * 1.01

  const tick = tickFor(anchor, market)
  const lo = roundToTick(anchor, tick)
  const hi = roundToTick(Math.max(rawHi, anchor + tick), tick)
  return {
    lo,
    hi: Math.max(hi, lo),
    kind: nearest ? ('swing' as const) : ('band' as const),
    basis: {
      swingHigh: nearest ? nearest.price : null,
      swingHighDate: nearest ? nearest.date : null,
      upper: bb.upper,
    },
  }
}

/**
 * 加碼區 = 布林中軌的 [×0.99, ×1.001]，取 0.5 元位。
 *
 * 0050 在 2026-08-19：101.5 ~ 102.5，與範本一字不差。
 */
export function addZone(bb: BollingerBands, market: Market = 'TW') {
  const tick = tickFor(bb.mid, market)
  return {
    lo: roundToTick(bb.mid * 0.99, tick),
    hi: roundToTick(bb.mid * 1.001, tick),
    basis: { mid: bb.mid },
  }
}

/** 技術合理價區 = [布林中軌, 60MA] 排序後的區間。不取整，這是參考區間不是掛單價。 */
export function fairZone(mid: number, ma60: number): PriceZone {
  return { lo: Math.min(mid, ma60), hi: Math.max(mid, ma60) }
}

/**
 * 止跌點。**這是 §4 唯一沒有現成公式的一項。**
 *
 * 範本的 100.0 來自「8 月反彈段的回檔低點 99.75 取整數關卡」，理由寫的是
 * 「收盤跌破代表 8 月反彈結構破壞」——所以它先定義了「當前波段」，
 * 再在波段**內部**找低點，而不是在固定天數的視窗裡找。
 *
 * 用固定視窗都失敗過（PLAN §4 記錄了三種），失敗原因都一樣：
 * 抓到的是波段**起漲點**（7/29 的 91.80），那是已經走完的急跌，不是現在的支撐。
 *
 * 所以規則是：
 *   1. 找最近一個 pivot high → 這是當前這一波的頂
 *   2. 往回找它之前最近的 pivot low → 這是這一波的起漲點
 *   3. 在「起漲點之後」的範圍裡找最低的 pivot low（k=2，較敏感）
 *      —— 排除起漲點本身，因為那是波段的定義點不是波段內的回檔
 *   4. 無條件進位到整數關卡
 *
 * 0050 在 2026-08-19：起漲點 7/29(91.80) → 波段內最低回檔 8/4(99.75) → 100 ✓
 */
export function stopLevel(bars: readonly Bar[], k = 3, market: Market = 'TW') {
  const highs = pivotHighs(bars, k)
  const lastHigh = highs[highs.length - 1]
  if (!lastHigh) return null

  // 起漲點：最近 pivot high 之前最近的 pivot low
  const majorLows = pivotLows(bars, k)
  const legStart = [...majorLows].reverse().find((p) => p.index < lastHigh.index)
  if (!legStart) return null

  // 波段內的回檔低點，用較敏感的 k=2 才抓得到淺回檔。
  // 波段剛起步、還沒出現任何回檔時退回起漲點本身——這時候「跌破就結構破壞」
  // 的那個價位本來就是起漲點，不是沒有答案。
  const minorLows = pivotLows(bars, 2).filter((p) => p.index > legStart.index)
  const lowest = minorLows.length > 0
    ? minorLows.reduce((a, b) => (b.price < a.price ? b : a))
    : legStart
  const round = roundLevelAbove(lowest.price, tickFor(lowest.price, market))

  return {
    price: round,
    basis: { swingLow: lowest.price, swingLowDate: lowest.date, round },
  }
}

/** 一次算出四組價位。 */
export function computeLevels(
  bars: readonly Bar[],
  bb: BollingerBands,
  ma60: number,
  k = 3,
  market: Market = 'TW',
): Levels {
  return {
    sell: sellZone(bars, bb, k, market),
    stop: stopLevel(bars, k, market),
    add: addZone(bb, market),
    fair: fairZone(bb.mid, ma60),
  }
}
