import { describe, it, expect } from 'vitest'
import { fingerprintOf, logRowsFor } from '../src/lib/sim/trade-log'
import { simulate } from '../src/lib/sim/engine'
import { holdDecider, ruleDecider as ruleDecider2, type RuleDay } from '../src/lib/sim/rules'
import { DEFAULT_FEES, DEFAULT_RULES as DEFAULT_RULES2 } from '../src/lib/sim/params'

const bar2 = (date: string, c: number) => ({ date, o: c, h: c, l: c, c, v: 1000 })
const cfg2 = {
  market: 'TW' as const, isEtf: true, initialCash: 50_000,
  fees: DEFAULT_FEES, actions: [],
}
const day2 = (): RuleDay => ({
  levels: { add: { lo: 99, hi: 101 }, sell: { lo: 120, hi: 122 }, stop: { price: 90 } },
  pctB: 0.9, k: 85, d: 84, kPrev: 84, dPrev: 85,
})

/**
 * 買賣要有歷程，而且每一筆要有判斷理由。
 *
 * `sim_trades` 是推導的：每次重建先刪光再寫回去，所以它**不是紀錄，
 * 是重算的結果**。實測 2026-08-29（週六，沒有開市）：改完 coreFraction
 * 重建之後，週五憑空多出三筆成交，而那一天實際上什麼都沒發生過——
 * 畫面上那兩者長得一模一樣。
 *
 * 這一層補上「系統在什麼時候、用哪一組參數、算出了什麼」。
 */

const trade = (over: Partial<Parameters<typeof logRowsFor>[1][number]> = {}) => ({
  signalD: '2026-08-27', fillD: '2026-08-28', side: 'buy' as const,
  qty: 310, price: 107.5, fee: 47, tax: 0,
  triggers: ['core'], decidedBy: 'rule' as const,
  reason: '建立底倉 67%', costBasis: null, confidence: undefined,
  overrodeStop: undefined,
  ...over,
})

describe('fingerprintOf', () => {
  it('同樣的成交給同樣的指紋——重建每天都跑，一樣就不該重記', () => {
    expect(fingerprintOf(trade())).toBe(fingerprintOf(trade()))
  })

  it('**股數變了就是不同的一筆**', () => {
    expect(fingerprintOf(trade({ qty: 311 }))).not.toBe(fingerprintOf(trade()))
  })

  it('價格變了也是', () => {
    expect(fingerprintOf(trade({ price: 107.6 }))).not.toBe(fingerprintOf(trade()))
  })

  it('觸發原因變了也是——同樣的股數可能是完全不同的決定', () => {
    // 「底倉」與「跌破止跌全部出清」可能剛好同股數，但那是兩件事
    expect(fingerprintOf(trade({ triggers: ['stop'] }))).not.toBe(fingerprintOf(trade()))
  })

  it('觸發原因的順序不算差異', () => {
    expect(fingerprintOf(trade({ triggers: ['sell_zone', 'add'] })))
      .toBe(fingerprintOf(trade({ triggers: ['add', 'sell_zone'] })))
  })
})

describe('logRowsFor', () => {
  it('帶上參數版本——少了它，看到兩列不同也不知道為什麼', () => {
    const rows = logRowsFor('acc-1', [trade()], '2026-08-29.1')
    expect(rows[0]!.params_version).toBe('2026-08-29.1')
    expect(rows[0]!.account_id).toBe('acc-1')
  })

  it('**每一筆都要有理由**——沒有理由的成交紀錄等於沒有紀錄', () => {
    const rows = logRowsFor('acc-1', [trade({ reason: undefined })], 'v')
    expect(rows[0]!.reason).toBeTruthy()
    // 講不出來就要說「講不出來」，不要留一個 null 讓人以為畫面壞了
    expect(rows[0]!.reason).toContain('沒有記錄')
  })

  it('理由原封不動帶過去', () => {
    const rows = logRowsFor('acc-1', [trade()], 'v')
    expect(rows[0]!.reason).toBe('建立底倉 67%')
  })

  it('空的成交清單給空陣列，不要生一列出來', () => {
    expect(logRowsFor('acc-1', [], 'v')).toEqual([])
  })
})

describe('每一筆買賣都要有判斷理由', () => {
  /**
   * 沒有理由的成交紀錄等於沒有紀錄：三個月後回頭看「08-20 買 21 股」，
   * 那句話裡沒有任何一個字回答「為什麼買」。
   *
   * 實測 2026-08-29：買進持有那條軌道的第一筆從來沒有理由——它是對照組，
   * 所以沒人替它想過這件事。但它照樣會出現在畫面的成交清單裡。
   */
  it('買了不動的第一筆也要說出它為什麼買', () => {
    const r = simulate(
      [bar2('2026-08-17', 100), bar2('2026-08-18', 100)], holdDecider(), cfg2)
    expect(r.trades).toHaveLength(1)
    expect(r.trades[0]!.reason).toBeTruthy()
    expect(r.trades[0]!.reason).toContain('對照組')
  })

  it('規則軌的底倉也有', () => {
    const r = simulate([bar2('2026-08-17', 100), bar2('2026-08-18', 100)],
      ruleDecider2({ '2026-08-17': day2() }, cfg2.initialCash, DEFAULT_RULES2), cfg2)
    expect(r.trades[0]!.reason).toContain('底倉')
  })
})
