import { describe, it, expect } from 'vitest'
import { marketFreshness, expectedBarDate } from '../src/lib/freshness'

/**
 * 台股與美股不能共用一個「資料日期」。
 *
 * 台北時間的今天，台股看的是**今天**的收盤；美股看的是**昨夜**那一場
 * （美股 16:00 ET 收盤 = 台北隔日 04:00/05:00）。兩個市場擠在同一個
 * 時間戳上，會讓人以為兩邊是同一場交易。
 */

describe('expectedBarDate：台北的今天對應到各市場的哪一天', () => {
  it('台股就是台北的今天', () => {
    expect(expectedBarDate('TW', '2026-08-19')).toBe('2026-08-19')
  })

  it('美股是台北的前一天——昨夜收盤那一場', () => {
    expect(expectedBarDate('US', '2026-08-19')).toBe('2026-08-18')
  })

  it('跨月要正確', () => {
    expect(expectedBarDate('US', '2026-09-01')).toBe('2026-08-31')
  })

  it('跨年要正確', () => {
    expect(expectedBarDate('US', '2026-01-01')).toBe('2025-12-31')
  })
})

const OK_TODAY = '2026-08-19T07:32:00+08:00'

describe('marketFreshness', () => {
  it('台股：今天跑過且有今天的 K 棒 → 正常', () => {
    const f = marketFreshness('TW', {
      lastOkAt: OK_TODAY, latestBarDate: '2026-08-19', today: '2026-08-19',
    })
    expect(f.kind).toBe('fresh')
    expect(f.label).toBe('台股')
  })

  it('美股：今天跑過且有昨天的 K 棒 → 正常（那就是昨夜收盤）', () => {
    const f = marketFreshness('US', {
      lastOkAt: OK_TODAY, latestBarDate: '2026-08-18', today: '2026-08-19',
    })
    expect(f.kind).toBe('fresh')
  })

  it('美股：拿到的是今天的日期反而不對——那場還沒收', () => {
    const f = marketFreshness('US', {
      lastOkAt: OK_TODAY, latestBarDate: '2026-08-19', today: '2026-08-19',
    })
    expect(f.kind).not.toBe('fresh')
  })

  it('台股：收盤後跑過卻只有昨天的 K 棒 → 休市', () => {
    // 抓取時間必須在 13:30 之後。早上抓的拿不到當天資料是理所當然的，
    // 那是「尚未收盤」不是「休市」——見 freshness-pending.test.ts
    const f = marketFreshness('TW', {
      lastOkAt: '2026-08-19T15:00:00+08:00', latestBarDate: '2026-08-18', today: '2026-08-19',
    })
    expect(f.kind).toBe('holiday')
  })

  it('沒跑過 → 未更新，兩個市場都一樣', () => {
    for (const m of ['TW', 'US'] as const) {
      const f = marketFreshness(m, {
        lastOkAt: '2026-08-17T07:30:00+08:00', latestBarDate: '2026-08-17', today: '2026-08-19',
      })
      expect(f.kind).toBe('stale')
    }
  })

  it('同一次排程下，兩個市場可以有不同狀態', () => {
    const tw = marketFreshness('TW', {
      lastOkAt: OK_TODAY, latestBarDate: '2026-08-19', today: '2026-08-19',
    })
    const us = marketFreshness('US', {
      lastOkAt: OK_TODAY, latestBarDate: '2026-08-14', today: '2026-08-19',
    })
    expect(tw.kind).toBe('fresh')
    expect(us.kind).toBe('holiday')  // 07:32 已過美股 06:00 基準，所以是休市不是尚未收盤
  })

  it('文案要帶市場名稱，不然兩行看起來一模一樣', () => {
    const tw = marketFreshness('TW', { lastOkAt: OK_TODAY, latestBarDate: '2026-08-19', today: '2026-08-19' })
    const us = marketFreshness('US', { lastOkAt: OK_TODAY, latestBarDate: '2026-08-18', today: '2026-08-19' })
    expect(tw.message).toContain('台股')
    expect(us.message).toContain('美股')
    expect(tw.message).not.toBe(us.message)
  })
})
