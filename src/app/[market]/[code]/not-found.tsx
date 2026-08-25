import Link from 'next/link'

/**
 * 這個代號在這個站上沒有資料。
 *
 * 走到這裡只有兩種可能，而它們要的下一步完全不同——所以兩種都要講，
 * 不能只丟一句「找不到」：
 *
 * 1. **代號打錯了**（或市場選錯：`/tw/nvda` 這種）。那要回清單重打。
 * 2. **代號是對的，只是還沒加入追蹤。** 這個站只抓有人關注的標的（§7），
 *    所以沒追蹤就沒有資料——那不是錯誤，是還沒開始。回清單加入即可。
 *
 * 預設的 404 頁只會說 "This page could not be found"，英文、而且把第二種
 * 情況說成錯誤。在一個只有自己在用的站上，那等於要你自己想起規則。
 */
export default function NotFound() {
  return (
    <main className="wrap" data-testid="stock-notfound">
      <div className="card errpage">
        <h1>這個代號還沒有資料</h1>
        <p>
          兩種可能：代號或市場打錯了（台股走 <code>/tw/</code>、美股走 <code>/us/</code>），
          或者它還沒加入追蹤——這個站只抓清單裡的標的，所以沒追蹤就沒有資料。
        </p>
        <div className="errbtns">
          <Link className="btn" href="/">回觀察清單</Link>
        </div>
      </div>
    </main>
  )
}
