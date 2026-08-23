/**
 * 把一張表整個讀完，不要相信一次查詢會回全部。
 *
 * **PostgREST 預設一次最多回 1000 列，而且不會告訴你被截斷了。**
 *
 * 這個坑咬過一次（2026-08-22）：5 檔 × 3 軌道 × 114 天 ≈ 1710 列的淨值查詢
 * 被切一半，後面的帳戶只拿到半截曲線，統計就用半截資料算——0050 顯示
 * 「在市 47/66 天」，實際是 73/114。沒有錯誤訊息，數字看起來也完全合理。
 *
 * 原本這支只住在 `data.ts` 裡（頁面讀取層）。搬出來是因為盤點時發現同一個
 * 坑還埋在另外四個地方，而那四個都不在 `data.ts`：
 *
 *   src/lib/sim/run.ts   分析（由舊到新）、AI 決策紀錄（由舊到新）
 *   src/lib/data.ts      個股頁的資金曲線（由舊到新）
 *   src/lib/sim/run.ts   匯率（**連 order 都沒有**）
 *
 * 前三個排序是由舊到新，所以截斷丟掉的是**最新的**資料——每檔每年約 250 個
 * 交易日，大約四年後開始。匯率那個更糟：沒有 `order()` 的查詢被截斷之後，
 * 回來的是一個**任意**子集，而它的用途是換算美股帳戶的本金。
 *
 * 判斷準則很簡單：**這張表的列數會不會隨時間長大？** 會的話就用這支。
 * `daily_bars` 不用（每檔上限 185 根），`symbols`／`watchlist` 不用。
 */
export async function fetchPaged<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
  size = 1000,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += size) {
    const { data } = await page(from, from + size - 1)
    if (!data || data.length === 0) break
    out.push(...data)
    if (data.length < size) break
    // 安全閥：帳戶資料不該有幾十萬列，真的有就是別的地方壞了
    if (out.length > 200_000) break
  }
  return out
}
