/**
 * 排程的時點。**這是 AI 與健檢共用的同一條線。**
 *
 * 兩支程式都要回答「今天的抓取來了沒」：`ai-decide` 用它決定要不要等，
 * `deploy-check` 用它決定要不要喊「沒跑」。各寫一套的話，遲早有一邊
 * 對另一邊的假設過期，而過期的那一天沒有人會發現——兩邊都只會安靜地
 * 給出看起來很正常的答案。
 *
 * ## 為什麼需要「寬限」而不是硬界線
 *
 * Vercel Hobby 的 cron **只保證在該小時內觸發**，不保證準時。實測：
 *
 *     排 07:30 → 實際 07:58（遲 28 分）
 *     排 14:30 → 實際 14:28（早 2 分）
 *
 * 所以兩個方向都要留餘裕。拿 14:30 當硬界線的話，14:28 那一輪會被判成
 * 「還沒來」，AI 白等 45 分鐘再宣告資料是舊的——而資料其實是新的。
 */

/**
 * 抓取的排程時點（台北時間）。
 *
 * **改這裡就要一起改 `vercel.json` 的 crons**，那邊寫的是 UTC：
 * 台北 07:30 = `30 23 * * *`（前一天），台北 14:30 = `30 6 * * *`。
 * 有一條測試釘著這個清單，改壞了會紅。
 */
export const INGEST_TIMES = ['07:30', '14:30'] as const

/** 台灣沒有日光節約時間，固定 +8 */
const TAIPEI_OFFSET_MS = 8 * 3600_000

/** cron 可能早跑也可能晚跑，兩個方向都留這麼多 */
export const SCHEDULE_SLACK_MS = 30 * 60_000

/**
 * 過了時點多久還沒有紀錄才算「沒跑」。
 *
 * Hobby 保證在那個小時內觸發，所以一小時之內都還在正常範圍。
 * 訂得太短的話健檢每天早上都會喊一次狼來了，然後就沒有人再看它。
 */
export const SCHEDULE_GRACE_MS = 60 * 60_000

/**
 * 本機那輪最多等抓取多久（`waitForFreshIngest`）。
 *
 * ## 這個數字被 Windows 工作排程器的「執行時間上限」蓋掉過，而且沒有任何痕跡
 *
 * 實測 2026-08-30、08-31、09-01 **連續三天**：早上那輪 07:35 開跑、寫了
 * 「開始 AI 決策」之後就再也沒有下文，log 裡沒有錯誤、沒有結束，
 * 工作排程器回報 267014（SCHED_S_TASK_TERMINATED）。
 *
 * 原因是算術：這裡等 45 分鐘，而兩個工作的 `ExecutionTimeLimit` 是
 * **PT30M**。早上的 Vercel Cron 實際落在 08:04、08:04、08:15——距離 07:35
 * 是 29～46 分鐘，**每天都踩過那條 30 分鐘的線**，所以行程在等待中被砍。
 * 為了「Cron 遲到」留的那一倍餘裕，因為排程器先動手而完全用不到。
 *
 * 下午那輪活著只是因為它的 Cron 落在 14:42～14:57（遲到 7～23 分鐘）——
 * 08-30 與 08-31 兩天結束於 15:03，**離被砍只剩約一分鐘**。
 *
 * ## 所以這個常數有一個外部條件
 *
 * **工作排程器的執行時間上限必須大於這個值加上實際工作時間**
 * （重建 + 問模型 + 推薦，實測約 4～8 分鐘）。已改成 PT90M。
 * 下面的單元測試盯著這個關係：把等待時間往上調而忘了改排程器，測試會紅。
 *
 * 改上限的指令（PowerShell，兩個工作都要）：
 *
 *     $t = Get-ScheduledTask -TaskName 'Tideline 每日抓取'
 *     $t.Settings.ExecutionTimeLimit = 'PT90M'
 *     Set-ScheduledTask -TaskName 'Tideline 每日抓取' -Settings $t.Settings
 */
export const INGEST_WAIT_MS = 45 * 60_000

/**
 * 工作排程器目前設定的執行時間上限（分鐘）。**改了排程器就要改這裡**，
 * 這個值存在的唯一理由是讓上面那個關係被測試盯著，而不是靠人記得。
 */
export const TASK_LIMIT_MIN = 90

/** 一輪實際要做的事大概多久：重建、問模型、推薦。實測 4～8 分鐘，抓寬一點 */
export const TASK_WORK_BUDGET_MIN = 20

