import type { Bar } from './types'
import type { Market } from './levels'
import { taipeiToday } from './freshness'

/**
 * 資料健檢：在寫進資料庫之前，先問「這批資料本身合理嗎」。
 *
 * 為什麼需要：到目前為止抓到的每一個資料錯誤都是用眼睛看出來的——
 * Yahoo 的幽靈 K 棒（交易所休市那天卻有一根）、null 破洞、盤中還沒收的半根、
 * upsert 留下的過期資料。那不是系統，那是運氣。
 *
 * 真正危險的不是「明顯壞掉」，是**錯得很像對的**：數字合理、沒有錯誤訊息、
 * 指標照算、圖照畫，沒有人會發現。所以檢查的重點是不變量——
 * 那些「不管市場怎麼走都必須成立」的關係。
 */

export type IssueKind =
  | 'ohlc'        // 開高低收互相矛盾
  | 'nonpositive' // 價格 ≤ 0
  | 'duplicate'   // 同一天出現兩次
  | 'order'       // 日期沒有由舊到新
  | 'future'      // 未來的日期
  | 'jump'        // 單日跳動超過合理範圍
  | 'gap'         // 中間缺了太久
  | 'tooshort'    // 資料不足以算季線
  | 'bands'       // 布林三軌順序錯
  | 'pctb'        // %b 與三軌對不起來
  | 'kd'          // K/D 跑出 0–100
  | 'orphan'      // 有分析、但沒有對應的 K 棒

export interface Issue {
  code: string
  kind: IssueKind
  date?: string
  detail: string
}

/**
 * 單日跳動的上限。
 *
 * 台股有 ±10% 漲跌幅限制，超過就一定是資料問題（除權息、分割沒處理、抓錯標的）。
 * 美股沒有限制，真的會有一天 −30% 的財報行情，所以門檻放到 ±80%——
 * 那個幅度基本上只剩「股票分割沒處理」一種解釋。
 */
const JUMP_LIMIT: Record<Market, number> = { TW: 10.5, US: 80 }

/** 中間可以空多久。連假加颱風假頂多一週多，兩週一定有問題。 */
const MAX_GAP_DAYS = 14

/** 算得出季線的最低根數 */
const MIN_BARS_FOR_MA60 = 60

export function checkBars(
  code: string,
  market: Market,
  bars: readonly Bar[],
  opts: { today?: string } = {},
): Issue[] {
  const issues: Issue[] = []
  const today = opts.today ?? taipeiToday()
  const seen = new Set<string>()

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!

    if ([b.o, b.h, b.l, b.c].some((v) => !Number.isFinite(v) || v <= 0)) {
      issues.push({ code, kind: 'nonpositive', date: b.date, detail: `價格出現 0 或負值：${JSON.stringify(b)}` })
      continue // 後面的比較沒有意義
    }

    // 高低必須包住開收。盤中抓到的半根最常違反這一條。
    if (b.l > b.h || b.l > b.o || b.l > b.c || b.h < b.o || b.h < b.c) {
      issues.push({
        code, kind: 'ohlc', date: b.date,
        detail: `開高低收互相矛盾：開 ${b.o} 高 ${b.h} 低 ${b.l} 收 ${b.c}`,
      })
    }

    if (seen.has(b.date)) {
      issues.push({ code, kind: 'duplicate', date: b.date, detail: '同一天出現兩次' })
    }
    seen.add(b.date)

    if (b.date > today) {
      issues.push({ code, kind: 'future', date: b.date, detail: `日期在今天（${today}）之後` })
    }

    const prev = bars[i - 1]
    if (!prev) continue

    if (b.date <= prev.date) {
      issues.push({ code, kind: 'order', date: b.date, detail: `日期沒有遞增（前一筆是 ${prev.date}）` })
      continue
    }

    const move = Math.abs((b.c - prev.c) / prev.c) * 100
    if (move > JUMP_LIMIT[market]) {
      issues.push({
        code, kind: 'jump', date: b.date,
        detail: `單日跳動 ${move.toFixed(1)}%，超過 ${market} 的合理上限 ${JUMP_LIMIT[market]}%`
          + `（${prev.c} → ${b.c}）`,
      })
    }

    const gapDays = Math.round(
      (Date.parse(`${b.date}T00:00:00Z`) - Date.parse(`${prev.date}T00:00:00Z`)) / 86_400_000,
    )
    if (gapDays > MAX_GAP_DAYS) {
      issues.push({
        code, kind: 'gap', date: b.date,
        detail: `距離上一筆 ${prev.date} 隔了 ${gapDays} 天`,
      })
    }
  }

  if (bars.length < MIN_BARS_FOR_MA60) {
    issues.push({
      code, kind: 'tooshort',
      detail: `只有 ${bars.length} 根，算不出 60 日均線`,
    })
  }

  return issues
}

