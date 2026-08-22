import { describe, it, expect } from 'vitest'
import { extractNumbers, checkNumbers, parseDecision, ACTIONS } from '../src/lib/ai/decide'

/**
 * AI 決策的解析與驗證（PLAN §5、§13.5）。
 *
 * 這一層存在的唯一理由：**AI 只寫關於數字的文字，不寫數字本身。**
 *
 * 動作是固定選項，沒有價格欄也沒有股數欄——沒有欄位可以填數字，
 * 就沒有機會編數字。但 `reason` 是自由文字，模型還是可能在裡面寫出
 * 「布林中軌 102.8」這種我們沒算過的價位，而使用者會照著它下單。
 *
 * 所以每個出現在理由裡的數字都要能對回程式算出來的那組值，對不上就整段退回。
 */

describe('extractNumbers：把文字裡的數字抓出來', () => {
  it('抓得到整數與小數', () => {
    expect(extractNumbers('收盤 103.10 跌破 100')).toEqual(['103.10', '100'])
  })

  it('百分比與正負號都算', () => {
    expect(extractNumbers('%b 回落至 0.55，跌 -1.72%')).toEqual(['0.55', '-1.72'])
  })

  it('日期不是數字——不要把 2026-08-19 拆成三個數字去驗', () => {
    expect(extractNumbers('2026-08-19 收盤 103.10')).toEqual(['103.10'])
  })

  it('千分位逗號要還原成數字', () => {
    expect(extractNumbers('跌破 2,310.00')).toEqual(['2310.00'])
  })

  it('沒有數字就回空陣列', () => {
    expect(extractNumbers('趨勢轉弱，暫時觀望')).toEqual([])
  })
})

describe('checkNumbers：每個數字都要對得回程式算出來的值', () => {
  const allowed = [103.1, 100, 0.55, 44, 58.1, 102.42, 107.5, 108.5]

  it('全部對得上 → 通過', () => {
    const r = checkNumbers('收盤 103.10 接近中軌 102.42，K 44 低於 D 58.1', allowed)
    expect(r.ok).toBe(true)
    expect(r.unknown).toEqual([])
  })

  it('編出一個我們沒算過的價位 → 擋下來，並指出是哪一個', () => {
    const r = checkNumbers('布林中軌 102.8 附近有支撐', allowed)
    expect(r.ok).toBe(false)
    expect(r.unknown).toEqual(['102.8'])
  })

  it('位數不同但值相同 → 算對得上（103.1 vs 103.10）', () => {
    expect(checkNumbers('收盤 103.1', allowed).ok).toBe(true)
    expect(checkNumbers('收盤 103.100', allowed).ok).toBe(true)
  })

  it('四捨五入到它寫的位數就算對得上（58.1 寫成 58）', () => {
    expect(checkNumbers('D 大約 58', allowed).ok).toBe(true)
  })

  it('差一點點就是不一樣——103.2 不能當成 103.1', () => {
    expect(checkNumbers('收盤 103.2', allowed).ok).toBe(false)
  })

  it('一次列出所有對不上的數字，不是遇到第一個就停', () => {
    const r = checkNumbers('中軌 102.8、上軌 109.9', allowed)
    expect(r.unknown).toEqual(['102.8', '109.9'])
  })

  it('沒有數字的理由一定通過', () => {
    expect(checkNumbers('趨勢轉弱，暫時觀望', allowed).ok).toBe(true)
  })
})

describe('parseDecision：只接受受限選單', () => {
  const allowed = [103.1, 44, 58.1]
  const ok = (over: Record<string, unknown> = {}) => JSON.stringify({
    action: 'hold', confidence: 'med', agree_with_rule: true,
    reason: 'K 44 仍低於 D 58.1，等轉強再說', ...over,
  })

  it('乾淨的 JSON 解析得出來', () => {
    const r = parseDecision(ok(), allowed)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.decision.action).toBe('hold')
      expect(r.decision.confidence).toBe('med')
      expect(r.decision.agreeWithRule).toBe(true)
    }
  })

  it('包在 ```json 圍欄裡也讀得出來——模型很常這樣回', () => {
    const r = parseDecision('好的：\n```json\n' + ok() + '\n```\n', allowed)
    expect(r.ok).toBe(true)
  })

  it('不在選單裡的動作 → 退回', () => {
    const r = parseDecision(ok({ action: 'buy_37' }), allowed)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('action')
  })

  it('選單裡的每一個動作都要能通過', () => {
    for (const a of ACTIONS) {
      expect(parseDecision(ok({ action: a }), allowed).ok).toBe(true)
    }
  })

  it('理由裡編了數字 → 整段退回（§5 的驗證器）', () => {
    const r = parseDecision(ok({ reason: '中軌 102.8 有支撐' }), allowed)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('102.8')
  })

  it('多回了價格或股數欄位 → 退回。AI 不准產生數字', () => {
    const r = parseDecision(ok({ price: 103.5 }), allowed)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('price')
  })

  it('股數欄位同樣不准', () => {
    expect(parseDecision(ok({ qty: 100 }), allowed).ok).toBe(false)
  })

  it('不是 JSON → 退回，不要硬猜', () => {
    expect(parseDecision('我覺得可以買一點', allowed).ok).toBe(false)
  })

  it('缺 reason → 退回。沒有理由的決策等於沒有決策', () => {
    const r = parseDecision(JSON.stringify({ action: 'hold', confidence: 'low' }), allowed)
    expect(r.ok).toBe(false)
  })

  it('理由太長 → 退回。一句話就是一句話', () => {
    const r = parseDecision(ok({ reason: '因為'.repeat(120) }), allowed)
    expect(r.ok).toBe(false)
  })

  it('confidence 不在選單裡 → 退回', () => {
    expect(parseDecision(ok({ confidence: '很高' }), allowed).ok).toBe(false)
  })
})

describe('extractNumbers：千分位只有三位一組才算', () => {
  it('KD(9,3,3) 是三個數字，不是 933', () => {
    // 用 [\d,]* 抓數字會把它併成 933，驗證器就對著一個不存在的數字報警。
    // 這是 test/ai-prompt.test.ts 的屬性測試抓到的。
    expect(extractNumbers('KD(9,3,3) 的 K 值')).toEqual(['9', '3', '3'])
  })

  it('2,310.00 仍然是一個數字', () => {
    expect(extractNumbers('跌破 2,310.00')).toEqual(['2310.00'])
  })

  it('1,234,567 也是一個', () => {
    expect(extractNumbers('市值 1,234,567 元')).toEqual(['1234567'])
  })

  it('布林 20,2σ 是兩個數字', () => {
    expect(extractNumbers('布林通道（20,2σ）')).toEqual(['20', '2'])
  })
})
