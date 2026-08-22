/**
 * 「照建議做」比「買了不動」好多少——**直接把差距畫出來**。
 *
 * 原本畫三條資金曲線疊在一起。那要求讀者同時追兩條線、在腦裡算它們的距離，
 * 再判斷距離是變大還變小。而他真正要的答案只有一句：**這樣做到底有沒有幫助。**
 *
 * 所以改成一條線：`照建議做 − 買了不動`。零線是分水嶺，線在上面就是有幫助、
 * 在下面就是拖後腿，而且填色直接把「多久處於哪一邊」變成面積。不需要圖例，
 * 也不需要比較兩個數字。
 *
 * 絕對報酬沒有消失，它以文字放在圖旁邊——**兩個數字用讀的比用看兩條曲線快**。
 */

export const W_WIDE = 920
export const W_NARROW = 360

const H = 150
const ML = 44
const MT = 12

export interface GapPoint { d: string; gap: number }

/** 兩條曲線相減。只取兩邊都有資料的日子——AI 那條起跑得晚，硬對齊會造出假的差距 */
export function gapSeries(
  lead: readonly { d: string; retPct: number }[],
  hold: readonly { d: string; retPct: number }[],
): GapPoint[] {
  const holdBy = new Map(hold.map((p) => [p.d, p.retPct]))
  const out: GapPoint[] = []
  for (const p of lead) {
    const h = holdBy.get(p.d)
    if (h === undefined) continue
    out.push({ d: p.d, gap: p.retPct - h })
  }
  return out
}

export function GapChart({
  points, leadLabel, id, width = W_WIDE,
}: {
  points: GapPoint[]
  /** 這條差距是誰減掉買了不動的。同一張圖在不同標的上可能是 AI，也可能是規則 */
  leadLabel: string
  /**
   * 這張圖在頁面上的唯一識別。
   *
   * **不能用 width 當 id 的一部分就好**：回顧頁一次畫五張圖、寬度都一樣，
   * 於是五個 `clipPath` 共用同一個 id，瀏覽器只認第一個——後面每一張圖
   * 都拿 0050 的零線高度去切紅綠，填色位置全錯。截圖才看得出來。
   */
  id: string
  width?: number
}) {
  if (points.length < 2) {
    return <p className="empty">資料還太短，畫不出差距。</p>
  }

  const PW = width - ML - 14
  const PH = H - MT - 20

  const values = points.map((p) => p.gap)
  const lo = Math.min(0, ...values)
  const hi = Math.max(0, ...values)
  // 零線一定要在圖上，而且上下都要留一點空間，否則貼著邊框看不出方向
  const pad = Math.max((hi - lo) * 0.15, 0.5)
  const ymin = lo - pad
  const ymax = hi + pad

  const x = (i: number) => ML + (PW * i) / (points.length - 1)
  const y = (v: number) => MT + PH * (1 - (v - ymin) / (ymax - ymin))
  const zeroY = y(0)

  const line = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.gap).toFixed(1)}`)
    .join('')
  // 填到零線：面積就是「差了多少 × 持續多久」，比線本身更好讀
  const area = `${line}L${x(points.length - 1).toFixed(1)},${zeroY.toFixed(1)}`
    + `L${x(0).toFixed(1)},${zeroY.toFixed(1)}Z`

  const last = points[points.length - 1]!.gap
  const good = last >= 0
  const labelEvery = Math.ceil(points.length / (width < 600 ? 3 : 6))

  return (
    <>
      <svg className="chartsvg" viewBox={`0 0 ${width} ${H}`} role="img"
        aria-label={`${leadLabel}與買了不動的差距，目前 ${last.toFixed(2)}%`}>
        {/* 填色用 **--up / --down**，不是 --buy / --sell。
            這個站是紅漲綠跌（globals.css 有明講理由：給台股使用者每天看的），
            而差距本質上也是一種漲跌。用綠色代表「好」會讓同一件事在數字上
            是綠、在圖上是紅——實測就長這樣：−0.29% 的數字是綠的、線卻是紅的。
            用 clipPath 讓同一塊面積被零線切開，不必分段算路徑。 */}
        <defs>
          <clipPath id={`gap-up-${id}`}>
            <rect x={0} y={0} width={width} height={zeroY} />
          </clipPath>
          <clipPath id={`gap-down-${id}`}>
            <rect x={0} y={zeroY} width={width} height={H - zeroY} />
          </clipPath>
        </defs>
        <path d={area} clipPath={`url(#gap-up-${id})`}
          style={{ fill: 'var(--up)', opacity: .16 }} />
        <path d={area} clipPath={`url(#gap-down-${id})`}
          style={{ fill: 'var(--down)', opacity: .16 }} />

        <line className="refline" x1={ML} y1={zeroY} x2={width - 14} y2={zeroY} />
        <text className="tick" x={ML - 6} y={zeroY + 4} textAnchor="end">0</text>
        <text className="tick" x={ML - 6} y={y(hi) + 10} textAnchor="end">
          {hi > 0 ? `+${hi.toFixed(0)}%` : ''}
        </text>
        <text className="tick" x={ML - 6} y={y(lo) - 2} textAnchor="end">
          {lo < 0 ? `−${Math.abs(lo).toFixed(0)}%` : ''}
        </text>

        <path d={line} fill="none"
          style={{ stroke: `var(--${good ? 'up' : 'down'})`, strokeWidth: 2 }} />

        {/* 最後一點標出來，眼睛要有著陸處 */}
        <circle cx={x(points.length - 1)} cy={y(last)} r={3.5}
          style={{ fill: `var(--${good ? 'up' : 'down'})` }} />

        {points.map((p, i) => (i % labelEvery === 0 ? (
          <text key={p.d} className="tick" x={x(i)} y={H - 4} textAnchor="middle">
            {p.d.slice(5)}
          </text>
        ) : null))}
      </svg>
      <p className="gapcaption">
        線在 0 以上代表<b>{leadLabel}比買了不動好</b>，在 0 以下代表反而更差。
      </p>
    </>
  )
}
