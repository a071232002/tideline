import { describe, it, expect } from 'vitest'
import { checkBars, checkAnalysis, checkOrphanAnalysis } from '../src/lib/sanity'
import type { Bar } from '../src/lib/types'

/**
 * 資料健檢。
 *
 * 到目前為止抓到的每一個資料錯誤都是用眼睛看出來的——Yahoo 的幽靈 K 棒、
 * null 破洞、盤中半根、upsert 留下的舊資料。那不是系統。
 *
 * 這一層要在每次抓取後自動跑，把異常寫進執行紀錄，讓頁面自己說
 * 「資料有問題」，而不是安靜地顯示錯的數字——**錯得很像對的**才是真正危險的：
 * 數字合理、沒有錯誤訊息、沒有人會發現。
 */

const bar = (over: Partial<Bar> & { date: string }): Bar =>
  ({ o: 100, h: 102, l: 99, c: 101, v: 1000, ...over })

/** 產生 n 根連續交易日的乾淨資料（跳過週末，免得誤觸 gap 檢查） */
const days = (n: number): Bar[] => {
  const out: Bar[] = []
  const d = new Date(Date.UTC(2026, 2, 2)) // 2026-03-02 是週一
  while (out.length < n) {
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) out.push(bar({ date: d.toISOString().slice(0, 10) }))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

describe('checkBars：K 棒本身的不變量', () => {
  it('乾淨的資料沒有異常', () => {
    expect(checkBars('0050', 'TW', days(60))).toEqual([])
  })

  it('最低價高於最高價 → 抓出來', () => {
    const bars = [bar({ date: '2026-06-01', l: 105, h: 102 })]
    const issues = checkBars('0050', 'TW', bars)
    expect(issues.some((i) => i.kind === 'ohlc')).toBe(true)
  })

  it('收盤價落在高低之外 → 抓出來（盤中半根最常見的樣子）', () => {
    const bars = [bar({ date: '2026-06-01', o: 100, h: 102, l: 99, c: 108 })]
    expect(checkBars('0050', 'TW', bars).some((i) => i.kind === 'ohlc')).toBe(true)
  })

  it('日期重複 → 抓出來', () => {
    const bars = [bar({ date: '2026-06-02' }), bar({ date: '2026-06-02' })]
    expect(checkBars('0050', 'TW', bars).some((i) => i.kind === 'duplicate')).toBe(true)
  })

  it('日期沒有由舊到新 → 抓出來', () => {
    const bars = [bar({ date: '2026-06-03' }), bar({ date: '2026-06-02' })]
    expect(checkBars('0050', 'TW', bars).some((i) => i.kind === 'order')).toBe(true)
  })

  it('未來的日期 → 抓出來', () => {
    const bars = [bar({ date: '2099-01-01' })]
    expect(checkBars('0050', 'TW', bars, { today: '2026-08-20' })
      .some((i) => i.kind === 'future')).toBe(true)
  })

  it('價格為零或負 → 抓出來', () => {
    expect(checkBars('0050', 'TW', [bar({ date: '2026-06-01', c: 0 })])
      .some((i) => i.kind === 'nonpositive')).toBe(true)
  })

  it('台股單日漲跌超過 10% → 抓出來（有漲跌幅限制）', () => {
    const bars = [bar({ date: '2026-06-01', c: 100 }), bar({ date: '2026-06-02', o: 118, h: 120, l: 117, c: 118 })]
    expect(checkBars('2330', 'TW', bars).some((i) => i.kind === 'jump')).toBe(true)
  })

  it('美股沒有漲跌幅限制，同樣幅度不該報警', () => {
    const bars = [bar({ date: '2026-06-01', c: 100 }), bar({ date: '2026-06-02', o: 118, h: 120, l: 117, c: 118 })]
    expect(checkBars('NVDA', 'US', bars).some((i) => i.kind === 'jump')).toBe(false)
  })

  it('美股極端跳動（一天翻倍）仍要抓——那通常是分割沒處理', () => {
    const bars = [bar({ date: '2026-06-01', c: 100 }), bar({ date: '2026-06-02', o: 210, h: 215, l: 205, c: 210 })]
    expect(checkBars('NVDA', 'US', bars).some((i) => i.kind === 'jump')).toBe(true)
  })

  it('中間空了超過兩週 → 抓出來（休市不會連續兩週）', () => {
    const bars = [bar({ date: '2026-06-01' }), bar({ date: '2026-07-05' })]
    expect(checkBars('0050', 'TW', bars).some((i) => i.kind === 'gap')).toBe(true)
  })

  it('資料太少算不出季線 → 抓出來', () => {
    expect(checkBars('0050', 'TW', days(10)).some((i) => i.kind === 'tooshort')).toBe(true)
    expect(checkBars('0050', 'TW', days(60)).some((i) => i.kind === 'tooshort')).toBe(false)
  })

  it('一次可以回報多個問題，不是遇到第一個就停', () => {
    const bars = [bar({ date: '2026-06-02', l: 200 }), bar({ date: '2026-06-01' })]
    const issues = checkBars('0050', 'TW', bars)
    expect(issues.length).toBeGreaterThan(1)
  })
})

describe('checkAnalysis：算完之後的內部一致性', () => {
  const good = {
    close: 103.1, bb_lo: 95.13, bb_mid: 102.42, bb_up: 109.72,
    pct_b: 0.546, k: 57, d_val: 75, ma60: 104.16,
  }

  it('一致的結果沒有異常', () => {
    expect(checkAnalysis('0050', good)).toEqual([])
  })

  it('布林三軌順序錯了 → 抓出來', () => {
    expect(checkAnalysis('0050', { ...good, bb_mid: 120 })
      .some((i) => i.kind === 'bands')).toBe(true)
  })

  it('%b 跟三軌對不起來 → 抓出來（存的跟算的不一致）', () => {
    expect(checkAnalysis('0050', { ...good, pct_b: 0.9 })
      .some((i) => i.kind === 'pctb')).toBe(true)
  })

  it('K 或 D 跑出 0–100 之外 → 抓出來', () => {
    expect(checkAnalysis('0050', { ...good, k: 140 }).some((i) => i.kind === 'kd')).toBe(true)
    expect(checkAnalysis('0050', { ...good, d_val: -5 }).some((i) => i.kind === 'kd')).toBe(true)
  })

  it('缺值不當成錯——季線在資料不足時本來就是 null', () => {
    expect(checkAnalysis('0050', { ...good, ma60: null })).toEqual([])
  })
})

describe('checkOrphanAnalysis：分析不能比 K 棒新', () => {
  /**
   * 2026-08-22 實測撞到的：0050 最新 K 棒是 08-19，最新分析卻是 08-21。
   *
   * 成因是 fixture 模式的抓取把 K 棒換成 fixture（結束於 08-19），
   * 並依既有邏輯刪掉「比最新一根還新」的真實 K 棒；而 `daily_analysis`
   * 依 PLAN §11 永不刪除，於是留下兩列沒有價格來源的孤兒。
   *
   * 後果不是少一天資料，是**頁面理直氣壯地顯示一個我們沒有價格的日期**：
   * 標題寫「資料日期 2026-08-21、收盤 104.65」，而 08-21 那根 K 棒不存在。
   * 沒有這個檢查，它不會有任何錯誤訊息。
   */
  it('分析日期比最新 K 棒新 → 抓出來', () => {
    const issues = checkOrphanAnalysis('0050', '2026-08-19', ['2026-08-20', '2026-08-21'])
    expect(issues).toHaveLength(1)
    expect(issues[0]!.kind).toBe('orphan')
    expect(issues[0]!.detail).toContain('2026-08-21')
  })

  it('分析日期等於最新 K 棒 → 正常', () => {
    expect(checkOrphanAnalysis('0050', '2026-08-19', ['2026-08-19'])).toEqual([])
  })

  it('分析日期比較舊 → 正常（分析全部留著，本來就會有很多舊的）', () => {
    expect(checkOrphanAnalysis('0050', '2026-08-19', ['2026-06-01', '2026-08-18'])).toEqual([])
  })

  it('沒有 K 棒時不誤報——那是另一種錯誤，由 checkBars 負責', () => {
    expect(checkOrphanAnalysis('0050', null, ['2026-08-21'])).toEqual([])
  })

  it('沒有分析時不誤報', () => {
    expect(checkOrphanAnalysis('0050', '2026-08-19', [])).toEqual([])
  })
})
