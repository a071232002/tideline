import { describe, it, expect } from 'vitest'
import { excluded, rank, pickTop, ZONE_TOLERANCE, type RankInput } from '../src/lib/ai/rank'

/**
 * 這把尺決定「值得看一眼」那一區會出現誰。它刻意跟新聞熱度相反——
 * 熱門的定義就是沒有回檔，而這個站只在回檔到加碼區時分批進場。
 *
 * 所以測試要釘住的是：**熱到爆的那一檔必須排在後面**。那不是 bug，
 * 是這一區的定義。哪天有人覺得「怎麼都推薦冷門股」，答案在這裡。
 */

const base: RankInput = {
  close: 100, k: 50, pctB: 0.5, ma60: 90, addHi: 102, addLo: 98, stop: 85,
}

describe('excluded', () => {
  it('平常不排除', () => {
    expect(excluded(base)).toBeNull()
  })

  it('跌破季線 → 排除。回檔到加碼區只是下跌途中的一站', () => {
    expect(excluded({ ...base, close: 85, ma60: 90 })).toContain('季線')
  })

  it('跌破止跌 → 排除。規則對已持有的是全部出清，沒道理同時推薦給別人', () => {
    // ma60 要一起壓低，否則先撞到季線那一條——兩個排除條件的順序是固定的
    expect(excluded({ ...base, close: 84, ma60: 80, stop: 85 })).toContain('止跌')
  })

  it('沒有季線或止跌資料時不要亂排除', () => {
    expect(excluded({ ...base, ma60: null, stop: null })).toBeNull()
  })
})

describe('rank', () => {
  it('%b 越低分數越高', () => {
    const lo = rank({ ...base, pctB: 0.1 }).parts.pctB
    const hi = rank({ ...base, pctB: 0.9 }).parts.pctB
    expect(lo).toBeGreaterThan(hi)
  })

  it('K 越低分數越高', () => {
    expect(rank({ ...base, k: 20 }).parts.k).toBeGreaterThan(rank({ ...base, k: 80 }).parts.k)
  })

  it('已經在加碼區內或更低 → 區位滿分', () => {
    expect(rank({ ...base, close: 100, addHi: 102 }).parts.zone).toBe(1)
    expect(rank({ ...base, close: 95, addHi: 102 }).parts.zone).toBe(1)
  })

  it('高出加碼區容忍範圍 → 區位 0 分', () => {
    const way = base.addHi * (1 + ZONE_TOLERANCE + 0.01)
    expect(rank({ ...base, close: way }).parts.zone).toBe(0)
  })

  it('%b 超出 0～1 也不會讓分數跑出範圍', () => {
    // 收盤跌出通道下緣時 %b 會是負的，衝出上緣會大於 1
    expect(rank({ ...base, pctB: -0.4 }).parts.pctB).toBe(1)
    expect(rank({ ...base, pctB: 1.6 }).parts.pctB).toBe(0)
  })

  it('**熱到爆的那一檔分數要低**——這一區不是熱門排行', () => {
    const hot = rank({ ...base, close: 130, addHi: 102, k: 92, pctB: 0.98 })
    const pulled = rank({ ...base, close: 99, addHi: 102, k: 24, pctB: 0.22 })
    expect(pulled.score).toBeGreaterThan(hot.score)
    expect(hot.score).toBeLessThan(0.2)
  })
})

describe('pickTop', () => {
  const mk = (code: string, x: Partial<RankInput>) => ({ code, input: { ...base, ...x } })

  it('排除的不進榜，而且說得出為什麼', () => {
    const r = pickTop([
      mk('AAA', { k: 20, pctB: 0.2 }),
      mk('BBB', { close: 80, ma60: 90 }),      // 跌破季線
    ], 3)
    expect(r.picked.map((p) => p.code)).toEqual(['AAA'])
    expect(r.dropped).toEqual([{ code: 'BBB', why: '收盤在季線之下' }])
  })

  it('依分數由高到低，取前 N', () => {
    const r = pickTop([
      mk('HOT', { close: 130, k: 95, pctB: 0.99 }),
      mk('MID', { close: 101, k: 55, pctB: 0.5 }),
      mk('DIP', { close: 96, k: 18, pctB: 0.15 }),
    ], 2)
    expect(r.picked.map((p) => p.code)).toEqual(['DIP', 'MID'])
  })

  it('同分時代號小的在前——結果要可重現', () => {
    const r = pickTop([mk('ZZZ', {}), mk('AAA', {})], 2)
    expect(r.picked.map((p) => p.code)).toEqual(['AAA', 'ZZZ'])
  })

  it('全部被排除 → 空名單，不要硬湊', () => {
    const r = pickTop([mk('AAA', { close: 10, ma60: 90 })], 3)
    expect(r.picked).toHaveLength(0)
    expect(r.dropped).toHaveLength(1)
  })
})
