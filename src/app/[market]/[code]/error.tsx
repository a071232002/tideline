'use client'
import { useEffect } from 'react'

/**
 * 個股頁掛掉的時候。
 *
 * 在這之前，抓取失敗或資料形狀不對會顯示 Next 的預設錯誤頁：英文、
 * 「Application error: a client-side exception has occurred」、沒有任何
 * 下一步。在一個給自己每天看的中文站上，那看起來像整個網站壞了。
 *
 * 三件事必須說出來，而且順序是固定的：
 *
 * 1. **哪一部分壞了。** 「這一檔的資料讀不出來」比「發生錯誤」有用得多——
 *    它同時告訴你清單頁還是好的。
 * 2. **可以做什麼。** 重試一次；不行就回清單。這一頁的資料是每天重抓的，
 *    所以「明天再看」也是一個真的選項，要講出來。
 * 3. **錯誤本身。** 收在摺疊區裡，但一定要留著：這個站是自己維護的，
 *    而一個沒有訊息的錯誤畫面等於要你去翻伺服器日誌。
 *
 * 這裡**不寫「請聯絡客服」**。沒有客服，寫了就是騙人。
 */
export default function Error({
  error, reset,
}: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // 留在瀏覽器主控台。伺服器端的那一份 Next 已經記了，但使用者手上這一份
    // 只有這裡看得到——實際除錯時，這一行常常是唯一的線索
    console.error('個股頁錯誤：', error)
  }, [error])

  return (
    <main className="wrap" data-testid="stock-error">
      <div className="card errpage">
        <h1>這一檔的資料讀不出來</h1>
        <p>
          清單頁應該還是好的。這一頁的價位與指標每天重抓一次，
          所以多半是暫時的——重試一次，或明天再看。
        </p>
        <div className="errbtns">
          <button type="button" className="btn" onClick={reset}>重試</button>
          <a className="btn" href="/">回觀察清單</a>
        </div>
        <details className="revdetails">
          <summary>錯誤訊息</summary>
          <pre className="errmsg">{error.message}{error.digest ? `\n\ndigest: ${error.digest}` : ''}</pre>
        </details>
      </div>
    </main>
  )
}
