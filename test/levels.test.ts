import { describe, it, expect } from 'vitest'
import fixture from './fixtures/0050.json'
import { bollinger, sma } from '../src/lib/indicators.js'
import {
  pivotHighs, pivotLows, sellZone, addZone, fairZone, stopLevel, roundToTick,
  tickFor, roundLevelAbove,
} from '../src/lib/levels.js'
import type { Bar } from '../src/lib/types.js'

const bars = fixture.bars as Bar[]
const exp = fixture.expected
const REF = exp.on_2026_08_19

/** 只餵到某一天為止的資料——回測時不能偷看未來 */
function upTo(date: string): Bar[] {
  const i = bars.findIndex((b) => b.date === date)
  if (i < 0) throw new Error(`fixture 沒有 ${date}`)
  return bars.slice(0, i + 1)
}

describe('roundToTick', () => {
  it('四捨五入到給定的 tick', () => {
    expect(roundToTick(108.575, 0.5)).toBe(108.5)
    expect(roundToTick(101.396, 0.5)).toBe(101.5)
    expect(roundToTick(102.52, 0.5)).toBe(102.5)
    expect(roundToTick(107.5, 0.5)).toBe(107.5) // 剛好落在 tick 上要原地不動
  })
})

describe('tickFor：報價單位要隨股價縮放', () => {
  it('台股照證交所分級表', () => {
    expect(tickFor(9.9, 'TW')).toBe(0.01)
    expect(tickFor(30, 'TW')).toBe(0.05)
    expect(tickFor(80, 'TW')).toBe(0.1)
    expect(tickFor(102.42, 'TW')).toBe(0.5)   // 0050，範本就是用這一階
    expect(tickFor(700, 'TW')).toBe(1)
    expect(tickFor(2350, 'TW')).toBe(5)       // 2330 台積電
  })

  it('美股用 1/2/5 階梯', () => {
    expect(tickFor(219, 'US')).toBe(1)
    expect(tickFor(5, 'US')).toBe(0.02)
  })

  it('高價股不會拿到荒謬的細碎單位', () => {
    // 2350 元的股票報 2336.00 是掛不出去的價位
    expect(tickFor(2350, 'TW')).toBeGreaterThanOrEqual(1)
  })
})

describe('roundLevelAbove：整數關卡也要隨股價縮放', () => {
  it('0050 的 99.75 進位到 100（與範本一致）', () => {
    expect(roundLevelAbove(99.75, 0.5)).toBe(100)
  })

  it('2330 的 2310 不會被推到 2400', () => {
    const v = roundLevelAbove(2310, 5)
    expect(v).toBeGreaterThanOrEqual(2310)
    expect(v).toBeLessThanOrEqual(2310 * 1.005)
  })

  it('關卡永遠不低於原本的低點，且不超過 0.5%', () => {
    for (const low of [8.3, 33.4, 99.75, 187.2, 512.5, 2310, 4180]) {
      const v = roundLevelAbove(low, tickFor(low, 'TW'))
      expect(v, `低點 ${low}`).toBeGreaterThanOrEqual(low)
      expect(v - low, `低點 ${low}`).toBeLessThanOrEqual(low * 0.005 + 1e-9)
    }
  })

  it('低價股沒有堪用的整數關卡時，退回波段低點本身（不硬湊）', () => {
    // 8.3 → 9 會是 +8.4%，那不是支撐是幻想
    expect(roundLevelAbove(8.3, 0.01)).toBeCloseTo(8.3, 2)
    expect(roundLevelAbove(33.4, 0.05)).toBeCloseTo(33.4, 2)
  })
})

describe('pivot 偵測', () => {
  const b = upTo('2026-08-19')

  it('最近的 pivot high 是 8/14 的 107.50', () => {
    const p = pivotHighs(b, 3)
    const last = p[p.length - 1]!
    expect(last.date).toBe('2026-08-14')
    expect(last.price).toBeCloseTo(107.5, 2)
  })

  it('pivot 需要右側 k 根確認，所以最後 k 天不會產生 pivot', () => {
    const p = pivotHighs(b, 3)
    const last = p[p.length - 1]!
    expect(last.index).toBeLessThanOrEqual(b.length - 1 - 3)
  })

  it('k 越大 pivot 越少', () => {
    expect(pivotHighs(b, 2).length).toBeGreaterThan(pivotHighs(b, 4).length)
    expect(pivotLows(b, 2).length).toBeGreaterThan(pivotLows(b, 4).length)
  })
})

describe('2026-08-19 的四組價位要重現範本', () => {
  const b = upTo('2026-08-19')
  const closes = b.map((x) => x.c)
  const bb = bollinger(closes, 20, 2)!
  const ma60 = sma(closes, 60)!

  it('賣出區 = 107.5 ~ 108.5', () => {
    const z = sellZone(b, bb, 3, 'TW')!
    expect(z.lo).toBeCloseTo(107.5, 2)
    expect(z.hi).toBeCloseTo(108.5, 2)
    expect(z.kind).toBe('swing')
    expect(z.basis.swingHighDate).toBe('2026-08-14')
  })

  it('加碼區 = 101.5 ~ 102.5', () => {
    const z = addZone(bb, 'TW')
    expect(z.lo).toBeCloseTo(101.5, 2)
    expect(z.hi).toBeCloseTo(102.5, 2)
  })

  it('合理價區 = 102.4 ~ 104.2', () => {
    const z = fairZone(bb.mid, ma60)
    expect(z.lo).toBeCloseTo(REF.bb.mid, 1)
    expect(z.hi).toBeCloseTo(REF.ma60, 1)
  })

  it('止跌點 = 100，依據是 8/4 的 99.75', () => {
    const s = stopLevel(b, 3, 'TW')!
    expect(s.price).toBe(100)
    expect(s.basis.swingLow).toBeCloseTo(99.75, 2)
    expect(s.basis.swingLowDate).toBe('2026-08-04')
  })
})

