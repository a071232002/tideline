import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 配色的兩件事，都是**只有量過才知道**的：
 *
 * 一、**系統深色與手動深色必須一模一樣。**
 *
 * 深色寫在兩個地方——`@media (prefers-color-scheme: dark)` 裡的
 * `:root:not([data-theme="light"])`，以及外面的 `:root[data-theme="dark"]`。
 * 兩塊不能合併（一個在 media query 裡、一個不在），所以只能各寫一份，
 * 而兩份就會漂移：實測就發生過 `--ink` 一邊 #f0ede4、一邊 #ebe8df，
 * `--faint` 更是有一邊整個漏掉，於是手動選深色的人會掉回淺色的 #a8a396，
 * 在深底上變成看不見的暗字。
 *
 * 二、**深色不是把淺色反過來。**
 *
 * 對比太低看不清楚，太高會眩光——近白壓在近黑上會暈開，而中文筆畫密。
 * 上一版 ink 對 bg 是 15.62:1，門檻只要 4.5。所以這裡訂**上下限**，
 * 不是只有下限。
 */

const css = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8')

/** 取出某個選擇器區塊裡的所有 `--token: value` */
function tokens(selector: string): Record<string, string> {
  const i = css.indexOf(selector)
  expect(i, `找不到選擇器 ${selector}`).toBeGreaterThan(-1)
  const open = css.indexOf('{', i)
  // 這些區塊裡只有宣告，沒有巢狀規則，所以第一個 } 就是結尾
  const close = css.indexOf('}', open)
  const body = css.slice(open + 1, close)
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out[m[1]!] = m[2]!.trim()
  }
  return out
}

const srgb = (h: string): [number, number, number] => {
  const m = /^#([0-9a-f]{6})$/i.exec(h)
  if (!m) throw new Error(`不是六碼色碼：${h}`)
  const n = parseInt(m[1]!, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const lum = (h: string): number => {
  const f = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)
  const [r, g, b] = srgb(h)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const ratio = (a: string, b: string): number => {
  const [x, y] = [lum(a), lum(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

describe('系統深色與手動深色必須一致', () => {
  const auto = tokens(':root:not([data-theme="light"])')
  const manual = tokens(':root[data-theme="dark"]')

  it('兩邊定義的 token 完全相同', () => {
    expect(Object.keys(manual).sort()).toEqual(Object.keys(auto).sort())
  })

  it('每一個值都一樣——漂移過的就是 --ink 與 --faint', () => {
    for (const k of Object.keys(auto)) {
      expect(manual[k], `${k} 兩邊不一致`).toBe(auto[k])
    }
  })

  it('淺色定義的每一個 token，深色都要有——漏掉會掉回淺色的值', () => {
    const light = tokens(':root {')
    for (const k of Object.keys(light)) {
      // 字級與行高不隨主題變，只檢查顏色
      if (/^--(t|n|lh)-/.test(k)) continue
      expect(auto[k], `深色缺少 ${k}`).toBeDefined()
    }
  })
})

describe('深色的對比要在區間內，不是越高越好', () => {
  const d = tokens(':root:not([data-theme="light"])')

  it('內文對卡片：夠讀，但不到眩光的程度', () => {
    const r = ratio(d['--ink']!, d['--card']!)
    expect(r).toBeGreaterThan(7)      // 遠高於 4.5，中文小字也讀得動
    expect(r, `${r.toFixed(2)}:1 太刺眼`).toBeLessThan(13)
  })

  it('**次要與標籤文字要比 4.5 更有餘裕**——深色底吃掉細筆畫', () => {
    /**
     * 4.5 是「讀得到」的門檻，不是「讀得舒服」的門檻。
     *
     * 實測過一次：底色抬亮之後 --ink2 是 5.88、--muted 是 4.80，兩個都「合格」，
     * 而使用者的回報是「小字看不清楚」。原因是深色底上細的亮筆畫會被周圍的
     * 暗色吃掉，看起來比同樣對比的暗字更細——所以深色的次要文字不能照抄
     * 淺色的數字。
     *
     * 這兩條下限比 WCAG 高，是刻意的。
     */
    expect(ratio(d['--ink2']!, d['--card']!), '--ink2 對卡片').toBeGreaterThan(7)
    expect(ratio(d['--muted']!, d['--card']!), '--muted 對卡片').toBeGreaterThan(5.5)
    for (const k of ['--ink2', '--muted']) {
      expect(ratio(d[k]!, d['--bg']!), `${k} 對底色`).toBeGreaterThan(4.5)
    }
  })

  it('邊框看得見——卡片浮不出來就是這條沒過', () => {
    expect(ratio(d['--line']!, d['--card']!)).toBeGreaterThan(1.35)
  })

  it('語意色在卡片上過非文字門檻 3:1', () => {
    for (const k of ['--sell', '--stop', '--buy', '--up', '--down', '--blue']) {
      expect(ratio(d[k]!, d['--card']!), `${k}`).toBeGreaterThan(3)
    }
  })
})

describe('淺色也要守同一組規則', () => {
  const l = tokens(':root {')

  it('次要與標籤文字過 4.5:1', () => {
    for (const k of ['--ink2', '--muted']) {
      expect(ratio(l[k]!, l['--bg']!), `${k} 對底色`).toBeGreaterThan(4.5)
      expect(ratio(l[k]!, l['--card']!), `${k} 對卡片`).toBeGreaterThan(4.5)
    }
  })

  it('邊框看得見', () => {
    expect(ratio(l['--line']!, l['--card']!)).toBeGreaterThan(1.35)
  })
})
