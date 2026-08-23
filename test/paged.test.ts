import { describe, it, expect } from 'vitest'
import { fetchPaged } from '../src/lib/supabase/paged'

/**
 * PostgREST 一次最多回 1000 列，而且不會說它截斷了。
 *
 * 這支測試用一個假的 `page()` 模擬那個行為——重點不是分頁演算法多聰明，
 * 是**證明它真的會去要第二頁**。少了這一條，回歸的樣子會是「數字看起來
 * 很合理但少了一截」，跟 2026-08-22 那次一模一樣：0050 顯示在市 47/66 天，
 * 實際是 73/114，沒有任何錯誤訊息。
 */

/** 一個回傳 `total` 列、但每次最多只給 `cap` 列的假資料來源 */
function source(total: number, cap = 1000) {
  const calls: [number, number][] = []
  const page = (from: number, to: number) => {
    calls.push([from, to])
    const end = Math.min(to, from + cap - 1, total - 1)
    const out: { i: number }[] = []
    for (let i = from; i <= end; i++) out.push({ i })
    return Promise.resolve({ data: out })
  }
  return { page, calls }
}

describe('fetchPaged', () => {
  it('剛好一頁：拿滿 1000 列還是要再問一次，才知道有沒有第 1001 列', async () => {
    const s = source(1000)
    expect(await fetchPaged(s.page)).toHaveLength(1000)
    // 第一頁滿了就不能假設結束——真的只有 1000 列時，第二頁回空才是證據
    expect(s.calls).toHaveLength(2)
  })

  it('超過一頁：全部拿回來，不是前 1000 列', async () => {
    const s = source(1710)   // 就是那次出事的列數量級
    const rows = await fetchPaged(s.page)
    expect(rows).toHaveLength(1710)
    expect(rows[1709]).toEqual({ i: 1709 })
  })

  it('不足一頁：問一次就停', async () => {
    const s = source(261)    // 目前的 fx_rates
    expect(await fetchPaged(s.page)).toHaveLength(261)
    expect(s.calls).toHaveLength(1)
  })

  it('空表：不會無限迴圈', async () => {
    const s = source(0)
    expect(await fetchPaged(s.page)).toEqual([])
    expect(s.calls).toHaveLength(1)
  })

  it('來源壞掉一直回滿頁時，安全閥要擋住', async () => {
    // 真的有幾十萬列就是別的地方壞了，不要把記憶體吃光
    let n = 0
    const rows = await fetchPaged(() => {
      n++
      return Promise.resolve({ data: Array.from({ length: 1000 }, (_, i) => ({ i })) })
    })
    expect(rows.length).toBeLessThanOrEqual(201_000)
    expect(n).toBeLessThan(300)
  })
})
