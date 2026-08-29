import { ThemeToggle } from './ThemeToggle'
import { SubmitButton } from './SubmitButton'
import { NavLink } from './NavLink'
import { Icon } from './Icon'
import { FreshClock } from './FreshClock'
import type { MarketFreshness } from '@/lib/freshness'

/**
 * 頂部列：站名、資料狀態、配色、登出。
 *
 * 原本這幾樣散在各處——狀態擠在副標裡、登出孤零零躺在頁尾的灰字，
 * 兩個都不是「內容」，不該跟內容排在同一條閱讀動線上。
 */
/** 手機用的短版：市場、狀態、資料日期，各一次 */
function shortForm(f: MarketFreshness): string {
  const state = f.kind === 'fresh' ? '已收盤'
    : f.kind === 'pending' ? '未收盤'
    : f.kind === 'holiday' ? '休市'
    : '未更新'
  return `${f.label} ${f.barDate?.slice(5) ?? '—'} ${state}`
}

export function TopBar({ fresh }: { fresh?: MarketFreshness[] }) {
  return (
    <div className="topbar">
      <NavLink href="/" className="brand">Tideline</NavLink>

      {fresh && fresh.length > 0 && (
        <span className="freshgroup" data-testid="freshness">
          {fresh.map((f) => (
            <span key={f.market} className={`freshness tone-${f.tone}`}
              data-testid={`freshness-${f.market}`} data-kind={f.kind}>
              {/* 完整句子在桌機，手機用短版。
                  「台股尚未收盤，為 2026-08-21 收盤」把「收盤」講了兩次，
                  兩個市場兩句話在 375px 上各佔一行——頂欄因此變成四行 171px，
                  而桌機只有 53px。看到第一檔標的之前就用掉三分之二個螢幕。 */}
              <span className="wide-only">{f.message}</span>
              <span className="narrow-only">{shortForm(f)}</span>
            </span>
          ))}
          {/* 收盤日與抓取時間是兩件事：前者說「這是哪一場交易」，
              後者說「這份資料多新」。只給日期看不出後者。

              **原本這裡是一個裸的「08-29 06:29」**，旁邊剛好都是日期，
              很容易被讀成第三個資料日期；而且它回答不了「這是新的還舊的」
              ——那要的是相對時間，以及「下次什麼時候」。
              兩者都跟「現在幾點」有關，所以交給 client 算（見 FreshClock）。 */}
          <FreshClock fetchedAtIso={fresh[0]?.fetchedAtIso ?? null} />
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
