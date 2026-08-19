import { ThemeToggle } from './ThemeToggle'
import { SubmitButton } from './SubmitButton'
import { NavLink } from './NavLink'
import { Icon } from './Icon'
import type { MarketFreshness } from '@/lib/freshness'

/**
 * 頂部列：站名、資料狀態、配色、登出。
 *
 * 原本這幾樣散在各處——狀態擠在副標裡、登出孤零零躺在頁尾的灰字，
 * 兩個都不是「內容」，不該跟內容排在同一條閱讀動線上。
 */
export function TopBar({ fresh }: { fresh?: MarketFreshness[] }) {
  return (
    <div className="topbar">
      <NavLink href="/" className="brand">Tideline</NavLink>

      {fresh && fresh.length > 0 && (
        <span className="freshgroup" data-testid="freshness">
          {fresh.map((f) => (
            <span key={f.market} className={`freshness tone-${f.tone}`}
              data-testid={`freshness-${f.market}`} data-kind={f.kind}>
              {f.message}
            </span>
          ))}
          {/* 收盤日與抓取時間是兩件事：前者說「這是哪一場交易」，
              後者說「這份資料多新」。只給日期看不出後者。 */}
          {fresh[0]?.fetchedAt && (
            <span className="fetchedat" data-testid="fetched-at">
              {fresh[0].fetchedAt} 抓取
            </span>
          )}
        </span>
      )}

      <div className="topbarright">
        <ThemeToggle />
        <form action="/auth/signout" method="post">
          <SubmitButton className="iconbtn" aria-label="登出" title="登出" pendingText="…">
            <Icon name="logout" />
          </SubmitButton>
        </form>
      </div>
    </div>
  )
}
