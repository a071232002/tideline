import { levelStatus, type StatusKind } from './status'

/**
 * 清單排序。預設是「該注意的浮上來」——不然清單一長，有狀態的那幾檔
 * 沉在最下面，狀態徽章等於白做。
 */

export type SortMode = 'attention' | 'code' | 'change' | 'sim'

interface SortableRow {
  code: string
  close: number | null
  chg_pct: number | null
  levels: { kind: 'sell' | 'stop' | 'add'; lo: number; hi?: number }[]
  /** 模擬帳戶。沒開帳的標的是 null（剛加入、或資料不足） */
  sim?: {
    retPct: number
    excessPct: number
    shares: number
    pending: { buy: boolean; sell: boolean; triggers: string[] } | null
  } | null
}

/** 越小越前面。跌破止跌最需要反應，所以排最前。 */
const SEVERITY: Record<StatusKind, number> = {
  'below-stop': 0,
  'in-sell': 1,
  'in-add': 2,
  'near-stop': 3,
  'near-sell': 4,
  'near-add': 5,
  none: 9,
}

export function sortRows<T extends SortableRow>(rows: readonly T[], mode: SortMode): T[] {
  // 一律複製再排。就地排序會改到呼叫端的陣列，在 React 裡是災難來源。
  const out = [...rows]

  if (mode === 'sim') {
    return out.sort((a, b) => {
      // 沒開帳的排最後，不要當成 0% 插進中間——「還沒有帳戶」跟「不賺不賠」
      // 是兩件事
      if (!a.sim && !b.sim) return 0
      if (!a.sim) return 1
      if (!b.sim) return -1
      return b.sim.retPct - a.sim.retPct
    })
  }

  if (mode === 'code') {
    return out.sort((a, b) => a.code.localeCompare(b.code, 'en'))
  }

  if (mode === 'change') {
    return out.sort((a, b) => {
      // 沒有漲跌幅的排最後，不要當成 0 插進中間
      if (a.chg_pct === null && b.chg_pct === null) return 0
      if (a.chg_pct === null) return 1
      if (b.chg_pct === null) return -1
      return a.chg_pct - b.chg_pct
    })
  }

  if (mode === 'attention') {
    const scored = out.map((r, i) => {
      const st = levelStatus(r.close, {
        sell: (r.levels.find((l) => l.kind === 'sell') ?? null) as never,
        stop: r.levels.find((l) => l.kind === 'stop')?.lo ?? null,
        add: (r.levels.find((l) => l.kind === 'add') ?? null) as never,
      })
      // 明日有動作的排在所有狀態之前。
      //
      // 「已跌破止跌」是**狀態**，「明天開盤賣出」是**指令**——後者更具體，
      // 而且是這個站唯一可以照做的東西。狀態告訴你發生了什麼，
      // 指令告訴你要做什麼，該注意的清單當然先給指令。
      // `pending` 不動作時也會存在（它要帶「為什麼不做」的理由），
      // 所以不能用 != null 判斷有沒有動作——那會讓每一列都被當成有事要做。
      const p = r.sim?.pending
      const hasTodo = p != null && (p.buy || p.sell)
      return {
        r, i,
        sev: (hasTodo ? -10 : 0) + SEVERITY[st.kind],
        dist: Math.abs(st.distancePct ?? 0),
      }
    })
    scored.sort((a, b) => {
      if (a.sev !== b.sev) return a.sev - b.sev
      if (a.dist !== b.dist) return a.dist - b.dist
      return a.i - b.i // 平手時維持原順序，不要每次重整就跳來跳去
    })
    return scored.map((s) => s.r)
  }

  return out
}
