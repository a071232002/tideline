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

function text(p: NonNullable<SimTrack['pending']>): string {
  const why = p.triggers.includes('stop') ? '跌破止跌'
    : p.triggers.includes('sell_zone') ? '觸及賣出區'
    : p.triggers.includes('add') ? '回到加碼區'
    : p.triggers.join('、')
  if (p.buy && p.sell) return `買賣相抵後的淨額（${why}）`
  if (p.sell) return `賣出${p.triggers.includes('stop') ? '全部' : '一半'}持股（${why}）`
  return `買進一批（${why}）`
}

export function SimNext({ track }: { track: SimTrack | undefined }) {
  if (!track) return null
  const p = track.pending
  return (
    <p className={`simnext${p ? '' : ' quiet'}`} data-testid="sim-pending">
      {p && <Icon name="chevronUp" />}
      <b>明日開盤</b>
      <span>{p ? text(p) : '不動作'}</span>
      <span className="simnextsrc">模擬帳戶</span>
    </p>
  )
}
