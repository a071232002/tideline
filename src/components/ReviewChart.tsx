/**
 * 回顧用的一張圖，兩層資訊。
 *
 * 上半：**收盤價走勢 ＋ 買賣點**。買在哪、賣在哪，直接標在價格上——
 * 這是「回顧」最直覺的問法：那幾筆進出，位置對不對？
 * 標在報酬率曲線上看不出這件事，因為報酬率不是價格。
 *
 * 下半：**跟「買了不動」的差距**。同一條時間軸，零線是分水嶺，
 * 填色是「差多少 × 多久」。它回答的是另一個問題：那些進出到底有沒有幫助。
 *
 * 兩個問題共用一條 x 軸，所以「這一筆買在這裡」與「之後差距怎麼走」
 * 是上下對齊的，眼睛不必在兩張圖之間換算日期。
 */

export const W_WIDE = 920
export const W_NARROW = 360

const ML = 44
const MT = 12
/** 上半（價格）與下半（差距）的高度。價格是主角，給它多一點 */
const PRICE_H = 168
const GAP_H = 72
const AXIS_H = 20
const SPLIT = 14

export interface Bar { d: string; c: number }
export interface Mark { d: string; side: 'buy' | 'sell'; price: number; stop: boolean }
export interface GapPoint { d: string; gap: number }

/** 兩條報酬率曲線相減。只取兩邊都有的日子——AI 那條起跑晚，硬對齊會造出假差距 */
export function gapSeries(
  lead: readonly { d: string; retPct: number }[],
  hold: readonly { d: string; retPct: number }[],
): GapPoint[] {
  const holdBy = new Map(hold.map((p) => [p.d, p.retPct]))
  const out: GapPoint[] = []
  for (const p of lead) {
    const h = holdBy.get(p.d)
    if (h !== undefined) out.push({ d: p.d, gap: p.retPct - h })
  }
  return out
}

