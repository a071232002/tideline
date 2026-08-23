import { describe, it, expect } from 'vitest'
import { simulate } from '../src/lib/sim/engine'
import { ruleDecider, holdDecider, type RuleDay } from '../src/lib/sim/rules'
import { DEFAULT_FEES, DEFAULT_RULES } from '../src/lib/sim/params'
import type { Bar } from '../src/lib/types'

/**
 * 規則軌道（PLAN §13.4）。**這條軌道是 AI 的對照組，不是主角**——
 * 沒有它，AI 帳戶賺了錢也分不出來是判斷力還是市場本身在漲。
 * 所以它必須是確定性的、規則寫死的。
 *
 * 這組測試守的重點只有一個：**價格到了不代表要買**。
 * §4 的加碼區本來就附帶「%b < 0.5，且等 K < 30 出現金叉再分批進場」，
 * 模擬草案原本漏掉了這兩條，變成「碰到就買」——那會把一路下跌的過程買好買滿。
 */

const bar = (date: string, o: number, c: number, h: number, l: number): Bar =>
  ({ date, o, h, l, c, v: 1000 })

const cfg = {
  market: 'TW' as const,
  isEtf: true,
  initialCash: 50_000,
  fees: DEFAULT_FEES,
  actions: [],
}

/** 一個「所有加碼條件都成立」的日子，再由測試逐項破壞 */
const goodAdd = (over: Partial<RuleDay> = {}): RuleDay => ({
  levels: { add: { lo: 99, hi: 101 }, sell: { lo: 120, hi: 122 }, stop: { price: 90 } },
  pctB: 0.3,
  k: 26, d: 25, kPrev: 18, dPrev: 26,   // K 由下穿上 D（18<=26 → 26>25），且在低檔
  ...over,
})

/** 三天：第一天下訊號，第二天開盤成交，第三天收尾 */
const threeDays = (h: number, l: number) => [
  bar('2026-08-17', 100, 100, h, l),
  bar('2026-08-18', 100, 100, 100, 100),
  bar('2026-08-19', 100, 100, 100, 100),
]

function run(bars: Bar[], days: Record<string, RuleDay>,
  over: Partial<typeof DEFAULT_RULES> = {}) {
  return simulate(
    bars, ruleDecider(days, cfg.initialCash, { ...DEFAULT_RULES, ...over }), cfg)
}

describe('加碼：價格到了只是必要條件', () => {
  it('四個條件都成立 → 買一批', () => {
    const r = run(threeDays(102, 100), { '2026-08-17': goodAdd() })
    expect(r.trades).toHaveLength(1)
    expect(r.trades[0]!.side).toBe('buy')
    expect(r.trades[0]!.triggers).toContain('add')
  })

  it('價格沒進加碼區 → 不買', () => {
    const r = run(threeDays(115, 110), { '2026-08-17': goodAdd() })
    expect(r.trades).toHaveLength(0)
  })

  it('%b 沒回到 0.5 以下 → 不買，錢繼續放著', () => {
    const r = run(threeDays(102, 100), { '2026-08-17': goodAdd({ pctB: 0.62 }) })
    expect(r.trades).toHaveLength(0)
    expect(r.state.cash).toBe(50_000)
  })

  it('K 還在高檔 → 不買', () => {
    const r = run(threeDays(102, 100), {
      '2026-08-17': goodAdd({ k: 55, d: 60, kPrev: 50, dPrev: 61 }),
    })
    expect(r.trades).toHaveLength(0)
  })

  it('K 在低檔但沒有金叉（還在 D 下方）→ 不買', () => {
    const r = run(threeDays(102, 100), {
      '2026-08-17': goodAdd({ k: 20, d: 25, kPrev: 22, dPrev: 24 }),
    })
    expect(r.trades).toHaveLength(0)
  })

  it('每批投入約為本金的三分之一', () => {
    const r = run(threeDays(102, 100), { '2026-08-17': goodAdd() })
    const t = r.trades[0]!
    const spent = t.qty * t.price + t.fee
    expect(spent).toBeGreaterThan(50_000 / 3 * 0.9)
    expect(spent).toBeLessThanOrEqual(50_000 / 3 + 50)
  })

  it('批次用完就不再買', () => {
    const bars = [
      bar('2026-08-17', 100, 100, 102, 100),
      bar('2026-08-18', 100, 100, 102, 100),
      bar('2026-08-19', 100, 100, 102, 100),
      bar('2026-08-20', 100, 100, 102, 100),
      bar('2026-08-21', 100, 100, 102, 100),
      bar('2026-08-24', 100, 100, 102, 100),
    ]
    const days = Object.fromEntries(bars.map((b) => [b.date, goodAdd()]))
    const r = run(bars, days)
    expect(r.trades.filter((t) => t.side === 'buy')).toHaveLength(DEFAULT_RULES.batches)
  })
})

