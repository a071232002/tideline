import { describe, it, expect } from 'vitest'
import { dataFreshness, taipeiToday } from '../src/lib/freshness'

/**
 * PLAN §7：「今天沒有新的一根 K 棒」有兩種完全不同的意思，頁面上不能混為一談。
 * 判斷方式不要自己維護假日表（台股有颱風假），改成**用結果反推**：
 * 抓回來的最後一根 K 棒不是今天、但當天有成功紀錄 → 休市；
 * 當天沒有成功紀錄 → 故障。
 */

const TODAY = '2026-08-19'

describe('dataFreshness', () => {
  it('今天跑成功、而且有今天的 K 棒 → 正常', () => {
    const f = dataFreshness({
      lastOkAt: '2026-08-19T07:32:00+08:00', latestBarDate: TODAY, today: TODAY,
    })
    expect(f.kind).toBe('fresh')
  })

  it('今天跑成功、但最後一根 K 棒是昨天 → 休市，不是故障', () => {
    const f = dataFreshness({
      lastOkAt: '2026-08-19T07:32:00+08:00', latestBarDate: '2026-08-18', today: TODAY,
    })
    expect(f.kind).toBe('holiday')
    expect(f.message).toContain('休市')
    expect(f.message).toContain('2026-08-18')
  })

  it('今天沒有成功紀錄 → 資料未更新，而且要說出最後成功時間', () => {
    const f = dataFreshness({
      lastOkAt: '2026-08-18T07:30:00+08:00', latestBarDate: '2026-08-18', today: TODAY,
    })
    expect(f.kind).toBe('stale')
    expect(f.message).toContain('未更新')
    expect(f.message).toContain('08-18')
  })

  it('從來沒成功過 → 也是未更新，不能假裝正常', () => {
    const f = dataFreshness({ lastOkAt: null, latestBarDate: null, today: TODAY })
    expect(f.kind).toBe('stale')
  })

  it('休市與未更新的文案必須不一樣——混為一談會讓人以為系統壞了', () => {
    const holiday = dataFreshness({
      lastOkAt: '2026-08-19T07:32:00+08:00', latestBarDate: '2026-08-18', today: TODAY,
    })
    const stale = dataFreshness({
      lastOkAt: '2026-08-18T07:30:00+08:00', latestBarDate: '2026-08-18', today: TODAY,
    })
    expect(holiday.message).not.toBe(stale.message)
    expect(holiday.tone).not.toBe(stale.tone)
  })
})

describe('taipeiToday', () => {
  it('用台北時區切日，不是 UTC', () => {
    // UTC 2026-08-18 17:00 → 台北已經是 08-19 01:00
    expect(taipeiToday(new Date('2026-08-18T17:00:00Z'))).toBe('2026-08-19')
    // UTC 2026-08-18 15:59 → 台北仍是 08-18 23:59
    expect(taipeiToday(new Date('2026-08-18T15:59:00Z'))).toBe('2026-08-18')
  })
})