export function ReviewChart({
  bars, marks, gap, leadLabel, id, width = W_WIDE,
}: {
  bars: Bar[]
  marks: Mark[]
  gap: GapPoint[]
  leadLabel: string
  /** 頁面上有好幾張圖，clipPath 的 id 必須唯一，否則後面的圖會用到前面的裁切區 */
  id: string
  width?: number
}) {
  if (bars.length < 2) return <p className="empty">資料還太短，畫不出走勢。</p>

  const H = MT + PRICE_H + SPLIT + GAP_H + AXIS_H
  const PW = width - ML - 14
  const x = (i: number) => ML + (PW * i) / (bars.length - 1)
  const idxOf = new Map(bars.map((b, i) => [b.d, i]))

  // 上半：價格
  const closes = bars.map((b) => b.c)
  const markPrices = marks.map((m) => m.price)
  const pLo = Math.min(...closes, ...markPrices)
  const pHi = Math.max(...closes, ...markPrices)
  const pPad = (pHi - pLo) * 0.08 || 1
  const py = (v: number) =>
    MT + PRICE_H * (1 - (v - (pLo - pPad)) / ((pHi + pPad) - (pLo - pPad)))
  const priceLine = bars
    .map((b, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${py(b.c).toFixed(1)}`)
    .join('')

  // 下半：差距
  const gapTop = MT + PRICE_H + SPLIT
  const gv = gap.map((g) => g.gap)
  const gLo = Math.min(0, ...gv)
  const gHi = Math.max(0, ...gv)
  const gPad = Math.max((gHi - gLo) * 0.15, 0.3)
  const gy = (v: number) =>
    gapTop + GAP_H * (1 - (v - (gLo - gPad)) / ((gHi + gPad) - (gLo - gPad)))
  const zeroY = gy(0)

  const gapPts = gap.map((g) => ({ i: idxOf.get(g.d), gap: g.gap }))
    .filter((p): p is { i: number; gap: number } => p.i !== undefined)
  const gapLine = gapPts
    .map((p, n) => `${n === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)},${gy(p.gap).toFixed(1)}`)
    .join('')
  const gapArea = gapPts.length > 1
    ? `${gapLine}L${x(gapPts[gapPts.length - 1]!.i).toFixed(1)},${zeroY.toFixed(1)}`
      + `L${x(gapPts[0]!.i).toFixed(1)},${zeroY.toFixed(1)}Z`
    : ''

  const lastGap = gapPts.length > 0 ? gapPts[gapPts.length - 1]!.gap : 0
  const good = lastGap >= 0
  const labelEvery = Math.ceil(bars.length / (width < 600 ? 3 : 6))

  return (
    <svg className="chartsvg" viewBox={`0 0 ${width} ${H}`} role="img"
      aria-label={`收盤價與買賣點，以及與買了不動的差距，目前 ${lastGap.toFixed(2)}%`}>
      <defs>
        <clipPath id={`rv-up-${id}`}>
          <rect x={0} y={gapTop} width={width} height={Math.max(zeroY - gapTop, 0)} />
        </clipPath>
        <clipPath id={`rv-down-${id}`}>
          <rect x={0} y={zeroY} width={width} height={Math.max(gapTop + GAP_H - zeroY, 0)} />
        </clipPath>
      </defs>

      {/* ---- 上半：收盤價與買賣點 ---- */}
      <text className="tick" x={ML - 6} y={py(pHi) + 4} textAnchor="end">{pHi.toFixed(0)}</text>
      <text className="tick" x={ML - 6} y={py(pLo) + 4} textAnchor="end">{pLo.toFixed(0)}</text>
      <path className="closeline" d={priceLine} />

      {marks.map((m, n) => {
        const i = idxOf.get(m.d)
        if (i === undefined) return null
        const cx = x(i)
        const cy = py(m.price)
        const varName = m.stop ? 'stop' : m.side === 'buy' ? 'buy' : 'sell'
        // 買點在價格下方朝上、賣點在上方朝下，才不會蓋住線
        const tri = m.side === 'buy'
          ? `${cx},${cy + 5} ${cx - 5},${cy + 13} ${cx + 5},${cy + 13}`
          : `${cx},${cy - 5} ${cx - 5},${cy - 13} ${cx + 5},${cy - 13}`
        return (
          <g key={`${m.d}-${m.side}-${n}`}>
            {/* 從買賣點拉一條細線到下半，兩層資訊才對得起來 */}
            <line x1={cx} y1={cy} x2={cx} y2={gapTop + GAP_H}
              style={{ stroke: `var(--${varName})`, strokeWidth: 1, opacity: .22 }} />
            <polygon points={tri} style={{ fill: `var(--${varName})`, opacity: .95 }}>
              <title>{`${m.d} ${m.side === 'buy' ? '買進' : m.stop ? '止損賣出' : '賣出'} @ ${m.price.toFixed(2)}`}</title>
            </polygon>
          </g>
        )
      })}

      {/* ---- 下半：與買了不動的差距 ---- */}
      {gapArea && (
        <>
          {/* 顏色跟著站上的紅漲綠跌走，不用「綠＝好」那套——
              否則同一件事在數字上是綠、在圖上是紅 */}
          <path d={gapArea} clipPath={`url(#rv-up-${id})`}
            style={{ fill: 'var(--up)', opacity: .16 }} />
          <path d={gapArea} clipPath={`url(#rv-down-${id})`}
            style={{ fill: 'var(--down)', opacity: .16 }} />
        </>
      )}
      <line className="refline" x1={ML} y1={zeroY} x2={width - 14} y2={zeroY} />
      <text className="tick" x={ML - 6} y={zeroY + 4} textAnchor="end">0</text>
      {gapLine && (
        <path d={gapLine} fill="none"
          style={{ stroke: `var(--${good ? 'up' : 'down'})`, strokeWidth: 1.8 }} />
      )}
      {/* 標籤放右上角。放左邊會跟零線的「0」撞在一起——差距很小的時候
          零線就在面板頂端，兩個字疊成一團（2330 實測）。 */}
      <text className="tick" x={width - 14} y={gapTop + 10} textAnchor="end"
        style={{ fill: 'var(--muted)' }}>vs 買了不動</text>

      {/* ---- 共用的日期軸 ---- */}
      {bars.map((b, i) => (i % labelEvery === 0 ? (
        <text key={b.d} className="tick" x={x(i)} y={H - 4} textAnchor="middle">
          {b.d.slice(5)}
        </text>
      ) : null))}
    </svg>
  )
}