/** 這個時間點的台北日期與當日經過的毫秒 */
function taipeiParts(now: Date): { dayStartMs: number; msIntoDay: number } {
  const shifted = now.getTime() + TAIPEI_OFFSET_MS
  const msIntoDay = ((shifted % 86_400_000) + 86_400_000) % 86_400_000
  return { dayStartMs: shifted - msIntoDay - TAIPEI_OFFSET_MS, msIntoDay }
}

function hhmmToMs(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h! * 60 + m!) * 60_000
}

/**
 * 現在之前最近的一個排程時點。
 *
 * 午夜到早上七點半之間回傳的是**昨天下午那個**——每天都會經過這一段，
 * 而少了它，健檢在凌晨零點六分就會喊「今天沒有抓取紀錄」，
 * 正確答案卻是「今天還沒到時間」。
 */
export function lastScheduledIngest(now: Date): Date {
  const { dayStartMs, msIntoDay } = taipeiParts(now)
  const offsets = INGEST_TIMES.map(hhmmToMs).sort((a, b) => a - b)
  const passed = offsets.filter((o) => o <= msIntoDay)
  if (passed.length > 0) return new Date(dayStartMs + passed[passed.length - 1]!)
  // 今天還沒有任何一個時點到，往前一天拿最後一個
  return new Date(dayStartMs - 86_400_000 + offsets[offsets.length - 1]!)
}

/**
 * AI 要等的那條線：「這一輪的抓取要在這之後結束」。
 *
 * 原本寫的是「今天台北 00:00」，於是 14:35 的 AI 只要看到早上那輪就放行
 * ——而早上台股還沒收盤，最新 K 棒是昨天的。結果是每一檔「已有紀錄」
 * 全部跳過，當天的台股判斷整天不會產生，而 log 看起來完全正常。
 */
export function freshSince(now: Date): Date {
  return new Date(lastScheduledIngest(now).getTime() - SCHEDULE_SLACK_MS)
}

/**
 * 健檢：現在該不該喊「抓取沒跑」。
 *
 * 兩個條件都要成立才喊，因為**假警報比沒有警報更糟**——喊過幾次狼來了
 * 之後就沒有人再看這份輸出了：
 *
 *   1. 已經過了上一個時點加寬限（否則只是還沒到時間）
 *   2. 而且最後一次成功的抓取早於那個時點（扣掉早跑的餘裕）
 */
export function ingestOverdue(
  now: Date, lastFinishedAt: Date | null,
): { overdue: boolean; expectedAt: Date } {
  const expectedAt = lastScheduledIngest(now)
  const tooEarlyToTell = now.getTime() < expectedAt.getTime() + SCHEDULE_GRACE_MS
  if (tooEarlyToTell) return { overdue: false, expectedAt }
  const covered = lastFinishedAt !== null
    && lastFinishedAt.getTime() >= expectedAt.getTime() - SCHEDULE_SLACK_MS
  return { overdue: !covered, expectedAt }
}

/**
 * 現在之後最近的一個排程時點。
 *
 * **剛好卡在時點上算下一個。** 14:30:00 那一秒還顯示「下次 14:30」，
 * 讀起來像那件事還沒發生。
 */
export function nextScheduledIngest(now: Date): Date {
  const { dayStartMs, msIntoDay } = taipeiParts(now)
  const offsets = INGEST_TIMES.map(hhmmToMs).sort((a, b) => a - b)
  const upcoming = offsets.filter((o) => o > msIntoDay)
  if (upcoming.length > 0) return new Date(dayStartMs + upcoming[0]!)
  return new Date(dayStartMs + 86_400_000 + offsets[0]!)
}

/**
 * 「多久以前」。
 *
 * 「06:29」回答不了「這是新的還舊的」，「3 小時前」可以——那是整個新鮮度
 * 顯示裡最重要的一句話。
 *
 * **無條件捨去。** 3 小時 50 分講「3 小時前」，不是「4 小時前」——
 * 把資料說得比實際更舊，使用者會據此不相信畫面上的數字。負數當作剛剛：
 * 伺服器與瀏覽器的時鐘會差幾秒，不該因此印出「-1 分鐘前」。
 */
export function agoText(ms: number): string {
  if (ms < 60_000) return '剛剛'
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins} 分鐘前`
  const hours = Math.floor(ms / 3600_000)
  if (hours < 24) return `${hours} 小時前`
  return `${Math.floor(ms / 86_400_000)} 天前`
}
