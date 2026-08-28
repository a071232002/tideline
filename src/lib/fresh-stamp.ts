/**
 * 「資料變了沒」的指紋。
 *
 * ## 為什麼需要
 *
 * 這個站的資料一天更新兩次，而且**兩次在不同的機器上**：抓取跑在
 * Vercel Cron（台北早上七點半左右），AI 判斷跑在本機的排程（抓完之後）。
 * 開著頁面的人不會知道這些——他隔天早上看到的是昨天的畫面，
 * 而畫面上沒有任何東西告訴他該按重新整理。
 *
 * ## 為什麼不只看 job_runs
 *
 * 只問「最後一次抓取什麼時候結束」會漏掉第二次更新：`ai-decide.ts`
 * 只**讀** `job_runs`（等抓取跑完），它不寫。AI 跑完之後那張表沒有變，
 * 於是畫面繼續停在「AI 尚未判斷」——而那正是這個站最主要的內容。
 *
 * 所以指紋蓋兩件事：抓取跑完了沒、AI 最後寫在什麼時候。
 *
 * ## 為什麼不問 K 棒日期
 *
 * 因為會動到 K 棒的路徑都會寫 `job_runs`（`runIngest` 開頭就 insert、
 * 結束才填 `finished_at`）。多問一次要多三趟往返——兩個市場各查一次
 * 最新 K 棒，還得先查 symbols 分市場。輪詢是會重複發生的事，
 * 多出來的每一趟都要付很多次。
 *
 * ## 為什麼是字串比對而不是時間比大小
 *
 * 比大小要處理時區、時鐘偏差、以及「回補之後日期反而變舊」這種情況。
 * 而這裡要回答的問題只有「跟我上次看到的一不一樣」——不需要知道
 * 誰比較新。字串比對沒有那些邊界。
 */

export interface FreshParts {
  /** 最後一次成功抓取的結束時間 */
  ingestAt: string | null
  /** 這個使用者最新一筆 AI 判斷的寫入時間 */
  aiAt: string | null
}

export function buildStamp(p: FreshParts): string {
  return [p.ingestAt ?? '-', p.aiAt ?? '-'].join('|')
}

/**
 * 該不該重整。
 *
 * 兩個都要擋掉：**第一次看到**（`seen` 是 null）不算變化——剛掛上去
 * 就重整會變成無限迴圈；**拿不到指紋**（空字串）也不算——網路失敗一次
 * 不該讓整頁重載，何況重載本身也需要網路。
 */
export function shouldRefresh(seen: string | null, next: string): boolean {
  if (seen === null || next === '') return false
  return seen !== next
}