/**
 * PLAN §4 規定止跌點的驗收「不是對單一天」，要跑過整段歷史看三件事：
 * (a) 穩定、不逐日跳動 (b) 與現價保持有意義的距離 (c) 8/19 落在 100 附近。
 */
describe('止跌點回測（§4 的驗收條件）', () => {
  // 從有足夠歷史的地方開始，逐日只餵當天以前的資料
  const start = 70
  const series = bars.slice(start).map((bar) => {
    const b = upTo(bar.date)
    const s = stopLevel(b, 3, 'TW')
    return { date: bar.date, close: bar.c, stop: s ? s.price : null }
  })
  const withStop = series.filter((x) => x.stop !== null) as {
    date: string; close: number; stop: number
  }[]

  it('幾乎每天都算得出止跌點', () => {
    expect(withStop.length / series.length).toBeGreaterThan(0.9)
  })

  it('(a) 穩定：逐日變動的次數要少，且平均持續多天不變', () => {
    let changes = 0
    for (let i = 1; i < withStop.length; i++) {
      if (withStop[i]!.stop !== withStop[i - 1]!.stop) changes++
    }
    const avgHold = withStop.length / Math.max(changes, 1)
    // 一個每兩三天就換一次的止跌點沒人跟得上
    expect(avgHold).toBeGreaterThan(5)
  })

  it('(b) 距離：止跌點要在現價下方，且不會貼著現價跑', () => {
    const below = withStop.filter((x) => x.stop < x.close)
    // 絕大多數時候要在現價下方（跌破的當下會短暫高於現價，那是正常的）
    expect(below.length / withStop.length).toBeGreaterThan(0.8)

    const gaps = below.map((x) => (x.close - x.stop) / x.close)
    const median = gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)]!
    // 中位數距離至少 1%，否則等於沒有停損空間
    expect(median).toBeGreaterThan(0.01)
    // 也不能遠到失去意義
    expect(median).toBeLessThan(0.25)
  })

  it('(c) 2026-08-19 落在 100', () => {
    expect(withStop[withStop.length - 1]!.stop).toBe(100)
  })
})


/**
 * 這一組是實測 NVDA 才抓到的：原本取「時間上最近的 pivot high」，
 * 但價格突破之後那個高點已經變成支撐，於是算出「反彈 214–217 減碼」
 * 而現價是 219.74——等於叫人立刻賣在低點。
 */
describe('賣出區永遠要在現價之上', () => {
  it('0050 過去半年逐日檢查，賣出區下緣都高於當日收盤', () => {
    let checked = 0
    for (let i = 70; i < bars.length; i++) {
      const b = bars.slice(0, i + 1)
      const bb = bollinger(b.map((x) => x.c), 20, 2)
      if (!bb) continue
      const z = sellZone(b, bb, 3, 'TW')
      if (!z) continue
      expect(z.lo, `${bars[i]!.date} 的賣出區下緣`).toBeGreaterThan(bars[i]!.c)
      checked++
    }
    expect(checked).toBeGreaterThan(60)
  })

  it('創新高時退回布林上軌，並標成 band', () => {
    // 造一段一路創新高的資料：不會有任何 pivot high 在現價之上
    const rising: Bar[] = Array.from({ length: 80 }, (_, i) => {
      const base = 100 + i
      return { date: `2026-01-${String(i + 1).padStart(2, '0')}`, o: base, h: base + 1, l: base - 1, c: base, v: 1000 }
    })
    const bb = bollinger(rising.map((x) => x.c), 20, 2)!
    const z = sellZone(rising, bb, 3, 'US')
    expect(z).not.toBeNull()
    expect(z!.kind).toBe('band')
    expect(z!.lo).toBeGreaterThan(rising[rising.length - 1]!.c)
  })

  it('賣出區永遠有寬度，不會塌成一個點', () => {
    // PLTR 實測抓到的：band 模式下上下界都取上軌，印出 196.00 ~ 196.00
    const rising: Bar[] = Array.from({ length: 80 }, (_, i) => {
      const base = 100 + i * 1.5
      return { date: `2026-02-${String(i + 1).padStart(2, '0')}`, o: base, h: base + 1, l: base - 1, c: base, v: 1000 }
    })
    const bb = bollinger(rising.map((x) => x.c), 20, 2)!
    const z = sellZone(rising, bb, 3, 'US')!
    expect(z.hi).toBeGreaterThan(z.lo)
  })

  it('0050 逐日檢查賣出區都有寬度', () => {
    for (let i = 70; i < bars.length; i++) {
      const b = bars.slice(0, i + 1)
      const bb = bollinger(b.map((x) => x.c), 20, 2)
      if (!bb) continue
      const z = sellZone(b, bb, 3, 'TW')
      if (!z) continue
      expect(z.hi, `${bars[i]!.date}`).toBeGreaterThan(z.lo)
    }
  })
})
