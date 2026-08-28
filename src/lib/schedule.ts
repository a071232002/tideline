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
