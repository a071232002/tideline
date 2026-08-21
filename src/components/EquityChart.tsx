/**
 * 三條資金曲線疊在一起（PLAN §13.1 三）。
 *
 * **買進持有那條線是這張圖存在的理由。** 沒有它，任何策略在上漲的市場裡
 * 都很好看——規則帳戶賺 29% 讀起來像本事，直到旁邊那條線顯示 41%。
 *
 * 畫的是**報酬率**不是淨值：台股帳戶記台幣、美股記美元，淨值不能疊在同一張圖上，
 * 報酬率可以。而且要比的本來就是「誰跑得比較好」，不是「誰的錢比較多」。
 */

const W = 920
const H = 190
const ML = 40
const MT = 12

export interface EquitySeries {
  track: 'rule' | 'ai' | 'hold'
  curve: { d: string; retPct: number }[]
}

const STYLE: Record<EquitySeries['track'], { label: string; varName: string; dash?: string }> = {
  rule: { label: '照建議做', varName: 'blue' },
  ai: { label: 'AI 判斷', varName: 'mid' },
  hold: { label: '買了不動', varName: 'muted', dash: '4 3' },
}

export function EquityChart({ series, width = W }: { series: EquitySeries[]; width?: number }) {
  const drawn = series.filter((s) => s.curve.length > 1)
  if (drawn.length === 0) return <p className="empty">還沒有足夠的資料畫出曲線。</p>

  const PW = width - ML - 14
  const PH = H - MT - 22

  // 所有日期取聯集：三條軌道的起跑點不同（AI 那條不能回補，只能從上線那天開始）
  const dates = [...new Set(drawn.flatMap((s) => s.curve.map((p) => p.d)))].sort()
  const xOf = new Map(dates.map((d, i) => [d, ML + (PW * i) / Math.max(1, dates.length - 1)]))

  const values = drawn.flatMap((s) => s.curve.map((p) => p.retPct))
  const lo = Math.min(0, ...values)
  const hi = Math.max(0, ...values)
  const pad = (hi - lo) * 0.08 || 1
  const y = (v: number) => MT + PH * (1 - (v - (lo - pad)) / ((hi + pad) - (lo - pad)))

  const zeroY = y(0)
  const labelEvery = Math.ceil(dates.length / (width < 600 ? 3 : 6))

  return (
    <>
      <svg className="chartsvg" viewBox={`0 0 ${width} ${H}`} role="img"
        aria-label="三條資金曲線：規則、AI、買進持有">
        {/* 0% 那條線是分水嶺：在它下面代表這段期間是賠的 */}
        <line className="refline" x1={ML} y1={zeroY} x2={width - 14} y2={zeroY} />
        <text className="tick" x={ML - 6} y={zeroY + 4} textAnchor="end">0%</text>
        {/* 貼著 0 的極值會印成「-0%」或「0%」跟上面那條 0% 重複，直接不畫 */}
        {[lo, hi].filter((v) => Math.abs(v) >= 1).map((v) => (
          <text key={v} className="tick" x={ML - 6} y={y(v) + 4} textAnchor="end">
            {v > 0 ? '+' : '−'}{Math.abs(v).toFixed(0)}%
          </text>
        ))}

        {drawn.map((s) => {
          const st = STYLE[s.track]
          const d = s.curve
            .map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf.get(p.d)!.toFixed(1)},${y(p.retPct).toFixed(1)}`)
            .join('')
          return (
            <path key={s.track} d={d} fill="none" strokeDasharray={st.dash}
              style={{ stroke: `var(--${st.varName})`, strokeWidth: s.track === 'rule' ? 2 : 1.6 }} />
          )
        })}

        {dates.map((d, i) => (i % labelEvery === 0 ? (
          <text key={d} className="tick" x={xOf.get(d)} y={H - 5} textAnchor="middle">
            {d.slice(5)}
          </text>
        ) : null))}
      </svg>
      <div className="legend">
        {drawn.map((s) => (
          <span key={s.track}>
            <i className={`sw${STYLE[s.track].dash ? ' dash' : ''}`}
              style={{ borderColor: `var(--${STYLE[s.track].varName})` }} />
            {STYLE[s.track].label}
          </span>
        ))}
      </div>
    </>
  )
}
