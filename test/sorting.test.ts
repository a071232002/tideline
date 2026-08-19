import { describe, it, expect } from 'vitest'
import { sortRows, type SortMode } from '../src/lib/sorting'

/**
 * 清單長到十幾檔之後，「有狀態的那幾檔沉在最下面」等於狀態徽章白做。
 * 預設排序要把該注意的浮上來。
 */

type Row = Parameters<typeof sortRows>[0][number]

const row = (code: string, over: Partial<Row> = {}): Row => ({
  code,
  market: 'TW',
  close: 100,
  chg_pct: 0,
  levels: [],
  ...over,
} as Row)

// 收盤 100；止跌 90、加碼 99~101、賣出 110
const L = [
  { kind: 'sell' as const, lo: 110, hi: 111 },
  { kind: 'stop' as const, lo: 90 },
  { kind: 'add' as const, lo: 99, hi: 101 },
]

describe('sortRows：attention（預設）', () => {
  it('已到價位的排在沒事的前面', () => {
    const rows = [
      row('QUIET', { close: 105, levels: L }),   // 什麼都沒碰到
      row('INADD', { close: 100, levels: L }),   // 已進加碼區
    ]
    expect(sortRows(rows, 'attention').map((r) => r.code)).toEqual(['INADD', 'QUIET'])
  })

  it('跌破止跌最優先——那是最需要反應的', () => {
    const rows = [
      row('INADD', { close: 100, levels: L }),
      row('BROKE', { close: 89, levels: L }),
    ]
    expect(sortRows(rows, 'attention')[0]!.code).toBe('BROKE')
  })

  it('同樣是「接近」時，比較近的排前面', () => {
    // 加碼區上緣 101：收 101.5 距離 -0.5%，收 102 距離 -1%
    const rows = [
      row('FAR', { close: 102, levels: L }),
      row('NEAR', { close: 101.5, levels: L }),
    ]
    expect(sortRows(rows, 'attention')[0]!.code).toBe('NEAR')
  })

  it('都沒事的時候維持原本順序，不要亂跳', () => {
    const rows = [
      row('AAA', { close: 105, levels: L }),
      row('BBB', { close: 105, levels: L }),
      row('CCC', { close: 105, levels: L }),
    ]
    expect(sortRows(rows, 'attention').map((r) => r.code)).toEqual(['AAA', 'BBB', 'CCC'])
  })

  it('不會改到傳進來的陣列', () => {
    const rows = [row('B', { close: 105, levels: L }), row('A', { close: 100, levels: L })]
    const before = rows.map((r) => r.code)
    sortRows(rows, 'attention')
    expect(rows.map((r) => r.code)).toEqual(before)
  })
})

describe('sortRows：其他排序', () => {
  it('code：照代號', () => {
    const rows = [row('NVDA'), row('0050'), row('2330')]
    expect(sortRows(rows, 'code').map((r) => r.code)).toEqual(['0050', '2330', 'NVDA'])
  })

  it('change：跌最多的排前面', () => {
    const rows = [row('A', { chg_pct: 1.2 }), row('B', { chg_pct: -3.4 }), row('C', { chg_pct: -0.1 })]
    expect(sortRows(rows, 'change').map((r) => r.code)).toEqual(['B', 'C', 'A'])
  })

  it('沒有漲跌幅的排最後，不要當成 0 插進中間', () => {
    const rows = [row('A', { chg_pct: -1 }), row('NULL', { chg_pct: null }), row('B', { chg_pct: 2 })]
    expect(sortRows(rows, 'change').map((r) => r.code)).toEqual(['A', 'B', 'NULL'])
  })

  it('未知的模式回原樣，不要炸', () => {
    const rows = [row('B'), row('A')]
    expect(sortRows(rows, 'nope' as SortMode).map((r) => r.code)).toEqual(['B', 'A'])
  })
})
