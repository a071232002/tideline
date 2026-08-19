/**
 * 把「收盤價 vs 三個關鍵價位」壓成一個狀態。
 *
 * 為什麼需要這個：清單上每一列的數字都長得差不多，掃過去看不出今天哪一檔
 * 該動作。真正要回答的問題是「有沒有到價位」，不是「價位是多少」。
 *
 * 清單與個股頁共用這一份，兩邊才不會對同一檔講出不一樣的話。
 */

export type StatusKind =
  | 'below-stop'   // 收盤跌破止跌 —— 結構破壞，最需要反應
  | 'in-sell'      // 進入賣出區
  | 'in-add'       // 進入加碼區
  | 'near-stop'
  | 'near-sell'
  | 'near-add'
  | 'none'

export interface LevelSet {
  sell?: { lo: number; hi: number } | null
  stop?: number | null
  add?: { lo: number; hi: number } | null
}

export interface Status {
  kind: StatusKind
  label: string
  /** 用哪一組語意色：對應 --sell / --stop / --buy */
  tone: 'sell' | 'stop' | 'buy' | 'none'
  /** 離該價位還有多少 %（正號＝還要漲上去，負號＝還要跌下來）；已經到了就是 null */
  distancePct: number | null
}

const NONE: Status = { kind: 'none', label: '', tone: 'none', distancePct: null }

/**
 * 幾 % 以內算「接近」。
 *
 * 一開始設 3%，被測試打臉：0050 的加碼區上緣 102.5 與賣出區下緣 107.5 只差 4.9%，
 * 3% 的門檻讓這兩段幾乎接起來，中間沒有任何「沒事」的空間——每一列都掛徽章，
 * 徽章就不再是訊號。收到 1.5% 才留得住「今天沒事」這個狀態。
 */
const NEAR_PCT = 1.5

function pctTo(close: number, target: number): number {
  return ((target - close) / close) * 100
}

export function levelStatus(close: number | null, levels: LevelSet): Status {
  if (close === null || !Number.isFinite(close) || close <= 0) return NONE

  const { sell, stop, add } = levels

  // ---- 已經到了：由嚴重度排序，跌破止跌最優先 ----
  if (typeof stop === 'number' && close < stop) {
    return { kind: 'below-stop', label: '已跌破止跌', tone: 'sell', distancePct: null }
  }
  if (sell && close >= sell.lo) {
    return { kind: 'in-sell', label: '已達賣出區', tone: 'sell', distancePct: null }
  }
  if (add && close >= add.lo && close <= add.hi) {
    return { kind: 'in-add', label: '已進加碼區', tone: 'buy', distancePct: null }
  }

  // ---- 還沒到，但很近 ----
  const candidates: { kind: StatusKind; label: string; tone: Status['tone']; d: number }[] = []

  if (typeof stop === 'number') {
    const d = pctTo(close, stop) // 負值：還要跌這麼多才碰到
    if (d < 0 && Math.abs(d) <= NEAR_PCT) {
      candidates.push({ kind: 'near-stop', label: '接近止跌', tone: 'stop', d })
    }
  }
  if (sell) {
    const d = pctTo(close, sell.lo)
    if (d > 0 && d <= NEAR_PCT) {
      candidates.push({ kind: 'near-sell', label: '接近賣出區', tone: 'sell', d })
    }
  }
  if (add) {
    // 加碼區在下方時看下緣，在上方時看上緣——取比較近的那一邊
    const d = close > add.hi ? pctTo(close, add.hi) : pctTo(close, add.lo)
    if (Math.abs(d) <= NEAR_PCT) {
      candidates.push({ kind: 'near-add', label: '接近加碼區', tone: 'buy', d })
    }
  }

  if (candidates.length === 0) return NONE

  // 最近的那個才有意義
  const best = candidates.reduce((a, b) => (Math.abs(b.d) < Math.abs(a.d) ? b : a))
  return { kind: best.kind, label: best.label, tone: best.tone, distancePct: best.d }
}
