import { describe, it, expect } from 'vitest'
import { simulate, type Order, type Decider } from '../src/lib/sim/engine'
import { ruleDecider } from '../src/lib/sim/rules'
import { DEFAULT_FEES, DEFAULT_RULES } from '../src/lib/sim/params'
import type { Bar } from '../src/lib/types'

/**
 * 限價成交：**訊號價與成交價要對得起來**。
 *
 * 規則軌的加碼與減碼觸發的是**盤中價位**——「今日最低進了加碼區」、
 * 「今日最高碰到賣出區」。但成交一律排在次日開盤，於是那個觸發它的價位
 * 從來沒有真的成交過。碰到加碼區之後彈回去，帳戶買在比加碼區高的地方；
 * 碰到賣出區之後回落，帳戶賣在比賣出區低的地方。**兩邊都往不利的方向偏，
 * 而且不會有任何錯誤訊息。**
 *
 * 真人拿到「明天回到 96.80 買進」這句話，會去券商掛一張 96.80 的限價單，
 * 不會用市價追。限價是**今天就決定的**，所以這樣模擬沒有偷看未來——
 * 這一點是這組測試存在的理由，也是它跟「用當日收盤成交」的分界。
 *
 * 沒碰到就不成交，那張單當天過期。訊號如果還成立，隔天的 decider 會再送一次。
 */

const bar = (date: string, o: number, h: number, l: number, c: number): Bar =>
  ({ date, o, h, l, c, v: 1000 })

const base = {
  market: 'TW' as const,
  isEtf: true,
  initialCash: 50_000,
  fees: DEFAULT_FEES,
  actions: [],
}

const on = (orders: Record<string, Order>): Decider =>
  (ctx) => orders[ctx.bar.date] ?? null

describe('限價買進', () => {
  const day1 = bar('2026-08-17', 100, 100, 100, 100)

  it('開盤就低於限價：用開盤價成交，撿到更好的價格', () => {
    const bars = [day1, bar('2026-08-18', 95, 99, 94, 98)]
    const r = simulate(bars, on({
      '2026-08-17': { buyCash: 20_000, buyLimit: 97, triggers: ['add'], decidedBy: 'rule' },
    }), base)
    expect(r.trades).toHaveLength(1)
    expect(r.trades[0]!.price).toBe(95)
  })

  it('開盤高於限價、盤中最低碰到：用限價成交', () => {
    const bars = [day1, bar('2026-08-18', 99, 101, 96, 100)]
    const r = simulate(bars, on({
      '2026-08-17': { buyCash: 20_000, buyLimit: 97, triggers: ['add'], decidedBy: 'rule' },
    }), base)
    expect(r.trades).toHaveLength(1)
    expect(r.trades[0]!.price).toBe(97)
  })

  it('整天都沒回到限價：不成交', () => {
    const bars = [day1, bar('2026-08-18', 99, 103, 98, 102)]
    const r = simulate(bars, on({
      '2026-08-17': { buyCash: 20_000, buyLimit: 97, triggers: ['add'], decidedBy: 'rule' },
    }), base)
    expect(r.trades).toHaveLength(0)
    expect(r.state.shares).toBe(0)
  })

  it('沒成交的單當天過期，不會留到後天偷偷成交', () => {
    const bars = [
      day1,
      bar('2026-08-18', 99, 103, 98, 102),  // 沒碰到
      bar('2026-08-19', 96, 97, 90, 91),    // 這天有碰到，但那張單已經過期
    ]
    const r = simulate(bars, on({
      '2026-08-17': { buyCash: 20_000, buyLimit: 97, triggers: ['add'], decidedBy: 'rule' },
    }), base)
    expect(r.trades).toHaveLength(0)
  })

  it('沒給限價就是市價：一律用次日開盤成交（既有行為不變）', () => {
    const bars = [day1, bar('2026-08-18', 110, 112, 109, 111)]
    const r = simulate(bars, on({
      '2026-08-17': { buyCash: 20_000, triggers: ['core'], decidedBy: 'rule' },
    }), base)
    expect(r.trades).toHaveLength(1)
    expect(r.trades[0]!.price).toBe(110)
  })
})

