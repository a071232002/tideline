import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { gapSeries } from '../src/components/GapPanel'

/**
 * 主圖與它的圖層。
 *
 * 買賣三角在真實資料上還沒出現過——帳戶剛從加入追蹤那天起算，
 * 三個交易日、零成交。所以用 server render 把它鎖起來，
 * **不要為了看一眼而往正式紀錄塞假成交**。
 */

const bars = Array.from({ length: 10 }, (_, i) => ({
  d: `2026-06-${String(i + 1).padStart(2, '0')}`,
  c: 100 + i,
}))
const gap = bars.map((b, i) => ({ d: b.d, gap: i - 4 }))

describe('gapSeries', () => {
  it('相減，而且只取兩邊都有的日子', () => {
    const lead = [{ d: 'a', retPct: 5 }, { d: 'b', retPct: 8 }, { d: 'c', retPct: 1 }]
    const hold = [{ d: 'a', retPct: 2 }, { d: 'c', retPct: 4 }]
    expect(gapSeries(lead, hold)).toEqual([{ d: 'a', gap: 3 }, { d: 'c', gap: -3 }])
  })

  it('AI 那條起跑晚時，不會對出假的差距', () => {
    const lead = [{ d: 'c', retPct: 1 }]
    const hold = [{ d: 'a', retPct: 2 }, { d: 'b', retPct: 3 }, { d: 'c', retPct: 4 }]
    expect(gapSeries(lead, hold)).toEqual([{ d: 'c', gap: -3 }])
  })
})

describe('PriceChart：買賣點要跟收盤價在同一張圖上', () => {
  /**
   * 使用者的原話：「買賣的操作跟收盤價的圖共用同一張，讓操作紀錄的日期跟
   * 價位直接可以看到」。所以成交價要**寫在圖上**，不是只放在 title 裡——
   * title 要滑鼠停上去才看得到，手機根本沒有 hover。
   */
  it('每一筆成交都畫三角，而且把成交價寫在旁邊', async () => {
    const { PriceChart } = await import('../src/components/Charts')
    const priceBars = bars.map((b) => ({ d: b.d, o: b.c, h: b.c + 1, l: b.c - 1, c: b.c }))
    const html = renderToStaticMarkup(
      <PriceChart
        bars={priceBars}
        bands={[]}
        levels={{ sell: [108, 109], stop: 99, add: [101, 102] }}
        currency="TWD"
        marks={[
          { d: '2026-06-03', side: 'buy', price: 102, stop: false },
          { d: '2026-06-08', side: 'sell', price: 107, stop: true },
        ]}
      />,
    )
    expect((html.match(/<polygon/g) ?? []).length).toBe(2)
    // 價格要看得見，不能只藏在 title（手機沒有 hover）
    expect(html).toContain('>102.00<')
    expect(html).toContain('>107.00<')
    expect(html).toContain('止損賣出')
  })

  it('沒有成交時圖照常畫，只是沒有三角', async () => {
    const { PriceChart } = await import('../src/components/Charts')
    const priceBars = bars.map((b) => ({ d: b.d, o: b.c, h: b.c + 1, l: b.c - 1, c: b.c }))
    const html = renderToStaticMarkup(
      <PriceChart bars={priceBars} bands={[]}
        levels={{ sell: null, stop: null, add: null }} currency="TWD" marks={[]} />,
    )
    expect(html).not.toContain('<polygon')
    expect(html).toContain('closeline')
  })
})
