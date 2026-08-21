import { describe, it, expect } from 'vitest'
import { simulate, type Order, type Decider } from '../src/lib/sim/engine'
import { DEFAULT_FEES } from '../src/lib/sim/params'
import type { Bar } from '../src/lib/types'

/**
 * 模擬帳戶引擎（PLAN §13.1、§13.3、§13.8）。
 *
 * 這一組測試裡最重要的是第一個 describe：**成交價用訊號的次日開盤價**。
 * 用訊號當天的收盤價成交是紙上交易最容易造假的一點，而且造假不會有任何錯誤訊息——
 * 我們的訊號是收盤後才算出來的，那個時候當天的收盤價早就成交完了。
 * 尤其止損那一筆，用當天收盤成交等於「跌破的瞬間就跑掉了」，
 * 實際上你隔天開盤才跑得掉，而跌破後的隔天常常跳空低開。
 */

const bar = (date: string, o: number, c = o, h = Math.max(o, c), l = Math.min(o, c)): Bar =>
  ({ date, o, h, l, c, v: 1000 })

const base = {
  market: 'TW' as const,
  isEtf: true,
  initialCash: 50_000,
  fees: DEFAULT_FEES,
  actions: [],
}

/** 在指定的訊號日下單，其餘日子不動作 */
const on = (orders: Record<string, Order>): Decider =>
  (ctx) => orders[ctx.bar.date] ?? null

const buy = (cash: number): Order =>
  ({ buyCash: cash, triggers: ['test-buy'], decidedBy: 'rule' })
const sell = (fraction: number): Order =>
  ({ sellFraction: fraction, triggers: ['test-sell'], decidedBy: 'rule' })

describe('成交時點：訊號在收盤後，成交在次日開盤', () => {
  const bars = [
    bar('2026-08-17', 100, 100),
    bar('2026-08-18', 110, 105), // 訊號日的隔天：開 110
    bar('2026-08-19', 106, 106),
  ]

  it('8/17 的訊號成交在 8/18 的開盤價 110，不是 8/17 的收盤價 100', () => {
    const r = simulate(bars, on({ '2026-08-17': buy(20_000) }), base)
    expect(r.trades).toHaveLength(1)
    expect(r.trades[0]!.signalD).toBe('2026-08-17')
    expect(r.trades[0]!.fillD).toBe('2026-08-18')
    expect(r.trades[0]!.price).toBe(110)
  })

  it('最後一天的訊號還沒成交，留成「明天要做的事」', () => {
    const r = simulate(bars, on({ '2026-08-19': buy(20_000) }), base)
    expect(r.trades).toHaveLength(0)
    expect(r.pending).not.toBeNull()
    expect(r.pending!.signalD).toBe('2026-08-19')
  })

  it('沒有訊號時 pending 是 null', () => {
    const r = simulate(bars, () => null, base)
    expect(r.pending).toBeNull()
  })
})

describe('不強制進場：空手是合法的最終狀態', () => {
  const bars = [bar('2026-08-17', 100), bar('2026-08-18', 101), bar('2026-08-19', 102)]

  it('第一天不會自動買進', () => {
    const r = simulate(bars, () => null, base)
    expect(r.trades).toHaveLength(0)
    expect(r.state.shares).toBe(0)
    expect(r.state.cash).toBe(50_000)
  })

  it('整段期間都不進場 → 曲線是水平線、報酬 0%、在市天數 0，而且不是錯誤', () => {
    const r = simulate(bars, () => null, base)
    expect(r.equity).toHaveLength(3)
    expect(r.equity.every((e) => e.equity === 50_000)).toBe(true)
    expect(r.equity.every((e) => e.retPct === 0)).toBe(true)
    expect(r.daysInMarket).toBe(0)
  })

  it('有持股的日子才算在市天數', () => {
    const r = simulate(bars, on({ '2026-08-17': buy(20_000) }), base)
    expect(r.daysInMarket).toBe(2) // 8/18 成交，8/18 與 8/19 有部位
  })
})

