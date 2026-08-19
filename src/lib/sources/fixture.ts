import fixture from '../../../test/fixtures/0050.json'
import type { Bar } from '../types'

/**
 * E2E 與本機測試用的假來源。由 `TIDELINE_FIXTURE=1` 啟用。
 *
 * 用真實的 0050 日線當底，再依代號做確定性的價格縮放——這樣不同標的看起來
 * 不一樣，但同一個代號每次跑都完全相同。測試要的是可重現，不是逼真。
 */

function scaleFor(code: string): number {
  // 由代號算出穩定的倍率，不用亂數（亂數會讓測試每次結果不同）
  let h = 0
  for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) % 997
  return 0.5 + (h % 40) / 10 // 0.5 ~ 4.4 倍
}

export function fixtureBars(
  market: 'TW' | 'US',
  code: string,
): { bars: Bar[]; name: string | null; currency: string } {
  const base = fixture.bars as Bar[]
  const k = code === '0050' ? 1 : scaleFor(code)
  const round = (v: number) => Math.round(v * 100) / 100

  const bars: Bar[] = base.map((b) => ({
    date: b.date,
    o: round(b.o * k), h: round(b.h * k),
    l: round(b.l * k), c: round(b.c * k),
    v: b.v,
  }))

  return {
    bars,
    name: code === '0050' ? '元大台灣50' : `${code} (fixture)`,
    currency: market === 'TW' ? 'TWD' : 'USD',
  }
}
