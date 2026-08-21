import { describe, it, expect } from 'vitest'
import { adjustBars, adjFactors } from '../src/lib/adjust'
import type { Bar } from '../src/lib/types'

/**
 * 還原價（PLAN §13.3）。
 *
 * 這一段在寫模擬帳戶之前是**壞的**：`pipeline.ts` 把 `*_adj` 直接寫成原始價的
 * 複本、`adj_factor` 恆為 1。對指標來說只是除息當天看起來像小跌，
 * 對模擬帳戶來說是系統性低估——帳戶白白吃掉除息那段跌幅，卻收不到股利。
 * 0050 一年配息數次，半年下來足以讓「規則帳戶輸給買進持有」這個結論整個反過來。
 *
 * 還原的方式是**回溯改寫**：除息日**之前**的價格全部乘上一個小於 1 的係數，
 * 讓那道跳空消失。除息日當天與之後不動——所以「最新價 = 原始價」永遠成立，
 * 這是判斷有沒有寫反的最快檢查。
 */

const bar = (date: string, c: number, v = 1000): Bar =>
  ({ date, o: c, h: c, l: c, c, v })

/** 相鄰兩根的漲跌幅 */
const steps = (bars: readonly { c: number }[]): number[] =>
  bars.slice(1).map((b, i) => (b.c - bars[i]!.c) / bars[i]!.c)

describe('adjFactors：每一根的還原係數', () => {
  const bars = [bar('2026-07-17', 105), bar('2026-07-18', 105), bar('2026-07-21', 104.4)]

  it('沒有事件時全部是 1', () => {
    expect(adjFactors(bars, {}, {})).toEqual([1, 1, 1])
  })

  it('除息日之前打折、當天與之後不動', () => {
    const f = adjFactors(bars, { '2026-07-21': 0.6 }, {})
    // 除息日前一根收 105，配 0.6 → 係數 1 − 0.6/105
    expect(f[0]).toBeCloseTo(1 - 0.6 / 105, 10)
    expect(f[1]).toBeCloseTo(1 - 0.6 / 105, 10)
    expect(f[2]).toBe(1)
  })

  it('最後一根的係數永遠是 1——最新價必須等於原始價', () => {
    const f = adjFactors(bars, { '2026-07-21': 0.6 }, { '2026-07-18': 4 })
    expect(f[f.length - 1]).toBe(1)
  })

  it('多個事件會累乘', () => {
    const many = [bar('2026-01-05', 100), bar('2026-03-05', 100), bar('2026-07-21', 100)]
    const f = adjFactors(many, { '2026-03-05': 1, '2026-07-21': 2 }, {})
    // 第一根跨過兩次除息：(1 − 1/100) × (1 − 2/100)
    expect(f[0]).toBeCloseTo(0.99 * 0.98, 10)
    expect(f[1]).toBeCloseTo(0.98, 10)
    expect(f[2]).toBe(1)
  })

  it('事件落在資料範圍之外就忽略，不會炸掉', () => {
    expect(adjFactors(bars, { '2020-01-01': 5 }, {})).toEqual([1, 1, 1])
  })
})

describe('adjustBars：除息那道跳空要消失', () => {
  /** 0050 的真實情境：2026-07-21 除息 0.6 元 */
  const bars = [
    bar('2026-07-16', 105.0),
    bar('2026-07-17', 105.0),
    bar('2026-07-18', 105.0),
    bar('2026-07-21', 104.4), // 除息，價格憑空掉 0.6
    bar('2026-07-22', 104.4),
  ]

  it('原始價序列上，除息日是一段真實存在的跌幅', () => {
    const s = steps(bars)
    expect(s[2]).toBeCloseTo(-0.6 / 105, 10)
  })

  it('還原價序列上，那一段跌幅消失（0050 2026-07-21 除息 0.6）', () => {
    const out = adjustBars(bars, { '2026-07-21': 0.6 }, {})
    const s = steps(out.map((b) => ({ c: b.c_adj })))
    expect(s[2]!).toBeCloseTo(0, 10)
  })

  it('原始價欄位一個字都不能動', () => {
    const out = adjustBars(bars, { '2026-07-21': 0.6 }, {})
    out.forEach((b, i) => {
      expect(b.o).toBe(bars[i]!.o)
      expect(b.h).toBe(bars[i]!.h)
      expect(b.l).toBe(bars[i]!.l)
      expect(b.c).toBe(bars[i]!.c)
    })
  })

  it('開高低收要用同一個係數，高低順序不能被破壞', () => {
    const raw: Bar[] = [
      { date: '2026-07-18', o: 104, h: 106, l: 103, c: 105, v: 1 },
      { date: '2026-07-21', o: 104.4, h: 105, l: 104, c: 104.4, v: 1 },
    ]
    const out = adjustBars(raw, { '2026-07-21': 0.6 }, {})
    const b = out[0]!
    expect(b.l_adj).toBeLessThanOrEqual(b.o_adj)
    expect(b.o_adj).toBeLessThanOrEqual(b.h_adj)
    expect(b.h_adj / b.h).toBeCloseTo(b.l_adj / b.l, 10)
  })
})

describe('adjustBars：分割', () => {
  /** NVDA 式的 10:1 分割：1000 → 100，不是真的跌了 90% */
  const bars = [
    bar('2026-06-08', 1000),
    bar('2026-06-09', 1000),
    bar('2026-06-10', 100), // 1 拆 10
    bar('2026-06-11', 100),
  ]

  it('原始價上這是一根 −90% 的假跌', () => {
    expect(steps(bars)[1]).toBeCloseTo(-0.9, 10)
  })

  it('還原價上分割那道斷層消失，不會憑空變十倍', () => {
    const out = adjustBars(bars, {}, { '2026-06-10': 10 })
    const s = steps(out.map((b) => ({ c: b.c_adj })))
    expect(s[1]!).toBeCloseTo(0, 10)
    expect(out[0]!.c_adj).toBeCloseTo(100, 10)
    expect(out[3]!.c_adj).toBe(100)
  })

  it('分割與除息同時存在時兩者都要算進去', () => {
    const out = adjustBars(
      [bar('2026-06-08', 1000), bar('2026-06-10', 100), bar('2026-07-21', 99.4)],
      { '2026-07-21': 0.6 }, { '2026-06-10': 10 },
    )
    // 第一根跨過 1 拆 10 與配息 0.6（除息前收 100）
    expect(out[0]!.c_adj).toBeCloseTo(1000 * (1 / 10) * (1 - 0.6 / 100), 10)
  })
})

describe('adjustBars：不變量', () => {
  it('沒有事件時，還原價 === 原始價、係數全為 1', () => {
    const bars = [bar('2026-08-18', 103), bar('2026-08-19', 104)]
    const out = adjustBars(bars, {}, {})
    for (const b of out) {
      expect(b.c_adj).toBe(b.c)
      expect(b.adj_factor).toBe(1)
    }
  })

  it('係數必為正——負數或 0 會讓所有指標變成垃圾', () => {
    // 配息大於前一日收盤是不可能的，但來源給錯時不能算出負價
    const bars = [bar('2026-07-18', 1), bar('2026-07-21', 0.5)]
    const out = adjustBars(bars, { '2026-07-21': 99 }, {})
    for (const b of out) expect(b.adj_factor).toBeGreaterThan(0)
  })

  it('空陣列不會炸', () => {
    expect(adjustBars([], { '2026-07-21': 0.6 }, {})).toEqual([])
  })
})
