import type { SimTrack } from '@/lib/data'
import { aiActionText } from '@/lib/sim/actions'
import { Icon } from './Icon'

/**
 * 「明日開盤將執行」——從模擬帳戶卡裡拆出來，放到決策條正下方。
 *
 * 理由是量出來的：它原本在手機上位於 y=1604，而視窗只有 780px，
 * **要捲兩個螢幕才看得到**。而這是整頁唯一一句可以在真實世界照做的指令，
 * 其餘全部是「已經發生的事」。
 *
 * 拆開的原則跟 PLAN §11 把 `/review` 從個股頁分出去是同一條：
 * **指令與回顧是兩種閱讀狀態，不要混在一起。**
 * 決策條說「哪些價位有意義」，這一行說「所以明天開盤做什麼」，兩句話是連著的；
 * 帳戶績效說「過去這樣做的結果」，那是另一件事，留在下面。
 *
 * **現在手上有什麼也放這裡。**「明天賣一半」要有意義，得先知道現在有幾股；
 * 那兩個數字原本分別在第 5 塊與第 11 塊，中間隔著決策條、整張圖與一個標題
 * ——手機上實測相距約 900px。「現在持股」是動作的前提，不是回顧的統計。
 *
 * **AI 今天判斷了什麼也放這裡，而且放在最前面。**
 *
 * 原本整個個股頁完全不會提到 AI：判斷「AI 上線了沒」是看它有沒有成交，
 * 而它天天判斷、天天決定觀望，於是一筆成交都沒有。**「不進場」是一個決定，
 * 不是沒有決定**——它是這個站的主角，不能因為結論是「不動」就消失。
 *
 * 兩條同時出現時要標清楚誰是誰：AI 是判斷，下面那行是規則的試算。
 */

function verb(p: NonNullable<SimTrack['pending']>): string {
  if (p.triggers.includes('stop')) return '全部賣掉'
  if (p.buy && p.sell) return '買賣相抵，只送淨額'
  if (p.sell) return '賣掉一半'
  return '買進'
}

const qtyText = (q: number, market: 'TW' | 'US') =>
  market === 'TW' ? `${Math.round(q)} 股` : `${q.toFixed(4)} 股`

const money = (v: number, cur: string) =>
  `${cur === 'TWD' ? 'NT$' : '$'}${Math.round(v).toLocaleString('en-US')}`

export function SimNext({ track, ai, market }: {
  track: SimTrack | undefined
  /** AI 那條軌道。它還沒成交過的時候 `track` 會是規則軌，但 AI 仍然天天在判斷 */
  ai?: SimTrack | undefined
  market: 'TW' | 'US'
}) {
  if (!track) return null
  const p = track.pending
  const act = p && (p.buy || p.sell)
  const est = p?.estimate ?? null

  // AI 判斷過就要露臉，即使它一次都沒進場——那正是它的判斷
  const said = ai?.ai?.today
  const aiLed = track.track === 'ai'

  return (
    <p className={`simnext${act ? '' : ' quiet'}`} data-testid="sim-pending">
      {said && !aiLed && (
        <span className="simai" data-testid="sim-ai-today">
          <b>AI 判斷</b>
          <span className="simaiact">{aiActionText(said.action)}</span>
          <span className="simaid tnum">{said.d}</span>
          {said.reason && <span className="simaiwhy">{said.reason}</span>}
        </span>
      )}
      {act && <Icon name="chevronUp" />}
      <b>{aiLed ? '明天開盤' : '規則試算・明天開盤'}</b>
      <span className="simnextact">{act ? verb(p) : '什麼都不用做'}</span>

      {/* 沒有股數與價位，這一行還是不能照做——讀完仍然不知道要在券商輸入什麼。
          明天的開盤價當然不知道，所以用今日收盤估，並且明講是估的。 */}
      {est && (
        <span className="simnextqty tnum" data-testid="sim-pending-qty">
          {qtyText(est.qty, market)}
          <span className="simnextref">
            　約 {Math.round(est.amount).toLocaleString('en-US')}
            （以今日收盤 {est.refPrice.toFixed(2)} 估）
          </span>
        </span>
      )}

      {/* 「為什麼不做」跟「要做什麼」一樣需要被說出口。
          沒有這句，連續幾週不動看起來就像資料壞掉。 */}
      {p?.reason && <span className="simnextwhy">{p.reason}</span>}

      {/* 現在手上有什麼、花了多少。空手時講現金——那才是「還沒進場」的證據 */}
      <span className="simnowline tnum" data-testid="sim-now">
        {track.shares > 0
          ? `現在 ${qtyText(track.shares, market)}，成本 ${money(track.cost, track.currency)}`
          : `現在空手，現金 ${money(track.cash, track.currency)}`}
      </span>
    </p>
  )
}