describe('減碼：觸及賣出區賣一半，不是出清', () => {
  const bars = [
    bar('2026-08-17', 100, 100, 102, 100),  // 加碼訊號
    bar('2026-08-18', 100, 100, 100, 100),  // 成交
    bar('2026-08-19', 100, 100, 125, 100),  // 觸及賣出區 120
    bar('2026-08-20', 100, 100, 100, 100),  // 成交
  ]

  /** 8/19 只滿足減碼：%b 已經回到 0.5 以上，加碼條件不成立 */
  const trimOnly = goodAdd({ pctB: 0.8 })

  it('有持股時觸及賣出區 → 賣掉一半', () => {
    const r = run(bars, { '2026-08-17': goodAdd(), '2026-08-19': trimOnly })
    const sells = r.trades.filter((t) => t.side === 'sell')
    expect(sells).toHaveLength(1)
    const bought = r.trades[0]!.qty
    expect(sells[0]!.qty).toBe(Math.floor(bought * DEFAULT_RULES.trimFraction))
    expect(r.state.shares).toBeGreaterThan(0)   // 沒有出清
  })

  it('沒有持股時觸及賣出區 → 什麼都不做', () => {
    const r = run(bars, { '2026-08-19': trimOnly })
    expect(r.trades).toHaveLength(0)
  })
})

describe('止損：收盤跌破止跌點', () => {
  const bars = [
    bar('2026-08-17', 100, 100, 102, 100),
    bar('2026-08-18', 100, 100, 100, 100),
    bar('2026-08-19', 100, 89, 100, 88),   // 收 89 < 止跌 90
    bar('2026-08-20', 89, 89, 89, 89),
  ]

  it('跌破 → 隔日開盤全部出清', () => {
    const r = run(bars, { '2026-08-17': goodAdd(), '2026-08-19': goodAdd() })
    const stop = r.trades.find((t) => t.triggers.includes('stop'))
    expect(stop).toBeDefined()
    expect(stop!.side).toBe('sell')
    expect(r.state.shares).toBe(0)
  })

  it('止損成交在次日開盤，不是跌破當天的收盤——那才是你真正跑得掉的價格', () => {
    const r = run(bars, { '2026-08-17': goodAdd(), '2026-08-19': goodAdd() })
    const stop = r.trades.find((t) => t.triggers.includes('stop'))!
    expect(stop.fillD).toBe('2026-08-20')
    expect(stop.price).toBe(89)
  })

  /**
   * `useStop: false` 只給 `scripts/experiment.ts` 用（PLAN §11 的對照實驗）。
   * 它一定要**只影響止損**：如果它順手把減碼或加碼也關掉，那張對照表比較的
   * 就不是「有沒有止損」，整個實驗的結論都會是錯的。
   */
  it('useStop: false → 不出清，而且其他規則照常', () => {
    const r = run(bars, { '2026-08-17': goodAdd(), '2026-08-19': goodAdd() },
      { useStop: false })
    expect(r.trades.find((t) => t.triggers.includes('stop'))).toBeUndefined()
    expect(r.state.shares).toBeGreaterThan(0)
    // 加碼那一筆還在——這個開關不能連進場一起關掉
    expect(r.trades.filter((t) => t.side === 'buy').length).toBeGreaterThan(0)
  })

  it('預設就是開著的——正式跑一律有止損', () => {
    expect(DEFAULT_RULES.useStop).toBeUndefined()
    const r = run(bars, { '2026-08-17': goodAdd(), '2026-08-19': goodAdd() })
    expect(r.trades.find((t) => t.triggers.includes('stop'))).toBeDefined()
  })

  it('止損當天不會同時觸發加碼', () => {
    const r = run(bars, { '2026-08-17': goodAdd(), '2026-08-19': goodAdd() })
    const day = r.trades.filter((t) => t.signalD === '2026-08-19')
    expect(day).toHaveLength(1)
    expect(day[0]!.side).toBe('sell')
  })
})

