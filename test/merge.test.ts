import { describe, it, expect } from 'vitest'
import { mergeBars, needsFullFetch } from '../src/lib/merge'
import type { Bar } from '../src/lib/types'

/**
 * 增量抓取碰的是**保留策略**，而保留策略在這個專案裡已經吃掉過真實資料
 * （2026-08-22，fixture 覆蓋把 0050 與 2454 洗成 151 根）。所以合併規則
 * 寫成純函式，而且先在這裡把該保留什麼釘死。
 */

const bar = (d: string, c = 100): Bar =>
  ({ date: d, o: c, h: c, l: c, c, v: 1000 })

describe('mergeBars', () => {
  it('新的一段接在舊的後面，由舊到新', () => {
    const r = mergeBars([bar('2026-08-01'), bar('2026-08-02')], [bar('2026-08-03')])
    expect(r.map((b) => b.date)).toEqual(['2026-08-01', '2026-08-02', '2026-08-03'])
  })

  it('同一天以新抓到的為準——來源會事後修正數值', () => {
    const r = mergeBars([bar('2026-08-01', 100)], [bar('2026-08-01', 101)])
    expect(r).toHaveLength(1)
    expect(r[0]!.c).toBe(101)
  })

  it('**舊資料不會因為這次只抓一小段而消失**', () => {
    // 這是整個增量抓取最危險的地方：抓回來的是這個月的三根，
    // 而手上有半年。合併之後必須還是半年。
    const existing = Array.from({ length: 120 }, (_, i) =>
      bar(`2026-0${Math.floor(i / 30) + 1}-${String((i % 30) + 1).padStart(2, '0')}`))
    const r = mergeBars(existing, [bar('2026-08-21'), bar('2026-08-22')])
    expect(r.length).toBe(122)
  })

  it('兩邊都空 → 空陣列，不要炸', () => {
    expect(mergeBars([], [])).toEqual([])
  })

  it('抓回來的順序亂掉也要排好', () => {
    const r = mergeBars([], [bar('2026-08-03'), bar('2026-08-01'), bar('2026-08-02')])
    expect(r.map((b) => b.date)).toEqual(['2026-08-01', '2026-08-02', '2026-08-03'])
  })
})

describe('needsFullFetch', () => {
  const base = {
    existingCount: 200, minBars: 185,
    dividendCount: 0, splitCount: 0,
    fetchedNewest: '2026-08-21', existingNewest: '2026-08-20',
  }

  it('平常 → 不用完整抓取', () => {
    expect(needsFullFetch(base).full).toBe(false)
  })

  it('歷史不足 → 完整抓取（新加入的標的走這條）', () => {
    const r = needsFullFetch({ ...base, existingCount: 3 })
    expect(r.full).toBe(true)
    expect(r.why).toContain('不足')
  })

  it('有配息 → 完整抓取，因為還原價是回溯計算的', () => {
    // 只更新這個月的幾根，前面幾百根的 adj_factor 就跟現實對不上——
    // 而那個錯誤不會報錯，它只是讓圖上那道除息跳空留在那裡
    const r = needsFullFetch({ ...base, dividendCount: 1 })
    expect(r.full).toBe(true)
    expect(r.why).toContain('回溯')
  })

  it('有分割 → 完整抓取', () => {
    expect(needsFullFetch({ ...base, splitCount: 1 }).full).toBe(true)
  })

  it('抓回來的比手上的還舊 → 完整抓取', () => {
    const r = needsFullFetch({ ...base, fetchedNewest: '2026-08-10' })
    expect(r.full).toBe(true)
    expect(r.why).toContain('還舊')
  })

  it('手上沒有任何資料時不會拿 null 去比大小', () => {
    expect(needsFullFetch({
      ...base, existingCount: 0, existingNewest: null, fetchedNewest: null,
    }).full).toBe(true)
  })
})
