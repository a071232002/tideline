import { describe, it, expect } from 'vitest'
import { summariseDay } from '../src/lib/summary'
import type { WatchRow } from '../src/lib/data'

/**
 * 頁首那一句話。
 *
 * 它要解決的問題是：**有動作的日子跟沒動作的日子，畫面看起來幾乎一樣**。
 * 而規則的在市天數只有三到六成，所以「沒動作」才是常態——一個每天說十一次
 * 「沒事」的介面，人會停止打開它。
 *
 * 這裡釘住的是排序：**已經到價的一定排在接近的前面**。那三種狀態
 * （已跌破止跌／已達賣出區／已進加碼區）的 distancePct 是 null，
 * 照距離排會被整個跳過，而它們正好是最該被看見的。
 */

const row = (code: string, close: number | null, lv: Partial<{
  sell: [number, number]; stop: number; add: [number, number]
}>, pending?: { buy: boolean; sell: boolean }): WatchRow => ({
  symbol_id: code, market: 'TW', code, name: code, currency: 'TWD',
  d: '2026-08-25', close, chg_pct: 0, k: 50, d_val: 50, tone: null,
  levels: [
    ...(lv.sell ? [{ kind: 'sell' as const, lo: lv.sell[0], hi: lv.sell[1] }] : []),
    ...(lv.stop ? [{ kind: 'stop' as const, lo: lv.stop }] : []),
    ...(lv.add ? [{ kind: 'add' as const, lo: lv.add[0], hi: lv.add[1] }] : []),
  ],
  sim: {
    retPct: 0, excessPct: 0, shares: 0, cost: 0, startedOn: '2026-08-19', days: 5,
    aiToday: null, lead: 'rule', ruleRetPct: 0, currency: 'TWD',
    equityTwd: 50000, initialTwd: 50000,
    pending: pending ? { ...pending, triggers: [] } : null,
  },
})

describe('有動作的日子', () => {
  it('一檔要動作 → 講出是哪一檔', () => {
    const s = summariseDay([
      row('2330', 100, { add: [98, 102] }),
      row('0050', 100, { add: [98, 102] }, { buy: true, sell: false }),
    ])
    expect(s.acting).toEqual(['0050'])
    expect(s.headline).toContain('只有 0050')
  })

  it('多檔要動作 → 全部列出來，不要只說「N 檔」', () => {
    const s = summariseDay([
      row('2330', 100, {}, { buy: true, sell: false }),
      row('0050', 100, {}, { buy: false, sell: true }),
    ])
    expect(s.acting).toEqual(['2330', '0050'])
    expect(s.headline).toContain('2330、0050')
  })

  it('pending 存在但不買不賣 → 不算動作', () => {
    // pending 一定會有（它要帶理由），所以不能只看它存不存在
    const s = summariseDay([row('2330', 100, {}, { buy: false, sell: false })])
    expect(s.acting).toEqual([])
  })
})

describe('沒有動作的日子：挑一檔出來看', () => {
  it('**已經到價的排在接近的前面**', () => {
    // 已跌破止跌的 distancePct 是 null；照距離排會把它整個跳過，
    // 而它正好是最該被看見的
    const s = summariseDay([
      row('AAA', 100, { add: [99, 101] }),          // 已進加碼區
      row('BBB', 100, { stop: 80, add: [98, 99] }), // 接近加碼區，距離 -1%
    ])
    expect(s.focus?.code).toBe('AAA')
    expect(s.headline).toContain('已進加碼區')
  })

  it('都只是接近時，挑距離最小的', () => {
    // 兩檔都要落在「接近」的門檻內（status.ts 的 NEAR_PCT = 1.5%），
    // 否則另一檔根本不會有狀態，這條就不是在測排序了。
    // 那個 1.5% 不是隨便訂的：3% 會讓加碼區與賣出區幾乎接起來，
    // 每一列都掛徽章，徽章就不再是訊號。
    const s = summariseDay([
      row('FAR', 100, { sell: [101.4, 105] }),   // +1.4%
      row('NEAR', 100, { sell: [100.5, 105] }),  // +0.5%
    ])
    expect(s.focus?.code).toBe('NEAR')
    expect(s.headline).toMatch(/NEAR/)
    expect(s.headline).toMatch(/[+-]?\d+\.\d%/)
  })

  it('到價的沒有百分比可講，就不要硬印一個括號', () => {
    const s = summariseDay([row('AAA', 100, { add: [99, 101] })])
    expect(s.headline).not.toContain('（）')
    expect(s.headline).not.toMatch(/NaN|Infinity/)
  })
})

describe('什麼都沒有的日子', () => {
  it('要說出**為什麼**沒有——單獨一句「沒有要動作的」讀起來像系統壞了', () => {
    const s = summariseDay([
      row('AAA', 100, {}), row('BBB', 100, {}),
    ])
    expect(s.focus).toBeNull()
    expect(s.headline).toContain('都離價位還遠')
  })

  it('沒有任何標的 → 不要講「0 檔都離價位還遠」', () => {
    const s = summariseDay([])
    expect(s.headline).toBe('今天沒有要動作的')
    expect(s.n).toBe(0)
  })

  it('沒有收盤價的列不會讓它爆掉', () => {
    const s = summariseDay([row('AAA', null, { add: [99, 101] })])
    expect(s.focus).toBeNull()
  })
})
