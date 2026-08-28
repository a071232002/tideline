import { describe, it, expect } from 'vitest'
import { waitingState } from '../src/lib/sim/waiting'

/**
 * 一筆都沒成交的時候，「報酬率 0.00%」與「獲益 +0」是版面上最大的兩個
 * 數字，而它們兩個都是**定義上的 0**，不是量出來的 0。它們每天都一樣，
 * 而每天真正會變的是「離進場還差多少」——那句話在小字裡。
 *
 * 更糟的是 0.00% 蓋掉了一個真實的差別：
 *
 *   0050  跑了兩天、條件沒成立、刻意空手      → 0.00%
 *   NVDA  只有一個交易日、連對照組都還沒成交  → 0.00%
 *
 * 這兩個狀態要的下一步完全不同，畫面上卻長得一模一樣。
 */

const base = {
  totalDays: 2, trades: 0, daysInMarket: 0, holdTrades: 1,
  addHi: 104.5, close: 107.5,
}

describe('waitingState', () => {
  it('有成交過 → 照常顯示數字，這裡不插手', () => {
    expect(waitingState({ ...base, trades: 1 }).kind).toBe('trading')
  })

  it('持有過但現在空手也算有在跑', () => {
    expect(waitingState({ ...base, trades: 2, daysInMarket: 5 }).kind).toBe('trading')
  })

  it('**連買了不動都還沒成交 → 還沒開始，不是沒賺沒賠**', () => {
    // NVDA 08-27 起算、只有一個交易日，訊號要隔天開盤才成交，
    // 而那根 K 棒還沒到。這時候印 0.00% 是在報告一個沒發生的結果。
    expect(waitingState({ ...base, totalDays: 1, holdTrades: 0 }).kind).toBe('not-started')
  })

  it('一個交易日都還沒有 → 也是還沒開始', () => {
    expect(waitingState({ ...base, totalDays: 0, holdTrades: 0 }).kind).toBe('not-started')
  })

  it('跑著但一直空手 → 說還差多少', () => {
    const s = waitingState(base)
    expect(s.kind).toBe('flat')
    if (s.kind !== 'flat') throw new Error('型別')
    // 107.5 要跌到 104.5，差 2.79%
    expect(s.gapPct).toBeCloseTo(2.79, 2)
  })

  it('**已經在加碼區裡卻還沒進場 → 不要報一個負的差距**', () => {
    // 這時候擋住的不是價格，是 %b 或訊號還沒架起來。硬算會印出
    // 「還要跌 −1.5%」，那句話沒有意義而且看起來像算錯。
    const s = waitingState({ ...base, close: 103 })
    expect(s.kind).toBe('flat')
    if (s.kind !== 'flat') throw new Error('型別')
    expect(s.gapPct).toBeNull()
  })

  it('沒有加碼區（沒有分析資料）→ 差距是 null，不是 0', () => {
    const s = waitingState({ ...base, addHi: null })
    if (s.kind !== 'flat') throw new Error('型別')
    expect(s.gapPct).toBeNull()
  })

  it('沒有收盤價 → 差距是 null', () => {
    const s = waitingState({ ...base, close: null })
    if (s.kind !== 'flat') throw new Error('型別')
    expect(s.gapPct).toBeNull()
  })
})
