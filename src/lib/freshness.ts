/**
 * 「今天沒有新的一根 K 棒」有兩種完全不同的意思（PLAN §7）：
 *
 *   休市     —— 週末、國定假日、颱風假。正常狀態，不該讓人以為系統壞了。
 *   資料未更新 —— 來源掛了、排程沒跑。要標出最後成功時間。
 *
 * 判斷方式**不維護假日表**（台股有颱風假，排不出來），改成用結果反推：
 * 當天有成功紀錄但沒有新 K 棒 → 休市；當天沒有成功紀錄 → 故障。
 */

export interface FreshnessInput {
  /** 最近一次成功的排程時間（ISO），沒有就是 null */
  lastOkAt: string | null
  /** 資料庫裡最新一根 K 棒的日期 */
  latestBarDate: string | null
  /** 台北時區的今天，`YYYY-MM-DD` */
  today: string
}

export interface Freshness {
  kind: 'fresh' | 'holiday' | 'stale'
  message: string
  tone: 'none' | 'muted' | 'warn'
}

/** 用台北時區切日。伺服器可能跑在 UTC，直接用 UTC 會在晚上八點後整個差一天。 */
export function taipeiToday(now = new Date()): string {
  const taipei = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  return taipei.toISOString().slice(0, 10)
}

function shortTime(iso: string): string {
  // 只留「MM-DD HH:mm」，年份對每天要看的人沒有資訊量
  const d = new Date(iso)
  const t = new Date(d.getTime() + 8 * 60 * 60 * 1000).toISOString()
  return `${t.slice(5, 10)} ${t.slice(11, 16)}`
}

export function dataFreshness({ lastOkAt, latestBarDate, today }: FreshnessInput): Freshness {
  const ranToday = lastOkAt !== null && taipeiToday(new Date(lastOkAt)) === today

  if (!ranToday) {
    return {
      kind: 'stale',
      message: lastOkAt
        ? `資料未更新——最後一次成功是 ${shortTime(lastOkAt)}`
        : '資料未更新——還沒有任何一次成功的排程',
      tone: 'warn',
    }
  }

  if (latestBarDate !== today) {
    return {
      kind: 'holiday',
      message: `今日休市，以下為 ${latestBarDate ?? '上一個交易日'} 的資料`,
      tone: 'muted',
    }
  }

  return { kind: 'fresh', message: `最後更新 ${shortTime(lastOkAt!)}`, tone: 'none' }
}
