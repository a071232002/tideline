import type { WatchRow } from './data'
import { levelStatus } from './status'

/**
 * 清單頁最上面那一句話。
 *
 * ## 為什麼需要它
 *
 * 現在的頁首說「沒有要動作的」，然後底下五列平等地攤開：每一列都有三個
 * 價位、KD、AI 判斷、追蹤天數。**有動作的日子跟沒動作的日子，畫面看起來
 * 幾乎一樣**——而那正是這個站唯一該讓人注意的差別。
 *
 * 而且「沒事」被說了很多次：五個「AI 觀望」、五個「太短」、頁首一句
 * 「都還沒進場」。每一句單獨看都合理，合起來是一個每天告訴你十一次
 * 「沒事」的介面。人會停止打開那種東西。
 *
 * 所以頁首改成**一句話講完今天**，而重複的部分從每一列收掉。
 *
 * ## 三種一天
 *
 * 1. **有動作**——明天開盤真的要買或賣。那是唯一可以照做的事，講出是哪幾檔。
 * 2. **沒動作，但有東西靠近價位**——今天不做，但值得看一眼那一檔，
 *    以及它離哪個價位多近。
 * 3. **什麼都沒有**——說清楚「都離價位還遠」，不要只說「沒有要動作的」，
 *    那句話讀起來像系統壞了。
 *
 * 回傳的是**結構**不是字串：畫面要能把重點那一檔標出來，而不是只印一段文字。
 */

export interface DaySummary {
  /** 明天開盤真的要動作的代號 */
  acting: string[]
  /** 沒有動作時，最值得看一眼的那一檔（離價位最近） */
  focus: { code: string; label: string; distancePct: number | null } | null
  /** 一句話 */
  headline: string
  /** 有幾檔在模擬 */
  n: number
}

/** 這一列明天要不要動作 */
function willAct(r: WatchRow): boolean {
  const p = r.sim?.pending
  return Boolean(p && (p.buy || p.sell))
}

export function summariseDay(rows: readonly WatchRow[]): DaySummary {
  const withSim = rows.filter((r) => r.sim)
  const acting = rows.filter(willAct).map((r) => r.code)

  if (acting.length > 0) {
    return {
      acting,
      focus: null,
      headline: acting.length === 1
        ? `今天只有 ${acting[0]} 要動作`
        : `今天有 ${acting.length} 檔要動作：${acting.join('、')}`,
      n: withSim.length,
    }
  }

  /**
   * 沒有動作的日子，找出最值得看一眼的那一檔。
   *
   * 用 `levelStatus` 而不是自己算——它已經是清單上那顆狀態徽章的來源。
   * 兩邊用同一個判斷，頁首說的「最接近」才會跟列上標出來的那顆對得起來。
   *
   * **已經到價的排在接近的前面。** `levelStatus` 對「已跌破止跌」「已達
   * 賣出區」「已進加碼區」回傳 `distancePct: null`（因為距離是 0，
   * 講百分比沒有意義）——照距離排序會把它們整個跳過，而那正好是最該
   * 被看見的三種狀態。
   */
  const ARRIVED = new Set(['below-stop', 'in-sell', 'in-add'])
  let best: DaySummary['focus'] = null
  let bestRank = Infinity
  for (const r of rows) {
    const st = levelStatus(r.close, {
      sell: r.levels.find((l) => l.kind === 'sell') as never,
      stop: r.levels.find((l) => l.kind === 'stop')?.lo ?? null,
      add: r.levels.find((l) => l.kind === 'add') as never,
    })
    if (st.kind === 'none') continue
    // 已到價一律排在接近之前；同一類再比距離
    const rank = ARRIVED.has(st.kind) ? -1 : Math.abs(st.distancePct ?? Infinity)
    if (rank < bestRank) {
      bestRank = rank
      best = { code: r.code, label: st.label, distancePct: st.distancePct }
    }
  }

  if (best) {
    const d = best.distancePct
    return {
      acting: [],
      focus: best,
      headline: `今天沒有要動作的。最該看的是 ${best.code}，${best.label}`
        + (d === null ? '' : `（${d >= 0 ? '+' : ''}${d.toFixed(1)}%）`),
      n: withSim.length,
    }
  }

  return {
    acting: [],
    focus: null,
    // 「沒有要動作的」單獨一句讀起來像系統壞了。要說出**為什麼**沒有。
    headline: withSim.length > 0
      ? `今天沒有要動作的，${withSim.length} 檔都離價位還遠`
      : '今天沒有要動作的',
    n: withSim.length,
  }
}
