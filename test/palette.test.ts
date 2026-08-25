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

const raw = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8')

/**
 * **先把註解拿掉。**
 *
 * 這份 CSS 的註解裡大量出現色碼與屬性名（那是刻意的，每個值都寫著為什麼
 * 是這個值）。不剝掉的話，「有沒有處理 prefers-reduced-motion」這種檢查
 * 會被一句解釋它的註解騙過去——測試自己先踩到了這個坑。
 */
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * 取出某個選擇器**所有**區塊裡的 `--token: value`。
 *
 * 不是只有第一個：`:root` 在這份檔案裡出現好幾次（色彩、字級、間距、動態
 * 各一段，因為每一段都帶著自己的說明）。只讀第一個的話，後面幾段等於
 * 不存在——測試自己也先踩到了這個坑。
 */
function tokens(selector: string): Record<string, string> {
  const out: Record<string, string> = {}
  let from = 0
  let found = false
  for (;;) {
    const i = css.indexOf(selector, from)
    if (i < 0) break
    found = true
    const open = css.indexOf('{', i)
    // 這些區塊裡只有宣告，沒有巢狀規則，所以第一個 } 就是結尾
    const close = css.indexOf('}', open)
    for (const m of css.slice(open + 1, close).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      out[m[1]!] = m[2]!.trim()
    }
    from = close + 1
  }
  expect(found, `找不到選擇器 ${selector}`).toBe(true)
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
      // **只有顏色隨主題變。** 字級、行高、間距、動態在兩個模式下相同，
      // 它們不該出現在深色區塊裡——重複定義就等於多一個會漂移的地方。
      if (/^--(t|n|lh|sp|mo)-/.test(k)) continue
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

/**
 * 間距要有節奏。
 *
 * 原本有 19 種不同的間距值，其中 3、5、7、9、13、18、22、26 落在格子外，
 * 共 36 處。單看每一個都合理（「這裡再擠一點點」），合起來就是整份版面
 * 沒有節奏——那種不對齊不會被指出來，只會讓人覺得「沒做完」。
 *
 * 這條測試不看好不好看，只看**有沒有在格子上**。新增一個 7px 的 margin
 * 會立刻紅，而那正是這種漂移唯一會被攔下來的時機——事後沒有人會回頭數。
 */
const SPACING_SCALE = [0, 1, 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 32, 40]

describe('間距只用格線上的階', () => {
  it('margin / padding / gap 不出現格線外的數值', () => {
    const bad: string[] = []
    const re = /(?:^|[\s;{])((?:margin|padding|gap|row-gap|column-gap)[a-z-]*)\s*:\s*([^;}]+)/g
    for (const m of css.matchAll(re)) {
      for (const px of m[2]!.matchAll(/(\d+)px/g)) {
        const v = Number(px[1])
        if (!SPACING_SCALE.includes(v)) bad.push(`${m[1]}: …${v}px`)
      }
    }
    expect([...new Set(bad)].sort(), '這些間距不在格線上').toEqual([])
  })

  it('格線本身有定義成 token，不是只存在於註解裡', () => {
    const root = tokens(':root {')
    // --sp-* 至少要有這幾階，否則「定義一次重複使用」只是一句話
    for (const k of ['--sp-2', '--sp-4', '--sp-6', '--sp-8', '--sp-12']) {
      expect(root[k], `缺少 ${k}`).toBeDefined()
    }
  })
})

describe('動態也要有 token，而且尊重 reduced-motion', () => {
  it('時間與緩動各自只有一組', () => {
    const root = tokens(':root {')
    for (const k of ['--mo-fast', '--mo-slow', '--mo-ease']) {
      expect(root[k], `缺少 ${k}`).toBeDefined()
    }
  })

  it('**prefers-reduced-motion 必須把時間歸零**', () => {
    // 這不是偏好設定：對一部分人，動態是會引發不適的醫療需求
    const i = css.indexOf('prefers-reduced-motion')
    expect(i, '整份 CSS 沒有處理 prefers-reduced-motion').toBeGreaterThan(-1)
    const block = css.slice(i, css.indexOf('}', css.indexOf('{', i)) + 1)
    expect(block).toMatch(/--mo-fast:\s*0m?s/)
    expect(block).toMatch(/--mo-slow:\s*0m?s/)
  })
})
