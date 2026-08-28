import { describe, it, expect } from 'vitest'
import { simulate } from '../src/lib/sim/engine'
import { ruleDecider, type RuleDay } from '../src/lib/sim/rules'
import { DEFAULT_FEES, DEFAULT_RULES } from '../src/lib/sim/params'
import type { Bar } from '../src/lib/types'

/**
 * 每一筆買賣都要說得出理由（PLAN §5 第 3 層：樣板填空，程式產生）。
 *
 * 原本成交紀錄只有 `add` / `stop` 這種內部代號，等於沒有理由——
 * 使用者看到的是「07-29 賣 485 96.95 stop」，那句話裡沒有任何一個字
 * 回答「為什麼賣」。而**沒有動作的日子更需要理由**：三週不動看起來像壞掉。
 *
 * 理由一律由程式用當天算出來的數字填空，**不是 AI 寫的**，
 * 所以每個數字都可以回頭對得上 daily_analysis。
 */

const bar = (date: string, o: number, c: number, h: number, l: number): Bar =>
  ({ date, o, h, l, c, v: 1000 })

const cfg = {
  market: 'TW' as const, isEtf: true, initialCash: 50_000,
  fees: DEFAULT_FEES, actions: [],
}

const day = (over: Partial<RuleDay> = {}): RuleDay => ({
  levels: { add: { lo: 99, hi: 101 }, sell: { lo: 120, hi: 122 }, stop: { price: 90 } },
  pctB: 0.3, k: 26, d: 25, kPrev: 18, dPrev: 26,
  ...over,
})

/**
 * **底倉關掉。** 這一組驗的是加碼與「今天為什麼不動」的理由，
 * 而底倉（2026-08-29.1 起預設 2/3）會在第一個交易日就買一筆——
 * 那會讓「不動作的理由」根本不存在，測試問的問題就消失了。
 * 底倉自己的理由由 sim-rules.test.ts 的「底倉」那一組驗。
 */
const run = (bars: Bar[], days: Record<string, RuleDay>) =>
  simulate(bars, ruleDecider(days, cfg.initialCash,
    { ...DEFAULT_RULES, coreFraction: 0 }), cfg)

describe('成交理由：要有數字，而且對得上當天的分析', () => {
  it('買進：說出加碼區、%b 與 K', () => {
    const bars = [
      bar('2026-08-17', 100, 100, 102, 100),
      bar('2026-08-18', 100, 100, 100, 100),
      bar('2026-08-19', 100, 100, 100, 100),
    ]
    const r = run(bars, { '2026-08-17': day({ pctB: 0.32, k: 26.4 }) })
    const reason = r.trades[0]!.reason!
    expect(reason).toContain('加碼區')
    expect(reason).toContain('101')     // 加碼區上緣
    expect(reason).toContain('0.32')    // %b
    expect(reason).toContain('26.4')    // K
    expect(reason).not.toMatch(/\badd\b/)
  })

  it('減碼：說出觸及的是哪個價位', () => {
    const bars = [
      bar('2026-08-17', 100, 100, 102, 100),
      bar('2026-08-18', 100, 100, 100, 100),
      bar('2026-08-19', 100, 100, 125, 100),
      bar('2026-08-20', 100, 100, 100, 100),
    ]
    const r = run(bars, {
      '2026-08-17': day(),
      '2026-08-19': day({ pctB: 0.8 }),
    })
    const sell = r.trades.find((t) => t.side === 'sell')!
    expect(sell.reason).toContain('賣出區')
    expect(sell.reason).toContain('120')
    expect(sell.reason).toContain('125')   // 當天最高價
  })

  it('止損：說出收盤價與被跌破的價位', () => {
    const bars = [
      bar('2026-08-17', 100, 100, 102, 100),
      bar('2026-08-18', 100, 100, 100, 100),
      bar('2026-08-19', 100, 89, 100, 88),
      bar('2026-08-20', 89, 89, 89, 89),
    ]
    const r = run(bars, { '2026-08-17': day(), '2026-08-19': day() })
    const stop = r.trades.find((t) => t.triggers.includes('stop'))!
    expect(stop.reason).toContain('89')   // 收盤
    expect(stop.reason).toContain('90')   // 止跌價
    expect(stop.reason).toContain('跌破')
  })
})