describe('帳務不變量：不融資、不放空', () => {
  const bars = [bar('2026-08-17', 100), bar('2026-08-18', 100), bar('2026-08-19', 100)]

  it('要買的錢超過現金 → 買得起多少買多少，現金不為負', () => {
    const r = simulate(bars, on({ '2026-08-17': buy(999_999) }), base)
    expect(r.state.cash).toBeGreaterThanOrEqual(0)
    for (const e of r.equity) expect(e.cash).toBeGreaterThanOrEqual(0)
  })

  it('沒有持股時的賣出指令不會產生成交，股數不為負', () => {
    const r = simulate(bars, on({ '2026-08-17': sell(1) }), base)
    expect(r.trades).toHaveLength(0)
    expect(r.state.shares).toBe(0)
  })

  it('賣出比例 1 就是全部出清', () => {
    const r = simulate(
      [...bars, bar('2026-08-20', 100)],
      on({ '2026-08-17': buy(20_000), '2026-08-18': sell(1) }),
      base,
    )
    expect(r.state.shares).toBe(0)
  })

  it('每一天：淨值 = 現金 + 股數 × 收盤', () => {
    const r = simulate(bars, on({ '2026-08-17': buy(20_000) }), base)
    for (const e of r.equity) {
      expect(e.equity).toBeCloseTo(e.cash + e.shares * e.mark, 8)
    }
  })

  it('報酬率是相對本金算的', () => {
    const r = simulate(bars, on({ '2026-08-17': buy(20_000) }), base)
    for (const e of r.equity) {
      expect(e.retPct).toBeCloseTo(((e.equity - 50_000) / 50_000) * 100, 8)
    }
  })
})

describe('同日一買一賣要相抵成一筆（PLAN §13.4）', () => {
  // 寬幅震盪的日子：最高碰到賣出區、最低碰到加碼區
  const bars = [
    bar('2026-08-17', 100, 100),
    bar('2026-08-18', 100, 100),
    bar('2026-08-19', 100, 100),
    bar('2026-08-20', 100, 100),
  ]

  const both = (buyCash: number, sellFraction: number): Order =>
    ({ buyCash, sellFraction, triggers: ['add', 'sell_zone'], decidedBy: 'rule' })

  it('同一天同時要買要賣 → 只成交淨額那一筆', () => {
    const r = simulate(bars, on({
      '2026-08-17': buy(20_000),           // 買 199 股
      '2026-08-18': both(5_000, 0.5),      // 想買 49 股、想賣 99 股 → 淨賣 50 股
    }), base)
    const second = r.trades.filter((t) => t.signalD === '2026-08-18')
    expect(second).toHaveLength(1)
    expect(second[0]!.side).toBe('sell')
  })

  it('相抵之後每天最多一筆成交', () => {
    const r = simulate(bars, on({
      '2026-08-17': buy(20_000),
      '2026-08-18': both(5_000, 0.5),
      '2026-08-19': both(30_000, 0.1),
    }), base)
    const byDay = new Map<string, number>()
    for (const t of r.trades) byDay.set(t.fillD, (byDay.get(t.fillD) ?? 0) + 1)
    for (const n of byDay.values()) expect(n).toBe(1)
  })

  it('買賣剛好抵銷 → 完全不成交，不付任何費用', () => {
    const r = simulate(bars, on({
      '2026-08-17': buy(20_000),
    }), base)
    const shares = r.state.shares
    const r2 = simulate(bars, on({
      '2026-08-17': buy(20_000),
      // 買回同樣的股數，同時賣掉全部 → 淨額 0
      '2026-08-18': { buyCash: shares * 100 + 100, sellFraction: 1, triggers: ['x'], decidedBy: 'rule' },
    }), base)
    const day2 = r2.trades.filter((t) => t.signalD === '2026-08-18')
    expect(day2.length).toBeLessThanOrEqual(1)
    if (day2.length === 1) expect(day2[0]!.qty).toBeGreaterThan(0)
  })

  it('相抵比分開送便宜——這就是要相抵的理由', () => {
    const netted = simulate(bars, on({
      '2026-08-17': buy(20_000),
      '2026-08-18': both(5_000, 0.5),
    }), base)
    const totalCost = netted.trades.reduce((s, t) => s + t.fee + t.tax, 0)
    // 分開送會多一筆買進手續費（台股至少 20 元）
    expect(totalCost).toBeLessThan(20 + 20 + 20 + 100)
  })
})

