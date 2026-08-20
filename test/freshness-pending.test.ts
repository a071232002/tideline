import { describe, it, expect } from 'vitest'
import { marketFreshness } from '../src/lib/freshness'

/**
 * 「今天沒有新的一根 K 棒」其實有**三**種意思，不是兩種：
 *
 *   休市      今天不開盤（週末、國定假日、颱風假）
 *   尚未收盤  今天會開，但我們抓的時候還沒收
 *   未更新    該有卻沒有
 *
 * 第二種原本被我歸進「休市」。實測踩到：08-20 早上 06:05 抓取，
 * 台股 13:30 才收盤，頁面卻說「台股休市」——那天台股照常交易。
 */

const TODAY = '2026-08-20'

describe('marketFreshness：尚未收盤 vs 休市', () => {
  it('台股：早上 06:05 抓的，13:30 還沒到 → 尚未收盤，不是休市', () => {
    const f = marketFreshness('TW', {
      lastOkAt: '2026-08-20T06:05:00+08:00', latestBarDate: '2026-08-19', today: TODAY,
    })
    expect(f.kind).toBe('pending')
    expect(f.message).toContain('尚未收盤')
    expect(f.message).not.toContain('休市')
  })

  it('台股：下午 15:00 抓的，還是拿不到今天 → 那才是休市', () => {
    const f = marketFreshness('TW', {
      lastOkAt: '2026-08-20T15:00:00+08:00', latestBarDate: '2026-08-19', today: TODAY,
    })
    expect(f.kind).toBe('holiday')
  })

  it('台股：拿得到今天的 → 正常', () => {
    const f = marketFreshness('TW', {
      lastOkAt: '2026-08-20T15:00:00+08:00', latestBarDate: TODAY, today: TODAY,
    })
    expect(f.kind).toBe('fresh')
  })

  it('美股：早上 06:05 抓的，昨夜那場已收 → 正常', () => {
    const f = marketFreshness('US', {
      lastOkAt: '2026-08-20T06:05:00+08:00', latestBarDate: '2026-08-19', today: TODAY,
    })
    expect(f.kind).toBe('fresh')
  })

  it('美股：凌晨 03:00 抓的，那場還沒收 → 尚未收盤', () => {
    const f = marketFreshness('US', {
      lastOkAt: '2026-08-20T03:00:00+08:00', latestBarDate: '2026-08-18', today: TODAY,
    })
    expect(f.kind).toBe('pending')
  })

  it('美股：早上 08:00 抓的卻只有前天的 → 休市（例如週一早上拿到上週五）', () => {
    const f = marketFreshness('US', {
      lastOkAt: '2026-08-20T08:00:00+08:00', latestBarDate: '2026-08-14', today: TODAY,
    })
    expect(f.kind).toBe('holiday')
  })

  it('尚未收盤要說出資料是哪一天的，不能只說「還沒」', () => {
    const f = marketFreshness('TW', {
      lastOkAt: '2026-08-20T06:05:00+08:00', latestBarDate: '2026-08-19', today: TODAY,
    })
    expect(f.message).toContain('2026-08-19')
  })

  it('三種狀態的文案兩兩都不一樣', () => {
    const pending = marketFreshness('TW', { lastOkAt: '2026-08-20T06:05:00+08:00', latestBarDate: '2026-08-19', today: TODAY })
    const holiday = marketFreshness('TW', { lastOkAt: '2026-08-20T15:00:00+08:00', latestBarDate: '2026-08-19', today: TODAY })
    const stale = marketFreshness('TW', { lastOkAt: '2026-08-18T07:30:00+08:00', latestBarDate: '2026-08-18', today: TODAY })
    const msgs = [pending.message, holiday.message, stale.message]
    expect(new Set(msgs).size).toBe(3)
  })
})
