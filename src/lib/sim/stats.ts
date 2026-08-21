import type { EquityPoint } from './engine'

/**
 * 回顧頁的統計（PLAN §11、§13.7）。
 *
 * 兩條規矩，都是為了不讓人誤讀自己的績效：
 *
 * 一、**超額報酬領銜。** 報酬率自己答不了「準不準」——大盤漲 10% 而你賺 4%，
 *     那不是準，是拖後腿。超額由呼叫端拿規則減買進持有算，這裡只給單軌數字。
 *
 * 二、**次數少的時候不寫百分比。** §11 明訂：「4 次裡 3 次」不能寫成
 *     「命中率 75%」。所以這裡回傳 `wins` 與 `closed` 兩個**整數**，
 *     不提供比率——想寫成百分比的人得自己動手，而且會先看到分母。
 */

export interface StatTrade {
  side: 'buy' | 'sell'
  qty: number
  price: number
  fee: number
  tax: number
  /** 賣出當下的每股平均成本。買進是 null */
  costBasis: number | null
  triggers: string[]
}

export interface TrackStats {
  retPct: number
  /** 從高點回落最深多少（%）。報酬率一樣的兩條曲線，回落大的那條抱不住 */
  maxDrawdownPct: number
  trades: number
  /** 賣出過幾次（＝結算過幾次損益） */
  closed: number
  /** 其中賺錢的幾次。**故意不提供比率**，見上方第二條 */
  wins: number
  daysInMarket: number
  totalDays: number
  totalFees: number
  feesPct: number
  /** 被止損幾次。止跌規則已知有問題（§11 實測），這格是它的體檢表 */
  stopped: number
}

/**
 * 最大回落：從歷史高點跌下來最深的一次。
 *
 * 為什麼要看它：兩條報酬率相同的曲線，一條穩定爬升、一條先腰斬再翻倍，
 * 對持有的人是完全不同的兩件事——後者你根本抱不到終點。
 */
export function maxDrawdown(equity: readonly number[]): number {
  let peak = -Infinity
  let worst = 0
  for (const v of equity) {
    if (v > peak) peak = v
    if (peak > 0) {
      const dd = ((peak - v) / peak) * 100
      if (dd > worst) worst = dd
    }
  }
  return worst
}

export function trackStats(
  equity: readonly EquityPoint[],
  trades: readonly StatTrade[],
  initialCash: number,
): TrackStats {
  const last = equity[equity.length - 1]
  const sells = trades.filter((t) => t.side === 'sell')

  // 賺賠用「賣出價 vs 當時的每股平均成本」判斷。成本基礎沒存到的舊資料
  // 不算進分母——寧可少算，也不要拿一個猜的成本去判定輸贏。
  const closed = sells.filter((t) => t.costBasis !== null).length
  const wins = sells.filter((t) => t.costBasis !== null && t.price > t.costBasis).length

  const totalFees = trades.reduce((a, t) => a + t.fee + t.tax, 0)

  return {
    retPct: last?.retPct ?? 0,
    maxDrawdownPct: maxDrawdown(equity.map((e) => e.equity)),
    trades: trades.length,
    closed,
    wins,
    daysInMarket: equity.filter((e) => e.shares > 0).length,
    totalDays: equity.length,
    totalFees,
    feesPct: initialCash > 0 ? (totalFees / initialCash) * 100 : 0,
    stopped: sells.filter((t) => t.triggers.includes('stop')).length,
  }
}