describe('不動作也要有理由——三週不動看起來像壞掉', () => {
  const bars = [
    bar('2026-08-17', 100, 100, 110, 108),
    bar('2026-08-18', 100, 100, 110, 108),
  ]

  it('K 還沒回低檔 → 說出目前的 K 值與門檻', () => {
    const r = run(bars, { '2026-08-18': day({ k: 57, d: 75, kPrev: 60, dPrev: 74 }) })
    expect(r.pending).not.toBeNull()
    const reason = r.pending!.order.reason!
    expect(reason).toContain('57')
    expect(reason).toContain('30')
  })

  it('回過低檔但還沒金叉 → 說在等金叉', () => {
    const r = run(bars, { '2026-08-18': day({ k: 22, d: 28, kPrev: 20, dPrev: 30 }) })
    expect(r.pending!.order.reason).toContain('黃金交叉')
  })

  it('訊號架起了但價格沒到 → 說在等價格', () => {
    const r = run(bars, { '2026-08-18': day({ k: 26, d: 25, kPrev: 18, dPrev: 26 }) })
    const reason = r.pending!.order.reason!
    expect(reason).toContain('101')      // 加碼區上緣
    expect(reason).toContain('108')      // 當天最低價
  })

  it('不動作的那一天不會產生成交', () => {
    const r = run(bars, { '2026-08-18': day({ k: 57, d: 75, kPrev: 60, dPrev: 74 }) })
    expect(r.trades).toHaveLength(0)
  })

  it('沒有那天的分析資料時不硬掰理由', () => {
    const r = run(bars, {})
    expect(r.pending).toBeNull()
  })
})

describe('明日動作要能直接照做：股數與參考價', () => {
  /**
   * 「明日開盤買進一批」沒有股數也沒有價位，等於還是不能照做。
   *
   * 明天的開盤價當然不知道——所以用**今日收盤**當參考價估算股數，
   * 並且標明它是估算。給一個假裝精確的數字比給估算更糟，
   * 但完全不給數字等於這一行沒有用。
   */
  const bars = [
    bar('2026-08-17', 100, 100, 102, 100),
    bar('2026-08-18', 100, 103, 104, 100),
  ]

  it('買進：用今日收盤估股數與金額', () => {
    const r = run(bars, { '2026-08-18': day({ k: 26, d: 25, kPrev: 18, dPrev: 26 }) })
    const est = r.pending!.estimate!
    expect(est.side).toBe('buy')
    expect(est.refPrice).toBe(103)          // 今日收盤
    // 一批 = 50,000/3 ≈ 16,667；扣手續費後買得起 161 股
    expect(est.qty).toBe(161)
    expect(est.amount).toBeCloseTo(161 * 103, 6)
  })

  it('賣出：用目前持股與比例估股數', () => {
    const seq = [
      bar('2026-08-17', 100, 100, 102, 100),
      bar('2026-08-18', 100, 100, 100, 100),
      bar('2026-08-19', 100, 100, 125, 100),
    ]
    const r = run(seq, { '2026-08-17': day(), '2026-08-19': day({ pctB: 0.8 }) })
    const est = r.pending!.estimate!
    expect(est.side).toBe('sell')
    expect(est.qty).toBe(Math.floor(r.state.shares * DEFAULT_RULES.trimFraction))
  })

  it('不動作時沒有估算，不要生一個數字出來', () => {
    const r = run(bars, { '2026-08-18': day({ k: 57, d: 75, kPrev: 60, dPrev: 74 }) })
    expect(r.pending!.estimate).toBeNull()
  })

  it('現金不夠買一股時估算為 null，而不是 0 股', () => {
    const poor = { ...cfg, initialCash: 50 }
    const r = simulate(bars, ruleDecider(
      { '2026-08-18': day({ k: 26, d: 25, kPrev: 18, dPrev: 26 }) }, 50, DEFAULT_RULES), poor)
    expect(r.pending!.estimate).toBeNull()
  })
})