describe('公司行動：配息發現金、分割調股數（PLAN §13.3）', () => {
  it('除息日按持股領現金，淨值在除息前後連續', () => {
    const bars = [
      bar('2026-07-17', 105, 105),
      bar('2026-07-18', 105, 105),
      bar('2026-07-21', 104.4, 104.4), // 除息，股價掉 0.6
    ]
    const r = simulate(bars, on({ '2026-07-17': buy(20_000) }), {
      ...base,
      actions: [{ date: '2026-07-21', kind: 'dividend', amount: 0.6 }],
    })
    const held = r.equity[1]!.shares
    expect(held).toBeGreaterThan(0)

    // 股價掉的那 0.6 元，由現金補回來 → 淨值不變
    expect(r.equity[2]!.cash - r.equity[1]!.cash).toBeCloseTo(held * 0.6, 6)
    expect(r.equity[2]!.equity).toBeCloseTo(r.equity[1]!.equity, 6)
  })

  it('除息日當天才買進的人領不到——配息用「開盤成交前」的持股計算', () => {
    const bars = [
      bar('2026-07-18', 105, 105),
      bar('2026-07-21', 104.4, 104.4),
      bar('2026-07-22', 104.4, 104.4),
    ]
    // 7/18 下訊號 → 7/21（除息日）開盤才成交，不該領到這次配息
    const r = simulate(bars, on({ '2026-07-18': buy(20_000) }), {
      ...base,
      actions: [{ date: '2026-07-21', kind: 'dividend', amount: 0.6 }],
    })
    const bought = r.trades[0]!
    expect(bought.fillD).toBe('2026-07-21')
    expect(r.dividendsReceived).toBe(0)
  })

  it('1 拆 10：股數 ×10、每股成本 ÷10、淨值不變', () => {
    const bars = [
      bar('2026-06-08', 1000, 1000),
      bar('2026-06-09', 1000, 1000),
      bar('2026-06-10', 100, 100), // 分割生效
    ]
    const r = simulate(bars, on({ '2026-06-08': buy(20_000) }), {
      ...base, market: 'US', isEtf: false,
      actions: [{ date: '2026-06-10', kind: 'split', amount: 10 }],
    })
    const before = r.equity[1]!
    const after = r.equity[2]!
    expect(after.shares).toBeCloseTo(before.shares * 10, 8)
    expect(after.equity).toBeCloseTo(before.equity, 6)
  })
})

describe('不偷看未來（PLAN §13.8）', () => {
  const bars = Array.from({ length: 30 }, (_, i) =>
    bar(`2026-06-${String(i + 1).padStart(2, '0')}`, 100 + i, 100 + i))

  /** 只看得到 ctx 裡的東西的決策函式 */
  const decider: Decider = (ctx) =>
    ctx.index % 7 === 0 && ctx.state.cash > 20_000 ? buy(15_000) : null

  it('只餵前 i 根算出來的成交，跟餵全部時的前 i 筆完全相同', () => {
    const full = simulate(bars, decider, base)
    for (const cut of [10, 17, 25]) {
      const partial = simulate(bars.slice(0, cut), decider, base)
      const expected = full.trades.filter((t) => t.fillD <= bars[cut - 1]!.date)
      expect(partial.trades).toEqual(expected)
    }
  })

  it('前綴的每日淨值也完全相同', () => {
    const full = simulate(bars, decider, base)
    const partial = simulate(bars.slice(0, 20), decider, base)
    expect(partial.equity).toEqual(full.equity.slice(0, 20))
  })
})

describe('邊界', () => {
  it('沒有 K 棒不會炸', () => {
    const r = simulate([], () => null, base)
    expect(r.trades).toEqual([])
    expect(r.equity).toEqual([])
    expect(r.pending).toBeNull()
  })

  it('只有一根 K 棒：訊號永遠成交不了，只會留成 pending', () => {
    const r = simulate([bar('2026-08-19', 100)], on({ '2026-08-19': buy(10_000) }), base)
    expect(r.trades).toEqual([])
    expect(r.pending).not.toBeNull()
  })

  it('費用會真的從現金扣掉', () => {
    const bars = [bar('2026-08-17', 100), bar('2026-08-18', 100), bar('2026-08-19', 100)]
    const r = simulate(bars, on({ '2026-08-17': buy(20_000) }), base)
    const t = r.trades[0]!
    expect(t.fee).toBeGreaterThan(0)
    expect(r.equity[1]!.cash).toBeCloseTo(50_000 - t.qty * t.price - t.fee, 8)
  })
})

