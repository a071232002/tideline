/**
 * 「照建議做」比「買了不動」好多少——一條線，零線是分水嶺。
 *
 * 這是主圖底下的一個圖層，不是獨立的一張圖：它跟價格圖共用同樣的日期範圍，
 * 上下對齊，所以「這一筆買在這裡」與「之後差距怎麼走」看得出關係。
 *
 * 填色用站上的紅漲綠跌（`--up` / `--down`），不用「綠＝好」那一套——
 * 否則同一件事在數字上是綠、在圖上是紅。
 */

const H = 96
const ML = 44
const MT = 10
const AXIS_H = 18

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

export function GapPanel({
  points, id, width = 920,
}: {
  points: GapPoint[]
  /** 同一頁會有寬窄兩份，clipPath 的 id 必須不同，否則後者會用到前者的裁切區 */
  id: string
  width?: number
}) {
  if (points.length < 2) return null

  const PW = width - ML - 14
  const PH = H - MT - AXIS_H
  const values = points.map((p) => p.gap)
  const lo = Math.min(0, ...values)
  const hi = Math.max(0, ...values)
  const pad = Math.max((hi - lo) * 0.15, 0.3)
  const x = (i: number) => ML + (PW * i) / (points.length - 1)
  const y = (v: number) => MT + PH * (1 - (v - (lo - pad)) / ((hi + pad) - (lo - pad)))
  const zeroY = y(0)

  const line = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.gap).toFixed(1)}`)
    .join('')
  const area = `${line}L${x(points.length - 1).toFixed(1)},${zeroY.toFixed(1)}`
    + `L${x(0).toFixed(1)},${zeroY.toFixed(1)}Z`

  const last = points[points.length - 1]!.gap
  const good = last >= 0

  return (
    <svg className="chartsvg gappanel" viewBox={`0 0 ${width} ${H}`} role="img"
      aria-label={`與買了不動的差距，目前 ${last.toFixed(2)}%`}>
      <defs>
        <clipPath id={`gp-up-${id}`}>
          <rect x={0} y={0} width={width} height={Math.max(zeroY, 0)} />
        </clipPath>
        <clipPath id={`gp-down-${id}`}>
          <rect x={0} y={zeroY} width={width} height={Math.max(H - zeroY, 0)} />
        </clipPath>
      </defs>
      <path d={area} clipPath={`url(#gp-up-${id})`}
        style={{ fill: 'var(--up)', opacity: .16 }} />
      <path d={area} clipPath={`url(#gp-down-${id})`}
        style={{ fill: 'var(--down)', opacity: .16 }} />

      <line className="refline" x1={ML} y1={zeroY} x2={width - 14} y2={zeroY} />
      <text className="tick" x={ML - 6} y={zeroY + 4} textAnchor="end">0</text>
      <path d={line} fill="none"
        style={{ stroke: `var(--${good ? 'up' : 'down'})`, strokeWidth: 1.8 }} />
      <text className="tick" x={width - 14} y={MT + 10} textAnchor="end"
        style={{ fill: 'var(--muted)' }}>
        vs 買了不動　{last >= 0 ? '+' : ''}{last.toFixed(2)}%
      </text>
    </svg>
  )
}
