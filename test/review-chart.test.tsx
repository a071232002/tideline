import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ReviewChart, gapSeries } from '../src/components/ReviewChart'

/**
 * 回顧圖：一張圖兩層（上半價格＋買賣點，下半與買了不動的差距）。
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

const render = (over: Parameters<typeof ReviewChart>[0]) =>
  renderToStaticMarkup(<ReviewChart {...over} />)

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

describe('ReviewChart：買賣點要標在價格上', () => {
  it('每一筆成交畫一個三角，並附上可讀的說明', () => {
    const html = render({
      bars, gap, leadLabel: '照建議做', id: 't1',
      marks: [
        { d: '2026-06-03', side: 'buy', price: 102, stop: false },
        { d: '2026-06-07', side: 'sell', price: 106, stop: false },
      ],
    })
    expect((html.match(/<polygon/g) ?? []).length).toBe(2)
    expect(html).toContain('2026-06-03 買進 @ 102.00')
    expect(html).toContain('2026-06-07 賣出 @ 106.00')
  })

  it('止損賣出要講出來，不能跟一般減碼混為一談', () => {
    const html = render({
      bars, gap, leadLabel: '照建議做', id: 't2',
      marks: [{ d: '2026-06-05', side: 'sell', price: 104, stop: true }],
    })
    expect(html).toContain('止損賣出')
  })

  it('成交日不在資料範圍內時略過，不要畫到圖外', () => {
    const html = render({
      bars, gap, leadLabel: '照建議做', id: 't3',
      marks: [{ d: '2020-01-01', side: 'buy', price: 50, stop: false }],
    })
    expect(html).not.toContain('<polygon')
  })

  it('沒有成交就不畫三角，但圖本身還在', () => {
    const html = render({ bars, gap, marks: [], leadLabel: '照建議做', id: 't4' })
    expect(html).not.toContain('<polygon')
    expect(html).toContain('<path')
  })

  it('成交價超出收盤價範圍時，三角仍然落在圖內（y 軸要含進去）', () => {
    // 買在盤中低點 90，低於所有收盤價——不把它算進 y 軸就會畫到圖框外面
    const html = render({
      bars, gap, leadLabel: '照建議做', id: 't5',
      marks: [{ d: '2026-06-02', side: 'buy', price: 90, stop: false }],
    })
    const pts = /<polygon points="([^"]+)"/.exec(html)![1]!
    const ys = pts.split(' ').map((p) => Number(p.split(',')[1]))
    for (const y of ys) expect(y).toBeLessThan(280)
  })
})

describe('ReviewChart：兩層要共用同一條時間軸', () => {
  it('clipPath 的 id 帶進 id 參數——同頁多張圖不能共用裁切區', () => {
    const a = render({ bars, gap, marks: [], leadLabel: 'x', id: 'aaa' })
    const b = render({ bars, gap, marks: [], leadLabel: 'x', id: 'bbb' })
    expect(a).toContain('rv-up-aaa')
    expect(b).toContain('rv-up-bbb')
    expect(a).not.toContain('rv-up-bbb')
  })

  it('資料太短時給一句話，不要畫出一張沒有意義的圖', () => {
    const html = render({ bars: [bars[0]!], gap: [], marks: [], leadLabel: 'x', id: 't6' })
    expect(html).toContain('資料還太短')
    expect(html).not.toContain('<svg')
  })
})