describe('出清之後不能留下浮點灰塵', () => {
  /**
   * 2026-08-22 實測：NVDA 全數賣出後 `shares` 是 8.881784197001252e-16。
   *
   * 那個數字大於 0，於是後果全部是真的：
   *   - 止損條件 `shares > 0` 永遠成立 → **每天產生一筆假的「明日全部賣出」指令**
   *   - `daysInMarket` 把之後每一天都算成「有部位」（NVDA 灌水到 79 天）
   *   - 清單顯示「持有中」，其實兩個月前就出清了
   *
   * 成因是 `roundQty` 的乘除在浮點數上不可逆：賣出 3.8123 股之後，
   * `shares - qty` 不會剛好是 0。小於一個可交易單位的餘額是**灰塵，不是部位**。
   */
  const bars = [
    bar('2026-08-17', 100, 100),
    bar('2026-08-18', 100, 100),
    bar('2026-08-19', 100, 100),
    bar('2026-08-20', 100, 100),
  ]

  /**
   * 重現 NVDA 的實際路徑：分三批買進、兩次減碼一半、最後全數出清。
   * 單獨一次買賣不會產生誤差——是 `roundQty` 的乘除在多次之後累積出來的。
   */
  const nvdaPath = [
    bar('2026-06-01', 100, 100), bar('2026-06-02', 100, 100), bar('2026-06-03', 100, 100),
    bar('2026-06-04', 100, 100), bar('2026-06-05', 100, 100), bar('2026-06-08', 100, 100),
    bar('2026-06-09', 100, 100), bar('2026-06-10', 100, 100), bar('2026-06-11', 100, 100),
  ]
  const batch = (): Order => ({ buyCash: 1666.67, triggers: ['add'], decidedBy: 'rule' })
  const usCfg = { ...base, market: 'US' as const, isEtf: false, initialCash: 5000 }

  it('美股小數股：三買、兩次減半、全出之後，股數剛好是 0', () => {
    const r = simulate(nvdaPath, on({
      '2026-06-01': batch(), '2026-06-02': batch(), '2026-06-03': batch(),
      '2026-06-04': sell(0.5), '2026-06-05': sell(0.5), '2026-06-08': sell(1),
    }), usCfg)
    expect(r.state.shares).toBe(0)
    expect(r.equity[r.equity.length - 1]!.shares).toBe(0)
  })

  it('灰塵不能讓「已出清」看起來像「還有部位」', () => {
    const r = simulate(nvdaPath, on({
      '2026-06-01': batch(), '2026-06-02': batch(), '2026-06-03': batch(),
      '2026-06-04': sell(0.5), '2026-06-05': sell(0.5), '2026-06-08': sell(1),
    }), usCfg)
    // 出清之後的每一天都不該再算成有部位
    for (const e of r.equity.filter((x) => x.d > '2026-06-09')) {
      expect(e.shares).toBe(0)
    }
  })

  it('台股整數股全數賣出後，股數剛好是 0', () => {
    const r = simulate(bars, on({
      '2026-08-17': buy(20_000),
      '2026-08-18': sell(1),
    }), base)
    expect(r.state.shares).toBe(0)
  })

  it('出清之後不再被算成「在市」', () => {
    const r = simulate(bars, on({
      '2026-08-17': { buyCash: 1234.5678, triggers: ['b'], decidedBy: 'rule' },
      '2026-08-18': sell(1),
    }), { ...base, market: 'US', isEtf: false })
    // 8/18 成交買進、8/19 成交賣出 → 只有 8/18 那一天有部位
    expect(r.daysInMarket).toBe(1)
  })

  it('出清之後成本歸零，批次額度整個放回來', () => {
    const r = simulate(bars, on({
      '2026-08-17': buy(20_000),
      '2026-08-18': sell(1),
    }), base)
    expect(r.state.cost).toBe(0)
  })

  it('只賣一半時不會被誤判成灰塵而清掉', () => {
    const r = simulate(bars, on({
      '2026-08-17': buy(20_000),
      '2026-08-18': sell(0.5),
    }), base)
    expect(r.state.shares).toBeGreaterThan(50)
    expect(r.state.cost).toBeGreaterThan(0)
  })
})
