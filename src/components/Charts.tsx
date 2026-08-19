/**
 * 兩張圖，直接輸出 SVG，不用圖表函式庫（PLAN §3）。
 *
 * 顏色一律走 CSS 變數（`.closeline` / `.bandfill` …），**不能寫死**，
 * 否則深色模式下線條會消失。縮放靠 viewBox + width:100%，絕不橫向捲動。
 */

const W = 920
const ML = 46
const MT = 14

interface Pt { d: string; c: number }
interface Band { d: string; mid: number; up: number; lo: number }

function niceTicks(min: number, max: number, count = 5): number[] {
  const span = max - min
  if (span <= 0) return [min]
  const raw = span / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v)
  return out
}

/** 圖一：收盤價＋布林通道＋三條水平價位線 */
export function PriceChart({
  bars, bands, levels, currency,
}: {
  bars: Pt[]
  bands: Band[]
  levels: { sell?: [number, number] | null; stop?: number | null; add?: [number, number] | null }
  currency: string
}) {
  const H = 380
  const PH = H - MT - 26
  const PW = W - ML - 14
  if (bars.length < 2) return <p className="empty">資料不足，畫不出圖。</p>

  const bandByDate = new Map(bands.map((b) => [b.d, b]))
  const values: number[] = []
  for (const b of bars) values.push(b.c)
  for (const b of bands) { values.push(b.up, b.lo) }
  for (const v of [levels.stop, levels.sell?.[0], levels.sell?.[1], levels.add?.[0], levels.add?.[1]]) {
    if (typeof v === 'number') values.push(v)
  }
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const pad = (hi - lo) * 0.06 || 1
  const ymin = lo - pad
  const ymax = hi + pad

  const x = (i: number) => ML + (PW * i) / (bars.length - 1)
  const y = (v: number) => MT + PH * (1 - (v - ymin) / (ymax - ymin))

  const closePath = bars.map((b, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(b.c).toFixed(1)}`).join('')

  const withBand = bars.map((b, i) => ({ i, band: bandByDate.get(b.d) })).filter((p) => p.band)
  const upPath = withBand.map((p, n) => `${n === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)},${y(p.band!.up).toFixed(1)}`).join('')
  const loPath = withBand.map((p, n) => `${n === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)},${y(p.band!.lo).toFixed(1)}`).join('')
  const midPath = withBand.map((p, n) => `${n === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)},${y(p.band!.mid).toFixed(1)}`).join('')
  const fill = withBand.length > 1
    ? upPath + ' ' + withBand.slice().reverse()
        .map((p) => `L${x(p.i).toFixed(1)},${y(p.band!.lo).toFixed(1)}`).join('') + 'Z'
    : ''

  const digits = currency === 'TWD' ? 0 : 0
  const hlines: { v: number; cls: string; label: string }[] = []
  if (levels.sell) hlines.push({ v: levels.sell[0], cls: 'sellc', label: '賣出' })
  if (typeof levels.stop === 'number') hlines.push({ v: levels.stop, cls: 'stopc', label: '止跌' })
  if (levels.add) hlines.push({ v: levels.add[1], cls: 'buyc', label: '加碼' })

  const labelEvery = Math.ceil(bars.length / 6)

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="收盤價與布林通道">
        {niceTicks(ymin, ymax).map((v) => (
          <g key={v}>
            <line className="grid" x1={ML} y1={y(v)} x2={W - 14} y2={y(v)} />
            <text className="tick" x={ML - 6} y={y(v) + 4} textAnchor="end">{v.toFixed(digits)}</text>
          </g>
        ))}
        {fill && <path className="bandfill" d={fill} />}
        {upPath && <path className="bandline" d={upPath} />}
        {loPath && <path className="bandline" d={loPath} />}
        {midPath && <path className="midline2" d={midPath} />}
        <path className="closeline" d={closePath} />
        {(() => {
          // 三條價位線靠得近時標籤會疊在一起（實測 0050 的 102.50 與 100.00）。
          // 由上而下排，記住上一個標籤的 y，不夠 13px 就往下推。
          let lastY = -Infinity
          return hlines
            .slice()
            .sort((a, b) => a.v - b.v)
            .reverse()
            .map((h) => {
              const varName = h.label === '賣出' ? 'sell' : h.label === '止跌' ? 'stop' : 'buy'
              const lineY = y(h.v)
              const labelY = Math.max(lineY - 4, lastY + 13)
              lastY = labelY
              return (
                <g key={h.label}>
                  <line className="refline" x1={ML} y1={lineY} x2={W - 14} y2={lineY}
                    style={{ stroke: `var(--${varName})` }} />
                  <text className="tick" x={W - 16} y={labelY} textAnchor="end"
                    style={{ fill: `var(--${varName})`, fontWeight: 600 }}>
                    {h.label} {h.v.toFixed(2)}
                  </text>
                </g>
              )
            })
        })()}
        {bars.map((b, i) => (i % labelEvery === 0 ? (
          <text key={b.d} className="tick" x={x(i)} y={H - 6} textAnchor="middle">{b.d.slice(5)}</text>
        ) : null))}
      </svg>
      <div className="legend">
        <span><i className="sw" style={{ borderColor: 'var(--blue)' }} />收盤價</span>
        <span><i className="sw" style={{ borderColor: 'var(--orange)' }} />布林中軌</span>
        <span><i className="sw" style={{ borderColor: 'var(--bandline)' }} />上下軌</span>
        <span><i className="sw dash" style={{ borderColor: 'var(--sell)' }} />賣出</span>
        <span><i className="sw dash" style={{ borderColor: 'var(--stop)' }} />止跌</span>
        <span><i className="sw dash" style={{ borderColor: 'var(--buy)' }} />加碼</span>
      </div>
    </>
  )
}

/** 圖二：KD，含 20 / 80 參考線 */
export function KdChart({ points }: { points: { d: string; k: number; d_val: number }[] }) {
  const H = 230
  const PH = H - MT - 26
  const PW = W - ML - 14
  if (points.length < 2) return <p className="empty">資料不足，畫不出圖。</p>

  const x = (i: number) => ML + (PW * i) / (points.length - 1)
  const y = (v: number) => MT + PH * (1 - v / 100)

  const kPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.k).toFixed(1)}`).join('')
  const dPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.d_val).toFixed(1)}`).join('')
  const labelEvery = Math.ceil(points.length / 6)

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="KD 指標">
        {[0, 20, 50, 80, 100].map((v) => (
          <g key={v}>
            <line className={v === 20 || v === 80 ? 'refline' : 'grid'}
              x1={ML} y1={y(v)} x2={W - 14} y2={y(v)} />
            <text className="tick" x={ML - 6} y={y(v) + 4} textAnchor="end">{v}</text>
          </g>
        ))}
        <path className="closeline" d={kPath} />
        <path className="midline2" d={dPath} />
        {points.map((p, i) => (i % labelEvery === 0 ? (
          <text key={p.d} className="tick" x={x(i)} y={H - 6} textAnchor="middle">{p.d.slice(5)}</text>
        ) : null))}
      </svg>
      <div className="legend">
        <span><i className="sw" style={{ borderColor: 'var(--blue)' }} />K</span>
        <span><i className="sw" style={{ borderColor: 'var(--orange)' }} />D</span>
        <span><i className="sw dash" style={{ borderColor: 'var(--muted)' }} />20 / 80 參考線</span>
      </div>
    </>
  )
}
