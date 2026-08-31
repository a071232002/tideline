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
 * 而成交必須排在下一個交易日，因為用當天收盤成交等於「跌破的瞬間就跑掉了」，
 * 那個價格在決定之前就已經印出來了。所以先說哪一天決定了什麼，
 * 再把成交時點當作機械後果附在後面。
 *
 * ## 兩種單要分得出來
 *
 * 加碼與減碼是**限價單**，掛在加碼區上緣／賣出區下緣，沒回到就不成交；
 * 底倉與止損是**開盤市價單**。同一句「明天買進」底下是兩件不同的事，
 * 所以價位那一行分開講（`howText`）——限價寫掛單價（那是要在券商輸入的
 * 數字，不是估的），市價只能用今日收盤估，並且要標明是估的。
 *
 * 限價不同的買賣單不相抵，那天要掛兩張，所以 `estimates` 是陣列。
 */

function verb(p: NonNullable<SimTrack['pending']>): string {
  if (p.triggers.includes('stop')) return '全部賣掉'
  // 兩張限價不同的單各自成交，不會相抵——講「相抵」會讓人只掛一張
  if (p.buy && p.sell) {
    return (p.estimates?.length ?? 0) > 1 ? '買、賣各掛一張' : '買賣相抵，只送淨額'
  }
  if (p.sell) return '賣掉一半'
  return '買進'
}

type Leg = NonNullable<NonNullable<SimTrack['pending']>['estimates']>[number]

/**
 * 這張單怎麼送。**限價與市價要分得出來**——同一句「明天買進」，一個是
 * 「掛 96.80，沒回到就不買」，另一個是「開盤多少買多少」，那是兩件事。
 *
 * 市價單的數量只能用今日收盤估，所以要標明是估的；限價單的價位不是估的，
 * 是明天真的要輸入的數字，估的只有股數（成交價已經鎖住了，數量還受現金影響）。
 */
function howText(e: Leg): string {
  return e.limit === null
    ? `以今日收盤 ${e.refPrice.toFixed(2)} 估`
    : `掛限價 ${e.limit.toFixed(2)}，沒碰到就不成交`
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
  const legs = p?.estimates ?? []

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
      {/* **AI 的判斷永遠要露臉，包括它就是主軌的時候。**

          這裡原本是 `said && !aiLed`——AI 成為主軌時就不印，因為那時候
          下面那行「決定」講的就是它。但那行只有動作沒有理由，於是 AI 說了
          什麼**整段消失**。這段程式碼在 AI 從來沒進場過的時候是死碼，
          加了底倉之後才活過來，才看得出來它漏了東西。 */}
      {said && (
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
      {/* AI 就是主軌、而且今天不動作時，這一行會變成「決定／什麼都不用做」
          ——跟上面那塊 AI 判斷講的是同一件事。同意的時候並排兩段是雜訊
          （跟 `agree` 同一條規矩），所以整行省掉。 */}
      {(!aiLed || act) && (<>
        {act && <Icon name="chevronUp" />}
        <b>{aiLed ? '決定' : '規則試算'}</b>
        {p?.signalD && <span className="simaid tnum">{p.signalD} 收盤後</span>}
        <span className="simnextact">
          {act ? verb(p) : agree ? '也是不動作' : '什麼都不用做'}
        </span>
        {act && <span className="simfill">下一個交易日</span>}
      </>)}

      {/* 沒有股數與價位，這一行還是不能照做——讀完仍然不知道要在券商輸入什麼。
          限價單就把限價寫出來（那是要輸入的數字，不是估的）；
          市價單只能用今日收盤估，並且明講是估的。 */}
      {legs.map((e) => (
        <span key={e.side} className="simnextqty tnum" data-testid="sim-pending-qty">
          {legs.length > 1 && <b className="simnextleg">{e.side === 'buy' ? '買' : '賣'}</b>}
          {qtyText(e.qty, market)}
          <span className="simnextref">
            　約 {Math.round(e.amount).toLocaleString('en-US')}
            （{howText(e)}）
          </span>
        </span>
      ))}

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
