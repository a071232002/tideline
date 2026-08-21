import { describe, it, expect } from 'vitest'
import { ratesFromBars, rateOn, plausible, FX_RANGE } from '../src/lib/sources/fx'
import type { Bar } from '../src/lib/types'

/**
 * 匯率（PLAN §13.2）。
 *
 * 美股帳戶的本金是「5 萬台幣換算成美元」，合計淨值也要換回台幣，所以匯率
 * 是模擬帳戶的硬相依。它有兩個安靜的失敗模式，兩個都會無聲汙染所有美股帳戶：
 *
 * 一、**缺一天**。假日、抓取失敗都會缺。缺了不能當成 0，也不能跳過——
 *     要沿用最後一筆已知匯率，否則淨值曲線會出現一個假的斷點。
 * 二、**數字荒謬**。來源回一個 0、1 或 3200（單位搞錯）不會有錯誤訊息，
 *     但會讓美股帳戶的台幣淨值變成千分之一或一百倍。要用合理區間擋掉。
 */

const bar = (date: string, c: number): Bar => ({ date, o: c, h: c, l: c, c, v: 0 })

describe('ratesFromBars：K 棒轉成 日期→匯率', () => {
  it('取收盤價當匯率', () => {
    const r = ratesFromBars([bar('2026-08-18', 32.15), bar('2026-08-19', 32.28)])
    expect(r).toEqual({ '2026-08-18': 32.15, '2026-08-19': 32.28 })
  })

  it('荒謬的數字直接丟掉，不寫進序列', () => {
    const r = ratesFromBars([
      bar('2026-08-18', 32.15),
      bar('2026-08-19', 0),        // 來源掛掉時最常見的樣子
      bar('2026-08-20', 3215),     // 單位搞錯
    ])
    expect(Object.keys(r)).toEqual(['2026-08-18'])
  })
})

describe('plausible：合理區間', () => {
  it('正常匯率過關', () => {
    expect(plausible(32.15)).toBe(true)
    expect(plausible(FX_RANGE.min)).toBe(true)
    expect(plausible(FX_RANGE.max)).toBe(true)
  })

  it('0、負數、NaN、超出區間都擋掉', () => {
    for (const v of [0, -1, NaN, Infinity, FX_RANGE.min - 0.01, FX_RANGE.max + 0.01]) {
      expect(plausible(v)).toBe(false)
    }
  })
})

describe('rateOn：缺漏沿用最後一筆', () => {
  const rates = { '2026-08-18': 32.15, '2026-08-19': 32.28, '2026-08-22': 32.40 }

  it('當天有就用當天的', () => {
    expect(rateOn(rates, '2026-08-19')).toBe(32.28)
  })

  it('當天沒有 → 用「之前」最近的一筆，不是最近的任何一筆', () => {
    // 8/20、8/21 沒有資料，要沿用 8/19，**不能**用 8/22 的——那是偷看未來
    expect(rateOn(rates, '2026-08-20')).toBe(32.28)
    expect(rateOn(rates, '2026-08-21')).toBe(32.28)
  })

  it('比第一筆還早 → null，不要猜', () => {
    expect(rateOn(rates, '2026-08-01')).toBeNull()
  })

  it('空序列 → null', () => {
    expect(rateOn({}, '2026-08-19')).toBeNull()
  })
})
