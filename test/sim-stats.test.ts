import { describe, it, expect } from 'vitest'
import { trackStats, maxDrawdown } from '../src/lib/sim/stats'

/**
 * 回顧頁的統計（PLAN §11、§13.7）。
 *
 * 兩條規矩，都是為了不讓人誤讀自己的績效：
 *
 * 一、**超額報酬領銜**。報酬率自己答不了「準不準」——大盤漲 10% 而你賺 4%，
 *     那不是準，是拖後腿。
 * 二、**次數少的時候不寫百分比**。「12 次裡 7 次」比「勝率 58%」誠實，
 *     §11 明訂的規矩。所以這裡回傳的是 wins 與 closed 兩個整數，不是比率。
 */

const eq = (vals: number[]) =>
  vals.map((v, i) => ({
    d: `2026-06-${String(i + 1).padStart(2, '0')}`,
    cash: 0, shares: 1, mark: v, equity: v,
    retPct: ((v - vals[0]!) / vals[0]!) * 100,
  }))

describe('maxDrawdown：從高點回落最深多少', () => {
  it('一路上漲沒有回落', () => {
    expect(maxDrawdown([100, 110, 120])).toBe(0)
  })

  it('先漲後跌：從最高點算起', () => {
    // 100 → 150 → 90：從 150 回落到 90 是 −40%
    expect(maxDrawdown([100, 150, 90])).toBeCloseTo(40, 6)
  })

  it('兩次回落取比較深的那次', () => {
    // 100→120→108（−10%）→160→112（−30%）
    expect(maxDrawdown([100, 120, 108, 160, 112])).toBeCloseTo(30, 6)
  })

  it('回落之後再創新高，仍然記得那次回落', () => {
    expect(maxDrawdown([100, 60, 200])).toBeCloseTo(40, 6)
  })

  it('空陣列與單點不會炸', () => {
    expect(maxDrawdown([])).toBe(0)
    expect(maxDrawdown([100])).toBe(0)
  })

  it('報酬率一樣的兩條曲線，回落可以差很多——這就是要看它的理由', () => {
    const smooth = maxDrawdown([100, 105, 110, 115, 120])
    const bumpy = maxDrawdown([100, 160, 70, 90, 120])
    expect(smooth).toBe(0)
    expect(bumpy).toBeGreaterThan(50)
  })
})

describe('trackStats', () => {
  const trades = [
    { side: 'buy' as const, qty: 100, price: 100, fee: 20, tax: 0, costBasis: null, triggers: ['add'] },
    { side: 'sell' as const, qty: 50, price: 120, fee: 20, tax: 6, costBasis: 100.2, triggers: ['sell_zone'] },
    { side: 'sell' as const, qty: 50, price: 90, fee: 20, tax: 5, costBasis: 100.2, triggers: ['stop'] },
  ]
  const s = trackStats(eq([50000, 52000, 48000, 51000]), trades, 50000)

  it('報酬率取曲線最後一天', () => {
    expect(s.retPct).toBeCloseTo(2, 6)
  })

  it('勝率回傳「幾次裡幾次」，不是百分比（§11）', () => {
    expect(s.closed).toBe(2)     // 兩筆賣出
    expect(s.wins).toBe(1)       // 120 > 100.2 賺，90 < 100.2 賠
    expect(s).not.toHaveProperty('winRate')
  })

  it('沒有賣出過就不談勝率', () => {
    const only = trackStats(eq([50000, 51000]), [trades[0]!], 50000)
    expect(only.closed).toBe(0)
    expect(only.wins).toBe(0)
  })

  it('費用要含稅，並且算成佔本金的百分比', () => {
    expect(s.totalFees).toBeCloseTo(20 + 20 + 6 + 20 + 5, 6)
    expect(s.feesPct).toBeCloseTo((71 / 50000) * 100, 6)
  })

  it('被止損的次數單獨算——止跌規則已知有問題，這格是它的體檢表', () => {
    expect(s.stopped).toBe(1)
  })

  it('在市天數與總天數都要給，只給比例讀不出樣本大小', () => {
    expect(s.totalDays).toBe(4)
    expect(s.daysInMarket).toBe(4)
  })

  it('最大回落跟著曲線走', () => {
    expect(s.maxDrawdownPct).toBeCloseTo(((52000 - 48000) / 52000) * 100, 6)
  })

  it('空帳戶不會炸', () => {
    const z = trackStats([], [], 50000)
    expect(z.retPct).toBe(0)
    expect(z.closed).toBe(0)
    expect(z.maxDrawdownPct).toBe(0)
  })
})
