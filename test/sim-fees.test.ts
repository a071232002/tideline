import { describe, it, expect } from 'vitest'
import {
  buyFee, sellCost, roundQty, affordableQty, MIN_FEE_THRESHOLD_TWD,
} from '../src/lib/sim/fees'
import { DEFAULT_FEES } from '../src/lib/sim/params'

/**
 * 交易成本（PLAN §13.2、§13.3）。
 *
 * 不算費用就等於宣告「進出是免費的」，而這套規則的進出並不少。
 * 真正會歪掉結論的不是費率本身，是**台股的最低手續費 20 元**：
 * 低於 14,035 元的每一筆，實際費率都不是 0.1425%，而是「20 ÷ 成交金額」。
 * 本金 1 萬分 3 批時那是 0.6%，是標準費率的四倍多——那不是在測規則，是在測手續費。
 * 這整組測試存在的理由就是把這件事釘住。
 */

const F = DEFAULT_FEES

describe('buyFee：台股最低手續費', () => {
  it('金額夠大時就是費率', () => {
    expect(buyFee('TW', 100_000, F)).toBeCloseTo(142.5, 6)
  })

  it('金額太小時撞到 20 元的地板', () => {
    expect(buyFee('TW', 3_333, F)).toBe(20)
  })

  it('地板的臨界點是 20 ÷ 0.1425% ≈ 14,035 元', () => {
    expect(MIN_FEE_THRESHOLD_TWD).toBeCloseTo(20 / 0.001425, 6)
    expect(buyFee('TW', MIN_FEE_THRESHOLD_TWD - 1, F)).toBe(20)
    expect(buyFee('TW', MIN_FEE_THRESHOLD_TWD + 1, F)).toBeGreaterThan(20)
  })

  it('本金 1 萬分 3 批，實際費率是標準費率的四倍以上', () => {
    const perBatch = 10_000 / 3
    const rate = buyFee('TW', perBatch, F) / perBatch
    expect(rate).toBeGreaterThan(0.005)          // > 0.5%
    expect(rate / F.twFeeRate).toBeGreaterThan(4)
  })

  it('本金 5 萬分 3 批就不再撞地板（§13.2 的定案依據）', () => {
    const perBatch = 50_000 / 3
    expect(perBatch).toBeGreaterThan(MIN_FEE_THRESHOLD_TWD)
    expect(buyFee('TW', perBatch, F) / perBatch).toBeCloseTo(F.twFeeRate, 10)
  })

  it('美股零手續費，沒有地板', () => {
    expect(buyFee('US', 300, F)).toBe(0)
    expect(buyFee('US', 100_000, F)).toBe(0)
  })
})

describe('sellCost：手續費 ＋ 證交稅', () => {
  it('ETF 的稅是 0.1%，個股是 0.3%——差三倍', () => {
    const etf = sellCost('TW', 21_000, true, F)
    const stock = sellCost('TW', 21_000, false, F)
    expect(etf.tax).toBeCloseTo(21, 6)
    expect(stock.tax).toBeCloseTo(63, 6)
    expect(etf.fee).toBeCloseTo(stock.fee, 10)
  })

  it('賣出也有 20 元地板', () => {
    expect(sellCost('TW', 3_000, true, F).fee).toBe(20)
  })

  it('美股賣出不收費也不課證交稅', () => {
    const r = sellCost('US', 5_000, false, F)
    expect(r.fee).toBe(0)
    expect(r.tax).toBe(0)
  })

  it('一趟來回：5 萬本金的 ETF 約 0.39%，1 萬本金約 1.1%（§13.2 那張表）', () => {
    const roundTrip = (capital: number) => {
      const buy = capital / 3
      const sell = buy
      const b = buyFee('TW', buy, F)
      const s = sellCost('TW', sell, true, F)
      return (b + s.fee + s.tax) / buy
    }
    expect(roundTrip(50_000)).toBeLessThan(0.005)
    expect(roundTrip(10_000)).toBeGreaterThan(0.01)
    expect(roundTrip(10_000) / roundTrip(50_000)).toBeGreaterThan(2.5)
  })
})

describe('roundQty：可交易單位', () => {
  it('台股是整數股（零股，1 股起），無條件捨去', () => {
    expect(roundQty('TW', 33.7)).toBe(33)
    expect(roundQty('TW', 0.9)).toBe(0)
    expect(roundQty('TW', 96)).toBe(96)
  })

  it('美股允許小數股，取到 4 位、無條件捨去', () => {
    expect(roundQty('US', 1.234567)).toBeCloseTo(1.2345, 10)
    expect(roundQty('US', 5.54016)).toBeCloseTo(5.5401, 10)
  })

  it('負數與非有限值一律回 0，不要讓它流進帳戶', () => {
    for (const v of [-1, NaN, Infinity]) {
      expect(roundQty('TW', v)).toBe(0)
      expect(roundQty('US', v)).toBe(0)
    }
  })
})

describe('affordableQty：買到買得起為止，現金不為負', () => {
  it('台股：手續費也要付得起', () => {
    // 10,000 元、每股 103：96 股 → 9,888 + 20 = 9,908 ✓；97 股 → 9,991 + 20 = 10,011 ✗
    const q = affordableQty('TW', 10_000, 103, F)
    expect(q).toBe(96)
    expect(q * 103 + buyFee('TW', q * 103, F)).toBeLessThanOrEqual(10_000)
    expect((q + 1) * 103 + buyFee('TW', (q + 1) * 103, F)).toBeGreaterThan(10_000)
  })

  it('美股：小數股剛好用完現金', () => {
    const q = affordableQty('US', 1_000, 180.5, F)
    expect(q * 180.5).toBeLessThanOrEqual(1_000)
    expect((q + 0.0001) * 180.5).toBeGreaterThan(1_000)
  })

  it('現金不夠買一股就回 0，不會買到負現金', () => {
    expect(affordableQty('TW', 50, 2_350, F)).toBe(0)
    expect(affordableQty('TW', 0, 103, F)).toBe(0)
  })

  it('現金只夠股款、不夠手續費 → 少買一股', () => {
    // 剛好 103 元只夠一股股款，但還要 20 元手續費
    expect(affordableQty('TW', 103, 103, F)).toBe(0)
    expect(affordableQty('TW', 123, 103, F)).toBe(1)
  })

  it('價格為 0 或負數時回 0，不會除出無限大', () => {
    expect(affordableQty('TW', 10_000, 0, F)).toBe(0)
    expect(affordableQty('TW', 10_000, -5, F)).toBe(0)
  })
})
