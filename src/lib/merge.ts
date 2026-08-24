import type { Bar } from './types'

/**
 * 增量抓取的合併規則（PLAN §7）。
 *
 * ## 為什麼需要增量
 *
 * `ingestSymbol` 原本每一輪都重抓台股 9 個月、美股 1 年。指標只需要最新那
 * 一根 K 棒，其餘 DB 裡本來就有——而九次 TWSE 請求中間各隔 1.2 秒避免限流，
 * 一檔就是 9 秒。6 檔 54 秒還能忍，60 檔就是九分鐘，雲端函式的執行時間上限
 * 會先把它砍掉，而被砍掉時畫面只會說「資料未更新」。
 *
 * ## 這個檔案在防的事
 *
 * 增量抓回來的是**一小段**，而保留策略（只留 185 根）是照著「這次拿到的
 * 第一根」去刪的：
 *
 *     cutoff = kept[0].date;  delete where d < cutoff
 *
 * 增量模式下 `kept[0]` 是這個月的第一天——照著刪就是把整段歷史刪光。
 * 這不是假想：2026-08-22 那次 fixture 覆蓋就是同一類錯誤，把 0050 與 2454
 * 洗成 151 根。所以**刪除只在完整抓取時發生**，而合併必須是純函式、
 * 有測試、看得出它保留了什麼。
 */

/**
 * 舊資料 ＋ 新抓到的一段。同一天以**新的**為準——來源會事後修正數值，
 * 而修正過的那一版才是對的。
 *
 * 回傳依日期由舊到新，且不重複。
 */
export function mergeBars(existing: readonly Bar[], fetched: readonly Bar[]): Bar[] {
  const by = new Map<string, Bar>()
  for (const b of existing) by.set(b.date, b)
  for (const b of fetched) by.set(b.date, b)   // 新的蓋掉舊的
  return [...by.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/**
 * 這次增量抓回來的東西夠不夠用，還是得退回去抓完整的？
 *
 * 三種情況要升級成完整抓取：
 *
 * 1. **手上的歷史根本不夠算指標**——新加入的標的、或資料被清過。
 *    布林要 20 根、KD 要 9 根、季線要 60 根，暖機不足算出來的是垃圾。
 * 2. **這段期間有配息或分割**。還原價是**回溯**計算的：除息日之前的每一根
 *    都要打折。只更新這個月的幾根，前面幾百根的 `adj_factor` 就跟現實對不上。
 *    事件一年才幾次，遇到就整段重抓，不要為了省一次請求去手算回溯。
 * 3. **抓回來的比手上的還舊**——來源出問題或代號換了，這時候寧可整段重來。
 */
export function needsFullFetch(opts: {
  existingCount: number
  minBars: number
  dividendCount: number
  splitCount: number
  fetchedNewest: string | null
  existingNewest: string | null
}): { full: boolean; why: string | null } {
  if (opts.existingCount < opts.minBars) {
    return { full: true, why: `手上只有 ${opts.existingCount} 根，不足 ${opts.minBars} 根` }
  }
  if (opts.dividendCount > 0 || opts.splitCount > 0) {
    return { full: true, why: '這段期間有配息或分割，還原價要整段回溯重算' }
  }
  if (opts.fetchedNewest && opts.existingNewest && opts.fetchedNewest < opts.existingNewest) {
    return { full: true, why: `抓回來的 ${opts.fetchedNewest} 比手上的 ${opts.existingNewest} 還舊` }
  }
  return { full: false, why: null }
}
