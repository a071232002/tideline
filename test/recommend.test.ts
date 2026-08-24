import { describe, it, expect } from 'vitest'
import { parsePicks, buildRecommendPrompt, MAX_THEME_CHARS } from '../src/lib/ai/recommend'

/**
 * 模型的輸出是**不受信任的輸入**。這一層又刻意讓它上網，所以更要防：
 * 一列看起來很正常但代號是編的，比整天沒有推薦糟得多——使用者會按下
 * 「加入追蹤」然後看到一個像是我們抓取壞掉的錯誤。
 *
 * 這裡釘死的規則只有三條，但每一條都對應一個具體的失敗：
 * 沒有來源的題材（跟捏造分不出來）、格式不對的代號（加入時才會爆）、
 * 整串不是 JSON（模型話多的時候）。
 */

const good = JSON.stringify({
  tw: [{ code: '2330', name: '台積電', theme: 'CoWoS 產能上修', source: 'https://money.udn.com/x' }],
  us: [{ code: 'NVDA', name: 'NVIDIA', theme: 'AI 需求', source: 'https://cnbc.com/y' }],
})

describe('parsePicks', () => {
  it('正常的回應', () => {
    const r = parsePicks(good)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.picks.tw[0]!.code).toBe('2330')
    expect(r.picks.us[0]!.code).toBe('NVDA')
  })

  it('前後有多餘的話也要能取出 JSON', () => {
    const r = parsePicks(`以下是結果：\n${good}\n希望有幫助。`)
    expect(r.ok).toBe(true)
  })

  it('**沒有來源的整列丟掉**——那是這一層唯一的保證', () => {
    const r = parsePicks(JSON.stringify({
      tw: [{ code: '2330', theme: '有題材沒出處' }],
      us: [{ code: 'NVDA', theme: 'AI', source: 'https://a.com/b' }],
    }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.picks.tw).toHaveLength(0)
    expect(r.picks.us).toHaveLength(1)
  })

  it('來源不是網址也算沒有來源', () => {
    const r = parsePicks(JSON.stringify({
      tw: [{ code: '2330', theme: 'x', source: '經濟日報' }], us: [],
    }))
    expect(r.ok).toBe(false)
  })

  it('台股代號要四碼數字，美股要英文——格式不對的丟掉', () => {
    const r = parsePicks(JSON.stringify({
      tw: [
        { code: 'TSMC', theme: 'x', source: 'https://a.com/b' },   // 台股給了英文
        { code: '2330', theme: 'y', source: 'https://a.com/c' },
      ],
      us: [{ code: '2330', theme: 'z', source: 'https://a.com/d' }], // 美股給了數字
    }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.picks.tw.map((p) => p.code)).toEqual(['2330'])
    expect(r.picks.us).toHaveLength(0)
  })

  it('00981A 這種帶字母尾碼的台股代號要收', () => {
    const r = parsePicks(JSON.stringify({
      tw: [{ code: '00981A', theme: 'x', source: 'https://a.com/b' }], us: [],
    }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.picks.tw[0]!.code).toBe('00981A')
  })

  it('同一天同一個代號只留一次', () => {
    const r = parsePicks(JSON.stringify({
      tw: [
        { code: '2330', theme: '第一次', source: 'https://a.com/b' },
        { code: '2330', theme: '第二次', source: 'https://a.com/c' },
      ],
      us: [],
    }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.picks.tw).toHaveLength(1)
    expect(r.picks.tw[0]!.theme).toBe('第一次')
  })

  it('太長的題材截斷，不是整列丟掉', () => {
    const long = '很'.repeat(300)
    const r = parsePicks(JSON.stringify({
      tw: [{ code: '2330', theme: long, source: 'https://a.com/b' }], us: [],
    }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.picks.tw[0]!.theme.length).toBe(MAX_THEME_CHARS)
  })

  it('不是 JSON → 這一天就沒有推薦，不要硬解', () => {
    expect(parsePicks('抱歉，我查不到相關資訊。').ok).toBe(false)
  })

  it('兩邊都空 → 不算成功，免得寫入一批空的', () => {
    expect(parsePicks(JSON.stringify({ tw: [], us: [] })).ok).toBe(false)
  })
})

describe('buildRecommendPrompt', () => {
  it('把已經在追蹤的排除掉——推薦已經有的等於沒推薦', () => {
    const p = buildRecommendPrompt(3, ['2330', 'NVDA'])
    expect(p).toContain('2330、NVDA')
    expect(p).toContain('已經在追蹤的不要再推薦')
  })

  it('沒有東西要排除時不要留一句空話', () => {
    expect(buildRecommendPrompt(3, [])).not.toContain('已經在追蹤')
  })

  it('說清楚只限上市——這個站不支援上櫃，收進來只會在加入時失敗', () => {
    expect(buildRecommendPrompt(3, [])).toContain('不含上櫃')
  })
})
