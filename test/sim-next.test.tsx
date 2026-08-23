import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SimNext } from '../src/components/SimNext'
import type { SimTrack } from '../src/lib/data'

/**
 * 「AI 跟上最新那根 K 棒了沒」。
 *
 * 這個狀態在正式資料上做不出來——要嘛排程正常（永遠跟得上），要嘛排程掛了
 * （而那不是能在測試裡等的事）。所以用 server render 把兩種情況都鎖起來，
 * **不要為了看一眼而往 sim_ai_log 塞一筆假的舊決策**：那張表依 §13.1 四
 * 是永不重算的真相，塞進去就洗不掉。
 */

const base: SimTrack = {
  track: 'rule',
  initialTwd: 50_000, initialCash: 50_000, currency: 'TWD',
  retPct: 0, equity: 50_000, cash: 50_000, shares: 0, cost: 0,
  daysInMarket: 0, totalDays: 5, totalFees: 0, trades: 0,
  curve: [{ d: '2026-08-21', retPct: 0 }],
  recent: [], marks: [],
  stats: {
    retPct: 0, maxDrawdownPct: 0, trades: 0, closed: 0, wins: 0,
    daysInMarket: 0, totalDays: 5, totalFees: 0, feesPct: 0, stopped: 0,
  },
  pending: null,
  startedOn: '2026-08-17',
}

const ai = (d: string): SimTrack => ({
  ...base,
  track: 'ai',
  ai: { days: 3, today: { d, action: 'hold', confidence: 'med', reason: '等金叉' } },
})

const render = (aiDay: string, latestBar: string) =>
  renderToStaticMarkup(
    <SimNext track={base} ai={ai(aiDay)} market="TW" latestBar={latestBar} />)

describe('AI 有沒有跟上最新那根 K 棒', () => {
  it('判斷日 = 最新 K 棒 → 不出警示', () => {
    const html = render('2026-08-21', '2026-08-21')
    expect(html).toContain('AI 判斷')
    expect(html).not.toContain('尚未判斷')
  })

  it('判斷日落後 → 說出落後到哪一天', () => {
    // 排程掛掉時，畫面原本只會顯示一個看起來很正常的舊判斷：
    // 沒有錯誤、沒有空白，只是日期悄悄落後（實測 2026-08-23 的午後排程）
    const html = render('2026-08-19', '2026-08-21')
    expect(html).toContain('尚未判斷 2026-08-21')
  })

  it('沒傳最新 K 棒日期就不要亂猜', () => {
    const html = renderToStaticMarkup(
      <SimNext track={base} ai={ai('2026-08-19')} market="TW" />)
    expect(html).not.toContain('尚未判斷')
  })

  it('一天都還沒跑的帳戶不印這一行——那是「還沒開始」，不是「落後」', () => {
    const fresh = { ...base, totalDays: 0 }
    const html = renderToStaticMarkup(
      <SimNext track={fresh} ai={ai('2026-08-19')} market="TW" latestBar="2026-08-21" />)
    expect(html).toBe('')
  })
})
