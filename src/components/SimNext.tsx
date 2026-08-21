import type { SimTrack } from '@/lib/data'
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
 */

function verb(p: NonNullable<SimTrack['pending']>): string {
  if (p.triggers.includes('stop')) return '全部賣掉'
  if (p.buy && p.sell) return '買賣相抵，只送淨額'
  if (p.sell) return '賣掉一半'
  return '買進'
}

const qtyText = (q: number, market: 'TW' | 'US') =>
  market === 'TW' ? `${Math.round(q)} 股` : `${q.toFixed(4)} 股`

export function SimNext({ track, market }: {
  track: SimTrack | undefined
  market: 'TW' | 'US'
}) {
  if (!track) return null
  const p = track.pending
  const act = p && (p.buy || p.sell)
  const est = p?.estimate ?? null

  return (
    <p className={`simnext${act ? '' : ' quiet'}`} data-testid="sim-pending">
      {act && <Icon name="chevronUp" />}
      <b>明天開盤</b>
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
    </p>
  )
}
