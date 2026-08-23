'use client'
import { useState } from 'react'

/**
 * 兩張圖，直接輸出 SVG，不用圖表函式庫（PLAN §3）。
 *
 * 顏色一律走 CSS 變數（`.closeline` / `.bandfill` …），**不能寫死**，
 * 否則深色模式下線條會消失。縮放靠 viewBox + width:100%，絕不橫向捲動。
 *
 * ## 為什麼是 client component
 *
 * 圖上原本只有最後一天標了數字，中間任何一天都得用眼睛去對 Y 軸——
 * 六個月的圖等於只有一天可讀。十字線需要滑鼠與鍵盤事件，所以這個檔案是
 * client component；代價是 123 個點會被序列化到瀏覽器（約 5KB），值得。
 */

/** 把游標的 clientX 換算成資料點的索引。SVG 會縮放，所以要先換回 viewBox 座標 */
function indexFromEvent(
  el: SVGSVGElement, clientX: number, vbWidth: number,
  ml: number, pw: number, count: number,
): number {
  const box = el.getBoundingClientRect()
  if (box.width === 0 || count < 2) return count - 1
  const vbX = ((clientX - box.left) / box.width) * vbWidth
  const t = (vbX - ml) / pw
  return Math.max(0, Math.min(count - 1, Math.round(t * (count - 1))))
}

/**
 * viewBox 的寬度。**這個數字決定手機上的字看不看得見。**
 *
 * SVG 的字級是 user unit，會跟著 viewBox 一起被縮放。920 寬的 viewBox 塞進
 * 375px 的螢幕，縮放係數是 0.377——11px 的軸標籤實測只剩 **3.6px**。
 * 那不是「小」，是不存在（實測見 e2e/audit.spec.ts）。
 *
 * 所以窄螢幕用一個窄的 viewBox。360 是量出來的：375px 螢幕扣掉版面留白後
 * 容器約 359px，viewBox 取 360 → 縮放係數 ≈ 1，SVG 裡寫幾 px 就真的是幾 px。
 * 兩種寬度各渲染一份、用 CSS 切換——沒有 JS、沒有 hydration、SSR 就決定好。
 */
export const W_WIDE = 920
export const W_NARROW = 360

/**
 * SVG 裡的字級是**使用者單位**，會跟著 viewBox 一起縮放。
 *
 * 窄版的 viewBox 是 360，但手機上這張圖實際只有約 323px 寬（375 減掉外層
 * 與卡片的內距），所以縮放比是 0.9——11 個單位的軸標籤畫出來只有 9.4px，
 * 實測就是這個數字。那低於這個站給中文訂的 12px 下限。
 *
 * 對策是把窄版的字級**乘回去**，而不是把圖放大：圖放大會讓它在寬螢幕上
 * 變成一塊模糊的巨圖。
 */
export const narrowScale = (width: number) => (width <= W_NARROW ? 1.4 : 1)

const ML = 46
const MT = 14

