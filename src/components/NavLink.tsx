'use client'
import Link from 'next/link'
import { useLinkStatus } from 'next/link'

/**
 * 導覽的回饋。**點下去到頁面換掉之間，一定要有反應**（PLAN §3）。
 *
 * 原本這裡是一個 0.6 透明度的「…」接在連結文字後面。實測正式站的個股頁
 * 冷啟動要 1,153～1,825ms（熱的 302～359ms）——在那 1.5 秒裡，一個灰色的
 * 小點點等於沒有回饋：**分不出是網站掛了還是只是慢**。
 *
 * 改成兩層，因為它們回答不同的問題：
 *
 *   頂部進度條   「這個網站在動」——全螢幕都看得到，不必盯著剛才點的地方
 *   點過的那一列 「我點的是這一個」——回來時知道剛才動作有沒有生效
 *
 * 進度條是**不確定型**（indeterminate）：我們不知道還要多久，假裝知道
 * 比誠實地說「在跑」更糟——一條卡在 80% 的進度條會讓人以為當掉了。
 */
function Pending() {
  const { pending } = useLinkStatus()
  if (!pending) return null
  return (
    <span className="navbar-progress" role="status" aria-live="polite">
      <span className="sronly">載入中</span>
    </span>
  )
}

export function NavLink({
  href, children, prefetch, ...rest
}: {
  href: string
  children?: React.ReactNode
  /**
   * 先把目標頁抓下來，不要等點擊。
   *
   * 這幾頁是 `force-dynamic`，而 Next 對動態路由的預設是**只預取到最近的
   * loading 邊界**——這個站沒有 loading.tsx，所以預設等於不預取，點下去
   * 才開始那 1.5 秒。明確設成 true 會在連結進入視窗時就把整份 RSC 抓好，
   * 點擊變成瞬間。
   *
   * 代價是清單上每一列都會發一個請求。四五檔的清單無所謂；真的長到幾十檔
   * 再改成只預取視窗內的（那本來就是 Next 的行為）。
   */
  prefetch?: boolean
} & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <Link href={href} prefetch={prefetch} {...rest}>
      {children}
      <Pending />
    </Link>
  )
}
