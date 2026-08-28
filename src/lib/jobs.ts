/**
 * 抓取與 AI 決策不能同時重建模擬帳戶。
 *
 * ## 為什麼需要互斥
 *
 * 部署之後這兩件事在**兩台不同的機器**上：抓取跑在 Vercel Cron，
 * AI 跑在本機（`ai-decide.ts` 要 spawn 本機的 `claude` 二進位）。
 * 而兩邊都會呼叫 `rebuildAll()`——抓完要重建、判斷前也要重建，
 * 因為 AI 得知道現在的持股與現金。
 *
 * `writeTrack()` 的做法是**整段刪掉再寫回去**（`run.ts`）。兩邊同時跑的話，
 * 一邊剛 delete 完還沒 insert，另一邊正在讀——讀到的是一條空的資金曲線，
 * 或者半截的。頁面不會報錯，它會畫出一張看起來很正常的圖。
 *
 * ## 為什麼不是「排程差五分鐘」
 *
 * 抓取的時間跟著標的數量長：實測 6 檔 54 秒，20 檔約三分鐘。固定的時間差
 * 是一個會隨著你多追蹤幾檔而悄悄失效的保護。問 `job_runs` 才是真的——
 * 那張表本來就記著每一輪的開始與結束。
 *
 * ## 為什麼要有「太舊就當它死了」
 *
 * `finished_at` 是在抓取結束時才填的。雲端函式被執行時間上限砍掉的時候
 * 不會執行到那一行，那一列就永遠停在「還在跑」。少了這個門檻，
 * AI 會從那天起每天都在等一個永遠不會結束的東西。
 */

/** 超過這個時間還沒結束的抓取，當作已經死了。實測一輪 54 秒，留很寬的餘裕 */
export const INGEST_STALE_MS = 15 * 60_000

export interface JobRow {
  started_at: string
  finished_at: string | null
}

/** 真的還在跑的抓取（排除掉那些沒有機會填 `finished_at` 就被砍掉的） */
export function inFlight(rows: readonly JobRow[], nowMs: number): JobRow[] {
  return rows.filter((r) =>
    r.finished_at === null && nowMs - Date.parse(r.started_at) < INGEST_STALE_MS)
}

export interface WaitOptions {
  /** 讀出「還沒結束」的那些列 */
  fetchRows: () => Promise<JobRow[]>
  /** 等多久放棄。放棄之後照樣往下做——見回傳值的說明 */
  timeoutMs?: number
  intervalMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  log?: (msg: string) => void
}

/**
 * 等到沒有抓取在跑為止。
 *
 * 回傳 `'clear'`（沒有東西在跑了）或 `'timeout'`（等太久）。
 *
 * **`'timeout'` 不代表要放棄執行。** 呼叫端該做的是記下來然後繼續：
 * AI 那條線的價值在於每天都有判斷，為了一個可能卡住的抓取而整天不判斷，
 * 是拿確定的損失換不確定的風險。但這件事必須留下紀錄，
 * 否則資料真的被寫壞時沒有人知道從哪天開始。
 */
export async function waitForIngestToFinish(
  opts: WaitOptions,
): Promise<'clear' | 'timeout'> {
  const {
    fetchRows,
    timeoutMs = 5 * 60_000,
    intervalMs = 10_000,
    now = () => Date.now(),
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    log = () => {},
  } = opts

  const deadline = now() + timeoutMs
  let announced = false

  for (;;) {
    const busy = inFlight(await fetchRows(), now())
    if (busy.length === 0) return 'clear'

    if (!announced) {
      log(`抓取還在跑（${busy[0]!.started_at} 開始），等它結束再重建帳戶`)
      announced = true
    }
    if (now() >= deadline) return 'timeout'
    await sleep(intervalMs)
  }
}

/**
 * 等到**今天的抓取真的跑完**，而不是等時鐘。
 *
 * ## 為什麼「差五分鐘」不夠
 *
 * 原本的安排是 Vercel Cron 07:30 抓取、本機 07:35 跑 AI。實測 2026-08-28：
 * Cron 排在 23:30 UTC，**實際 23:58 才跑**（Vercel 的 cron 不保證準時），
 * 而本機的 AI 準時在 07:35 開跑——比抓取早了 23 分鐘。
 *
 * 結果不是「兩邊打架」，是**AI 看到的是昨天的資料**：NVDA 的 K 棒還停在
 * 前一天，於是被「早於起算日」擋掉；另外兩檔則是「已有紀錄」。整輪安靜地
 * 什麼都沒做，而 log 看起來完全正常。
 *
 * `waitForIngestToFinish` 解不了這個：它只在抓取**正在跑**的時候等，
 * 而這次抓取根本還沒開始。要等的是「今天的那一輪已經結束」。
 *
 * ## 逾時就繼續，但要留紀錄
 *
 * 跟另一支同樣的取捨：AI 這條線的價值在於每天都有判斷。為了一個可能
 * 根本不會來的抓取而整天不判斷，是拿確定的損失換不確定的風險。
 * 但那時候它看到的是舊資料，所以一定要說出來。
 */
export async function waitForFreshIngest(opts: {
  /** 讀出最近幾筆抓取紀錄（含未結束的） */
  fetchRows: () => Promise<JobRow[]>
  /** 「夠新」的界線：`finished_at` 要晚於這個時間 */
  since: Date
  timeoutMs?: number
  intervalMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  log?: (msg: string) => void
}): Promise<'fresh' | 'timeout'> {
  const {
    fetchRows, since,
    // 預設等 45 分鐘：Vercel 的 cron 實測遲到 28 分鐘，留一倍餘裕
    timeoutMs = 45 * 60_000,
    intervalMs = 60_000,
    now = () => Date.now(),
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    log = () => {},
  } = opts

  const deadline = now() + timeoutMs
  const cutoff = since.getTime()
  let announced = false

  for (;;) {
    const rows = await fetchRows()
    const done = rows.some((r) =>
      r.finished_at !== null && Date.parse(r.finished_at) >= cutoff)
    if (done) return 'fresh'

    if (!announced) {
      log(`還沒看到今天的抓取（要晚於 ${since.toISOString().slice(11, 16)} UTC 結束），等它`)
      announced = true
    }
    if (now() >= deadline) return 'timeout'
    await sleep(intervalMs)
  }
}
