import { describe, it, expect } from 'vitest'
import { checkRestartDate, judgmentStranded } from '../src/lib/sim/restart'

/**
 * 改了規則參數之後，舊的模擬歷史不能沿用——**但也不能把新規則倒填回去。**
 *
 * 模擬帳戶的成交是推導的，所以「整條重跑」平常沒問題。可是規則本身變了
 * 的時候，重跑等於用今天才決定的規則去寫上週的成交：那些日子的走勢
 * 已經知道了。這跟 `ai-decide` 那條「沒跑到就記 missing，不補，事後補
 * 等於偷看未來」是同一條規矩，只是換成規則軌。
 *
 * 所以起算日必須落在**未來**的交易日。這裡守的就是那道界線。
 */

describe('checkRestartDate', () => {
  const today = '2026-08-29'   // 週六

  it('下一個交易日 → 可以', () => {
    expect(checkRestartDate('2026-08-31', today).ok).toBe(true)
  })

  it('**今天不行**——今天的 K 棒可能已經收了，那就是倒填', () => {
    const r = checkRestartDate('2026-08-29', today)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.why).toContain('倒填')
  })

  it('過去更不行', () => {
    expect(checkRestartDate('2026-08-27', today).ok).toBe(false)
  })

  it('格式不對要擋下來，不要送一個怪字串進資料庫', () => {
    const r = checkRestartDate('8/31', today)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.why).toContain('YYYY-MM-DD')
  })

  it('太遠也擋——打錯年份的話帳戶會永遠不開始，而且畫面上看起來很正常', () => {
    const r = checkRestartDate('2027-08-31', today)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.why).toContain('太遠')
  })
})

/**
 * **重新起算會刻意把舊的判斷留在窗口外，那不是損壞。**
 *
 * `sim_ai_log` 依 §13.1 永不刪除，而 `sim:restart` 把起算日往後移——
 * 兩件事加起來，每一次合法的重新起算都會留下一批「早於起算日」的決策。
 * 那是設計本身（舊的那段歷史就讓它結束），不是要修的東西。
 *
 * check-data 原本數的是「有幾筆早於起算日」，所以**每次重新起算之後
 * 都會永遠亮紅燈**。一個永遠亮著的警告等於沒有警告——它只會訓練人
 * 忽略這支腳本，而它守的另外六條是真的損壞。
 *
 * 真正要抓的是另一件事：**AI 最新的那個判斷不會被模擬到。**
 * 那才是「畫面顯示 AI 說要買、帳戶卻什麼都沒做」的情況。
 */
describe('judgmentStranded：最新的判斷有沒有落在窗口外', () => {
  const today = '2026-09-10'

  it('還沒判斷過 → 不是問題', () => {
    expect(judgmentStranded({ startedOn: '2026-09-02', newestLogD: null, today }))
      .toBe(false)
  })

  it('剛重新起算、起算日還沒到 → 不是問題，AI 還沒輪到它的日子', () => {
    expect(judgmentStranded({
      startedOn: '2026-09-12', newestLogD: '2026-09-10', today,
    })).toBe(false)
  })

  it('起算日已經到了，最新判斷還停在它之前 → **這才是問題**', () => {
    expect(judgmentStranded({
      startedOn: '2026-09-02', newestLogD: '2026-08-31', today,
    })).toBe(true)
  })

  it('最新判斷正好落在起算日 → 會被模擬到，沒問題', () => {
    expect(judgmentStranded({
      startedOn: '2026-09-02', newestLogD: '2026-09-02', today,
    })).toBe(false)
  })

  it('舊判斷一大堆在起算日之前、但最新那筆在窗口內 → 那正是重新起算的樣子', () => {
    expect(judgmentStranded({
      startedOn: '2026-09-02', newestLogD: '2026-09-08', today,
    })).toBe(false)
  })
})
