import { describe, it, expect } from 'vitest'
import { dropUnfinishedSession } from '../src/lib/sources/yahoo'

/**
 * Yahoo 在盤中就會給出「今天」那一根 K 棒，但它還沒收盤——
 * 收盤價其實是當下報價，高低價也只到現在為止。
 *
 * 把它當成收盤存進去，會讓當天的 KD、布林、均線全部是錯的，
 * 而且錯得很像對的：數字合理、沒有任何錯誤訊息。
 */

const bar = (date: string) => ({ date, o: 1, h: 2, l: 0.5, c: 1.5, v: 100 })

describe('dropUnfinishedSession', () => {
  it('盤中：最後一根與正在進行的交易日同一天 → 丟掉', () => {
    const bars = [bar('2026-08-18'), bar('2026-08-19')]
    const out = dropUnfinishedSession(bars, {
      // 現在是這一場的中途
      marketTime: Date.parse('2026-08-19T15:36:00Z') / 1000,
      sessionStart: Date.parse('2026-08-19T13:30:00Z') / 1000,
      sessionEnd: Date.parse('2026-08-19T20:00:00Z') / 1000,
    })
    expect(out.map((b) => b.date)).toEqual(['2026-08-18'])
  })

  it('已收盤：最後一根留著', () => {
    const bars = [bar('2026-08-18'), bar('2026-08-19')]
    const out = dropUnfinishedSession(bars, {
      marketTime: Date.parse('2026-08-19T20:00:00Z') / 1000,
      sessionStart: Date.parse('2026-08-19T13:30:00Z') / 1000,
      sessionEnd: Date.parse('2026-08-19T20:00:00Z') / 1000,
    })
    expect(out.map((b) => b.date)).toEqual(['2026-08-18', '2026-08-19'])
  })

  it('最後一根不是今天（例如週末）→ 不動它', () => {
    const bars = [bar('2026-08-14')]
    const out = dropUnfinishedSession(bars, {
      marketTime: Date.parse('2026-08-15T15:00:00Z') / 1000,
      sessionStart: Date.parse('2026-08-15T13:30:00Z') / 1000,
      sessionEnd: Date.parse('2026-08-15T20:00:00Z') / 1000,
    })
    expect(out).toHaveLength(1)
  })

  it('盤前：這一場還沒開始，上一場已經收完 → 不能丟', () => {
    // 台北 18:38 = 美東 06:38，08-20 那場 09:30 ET 才開盤。
    // regularMarketTime 仍指向 08-19 收盤（已完成），
    // 但 currentTradingPeriod 已經換成 08-20。拿前者的日期去比對就會
    // 誤刪 08-19 那根完整的 K 棒——實測踩過，美股整個退回 08-18。
    const bars = [bar('2026-08-18'), bar('2026-08-19')]
    const out = dropUnfinishedSession(bars, {
      marketTime: Date.parse('2026-08-19T20:00:00Z') / 1000,   // 08-19 收盤
      sessionStart: Date.parse('2026-08-20T13:30:00Z') / 1000, // 08-20 開盤（未到）
      sessionEnd: Date.parse('2026-08-20T20:00:00Z') / 1000,
    })
    expect(out.map((b) => b.date)).toEqual(['2026-08-18', '2026-08-19'])
  })

  it('沒有時段資訊時保守起見不丟——寧可多一根也不要無聲刪資料', () => {
    const bars = [bar('2026-08-18'), bar('2026-08-19')]
    expect(dropUnfinishedSession(bars, {})).toHaveLength(2)
    expect(dropUnfinishedSession(bars, { marketTime: 123 })).toHaveLength(2)
  })

  it('空陣列不會炸', () => {
    expect(dropUnfinishedSession([], { marketTime: 1, sessionStart: 0, sessionEnd: 2 })).toEqual([])
  })
})
