/**
 * Phase A 的 DEMO：吃一份代號清單 → 抓真實資料 → 算指標與價位 → 印出分析。
 *
 * 這一支還沒有資料庫、沒有網站。它的用途是回答兩個問題：
 * 「數字對不對」與「資料抓不抓得到」。
 *
 *   npm run demo                 # 用預設清單
 *   npm run demo -- 2330 NVDA    # 指定標的
 */
import { fetchTwseDailyBars } from '../src/lib/sources/twse'
import { fetchYahooDailyBars } from '../src/lib/sources/yahoo'
import { analyze } from '../src/lib/analyze'
import type { Bar } from '../src/lib/types'

interface Target {
  market: 'TW' | 'US'
  code: string
  label: string
  currency: string
}

/** 預設觀察清單。美股預設追蹤 Palantir 與輝達。 */
const DEFAULT_TARGETS: Target[] = [
  { market: 'TW', code: '0050', label: '0050 元大台灣50', currency: 'TWD' },
  { market: 'TW', code: '2330', label: '2330 台積電', currency: 'TWD' },
  { market: 'US', code: 'PLTR', label: 'PLTR Palantir', currency: 'USD' },
  { market: 'US', code: 'NVDA', label: 'NVDA 輝達', currency: 'USD' },
]

function parseArgs(argv: string[]): Target[] {
  const args = argv.slice(2).filter((a) => !a.startsWith('-'))
  if (args.length === 0) return DEFAULT_TARGETS
  return args.map((a) => {
    // 純數字視為台股代號
    const isTw = /^\d{4,6}$/.test(a)
    return isTw
      ? { market: 'TW' as const, code: a, label: a, currency: 'TWD' }
      : { market: 'US' as const, code: a.toUpperCase(), label: a.toUpperCase(), currency: 'USD' }
  })
}

async function loadBars(t: Target): Promise<{ bars: Bar[]; name: string | null; currency: string }> {
  if (t.market === 'TW') {
    // 台股走 TWSE，不走 Yahoo（PLAN §2）
    const bars = await fetchTwseDailyBars(t.code, 9)
    return { bars, name: null, currency: 'TWD' }
  }
  const r = await fetchYahooDailyBars(t.code, '1y')
  return { bars: r.bars, name: r.name, currency: r.currency }
}

const money = (v: number, c: string) => (c === 'TWD' ? v.toFixed(2) : v.toFixed(2))

function render(t: Target, name: string | null, currency: string, bars: Bar[]): void {
  const a = analyze(bars, currency, t.market)
  const title = name ? `${t.code} ${name}` : t.label

  console.log('')
  console.log('═'.repeat(72))
  console.log(`  ${title}`)
  console.log('═'.repeat(72))

  if (!a) {
    console.log(`  資料不足（只有 ${bars.length} 根 K 棒，至少要 60 根）`)
    return
  }

  const sign = a.chg >= 0 ? '▲' : '▼'
  console.log(`  資料日期 ${a.date}   （共 ${bars.length} 根 K 棒）`)
  console.log('')
  console.log(`  收盤 ${money(a.close, currency)}  ${sign}${Math.abs(a.chg).toFixed(2)}`
    + ` (${a.chgPct >= 0 ? '+' : ''}${a.chgPct.toFixed(2)}%)`
    + `   開 ${money(a.o, currency)} / 高 ${money(a.h, currency)} / 低 ${money(a.l, currency)}`)
  console.log(`  KD(9,3,3)   K ${a.k.toFixed(1)} / D ${a.d.toFixed(1)}`)
  console.log(`  布林(20,2σ) %b ${a.pctB.toFixed(2)}   上 ${a.bb.upper.toFixed(2)}`
    + ` / 中 ${a.bb.mid.toFixed(2)} / 下 ${a.bb.lower.toFixed(2)}`
    + `   帶寬 ${(a.bandwidth * 100).toFixed(1)}%`)
  console.log(`  季線 60MA   ${a.ma60 === null ? '—' : a.ma60.toFixed(2)}`
    + `   合理價區 ${a.levels.fair.lo.toFixed(2)} ~ ${a.levels.fair.hi.toFixed(2)}`)

  console.log('')
  console.log(`  ▸ ${a.verdict.headline}`)
  for (const r of a.verdict.reasons) console.log(`      · ${r}`)

  console.log('')
  console.log('  關鍵價位')
  if (a.levels.sell) {
    console.log(`    波段賣出  ${money(a.levels.sell.lo, currency)} ~ ${money(a.levels.sell.hi, currency)}`)
    console.log(`              ${a.levelWhy.sell}`)
  }
  if (a.levels.stop) {
    console.log(`    止跌      ${money(a.levels.stop.price, currency)}`)
    console.log(`              ${a.levelWhy.stop}`)
  }
  console.log(`    加碼      ${money(a.levels.add.lo, currency)} ~ ${money(a.levels.add.hi, currency)}`)
  console.log(`              ${a.levelWhy.add}`)
  console.log('')
  console.log('  指標與價位由程式計算。僅供參考，非投資建議。')
}

async function main(): Promise<void> {
  const targets = parseArgs(process.argv)
  console.log(`Tideline DEMO — ${targets.length} 檔`)

  let failed = 0
  for (const t of targets) {
    try {
      const { bars, name, currency } = await loadBars(t)
      render(t, name, currency, bars)
    } catch (e) {
      failed++
      console.log('')
      console.log('═'.repeat(72))
      console.log(`  ${t.label}`)
      console.log('═'.repeat(72))
      // 抓不到就明講，不要寫空資料或猜的數字（PLAN §9）
      console.log(`  抓取失敗：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  console.log('')
  if (failed > 0) {
    console.log(`${failed} / ${targets.length} 檔抓取失敗`)
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