describe('限價賣出', () => {
  const bars0 = [
    bar('2026-08-17', 100, 100, 100, 100),
    bar('2026-08-18', 100, 100, 100, 100),  // 建倉成交在這天
  ]

  it('開盤就高於限價：用開盤價成交', () => {
    const bars = [...bars0, bar('2026-08-19', 112, 113, 111, 112)]
    const r = simulate(bars, on({
      '2026-08-17': { buyCash: 30_000, triggers: ['core'], decidedBy: 'rule' },
      '2026-08-18': {
        sellFraction: 0.5, sellLimit: 110, triggers: ['sell_zone'], decidedBy: 'rule',
      },
    }), base)
    expect(r.trades).toHaveLength(2)
    expect(r.trades[1]!.side).toBe('sell')
    expect(r.trades[1]!.price).toBe(112)
  })

  it('開盤低於限價、盤中最高碰到：用限價成交', () => {
    const bars = [...bars0, bar('2026-08-19', 105, 111, 104, 106)]
    const r = simulate(bars, on({
      '2026-08-17': { buyCash: 30_000, triggers: ['core'], decidedBy: 'rule' },
      '2026-08-18': {
        sellFraction: 0.5, sellLimit: 110, triggers: ['sell_zone'], decidedBy: 'rule',
      },
    }), base)
    expect(r.trades).toHaveLength(2)
    expect(r.trades[1]!.price).toBe(110)
  })

  it('整天都沒碰到限價：不成交', () => {
    const bars = [...bars0, bar('2026-08-19', 105, 108, 104, 106)]
    const r = simulate(bars, on({
      '2026-08-17': { buyCash: 30_000, triggers: ['core'], decidedBy: 'rule' },
      '2026-08-18': {
        sellFraction: 0.5, sellLimit: 110, triggers: ['sell_zone'], decidedBy: 'rule',
      },
    }), base)
    expect(r.trades).toHaveLength(1)
    expect(r.state.shares).toBeGreaterThan(0)
  })
})

describe('止損不掛限價', () => {
  it('跌破就是要跑，用次日開盤成交，跳空低開也照吃', () => {
    const bars = [
      bar('2026-08-17', 100, 100, 100, 100),
      bar('2026-08-18', 100, 100, 100, 100),
      bar('2026-08-19', 88, 90, 86, 87),   // 跳空低開
    ]
    const r = simulate(bars, on({
      '2026-08-17': { buyCash: 30_000, triggers: ['core'], decidedBy: 'rule' },
      '2026-08-18': { sellFraction: 1, triggers: ['stop'], decidedBy: 'rule' },
    }), base)
    expect(r.trades).toHaveLength(2)
    expect(r.trades[1]!.triggers).toContain('stop')
    expect(r.trades[1]!.price).toBe(88)
  })
})

