/**
 * 收工。**不要直接呼叫 `process.exit()`。**
 *
 * ## 為什麼
 *
 * Windows 上的 Node，在 Supabase client 還握著閒置連線的時候直接 exit，
 * 會在 libuv 收尾時撞上一個斷言：
 *
 *     Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76
 *
 * 那行字進 stderr。工作已經全部做完了，輸出也都印出來了——它純粹是
 * 拆解時序的產物。但下游看不出這件事：`daily.ps1` 只看到一行 stderr，
 * 於是把一次**成功**的執行記成「推薦失敗：Assertion failed…」，
 * 而真正的輸出（「今天已經有 6 筆推薦，跳過」）被整段丟掉。
 *
 * 實測 3/3 重現，加一個 50ms 的讓步之後 3/3 不再出現。
 *
 * ## 為什麼不是乾脆不要 exit
 *
 * 因為那些閒置連線會讓行程掛在那裡不結束，而這些腳本是排程叫的——
 * 掛住比多等 50 毫秒糟得多。讓事件迴圈跑完一圈再走，兩邊都要。
 */
export async function exitCleanly(code = 0): Promise<never> {
  await new Promise((r) => setTimeout(r, 50))
  process.exit(code)
}
