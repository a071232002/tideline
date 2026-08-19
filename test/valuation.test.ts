import { describe, it, expect } from 'vitest'
import { parseTwseValuation, parseYahooValuation } from '../src/lib/sources/valuation'

/**
 * 估值（本益比／殖利率／股價淨值比）是**獨立資訊**，不參與 §4 的價位計算。
 * 它回答的是「現在貴不貴」，價位回答的是「現在在哪裡」——兩套邏輯混在一起，
 * 出錯時分不出是哪一邊錯。
 */

describe('parseTwseValuation', () => {
  const OK = {
    stat: 'OK',
    fields: ['日期', '殖利率(%)', '股利年度', '本益比', '股價淨值比', '財報年/季'],
    data: [
      ['115/08/18', '0.95', '114', '27.30', '9.50', '115/2'],
      ['115/08/19', '0.94', '114', '27.24', '9.47', '115/2'],
    ],
  }

  it('取最後一筆，民國年轉西元', () => {
    const v = parseTwseValuation(OK)!
    expect(v.date).toBe('2026-08-19')
    expect(v.pe).toBeCloseTo(27.24, 2)
    expect(v.pb).toBeCloseTo(9.47, 2)
    expect(v.dividendYield).toBeCloseTo(0.94, 2)
  })

  it('ETF 沒有本益比——回 null，不要填 0', () => {
    expect(parseTwseValuation({ stat: '很抱歉，沒有符合條件的資料!', total: 0 })).toBeNull()
  })

  it('欄位是 `-` 時該欄為 null，不是 0', () => {
    const v = parseTwseValuation({
      ...OK,
      data: [['115/08/19', '-', '114', '-', '9.47', '115/2']],
    })!
    expect(v.pe).toBeNull()
    expect(v.dividendYield).toBeNull()
    expect(v.pb).toBeCloseTo(9.47, 2)
  })

  it('虧損公司的本益比會是 0 或負——當成沒有意義', () => {
    const v = parseTwseValuation({ ...OK, data: [['115/08/19', '0', '114', '0.00', '3.2', '115/2']] })!
    expect(v.pe).toBeNull()
  })
})

describe('parseYahooValuation', () => {
  const OK = {
    quoteSummary: {
      result: [{
        summaryDetail: {
          trailingPE: { raw: 33.54594 },
          forwardPE: { raw: 17.068346 },
          dividendYield: { raw: 0.0046 },
        },
        defaultKeyStatistics: { priceToBook: { raw: 27.144361 } },
      }],
    },
  }

  it('抓 trailing 本益比與股價淨值比', () => {
    const v = parseYahooValuation(OK)!
    expect(v.pe).toBeCloseTo(33.55, 1)
    expect(v.forwardPe).toBeCloseTo(17.07, 1)
    expect(v.pb).toBeCloseTo(27.14, 1)
  })

  it('殖利率 Yahoo 給的是小數，要轉成百分比', () => {
    // 0.0046 是 0.46%，不是 0.0046%
    expect(parseYahooValuation(OK)!.dividendYield).toBeCloseTo(0.46, 2)
  })

  it('沒有配息的公司 → 殖利率 null，不是 0', () => {
    const v = parseYahooValuation({
      quoteSummary: { result: [{ summaryDetail: { trailingPE: { raw: 50 } }, defaultKeyStatistics: {} }] },
    })!
    expect(v.dividendYield).toBeNull()
    expect(v.pb).toBeNull()
  })

  it('查不到就回 null，不要湊出一個空物件', () => {
    expect(parseYahooValuation({ quoteSummary: { result: [] } })).toBeNull()
    expect(parseYahooValuation({ finance: { error: { description: 'x' } } })).toBeNull()
  })

  it('虧損公司沒有 trailing 本益比 → pe null，但 forward 可能還在', () => {
    const v = parseYahooValuation({
      quoteSummary: { result: [{ summaryDetail: { forwardPE: { raw: 40 } }, defaultKeyStatistics: {} }] },
    })!
    expect(v.pe).toBeNull()
    expect(v.forwardPe).toBeCloseTo(40, 1)
  })
})
