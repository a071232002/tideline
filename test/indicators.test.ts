import { describe, it, expect } from 'vitest'
import fixture from './fixtures/0050.json'
import { sma, bollinger, kd, percentB, bandwidth } from '../src/lib/indicators'
import type { Bar } from '../src/lib/types'

const bars = fixture.bars as Bar[]
const exp = fixture.expected

/**
 * 這份測試的期望值全部來自 docs/reference 的 0050 範本，
 * 而範本的收盤價已逐日比對過 TWSE、0 筆不符（PLAN §2）。
 * 所以下面每一條失敗都代表「我們算錯了」，不是「範本不準」。
 *
 * 範本的指標是用「原始價」算的，所以測試一律走原始價欄位。
 */

/** 把 fixture 的 bars 對齊到範本那 122 天的視窗 */
function alignedIndex(): number[] {
  const byDate = new Map(bars.map((b, i) => [b.date, i]))
  return exp.dates.map((d) => {
    const i = byDate.get(d)
    if (i === undefined) throw new Error(`fixture 缺少 ${d} 這根 K 棒`)
    return i
  })
}

describe('fixture 本身', () => {
  it('範本的 122 天在 bars 裡都找得到，且收盤價一致', () => {
    const idx = alignedIndex()
    expect(idx).toHaveLength(122)
    idx.forEach((i, j) => {
      expect(bars[i]!.c, `${exp.dates[j]} 的收盤價`).toBeCloseTo(exp.close[j]!, 4)
    })
  })
})

describe('sma', () => {
  it('60MA 在 2026-08-19 等於範本的 104.16', () => {
    const closes = bars.map((b) => b.c)
    const idx = alignedIndex()
    const last = idx[idx.length - 1]!
    const v = sma(closes.slice(0, last + 1), 60)
    expect(v).not.toBeNull()
    expect(v!).toBeCloseTo(exp.on_2026_08_19.ma60, 2)
  })

  it('視窗不足時回 null，而不是用不完整的資料硬算', () => {
    expect(sma([1, 2, 3], 5)).toBeNull()
  })
})

describe('bollinger', () => {
  it('用母體標準差（÷N），逐點吻合範本的 103 個點', () => {
    const closes = bars.map((b) => b.c)
    const idx = alignedIndex()

    // 範本存的是四捨五入到小數 2 位的值，所以我們未取整的結果最多可以差半個
    // 末位單位（0.005）。用這個上界比 toBeCloseTo(x, 2) 精確——後者在剛好
    // 差 0.005 的邊界上（例如 2026-03-11 的中軌 76.145 vs 76.15）會誤判成失敗。
    const ROUNDING = 0.005 + 1e-9

    let checked = 0
    idx.forEach((i, j) => {
      const b = bollinger(closes.slice(0, i + 1), 20, 2)
      if (exp.bb_mid[j] === null || b === null) return
      expect(Math.abs(b.mid - exp.bb_mid[j]!), `${exp.dates[j]} 中軌`).toBeLessThanOrEqual(ROUNDING)
      expect(Math.abs(b.upper - exp.bb_up[j]!), `${exp.dates[j]} 上軌`).toBeLessThanOrEqual(ROUNDING)
      expect(Math.abs(b.lower - exp.bb_lo[j]!), `${exp.dates[j]} 下軌`).toBeLessThanOrEqual(ROUNDING)
      checked++
    })

    // 守住「測試真的有在測東西」：至少要驗到 100 個點
    expect(checked).toBeGreaterThanOrEqual(100)
  })

  it('用樣本標準差（÷N−1）會算出 109.91 / 94.94，那是錯的', () => {
    const closes = bars.map((b) => b.c)
    const idx = alignedIndex()
    const last = idx[idx.length - 1]!
    const b = bollinger(closes.slice(0, last + 1), 20, 2)!
    // 這一條的用途是「如果有人手滑改成 ÷(N−1)，上面那條會紅、這條會綠」
    expect(b.upper).toBeCloseTo(exp.on_2026_08_19.bb.up, 2)
    expect(b.upper).not.toBeCloseTo(109.91, 2)
    expect(b.lower).not.toBeCloseTo(94.94, 2)
  })
})