interface Pt { d: string; c: number }
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
  bars, bands, levels, currency, marks, width = W_WIDE,
}: {
  bars: Pt[]
  bands: Band[]
  levels: { sell?: [number, number] | null; stop?: number | null; add?: [number, number] | null }
  currency: string
  /** 模擬帳戶的成交點。一眼就看得出是「低接高出」還是「追高殺低」。 */
  marks?: TradeMark[]
  /** viewBox 寬度。窄螢幕傳 `W_NARROW`，否則字會縮到讀不到 */
  width?: number
}) {
  const W = width
  const fs = narrowScale(width)
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

  // null＝沒有停在任何一天，顯示最後一天（也就是「今天」）
  const [hoverI, setHoverI] = useState<number | null>(null)
  const cur = hoverI ?? lastI
  const curBar = bars[cur]!
  const curBand = bandByDate.get(curBar.d)

  // 窄圖只放 4 個日期標籤：360 單位寬放 6 個「02-24」會黏在一起
  const labelEvery = Math.ceil(bars.length / (W < 600 ? 4 : 6))

  const idxByDate = new Map(bars.map((b, i) => [b.d, i]))

  // 歷史價位的階梯線拿掉了。
  //
  // 它原本疊在這張圖上回答「當時說的價位後來準不準」，但那是**回顧**的問題，
  // /review 現在用「價格 ＋ 買賣點 ＋ 與買了不動的差距」直接回答。
  // 留在這裡只是把主圖變成六層，而這張圖要回答的是另一件事：
  // **買在哪、賣在哪，價格當時在什麼位置。**

  return (
    <>
      {/* 讀數放在圖**外面**，固定一行。
          原本它畫在 SVG 裡、跟著游標的點浮動：三行字疊在資料上，
          窄版把字級乘回去之後就直接壓在收盤價線上（實測「中軌 102.57」
          蓋住線）。而且圖裡的字受 viewBox 縮放擺布，圖外的不會。
          位置的資訊由十字線與圓點負責，數字只要在同一個地方唸出來就好。 */}
      <div className="readout" data-testid="chart-readout">
        <span className="tnum rdate">{curBar.d}</span>
        <b className="tnum rdclose">{curBar.c.toFixed(2)}</b>
        {curBand && <span className="tnum rmid">中軌 {curBand.mid.toFixed(2)}</span>}
        <span className="rhint wide-only">滑過或用左右鍵看其他日子</span>
      </div>
      <svg className={`chartsvg${fs > 1 ? ' narrowtext' : ''}`} viewBox={`0 0 ${W} ${H}`}
        data-last-bar={bars[bars.length - 1]!.d}
        data-hover={hoverI ?? ''}
        /* 有互動就不只是圖片：給它一個可聚焦的角色與鍵盤操作，
           不然只有滑鼠使用者讀得到中間那幾個月 */
        role="application"
        tabIndex={0}
        aria-label={`收盤價與布林通道。左右鍵可逐日查看，目前 ${curBar.d} 收盤 ${curBar.c.toFixed(2)}`}
        onMouseMove={(e) => setHoverI(
          indexFromEvent(e.currentTarget, e.clientX, W, ML, PW, bars.length))}
        onMouseLeave={() => setHoverI(null)}
        onTouchStart={(e) => setHoverI(
          indexFromEvent(e.currentTarget, e.touches[0]!.clientX, W, ML, PW, bars.length))}
        onTouchMove={(e) => setHoverI(
          indexFromEvent(e.currentTarget, e.touches[0]!.clientX, W, ML, PW, bars.length))}
        onBlur={() => setHoverI(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault()
            const step = e.key === 'ArrowLeft' ? -1 : 1
            setHoverI(Math.max(0, Math.min(bars.length - 1, cur + step)))
          } else if (e.key === 'Home') { e.preventDefault(); setHoverI(0) }
          else if (e.key === 'End') { e.preventDefault(); setHoverI(bars.length - 1) }
          else if (e.key === 'Escape') { setHoverI(null) }
        }}>
        {niceTicks(ymin, ymax).map((v) => (
          <g key={v}>
            <line className="grid" x1={ML} y1={y(v)} x2={W - 14} y2={y(v)} />
            <text className="tick" x={ML - 6} y={y(v) + 4} textAnchor="end">{v.toFixed(digits)}</text>
          </g>
        ))}
        {zones.map((z) => (
          <rect key={z.varName} x={ML} y={Math.min(y(z.hi), y(z.lo))}
            width={PW} height={Math.max(Math.abs(y(z.lo) - y(z.hi)), 2)}
            /* 再淡一階。價位是背景，買賣點與價格才是這張圖的主角 */
            style={{ fill: `var(--${z.varName})`, opacity: .07 }} />
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
                    style={{ stroke: `var(--${varName})`, opacity: .45 }} />
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
        {/* 買賣點。**這張圖的主角就是它們**——日期與成交價直接落在價格線上，
            不必去對另一張表。所以三角畫大一點，並且把成交價寫在旁邊。 */}
        {(marks ?? []).map((m, n) => {
          const i = idxByDate.get(m.d)
          if (i === undefined) return null
          const px = x(i)
          const py = y(m.price)
          const varName = m.stop ? 'stop' : m.side === 'buy' ? 'buy' : 'sell'
          const buy = m.side === 'buy'
          // 買點畫在價格下方朝上、賣點畫在上方朝下——不要蓋住收盤價那條線
          const tri = buy
            ? `${px},${py + 6} ${px - 6},${py + 16} ${px + 6},${py + 16}`
            : `${px},${py - 6} ${px - 6},${py - 16} ${px + 6},${py - 16}`
          return (
            <g key={`${m.d}-${m.side}-${n}`}>
              {/* 一條細線把成交點釘回價格線上，眼睛才知道它對應哪一天 */}
              <line x1={px} y1={py} x2={px} y2={buy ? py + 6 : py - 6}
                style={{ stroke: `var(--${varName})`, strokeWidth: 1.2 }} />
              <polygon points={tri} style={{ fill: `var(--${varName})` }}>
                <title>
                  {`${m.d} ${buy ? '買進' : m.stop ? '止損賣出' : '賣出'} @ ${m.price.toFixed(2)}`}
                </title>
              </polygon>
              <text x={px} y={buy ? py + 28 : py - 21} textAnchor="middle"
                style={{ fill: `var(--${varName})`, fontWeight: 700, fontSize: 11 * fs }}>
                {m.price.toFixed(2)}
              </text>
            </g>
          )
        })}

        {/* 停在哪一天：十字線 ＋ 圓點 ＋ 讀數。
            沒有 hover 時停在最後一天，也就是「今天」——所以這一組同時是
            「今天在哪」的端點標記，不必畫兩份。 */}
        {hoverI !== null && (
          <line x1={x(cur)} y1={MT} x2={x(cur)} y2={MT + PH}
            style={{ stroke: 'var(--blue)', strokeWidth: 1, opacity: .35 }} />
        )}
        <circle cx={x(cur)} cy={y(curBar.c)} r={4} className="hoverdot"
          style={{ fill: 'var(--blue)' }} />
        <circle cx={x(cur)} cy={y(curBar.c)} r={7.5} fill="none"
          style={{ stroke: 'var(--blue)', opacity: .35 }} />

        {bars.map((b, i) => (i % labelEvery === 0 ? (
          <text key={b.d} className="tick" x={x(i)} y={H - 6} textAnchor="middle">{b.d.slice(5)}</text>
        ) : null))}
      </svg>
      {/* 圖例在手機上量到 121px，而圖本身只有 318px——說明佔了內容的 38%。
          賣出／止跌／加碼三格是**純重複**：那三個價位就用同色標在圖上，
          寫著「賣出 107.50」。窄螢幕收起來，圖例從 8 格降到 3 格。 */}
      {/* 圖例只列**真的畫出來的東西**。
          圖層可以關掉之後，固定列出六項會變成謊：畫面上沒有布林通道，
          圖例卻說有——讀者會去找一條不存在的線。 */}
      <div className="legend">
        <span><i className="sw" style={{ borderColor: 'var(--blue)' }} />收盤價（末點＝今日）</span>
        {withBand.length > 0 && (
          <>
            <span><i className="sw" style={{ borderColor: 'var(--mid)' }} />布林中軌</span>
            <span><i className="sw" style={{ borderColor: 'var(--bandline)' }} />上下軌</span>
          </>
        )}
        {hlines.map((h) => {
          const varName = h.label === '賣出' ? 'sell' : h.label === '止跌' ? 'stop' : 'buy'
          return (
            <span key={h.label} className="wide-only">
              <i className="sw dash" style={{ borderColor: `var(--${varName})` }} />{h.label}
            </span>
          )
        })}
        {(marks ?? []).length > 0 && (
          <span><i className="sw" style={{ borderColor: 'var(--buy)' }} />▲買／▼賣</span>
        )}
      </div>
    </>
  )
}

/** 圖二：KD，含 20 / 80 參考線 */
export function KdChart({ points, width = W_WIDE }: {
  points: { d: string; k: number; d_val: number }[]
  width?: number
}) {
  const W = width
  const H = 230
  const PH = H - MT - 26
  const PW = W - ML - 14
  if (points.length < 2) return <p className="empty">資料不足，畫不出圖。</p>

  const x = (i: number) => ML + (PW * i) / (points.length - 1)
  const y = (v: number) => MT + PH * (1 - v / 100)

  const kPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.k).toFixed(1)}`).join('')
  const dPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.d_val).toFixed(1)}`).join('')
  const labelEvery = Math.ceil(points.length / (W < 600 ? 4 : 6))

  return (
    <>
      <svg className={`chartsvg${narrowScale(width) > 1 ? ' narrowtext' : ''}`}
        viewBox={`0 0 ${W} ${H}`} role="img" aria-label="KD 指標">
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
