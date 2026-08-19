import { levelStatus, type StatusKind } from './status'

/**
 * 清單排序。預設是「該注意的浮上來」——不然清單一長，有狀態的那幾檔
 * 沉在最下面，狀態徽章等於白做。
 */

export type SortMode = 'attention' | 'code' | 'change'

interface SortableRow {
  code: string
  close: number | null
  chg_pct: number | null
  levels: { kind: 'sell' | 'stop' | 'add'; lo: number; hi?: number }[]
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
      return { r, i, sev: SEVERITY[st.kind], dist: Math.abs(st.distancePct ?? 0) }
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
