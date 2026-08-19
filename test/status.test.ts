import { describe, it, expect } from 'vitest'
import { levelStatus } from '../src/lib/status'

/**
 * 掃清單時最想知道的不是數字，是「今天這檔要不要動」。
 * 這支把收盤價與三個價位的關係壓成一個狀態，清單與個股頁共用同一份判斷，
 * 兩邊才不會說出不一樣的話。
 */

const L = { sell: { lo: 107.5, hi: 108.5 }, stop: 100, add: { lo: 101.5, hi: 102.5 } }

describe('levelStatus', () => {
  it('收盤在加碼區內 → 已進加碼區', () => {
    const s = levelStatus(102.0, L)
    expect(s.kind).toBe('in-add')
    expect(s.tone).toBe('buy')
  })

  it('收盤觸及賣出區下緣 → 已達賣出區', () => {
    expect(levelStatus(107.5, L).kind).toBe('in-sell')
    expect(levelStatus(109.0, L).kind).toBe('in-sell')
  })

  it('收盤跌破止跌 → 已跌破止跌', () => {
    const s = levelStatus(99.8, L)
    expect(s.kind).toBe('below-stop')
    expect(s.tone).toBe('sell')
  })

  it('剛好等於止跌價不算跌破——要「收盤跌破」才算', () => {
    expect(levelStatus(100, L).kind).not.toBe('below-stop')
  })

  it('接近但還沒到 → 標成接近，並帶距離', () => {
    const s = levelStatus(103.1, L) // 離加碼區上緣 102.5 約 -0.6%
    expect(s.kind).toBe('near-add')
    expect(s.distancePct).not.toBeNull()
    expect(Math.abs(s.distancePct!)).toBeLessThan(1.5)
  })

  it('離所有價位都遠 → 沒有狀態，不要硬給一個', () => {
    // 105.0 離加碼區上緣 +2.4%、離賣出區下緣 −2.4%，兩邊都超過門檻
    expect(levelStatus(105.0, L).kind).toBe('none')
  })

  it('門檻要窄到留得住「今天沒事」這個狀態', () => {
    // 這組價位很密（加碼上緣 102.5、賣出下緣 107.5，相差不到 5%）。
    // 若門檻放到 3%，兩段會接起來、中間沒有 none，徽章就失去意義。
    const gap = [104.5, 105.0, 105.5]
    for (const c of gap) expect(levelStatus(c, L).kind, `收盤 ${c}`).toBe('none')
  })

  it('價位不完整時不會炸', () => {
    expect(levelStatus(100, { sell: null, stop: null, add: undefined }).kind).toBe('none')
    expect(levelStatus(null, L).kind).toBe('none')
  })

  it('優先序：同時符合時，跌破止跌最優先（那是最需要反應的）', () => {
    // 造一個止跌高於加碼區的怪組合
    const weird = { sell: { lo: 120, hi: 121 }, stop: 103, add: { lo: 101, hi: 104 } }
    expect(levelStatus(102, weird).kind).toBe('below-stop')
  })
})
