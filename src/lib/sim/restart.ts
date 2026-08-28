/**
 * 重新起算模擬帳戶的日期檢查。
 *
 * ## 為什麼需要「重新起算」
 *
 * 模擬帳戶的成交與淨值是推導的，改了費率就整條重跑，那沒問題——
 * 規則沒變，重跑只是把同一套算式再算一次。
 *
 * 但**規則本身變了**的時候不一樣：重跑等於用今天才決定的規則去寫上週的
 * 成交，而上週的走勢已經知道了。那條曲線會比它應得的好看，而且沒有任何
 * 地方看得出來。這跟 `ai-decide` 那條「沒跑到就記 missing，不補，
 * 事後補等於偷看未來」是同一條規矩，只是換成規則軌。
 *
 * 所以改了 `PARAMS_VERSION` 之後，正確的動作是**從下一個交易日重新起算**，
 * 舊的那段歷史就讓它結束——它是另一套規則跑出來的，本來就不該接在一起比。
 *
 * ## 為什麼今天也不行
 *
 * 因為今天的 K 棒可能已經收了。台股 13:30 收盤，而你可能是晚上才改參數。
 * 分辨「收了沒」要看市場、看假日、看資料到齊沒——與其判斷，不如一律往後。
 * 少算一天的代價，遠小於一條偷看過未來的曲線。
 */

/** 起算日最多能訂在多久以後。打錯年份的話帳戶會永遠不開始，而畫面看起來很正常 */
const MAX_AHEAD_DAYS = 30

export function checkRestartDate(
  from: string, today: string,
): { ok: true } | { ok: false; why: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    return { ok: false, why: `日期要寫成 YYYY-MM-DD，收到的是「${from}」` }
  }
  if (from <= today) {
    return {
      ok: false,
      why: `起算日要在今天（${today}）之後。${from} 是倒填——`
        + '那等於用現在才決定的規則去寫已經知道結果的日子。',
    }
  }
  const ahead = (Date.parse(`${from}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000
  if (ahead > MAX_AHEAD_DAYS) {
    return {
      ok: false,
      why: `${from} 距今 ${Math.round(ahead)} 天，太遠了（上限 ${MAX_AHEAD_DAYS} 天）。`
        + '年份打錯的話帳戶會永遠不開始，而畫面上看起來完全正常。',
    }
  }
  return { ok: true }
}
