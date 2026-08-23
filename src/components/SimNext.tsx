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
 *
 * ## 講法：決定在前，成交在後
 *
 * 原本這一行的開頭是「明天開盤」，讀起來像在猜明天會怎樣。實際上不是：
 * **訊號是第 i 天收盤、資訊到齊之後才產生的**（engine.ts 開頭那一行），
 * 單已經下了，「明天」講的只是這張單什麼時候成交。
 *
 * 而成交必須排在下一個開盤，因為用當天收盤成交等於「跌破的瞬間就跑掉了」，
 * 那個價格在決定之前就已經印出來了。所以先說哪一天決定了什麼，
 * 再把成交時點當作機械後果附在後面。
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

export function SimNext({ track, ai, market, latestBar }: {
  track: SimTrack | undefined
  /** AI 那條軌道。它還沒成交過的時候 `track` 會是規則軌，但 AI 仍然天天在判斷 */
  ai?: SimTrack | undefined
  market: 'TW' | 'US'
  /** 最新一根 K 棒的日期。用來回答「AI 跟上了沒」 */
  latestBar?: string
}) {
  if (!track) return null
  // 還沒有交易日的帳戶沒有「決定」可言。這裡印「什麼都不用做」會像是
  // 跑過一輪的結論，實際上是還沒開始——那句話由帳戶卡負責講。
  if (track.totalDays === 0) return null
  const p = track.pending
  const act = p && (p.buy || p.sell)
  const est = p?.estimate ?? null

  // AI 判斷過就要露臉，即使它一次都沒進場——那正是它的判斷
  const said = ai?.ai?.today
  const aiLed = track.track === 'ai'

  /**
   * **AI 跟上最新那根 K 棒了沒。**
   *
   * 只印訊號日的話，排程掛掉時畫面會顯示一個看起來很正常的舊判斷——
   * 沒有錯誤、沒有空白，只是日期悄悄落後。實測 2026-08-23：午後那輪
   * 排程從來沒觸發過，週五收盤的判斷拖到週日早上才做，而頁面上完全看不出來。
   *
   * 這跟頂欄的資料新鮮度是同一條規矩（§7）：**沉默會被讀成正常。**
   */
  const behind = said && latestBar && said.d < latestBar ? latestBar : null

  /**
   * 兩條軌道都不動作時，規則那段不必再講一次理由。
   *
   * 實測 0050：AI 說「等回中軌 102.57 附近且 K<30 金叉再進場」，
   * 規則說「K 44.0 還沒回到 30 以下，進場訊號未成立」——四行字，同一件事。
   * 對照組存在的價值在**它們不同意的時候**；同意的時候並排兩段是雜訊。
   */
  const agree = said?.action === 'hold' && !act

  return (
    <p className={`simnext${act ? '' : ' quiet'}`} data-testid="sim-pending">
      {said && !aiLed && (
        <span className="simai" data-testid="sim-ai-today">
          <b>AI 判斷</b>
          <span className="simaiact">{aiActionText(said.action)}</span>
          <span className="simaid tnum">{said.d} 收盤後</span>
          {behind && (
            <span className="simaistale" data-testid="sim-ai-stale">
              尚未判斷 {behind}
            </span>
          )}
          {said.reason && <span className="simaiwhy">{said.reason}</span>}
        </span>
      )}
      {act && <Icon name="chevronUp" />}
      <b>{aiLed ? '決定' : '規則試算'}</b>
      {p?.signalD && <span className="simaid tnum">{p.signalD} 收盤後</span>}
      <span className="simnextact">
        {act ? verb(p) : agree ? '也是不動作' : '什麼都不用做'}
      </span>
      {act && <span className="simfill">下一個開盤成交</span>}

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
      {p?.reason && !agree && <span className="simnextwhy">{p.reason}</span>}

      {/* 現在手上有什麼、花了多少。空手時講現金——那才是「還沒進場」的證據 */}
      <span className="simnowline tnum" data-testid="sim-now">
        {track.shares > 0
          ? `現在 ${qtyText(track.shares, market)}，成本 ${money(track.cost, track.currency)}`
          : `現在空手，現金 ${money(track.cash, track.currency)}`}
      </span>
    </p>
  )
}