describe('kd (9,3,3)', () => {
  // KD 是遞迴的，初始 K = D = 50 的影響會隨每一步乘上 (1 − 1/3) 衰減。
  // fixture 從 2026-01-02 起算，到範本視窗起點 2026-02-23 已經過 21 步，
  // 殘留約 31 × (2/3)^21 ≈ 0.014（K）、D 再多落後一步所以略大。
  // 視窗起點那幾天因此會有 0.05 上下的殘差，這是暖機的正常行為，不是算錯。
  const WARMUP_SKIP = 5

  it('RSV 用盤中高低價，逐日吻合範本的 K 與 D（暖機後）', () => {
    const idx = alignedIndex()
    const series = kd(bars, 9, 3, 3)

    let checked = 0
    let worst = 0
    idx.forEach((i, j) => {
      if (j < WARMUP_SKIP) return
      const v = series[i]
      if (!v) return
      worst = Math.max(worst, Math.abs(v.k - exp.k[j]!), Math.abs(v.d - exp.d[j]!))
      expect(Math.abs(v.k - exp.k[j]!), `${exp.dates[j]} 的 K`).toBeLessThanOrEqual(0.05)
      expect(Math.abs(v.d - exp.d[j]!), `${exp.dates[j]} 的 D`).toBeLessThanOrEqual(0.05)
      checked++
    })
    expect(checked).toBeGreaterThanOrEqual(100)
    // 暖機過後應該貼得非常近；放寬到 0.05 只是防四捨五入，不是留給演算法誤差
    expect(worst).toBeLessThan(0.03)
  })

  it('暖機不足時會有殘差，而且會隨資料變長收斂', () => {
    // 挑一個前面有足夠歷史的日期，才餵得出長短不同的三段
    const target = '2026-06-01'
    const i0 = bars.findIndex((b) => b.date === target)
    const j0 = exp.dates.indexOf(target)
    expect(i0).toBeGreaterThan(60)
    expect(j0).toBeGreaterThan(0)

    const truth = exp.k[j0]! // 範本的值當真值
    const kAt = (fromBack: number) => {
      const s = kd(bars.slice(i0 - fromBack + 1, i0 + 1), 9, 3, 3)
      return s[s.length - 1]!.k
    }

    const errShort = Math.abs(kAt(12) - truth) // 剛好夠算 RSV，幾乎沒暖機
    const errMid = Math.abs(kAt(30) - truth)
    const errLong = Math.abs(kAt(i0 + 1) - truth) // 全部歷史

    // 暖機不足是「明顯錯」等級，不是小數點後幾位的問題
    expect(errShort).toBeGreaterThan(1)
    // 約 30 根之後就收斂到看不出來了
    expect(errMid).toBeLessThan(0.05)
    expect(errLong).toBeLessThan(0.05)

    // errMid 與 errLong 誰比較小沒有意義——兩者都已經低於範本本身的
    // 四捨五入粒度（0.005），再比下去是在比雜訊。這也是 PLAN §7 保留
    // 「半年 + 60 根暖機」的依據：KD 大約 30 根就夠，60 根很安全。
  })

  it('2026-08-19 是 K 57.0 / D 75.0', () => {
    const series = kd(bars, 9, 3, 3)
    const i = bars.findIndex((b) => b.date === '2026-08-19')
    expect(series[i]!.k).toBeCloseTo(exp.on_2026_08_19.k, 1)
    expect(series[i]!.d).toBeCloseTo(exp.on_2026_08_19.d, 1)
  })

  it('高低相同時 RSV 不會除以零', () => {
    const flat: Bar[] = Array.from({ length: 12 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      o: 10, h: 10, l: 10, c: 10, v: 0,
    }))
    const series = kd(flat, 9, 3, 3)
    for (const v of series) {
      if (v) {
        expect(Number.isFinite(v.k)).toBe(true)
        expect(Number.isFinite(v.d)).toBe(true)
      }
    }
  })
})

describe('percentB / bandwidth', () => {
  const { up, mid, lo } = exp.on_2026_08_19.bb
  const close = exp.on_2026_08_19.ohlc.c

  it('%b 在 2026-08-19 是 0.55', () => {
    expect(percentB(close, up, lo)).toBeCloseTo(0.546, 3)
  })

  it('帶寬在 2026-08-19 是 14.3%', () => {
    expect(bandwidth(up, lo, mid) * 100).toBeCloseTo(14.25, 1)
  })

  it('上下軌相同時不會回 Infinity', () => {
    expect(Number.isFinite(percentB(10, 10, 10))).toBe(true)
    expect(Number.isFinite(bandwidth(10, 10, 10))).toBe(true)
  })
})