describe('同一天買賣都有', () => {
  const bars0 = [
    bar('2026-08-17', 100, 100, 100, 100),
    bar('2026-08-18', 100, 100, 100, 100),
  ]

  it('兩邊都市價：成交價相同，相抵成一筆（既有行為）', () => {
    const bars = [...bars0, bar('2026-08-19', 100, 100, 100, 100)]
    const r = simulate(bars, on({
      '2026-08-17': { buyCash: 30_000, triggers: ['core'], decidedBy: 'rule' },
      '2026-08-18': {
        buyCash: 10_000, sellFraction: 0.5,
        triggers: ['add', 'sell_zone'], decidedBy: 'rule',
      },
    }), base)
    // 建倉一筆 + 相抵後的淨額一筆
    expect(r.trades).toHaveLength(2)
    expect(r.trades[1]!.fillD).toBe('2026-08-19')
  })

  it('限價不同、兩邊都成交：拆成兩筆，各自用自己的價位', () => {
    // 寬幅震盪：最低 96 進加碼區、最高 112 觸賣出區
    const bars = [...bars0, bar('2026-08-19', 104, 112, 96, 105)]
    const r = simulate(bars, on({
      '2026-08-17': { buyCash: 30_000, triggers: ['core'], decidedBy: 'rule' },
      '2026-08-18': {
        buyCash: 10_000, buyLimit: 97,
        sellFraction: 0.5, sellLimit: 110,
        triggers: ['add', 'sell_zone'], decidedBy: 'rule',
      },
    }), base)
    const day3 = r.trades.filter((t) => t.fillD === '2026-08-19')
    expect(day3).toHaveLength(2)
    expect(day3.find((t) => t.side === 'sell')!.price).toBe(110)
    expect(day3.find((t) => t.side === 'buy')!.price).toBe(97)
  })

  it('只有一邊碰到限價：只成交那一邊', () => {
    const bars = [...bars0, bar('2026-08-19', 104, 112, 103, 105)]  // 高點到、低點沒到
    const r = simulate(bars, on({
      '2026-08-17': { buyCash: 30_000, triggers: ['core'], decidedBy: 'rule' },
      '2026-08-18': {
        buyCash: 10_000, buyLimit: 97,
        sellFraction: 0.5, sellLimit: 110,
        triggers: ['add', 'sell_zone'], decidedBy: 'rule',
      },
    }), base)
    const day3 = r.trades.filter((t) => t.fillD === '2026-08-19')
    expect(day3).toHaveLength(1)
    expect(day3[0]!.side).toBe('sell')
  })

  it('買進不預支同日賣出的價款', () => {
    // 現金幾乎用光，同日賣出換回一大筆——那筆錢當天不能拿來買
    const bars = [...bars0, bar('2026-08-19', 104, 112, 96, 105)]
    const r = simulate(bars, on({
      '2026-08-17': { buyCash: 49_000, triggers: ['core'], decidedBy: 'rule' },
      '2026-08-18': {
        buyCash: 20_000, buyLimit: 97,
        sellFraction: 0.5, sellLimit: 110,
        triggers: ['add', 'sell_zone'], decidedBy: 'rule',
      },
    }), base)
    const bought = r.trades.filter((t) => t.fillD === '2026-08-19' && t.side === 'buy')
    const spent = bought.reduce((s, t) => s + t.qty * t.price + t.fee, 0)
    expect(spent).toBeLessThan(20_000)
  })
})

describe('明日指令帶著限價', () => {
  const day1 = bar('2026-08-17', 100, 100, 100, 100)

  it('有限價時用限價算，並且標出來', () => {
    const r = simulate([day1], on({
      '2026-08-17': { buyCash: 20_000, buyLimit: 96.8, triggers: ['add'], decidedBy: 'rule' },
    }), base)
    expect(r.pending!.estimates).toHaveLength(1)
    expect(r.pending!.estimates[0]!.limit).toBe(96.8)
    expect(r.pending!.estimates[0]!.refPrice).toBe(96.8)
  })

  it('沒有限價時 limit 是 null，refPrice 仍是今日收盤', () => {
    const r = simulate([day1], on({
      '2026-08-17': { buyCash: 20_000, triggers: ['core'], decidedBy: 'rule' },
    }), base)
    expect(r.pending!.estimates).toHaveLength(1)
    expect(r.pending!.estimates[0]!.limit).toBeNull()
    expect(r.pending!.estimates[0]!.refPrice).toBe(100)
  })

  it('不動作時是空陣列，不生一個 0 出來', () => {
    const r = simulate([day1], on({
      '2026-08-17': { triggers: [], decidedBy: 'rule', reason: '今天不用做' },
    }), base)
    expect(r.pending!.estimates).toEqual([])
  })

  it('限價不同的買賣單分成兩張列出來，不相抵', () => {
    const bars = [
      day1,
      bar('2026-08-18', 100, 100, 100, 100),
      bar('2026-08-19', 100, 100, 100, 100),
    ]
    const r = simulate(bars, on({
      '2026-08-17': { buyCash: 30_000, triggers: ['core'], decidedBy: 'rule' },
      '2026-08-19': {
        buyCash: 10_000, buyLimit: 97,
        sellFraction: 0.5, sellLimit: 110,
        triggers: ['add', 'sell_zone'], decidedBy: 'rule',
      },
    }), base)
    expect(r.pending!.estimates.map((e) => e.side).sort()).toEqual(['buy', 'sell'])
    expect(r.pending!.estimates.find((e) => e.side === 'buy')!.limit).toBe(97)
    expect(r.pending!.estimates.find((e) => e.side === 'sell')!.limit).toBe(110)
  })

  it('兩張都是市價：相抵成一張淨額（既有行為）', () => {
    const bars = [
      day1,
      bar('2026-08-18', 100, 100, 100, 100),
      bar('2026-08-19', 100, 100, 100, 100),
    ]
    const r = simulate(bars, on({
      '2026-08-17': { buyCash: 30_000, triggers: ['core'], decidedBy: 'rule' },
      '2026-08-19': {
        buyCash: 10_000, sellFraction: 0.5,
        triggers: ['add', 'sell_zone'], decidedBy: 'rule',
      },
    }), base)
    expect(r.pending!.estimates).toHaveLength(1)
  })
})