describe('冷卻：止損後不要馬上被巴回來', () => {
  /** 跌破後價格立刻回到加碼區，且所有加碼條件都成立 */
  const bars = [
    bar('2026-08-17', 100, 100, 102, 100),
    bar('2026-08-18', 100, 100, 100, 100),
    bar('2026-08-19', 100, 89, 100, 88),    // 止損訊號
    bar('2026-08-20', 89, 100, 102, 89),    // 止損成交；同日又進加碼區
    bar('2026-08-21', 100, 100, 102, 100),
    bar('2026-08-24', 100, 100, 102, 100),
    bar('2026-08-25', 100, 100, 102, 100),
    bar('2026-08-26', 100, 100, 102, 100),
    bar('2026-08-27', 100, 100, 102, 100),
    bar('2026-08-28', 100, 100, 102, 100),
  ]
  const days = Object.fromEntries(bars.map((b) => [b.date, goodAdd()]))

  it('冷卻期內不重新進場', () => {
    const r = run(bars, days)
    const buysAfterStop = r.trades.filter(
      (t) => t.side === 'buy' && t.signalD > '2026-08-19',
    )
    for (const t of buysAfterStop) {
      const gap = bars.findIndex((b) => b.date === t.signalD)
        - bars.findIndex((b) => b.date === '2026-08-19')
      expect(gap).toBeGreaterThan(DEFAULT_RULES.cooldownDays)
    }
  })

  it('冷卻期滿之後可以再進場', () => {
    const r = run(bars, days)
    expect(r.trades.some((t) => t.side === 'buy' && t.signalD > '2026-08-19')).toBe(true)
  })
})

describe('金叉是「先架起訊號」，不是「同一天」（params 2026-08-21.2）', () => {
  /**
   * 初稿要求 %b<0.5、K<30、金叉、價格進區四者同日成立，實測台股三檔
   * **半年一次都沒進場**——一條永遠不觸發的規則不能當 AI 的對照組。
   * §4 的原文是「等 KD 回低檔出現金叉**再**分批進場」，「再」是先後。
   */

  /** 低檔金叉當天，但價格還沒回到加碼區 */
  const crossDay = goodAdd()
  /** 幾天後價格才回到加碼區，當天沒有金叉（K 仍在低檔且高於 D） */
  const laterDip = goodAdd({ k: 28, d: 26, kPrev: 27, dPrev: 25 })

  const bars = [
    bar('2026-08-17', 100, 100, 110, 108),  // 金叉日，價格在高處
    bar('2026-08-18', 100, 100, 110, 108),
    bar('2026-08-19', 100, 100, 102, 100),  // 價格回到加碼區
    bar('2026-08-20', 100, 100, 100, 100),
  ]

  it('金叉在前、價格在後 → 買得到', () => {
    const r = run(bars, { '2026-08-17': crossDay, '2026-08-19': laterDip })
    expect(r.trades).toHaveLength(1)
    expect(r.trades[0]!.side).toBe('buy')
    expect(r.trades[0]!.signalD).toBe('2026-08-19')
  })

  it('從頭到尾沒有低檔金叉 → 價格再怎麼進加碼區也不買', () => {
    const noCross = goodAdd({ k: 28, d: 26, kPrev: 27, dPrev: 25 })
    const r = run(bars, { '2026-08-17': noCross, '2026-08-19': noCross })
    expect(r.trades).toHaveLength(0)
  })

  it('先回低檔、之後才金叉（金叉當天 K 已回到 30 以上）→ 仍然算數', () => {
    // 上升趨勢裡 KD 的回檔又淺又快，金叉出現時 K 常常已經回到 30 以上。
    // 要求同日成立的話，台股這半年一次都不會進場（params 2026-08-21.3）。
    const dip = goodAdd({ k: 21, d: 30, kPrev: 25, dPrev: 33 })       // 回低檔，沒交叉
    const crossLate = goodAdd({ k: 36, d: 34, kPrev: 30, dPrev: 35 }) // 金叉，但 K 已 36
    const r = run(bars, {
      '2026-08-17': dip,
      '2026-08-18': crossLate,
      '2026-08-19': goodAdd({ k: 40, d: 38, kPrev: 39, dPrev: 37 }),  // 價格進區
    })
    expect(r.trades).toHaveLength(1)
    expect(r.trades[0]!.side).toBe('buy')
  })

  it('只有金叉、從來沒回過低檔 → 不算數', () => {
    const highCross = goodAdd({ k: 55, d: 52, kPrev: 50, dPrev: 53 })
    const r = run(bars, {
      '2026-08-17': highCross,
      '2026-08-19': goodAdd({ k: 45, d: 43, kPrev: 44, dPrev: 42 }),
    })
    expect(r.trades).toHaveLength(0)
  })

  it('金叉之後 K 衝上高檔 → 訊號失效，那時才進加碼區也不買（那是追高）', () => {
    const overbought = goodAdd({ k: 82, d: 75, kPrev: 80, dPrev: 74 })
    const r = run(bars, {
      '2026-08-17': crossDay,
      '2026-08-18': overbought,   // K > 70 解除
      '2026-08-19': laterDip,
    })
    expect(r.trades).toHaveLength(0)
  })

  it('止損也會把訊號解除，冷卻結束後要重新金叉才算數', () => {
    const stopBars = [
      bar('2026-08-17', 100, 100, 102, 100),  // 金叉 + 進加碼區 → 買
      bar('2026-08-18', 100, 100, 100, 100),
      bar('2026-08-19', 100, 89, 100, 88),    // 跌破止跌 90
      bar('2026-08-20', 89, 89, 89, 89),
      bar('2026-08-21', 89, 89, 102, 100),
      bar('2026-08-24', 100, 100, 102, 100),
      bar('2026-08-25', 100, 100, 102, 100),
      bar('2026-08-26', 100, 100, 102, 100),
      bar('2026-08-27', 100, 100, 102, 100),
      bar('2026-08-28', 100, 100, 102, 100),
    ]
    // 止損之後每天價格都在加碼區、%b 也夠低，但沒有新的低檔金叉
    const after = goodAdd({ k: 28, d: 26, kPrev: 27, dPrev: 25 })
    const days: Record<string, RuleDay> = { '2026-08-17': goodAdd(), '2026-08-19': goodAdd() }
    for (const b of stopBars.slice(3)) days[b.date] = after
    const r = run(stopBars, days)
    expect(r.trades.filter((t) => t.side === 'buy' && t.signalD > '2026-08-19')).toHaveLength(0)
  })
})