export interface AnalysisShape {
  close: number
  bb_lo: number | null
  bb_mid: number | null
  bb_up: number | null
  pct_b: number | null
  k: number | null
  d_val: number | null
  ma60: number | null
}

/**
 * 算完之後的內部一致性。
 *
 * 這一層抓的是「同一組數字自己對不起來」——例如存進去的 %b 跟三軌重算出來的
 * 不一樣，那代表中間有一步用了不同的資料。缺值不算錯：季線在資料不足時本來就是 null。
 */
export function checkAnalysis(code: string, a: AnalysisShape): Issue[] {
  const issues: Issue[] = []
  const { bb_lo, bb_mid, bb_up, pct_b, k, d_val, close } = a

  if (bb_lo !== null && bb_mid !== null && bb_up !== null) {
    if (!(bb_lo <= bb_mid && bb_mid <= bb_up)) {
      issues.push({
        code, kind: 'bands',
        detail: `布林三軌順序不對：下 ${bb_lo} / 中 ${bb_mid} / 上 ${bb_up}`,
      })
    } else if (pct_b !== null && bb_up > bb_lo) {
      const recomputed = (close - bb_lo) / (bb_up - bb_lo)
      if (Math.abs(recomputed - pct_b) > 0.01) {
        issues.push({
          code, kind: 'pctb',
          detail: `%b 存的是 ${pct_b.toFixed(3)}，用三軌重算是 ${recomputed.toFixed(3)}`,
        })
      }
    }
  }

  for (const [name, v] of [['K', k], ['D', d_val]] as const) {
    if (v !== null && (v < 0 || v > 100)) {
      issues.push({ code, kind: 'kd', detail: `${name} = ${v}，跑出 0–100 之外` })
    }
  }

  return issues
}

/**
 * 分析不能比 K 棒新。
 *
 * 2026-08-22 實測撞到：0050 最新 K 棒是 08-19，最新分析卻是 08-21。
 * 成因是 fixture 模式的抓取把 K 棒換成 fixture（結束於 08-19），並依既有邏輯
 * 刪掉「比最新一根還新」的真實 K 棒；而 `daily_analysis` 依 PLAN §11 永不刪除，
 * 於是留下兩列沒有價格來源的孤兒。
 *
 * 後果不是少一天資料，是**頁面理直氣壯地顯示一個我們沒有價格的日期**——
 * 標題寫「資料日期 2026-08-21、收盤 104.65」，而那根 K 棒不存在。
 * 模擬帳戶更糟：它只跑得到 08-19，頁面卻宣稱資料到 08-21。
 *
 * 「分析全部留著」是對的（那是回顧的素材），但**留著不等於可以拿來當今天**。
 */
export function checkOrphanAnalysis(
  code: string,
  latestBarDate: string | null,
  analysisDates: readonly string[],
): Issue[] {
  if (latestBarDate === null || analysisDates.length === 0) return []
  const orphans = analysisDates.filter((d) => d > latestBarDate).sort()
  if (orphans.length === 0) return []
  return [{
    code, kind: 'orphan', date: orphans[orphans.length - 1],
    detail: `有 ${orphans.length} 天的分析比最新 K 棒（${latestBarDate}）還新：`
      + `${orphans.join('、')}。頁面會顯示一個我們沒有價格的日期`,
  }]
}
