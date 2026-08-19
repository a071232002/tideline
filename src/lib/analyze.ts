import type { Bar } from './types'
import { sma, bollinger, kd, percentB, bandwidth } from './indicators'
import { computeLevels, type Levels, type Market } from './levels'
import { buildVerdict, levelReasons, type Verdict } from './verdict'

/**
 * 把一串 K 棒變成「一天的分析」。這是 PLAN §5 第 1～3 層的組裝點，
 * 全部由程式算，AI 不碰任何數字。
 */

export interface Analysis {
  date: string
  close: number
  chg: number
  chgPct: number
  o: number
  h: number
  l: number

  k: number
  d: number
  bb: { upper: number; mid: number; lower: number }
  pctB: number
  bandwidth: number
  ma60: number | null

  levels: Levels
  verdict: Verdict
  levelWhy: Record<string, string>
}

/** 算指標至少要 60 根（季線）；不足就別硬算，讓上層說「資料不足」。 */
export const MIN_BARS = 60

export function analyze(bars: readonly Bar[], currency = 'TWD', market: Market = 'TW'): Analysis | null {
  if (bars.length < MIN_BARS) return null

  const last = bars[bars.length - 1]!
  const prev = bars[bars.length - 2]
  const closes = bars.map((b) => b.c)

  const bb = bollinger(closes, 20, 2)
  if (!bb) return null

  const kdSeries = kd(bars, 9, 3, 3)
  const cur = kdSeries[kdSeries.length - 1]
  if (!cur) return null
  const kdPrev = kdSeries[kdSeries.length - 2] ?? null

  const ma60 = sma(closes, 60)
  const pctB = percentB(last.c, bb.upper, bb.lower)

  // 前一天的 %b 要用前一天的通道算，不能拿今天的通道去套昨天的收盤
  const bbPrev = bollinger(closes.slice(0, -1), 20, 2)
  const pctBPrev = bbPrev && prev ? percentB(prev.c, bbPrev.upper, bbPrev.lower) : null

  const levels = computeLevels(bars, bb, ma60 ?? bb.mid, 3, market)

  const chg = prev ? last.c - prev.c : 0
  const chgPct = prev && prev.c !== 0 ? (chg / prev.c) * 100 : 0

  const verdict = buildVerdict({
    close: last.c, ma60, k: cur.k, d: cur.d,
    kPrev: kdPrev?.k ?? null, dPrev: kdPrev?.d ?? null,
    pctB, pctBPrev, levels, currency,
  })

  return {
    date: last.date,
    close: last.c, chg, chgPct, o: last.o, h: last.h, l: last.l,
    k: cur.k, d: cur.d,
    bb: { upper: bb.upper, mid: bb.mid, lower: bb.lower },
    pctB, bandwidth: bandwidth(bb.upper, bb.lower, bb.mid), ma60,
    levels, verdict, levelWhy: levelReasons(levels),
  }
}
