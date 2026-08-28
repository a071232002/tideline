import { describe, it, expect } from 'vitest'
import { checkRestartDate } from '../src/lib/sim/restart'

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
