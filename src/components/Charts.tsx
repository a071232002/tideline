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
export interface LevelHistoryPoint {
  d: string
  sellLo: number | null
  stop: number | null
  addLo: number | null
  addHi: number | null
  origin: string
}
interface Band { d: string; mid: number; up: number; lo: number }
/** 模擬帳戶的成交點。畫在圖上比任何統計數字都有說服力（PLAN §13.7） */
export interface TradeMark {
  d: string
  side: 'buy' | 'sell'
  price: number
  stop: boolean
}

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
  bars, bands, levels, currency, history, marks,
}: {
  bars: Pt[]
  bands: Band[]
  levels: { sell?: [number, number] | null; stop?: number | null; add?: [number, number] | null }
  currency: string
  /** 當時每天說的價位。給了就疊上去，回顧才看得出建議準不準。 */
  history?: LevelHistoryPoint[]
  /** 模擬帳戶的成交點。一眼就看得出是「低接高出」還是「追高殺低」。 */
  marks?: TradeMark[]
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

  const digits = 0
  const hlines: { v: number; cls: string; label: string }[] = []
  if (levels.sell) hlines.push({ v: levels.sell[0], cls: 'sellc', label: '賣出' })
  if (typeof levels.stop === 'number') hlines.push({ v: levels.stop, cls: 'stopc', label: '止跌' })
  if (levels.add) hlines.push({ v: levels.add[1], cls: 'buyc', label: '加碼' })

  // 區間畫成色帶而不是單線——「現在離哪個區還有多遠」用看的就知道，
  // 不必回頭讀數字。單線只告訴你邊界在哪，說不出區間有多寬。
  const zones: { lo: number; hi: number; varName: string }[] = []
  if (levels.sell) zones.push({ lo: levels.sell[0], hi: levels.sell[1], varName: 'sell' })
  if (levels.add) zones.push({ lo: levels.add[0], hi: levels.add[1], varName: 'buy' })

  // 最後一天的位置：眼睛要有個著陸點，否則得自己找線的end
  const lastI = bars.length - 1
  const lastC = bars[lastI]!.c

  const labelEvery = Math.ceil(bars.length / 6)

  // 歷史價位：階梯線（價位一天一個值，不該畫成平滑折線——它是離散的判斷）
  const idxByDate = new Map(bars.map((b, i) => [b.d, i]))
  const histSeries: { key: string; varName: string; pick: (h: LevelHistoryPoint) => number | null }[] = [
    { key: 'hist-sell', varName: 'sell', pick: (h) => h.sellLo },
    { key: 'hist-stop', varName: 'stop', pick: (h) => h.stop },
    { key: 'hist-add', varName: 'buy', pick: (h) => h.addHi },
  ]
  const histPaths = (history ?? []).length > 1
    ? histSeries.map(({ key, varName, pick }) => {
        let d = ''
        let prevY: number | null = null
        for (const h of history!) {
          const i = idxByDate.get(h.d)
          const v = pick(h)
          if (i === undefined || v === null) continue
          const px = x(i)
          const py = y(v)
          if (d === '') d = `M${px.toFixed(1)},${py.toFixed(1)}`
          else if (prevY !== null && Math.abs(py - prevY) > 0.01) {
            d += `L${px.toFixed(1)},${prevY.toFixed(1)}L${px.toFixed(1)},${py.toFixed(1)}`
          } else {
            d += `L${px.toFixed(1)},${py.toFixed(1)}`
          }
          prevY = py
        }
        return { key, varName, d }
      }).filter((p) => p.d !== '')
    : []

  return (
    <>
      <svg className="chartsvg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="收盤價與布林通道">
        {niceTicks(ymin, ymax).map((v) => (
          <g key={v}>
            <line className="grid" x1={ML} y1={y(v)} x2={W - 14} y2={y(v)} />
            <text className="tick" x={ML - 6} y={y(v) + 4} textAnchor="end">{v.toFixed(digits)}</text>
          </g>
        ))}
        {/* 當時說的價位，畫成階梯線疊在走勢上。
            這是回顧的重點：止跌線被跌破之後價格真的續跌了嗎？
            賣出線碰到之後真的回落嗎？看圖比看統計數字直接。 */}
        {histPaths.map((h) => (
          <path key={h.key} d={h.d} fill="none"
            style={{ stroke: `var(--${h.varName})`, strokeWidth: 1.5, opacity: .75 }} />
        ))}
        {zones.map((z) => (
          <rect key={z.varName} x={ML} y={Math.min(y(z.hi), y(z.lo))}
            width={PW} height={Math.max(Math.abs(y(z.lo) - y(z.hi)), 2)}
            style={{ fill: `var(--${z.varName})`, opacity: .10 }} />
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
                  {/* 有歷史軌跡時不再畫整條橫線：那條線的右端就是軌跡的右端，
                      兩條疊在一起只會互相干擾。沒有歷史時才需要它當參考。 */}
                  {histPaths.length === 0 && (
                    <line className="refline" x1={ML} y1={lineY} x2={W - 14} y2={lineY}
                      style={{ stroke: `var(--${varName})` }} />
                  )}
                  {/* 價位標籤放左側。右邊留給「今天的價格」那個端點標籤，
                      兩邊都擠在右緣會疊在一起。 */}
                  <text className="tick" x={ML + 6} y={labelY} textAnchor="start"
                    style={{ fill: `var(--${varName})`, fontWeight: 600 }}>
                    {h.label} {h.v.toFixed(2)}
                  </text>
                </g>
              )
            })
        })()}
        {/* 模擬帳戶的成交點。買綠三角朝上、賣紅三角朝下、止損橘色。
            這比任何統計數字都有說服力——低接高出還是追高殺低，用看的就知道。 */}
        {(marks ?? []).map((m, n) => {
          const i = idxByDate.get(m.d)
          if (i === undefined) return null
          const px = x(i)
          const py = y(m.price)
          const varName = m.stop ? 'stop' : m.side === 'buy' ? 'buy' : 'sell'
          // 買點畫在價格下方朝上、賣點畫在上方朝下——不要蓋住收盤價那條線
          const tri = m.side === 'buy'
            ? `${px},${py + 5} ${px - 4.5},${py + 12} ${px + 4.5},${py + 12}`
            : `${px},${py - 5} ${px - 4.5},${py - 12} ${px + 4.5},${py - 12}`
          return (
            <polygon key={`${m.d}-${m.side}-${n}`} points={tri}
              style={{ fill: `var(--${varName})`, opacity: .9 }}>
              <title>{`${m.d} ${m.side === 'buy' ? '買進' : m.stop ? '止損賣出' : '賣出'} @ ${m.price.toFixed(2)}`}</title>
            </polygon>
          )
        })}

        {/* 今天在哪：端點圓點＋收盤價標籤 */}
        <circle cx={x(lastI)} cy={y(lastC)} r={4} className="hoverdot"
          style={{ fill: 'var(--blue)' }} />
        <circle cx={x(lastI)} cy={y(lastC)} r={7.5} fill="none"
          style={{ stroke: 'var(--blue)', opacity: .35 }} />
        <text x={x(lastI) - 12} y={y(lastC) - 12} textAnchor="end"
          style={{ fill: 'var(--blue)', fontWeight: 800, fontSize: 13 }}>
          {lastC.toFixed(2)}
        </text>

        {bars.map((b, i) => (i % labelEvery === 0 ? (
          <text key={b.d} className="tick" x={x(i)} y={H - 6} textAnchor="middle">{b.d.slice(5)}</text>
        ) : null))}
      </svg>
      <div className="legend">
        <span><i className="sw" style={{ borderColor: 'var(--blue)' }} />收盤價（末點＝今日）</span>
        <span><i className="sw" style={{ borderColor: 'var(--mid)' }} />布林中軌</span>
        <span><i className="sw" style={{ borderColor: 'var(--bandline)' }} />上下軌</span>
        <span><i className="sw dash" style={{ borderColor: 'var(--sell)' }} />賣出</span>
        <span><i className="sw dash" style={{ borderColor: 'var(--stop)' }} />止跌</span>
        <span><i className="sw dash" style={{ borderColor: 'var(--buy)' }} />加碼</span>
        {(marks ?? []).length > 0 && (
          <span><i className="sw" style={{ borderColor: 'var(--buy)' }} />▲買／▼賣（模擬帳戶）</span>
        )}
        {histPaths.length > 0 && (
          <span style={{ color: 'var(--muted)' }}>
            階梯線＝<b>當時每天說的價位</b>（回頭看準不準）
          </span>
        )}
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
      <svg className="chartsvg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="KD 指標">
        {[0, 20, 50, 80, 100].map((v) => (
          <g key={v}>
            <line className={v === 20 || v === 80 ? 'refline' : 'grid'}
              x1={ML} y1={y(v)} x2={W - 14} y2={y(v)} />
            <text className="tick" x={ML - 6} y={y(v) + 4} textAnchor="end">{v}</text>
          </g>
        ))}
        <path className="closeline" d={kPath} />
        <path className="midline2" d={dPath} />
        <circle cx={x(points.length - 1)} cy={y(points[points.length - 1]!.k)} r={3.5}
          style={{ fill: 'var(--blue)' }} />
        <circle cx={x(points.length - 1)} cy={y(points[points.length - 1]!.d_val)} r={3.5}
          style={{ fill: 'var(--mid)' }} />
        {points.map((p, i) => (i % labelEvery === 0 ? (
          <text key={p.d} className="tick" x={x(i)} y={H - 6} textAnchor="middle">{p.d.slice(5)}</text>
        ) : null))}
      </svg>
      <div className="legend">
        <span><i className="sw" style={{ borderColor: 'var(--blue)' }} />K</span>
        <span><i className="sw" style={{ borderColor: 'var(--mid)' }} />D</span>
        <span><i className="sw dash" style={{ borderColor: 'var(--muted)' }} />20 / 80 參考線</span>
      </div>
    </>
  )
}
