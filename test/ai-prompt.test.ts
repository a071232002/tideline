import { describe, it, expect } from 'vitest'
import { buildPrompt, allowedNumbers, type AiFacts } from '../src/lib/ai/prompt'
import { checkNumbers, ACTIONS } from '../src/lib/ai/decide'

/**
 * 給 AI 的事實包（PLAN §13.5）。
 *
 * 最重要的一條不變量：**prompt 裡出現的每個數字，都要在 allowed 裡。**
 *
 * 少了這條，模型引用我們自己餵給它的數字，卻被驗證器擋下來——
 * 那不是模型的錯，是我們自己前後不一致，而且會表現成「AI 天天失敗」
 * 這種很難查的症狀。
 */

const facts: AiFacts = {
  code: '0050', name: '元大台灣50', market: 'TW', currency: 'TWD', date: '2026-08-19',
  close: 103.1, chg: -1.8, chgPct: -1.72, o: 103.05, h: 103.85, l: 102.7,
  k: 57, d: 75, pctB: 0.55, bandwidth: 0.142,
  bbUp: 109.72, bbMid: 102.42, bbLo: 95.13, ma60: 104.16,
  levels: {
    sell: { lo: 107.5, hi: 108.5 },
    stop: 100,
    add: { lo: 101.5, hi: 102.5 },
  },
  levelWhy: { sell: '前波高', stop: '整數關卡', add: '布林中軌附近' },
  recentCloses: [101.2, 102.4, 103.9, 104.65, 103.1],
  position: { shares: 0, cash: 64661, cost: 0, equity: 64661, retPct: 29.32 },
  ruleAction: { verb: '不動作', reason: 'K 57.0 還沒回到 30 以下' },
}

describe('allowedNumbers：驗證器認得的那組值', () => {
  it('prompt 裡的每個數字都在 allowed 裡——否則模型引用我們給的數字會被自己擋掉', () => {
    const r = checkNumbers(buildPrompt(facts), allowedNumbers(facts))
    expect(r.unknown).toEqual([])
  })

  it('沒有持股、沒有規則動作時也成立', () => {
    const bare: AiFacts = {
      ...facts,
      levels: { add: { lo: 101.5, hi: 102.5 } },
      levelWhy: {},
      ruleAction: null,
      recentCloses: [],
    }
    expect(checkNumbers(buildPrompt(bare), allowedNumbers(bare)).unknown).toEqual([])
  })

  it('關鍵數值都收進來了', () => {
    const a = allowedNumbers(facts)
    for (const v of [103.1, 57, 75, 0.55, 107.5, 100, 101.5, 104.16]) {
      expect(a).toContain(v)
    }
  })

  it('沒算過的數字不會混進來', () => {
    expect(allowedNumbers(facts)).not.toContain(102.8)
  })
})

describe('buildPrompt：受限選單與硬約束要寫清楚', () => {
  const p = buildPrompt(facts)

  it('列出全部七個動作', () => {
    for (const a of ACTIONS) expect(p).toContain(a)
  })

  it('明講不准填價格與股數', () => {
    expect(p).toMatch(/不要.*(價格|股數)|不得.*(價格|股數)/)
  })

  it('明講沒有強制進場、也沒有強制停損', () => {
    expect(p).toContain('不強制')
  })

  it('把規則帳戶今天打算做什麼一起給它——它要能選擇不同意', () => {
    expect(p).toContain('不動作')
    expect(p).toContain('agree_with_rule')
  })

  it('目前部位與現金要在裡面，否則它算不出自己能買多少', () => {
    expect(p).toContain('64661')
  })

  it('理由的長度上限要說出來', () => {
    expect(p).toMatch(/120/)
  })
})