describe('holdDecider：買進持有對照組', () => {
  const bars = [
    bar('2026-08-17', 100, 100, 100, 100),
    bar('2026-08-18', 100, 110, 110, 100),
    bar('2026-08-19', 110, 120, 120, 110),
  ]

  it('第一天下單、第二天開盤全押，之後什麼都不做', () => {
    const r = simulate(bars, holdDecider(), cfg)
    expect(r.trades).toHaveLength(1)
    expect(r.trades[0]!.fillD).toBe('2026-08-18')
    expect(r.state.cash).toBeLessThan(50_000 / 3)  // 幾乎全部投入
  })

  it('報酬率就是這段期間的漲幅（扣掉買進費用）', () => {
    const r = simulate(bars, holdDecider(), cfg)
    const last = r.equity[r.equity.length - 1]!
    expect(last.retPct).toBeGreaterThan(15)
    expect(last.retPct).toBeLessThan(20)
  })

  it('只有一根 K 棒時買不進去，但不會炸', () => {
    const r = simulate([bars[0]!], holdDecider(), cfg)
    expect(r.trades).toHaveLength(0)
    expect(r.pending).not.toBeNull()
  })
})

describe('決策函式是有狀態的：每次模擬都要重新建一個', () => {
  it('同一份輸入跑兩次，結果完全相同', () => {
    const bars = threeDays(102, 100)
    const days = { '2026-08-17': goodAdd() }
    const a = simulate(bars, ruleDecider(days, 50_000, DEFAULT_RULES), cfg)
    const b = simulate(bars, ruleDecider(days, 50_000, DEFAULT_RULES), cfg)
    expect(a.trades).toEqual(b.trades)
    expect(a.equity).toEqual(b.equity)
  })

  it('不偷看未來：只餵前 i 根的結果，是餵全部時前 i 根的前綴', () => {
    const bars = [
      bar('2026-08-17', 100, 100, 102, 100),
      bar('2026-08-18', 100, 100, 100, 100),
      bar('2026-08-19', 100, 100, 102, 100),
      bar('2026-08-20', 100, 100, 100, 100),
      bar('2026-08-21', 100, 100, 102, 100),
    ]
    const days = Object.fromEntries(bars.map((b) => [b.date, goodAdd()]))
    const full = simulate(bars, ruleDecider(days, 50_000, DEFAULT_RULES), cfg)
    const partial = simulate(bars.slice(0, 3), ruleDecider(days, 50_000, DEFAULT_RULES), cfg)
    expect(partial.equity).toEqual(full.equity.slice(0, 3))
    expect(partial.trades).toEqual(full.trades.filter((t) => t.fillD <= '2026-08-19'))
  })
})
