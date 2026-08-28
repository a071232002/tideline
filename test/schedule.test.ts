import { describe, it, expect } from 'vitest'
import {
  INGEST_TIMES, lastScheduledIngest, freshSince, ingestOverdue,
  SCHEDULE_SLACK_MS,
} from '../src/lib/schedule'

/**
 * 排程時點是**兩支程式共用的一條線**：AI 用它決定「今天的抓取來了沒」，
 * 健檢用它決定「現在該不該喊沒跑」。兩邊各寫一套的話，遲早會有一邊
 * 對另一邊的假設過期而沒人發現。
 *
 * 這裡守的都是真的踩過或差一點踩到的邊界。
 */

const tp = (s: string) => new Date(`${s}+08:00`)

describe('排程時點', () => {
  it('跟 vercel.json 對得起來：一天兩次', () => {
    expect(INGEST_TIMES).toEqual(['07:30', '14:30'])
  })

  it('早上那輪之後 → 上一個時點是今天 07:30', () => {
    expect(lastScheduledIngest(tp('2026-08-29T07:40:00')).toISOString())
      .toBe(tp('2026-08-29T07:30:00').toISOString())
  })

  it('下午那輪之後 → 上一個時點是今天 14:30', () => {
    expect(lastScheduledIngest(tp('2026-08-29T14:40:00')).toISOString())
      .toBe(tp('2026-08-29T14:30:00').toISOString())
  })

  it('**午夜到早上七點半之間 → 上一個時點是昨天下午**', () => {
    // 這一段每天都會經過。少了它，健檢在凌晨零點六分就喊「今天沒有抓取」
    // ——而正確答案是「今天還沒到時間」。實測 2026-08-29 00:06 就是這樣。
    expect(lastScheduledIngest(tp('2026-08-29T00:06:00')).toISOString())
      .toBe(tp('2026-08-28T14:30:00').toISOString())
  })

  it('剛好卡在時點上算今天的', () => {
    expect(lastScheduledIngest(tp('2026-08-29T07:30:00')).toISOString())
      .toBe(tp('2026-08-29T07:30:00').toISOString())
  })

  it('差一秒就還是上一個', () => {
    expect(lastScheduledIngest(tp('2026-08-29T07:29:59')).toISOString())
      .toBe(tp('2026-08-28T14:30:00').toISOString())
  })
})

describe('AI 要等的那條線', () => {
  it('**下午那輪要等下午的抓取，不是等今天零點以後的任何一輪**', () => {
    // 原本的界線是「今天台北 00:00」，於是 14:35 的 AI 只要看到早上
    // 07:58 那輪就放行——而早上台股還沒收盤，最新 K 棒是昨天的。
    // 結果是「已有紀錄」全部跳過，當天的台股判斷整天不會產生。
    const since = freshSince(tp('2026-08-29T14:35:00'))
    expect(since.getTime()).toBeGreaterThan(tp('2026-08-29T08:00:00').getTime())
  })

  it('要扣掉寬限——cron 可能**早跑**', () => {
    // 實測 2026-08-28：排 14:30 的那輪 14:28 就開始了。用 14:30 當硬界線
    // 會把一輪剛跑完的抓取判成「還沒來」，然後白等 45 分鐘再說資料是舊的。
    const since = freshSince(tp('2026-08-29T14:35:00'))
    expect(since.getTime()).toBe(tp('2026-08-29T14:30:00').getTime() - SCHEDULE_SLACK_MS)
  })

  it('早上那輪等的是早上的時點', () => {
    expect(freshSince(tp('2026-08-29T07:35:00')).getTime())
      .toBe(tp('2026-08-29T07:30:00').getTime() - SCHEDULE_SLACK_MS)
  })
})

describe('健檢該不該喊「沒跑」', () => {
  const at = (now: string, last: string | null) =>
    ingestOverdue(tp(now), last === null ? null : tp(last)).overdue

  it('**凌晨零點六分不算沒跑**——上一個時點是昨天下午，而昨天下午跑過了', () => {
    expect(at('2026-08-29T00:06:00', '2026-08-28T14:29:00')).toBe(false)
  })

  it('早上八點也還不算——Hobby 的 cron 只保證在那個小時內觸發', () => {
    expect(at('2026-08-29T08:00:00', '2026-08-28T14:29:00')).toBe(false)
  })

  it('早上九點還沒來 → 這才是真的沒跑', () => {
    expect(at('2026-08-29T09:00:00', '2026-08-28T14:29:00')).toBe(true)
  })

  it('跑過了就不要喊', () => {
    expect(at('2026-08-29T09:00:00', '2026-08-29T07:58:00')).toBe(false)
  })

  it('一次都沒跑過 → 喊', () => {
    expect(at('2026-08-29T09:00:00', null)).toBe(true)
  })

  it('早跑兩分鐘的那一輪要算數', () => {
    // 14:28 開始、14:29 結束，而時點是 14:30
    expect(at('2026-08-29T16:00:00', '2026-08-29T14:29:00')).toBe(false)
  })
})
