import { describe, it, expect } from 'vitest'
import { buildStamp, shouldRefresh, type FreshParts } from '../src/lib/fresh-stamp'

/**
 * 「資料變了」這件事要怎麼問？
 *
 * 一天有兩次更新，而且**它們在不同的機器上**：抓取在 Vercel Cron，
 * AI 判斷在本機的排程。只看 `job_runs` 會漏掉第二次——那是這個站
 * 最主要的內容，而畫面會安靜地停在「AI 尚未判斷」直到有人按重新整理。
 *
 * 所以指紋蓋兩件事：抓取跑完了沒、AI 最後寫在什麼時候。
 *
 * K 棒日期不另外問——**會動到 K 棒的路徑都會寫 `job_runs`**，
 * 再問一次要多三趟往返（每個市場各查一次最新 K 棒，還要先查 symbols），
 * 而輪詢是會重複發生的事，每一趟都要付很多次。
 */

const base: FreshParts = {
  ingestAt: '2026-08-28T00:12:03Z',
  aiAt: '2026-08-28T00:40:11Z',
}

describe('buildStamp', () => {
  it('同樣的資料給同樣的指紋', () => {
    expect(buildStamp(base)).toBe(buildStamp({ ...base }))
  })

  it('抓取跑完 → 指紋要變', () => {
    expect(buildStamp({ ...base, ingestAt: '2026-08-29T00:01:00Z' }))
      .not.toBe(buildStamp(base))
  })

  it('**AI 寫了新判斷但抓取沒動 → 指紋也要變**', () => {
    // 這是最容易漏的一種：只問 job_runs 的話，本機那輪 AI 跑完之後
    // 指紋一模一樣，畫面停在「AI 尚未判斷」。
    expect(buildStamp({ ...base, aiAt: '2026-08-28T01:10:00Z' }))
      .not.toBe(buildStamp(base))
  })

  it('全空也要給得出指紋，不要丟例外', () => {
    // 還沒跑過任何抓取的第一天。這時候每次輪詢都拿到同一個指紋，
    // 也就是什麼都不做——正確。
    expect(buildStamp({ ingestAt: null, aiAt: null })).toBeTypeOf('string')
  })
})

describe('shouldRefresh', () => {
  it('**第一次看到不算變**——剛掛上去就重整是無限迴圈', () => {
    expect(shouldRefresh(null, buildStamp(base))).toBe(false)
  })

  it('一樣就不要動', () => {
    expect(shouldRefresh(buildStamp(base), buildStamp(base))).toBe(false)
  })

  it('不一樣才重整', () => {
    expect(shouldRefresh(buildStamp(base), buildStamp({ ...base, aiAt: 'x' }))).toBe(true)
  })

  it('拿不到指紋（空字串）就當作沒事，不要因為一次網路失敗就重整', () => {
    expect(shouldRefresh(buildStamp(base), '')).toBe(false)
  })
})