describe('規則軌把價位帶進訂單', () => {
  const lv = {
    add: { lo: 95, hi: 97 }, sell: { lo: 110, hi: 115 }, stop: { price: 90 },
  }
  const days = {
    '2026-08-17': { levels: lv, pctB: 0.3, k: 20, d: 25, kPrev: null, dPrev: null },
    '2026-08-18': { levels: lv, pctB: 0.3, k: 35, d: 30, kPrev: 20, dPrev: 25 },
    '2026-08-19': { levels: lv, pctB: 0.3, k: 40, d: 35, kPrev: 35, dPrev: 30 },
  }
  const flat = { cash: 50_000, shares: 0, cost: 0 }

  it('加碼掛在加碼區上緣', () => {
    const d = ruleDecider(days, 50_000, { ...DEFAULT_RULES, coreFraction: 0 })
    d({ index: 0, bar: bar('2026-08-17', 100, 100, 100, 100), state: flat })
    d({ index: 1, bar: bar('2026-08-18', 100, 100, 100, 100), state: flat })
    const o = d({ index: 2, bar: bar('2026-08-19', 100, 101, 96, 99), state: flat })
    expect(o!.triggers).toContain('add')
    expect(o!.buyLimit).toBe(97)
  })

  it('減碼掛在賣出區下緣', () => {
    const d = ruleDecider(days, 50_000, { ...DEFAULT_RULES, coreFraction: 0 })
    const o = d({
      index: 0, bar: bar('2026-08-17', 100, 112, 99, 105),
      state: { cash: 20_000, shares: 300, cost: 30_000 },
    })
    expect(o!.triggers).toContain('sell_zone')
    expect(o!.sellLimit).toBe(110)
  })

  it('止損與底倉不掛限價', () => {
    const dStop = ruleDecider(days, 50_000, { ...DEFAULT_RULES, coreFraction: 0 })
    const stop = dStop({
      index: 0, bar: bar('2026-08-17', 100, 100, 88, 89),
      state: { cash: 20_000, shares: 300, cost: 30_000 },
    })
    expect(stop!.triggers).toContain('stop')
    expect(stop!.sellLimit).toBeUndefined()

    const dCore = ruleDecider(days, 50_000, { ...DEFAULT_RULES, coreFraction: 2 / 3 })
    const core = dCore({ index: 0, bar: bar('2026-08-17', 100, 101, 99, 100), state: flat })
    expect(core!.triggers).toContain('core')
    expect(core!.buyLimit).toBeUndefined()
  })
})
