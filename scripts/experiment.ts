/**
 * 規則的對照實驗：**只量，不改。**
 *
 * ## 為什麼要有這支腳本
 *
 * PLAN §11 留了一個問句：「跌破止跌就出清」到底幫了還是害了？
 *
 * 到目前為止的答案都是印象——看到某一檔止損之後股價又漲回去，就覺得
 * 這條規則有問題。那不算證據：任何規則在任何一檔上都找得到反例。
 *
 * 要回答它只有一種誠實的作法：**同一段資料、同一組參數，只差那一條規則**，
 * 跑完之後看每一檔的差。這支腳本就做這件事。
 *
 * ## 這支腳本刻意不做的事
 *
 * - **不寫資料庫。** 它不碰 `sim_trades` / `sim_equity` / `sim_accounts`。
 *   實驗的結果是拿來讀的，不是拿來當成績的。
 * - **不掃參數找最佳解。** §11 明令禁止用曲線好看來挑參數。這裡只有
 *   「開／關」兩種，因為問題本身就是二元的：這條規則該不該存在。
 * - **不改變正式行為。** `useStop` 預設 true，只有這支腳本會傳 false。
 *
 * ## 讀法
 *
 * 每一檔三個數字：有止損、沒止損、以及買了不動。
 * **要看的是「沒止損 − 有止損」這一欄**，而且要看每一檔，不要看平均——
 * 五檔的平均會被一檔大贏或大輸帶著走，那不是結論，是巧合。
 *
 *     npm run experiment
 */
import { createAdminClient } from '../src/lib/supabase/admin'
import { simulate, type CorporateAction } from '../src/lib/sim/engine'
import { ruleDecider, holdDecider } from '../src/lib/sim/rules'
import { toRuleDays, initialCashFor, type SymbolMeta } from '../src/lib/sim/run'
import { DEFAULT_CAPITAL_TWD, DEFAULT_FEES, DEFAULT_RULES } from '../src/lib/sim/params'
import { rateOn, FX_PAIR, type FxRates } from '../src/lib/sources/fx'
import { maxDrawdown } from '../src/lib/sim/stats'
import type { Bar } from '../src/lib/types'
import type { Market } from '../src/lib/levels'

const db = createAdminClient()

/**
 * 實驗用的起算日與正式帳戶不同：**這裡從有分析的第一天開始。**
 *
 * 正式帳戶從「加入觀察清單那天」起算，因為在那之前這個站沒有對使用者
 * 出過建議（見 run.ts）。但這支腳本問的是「這條規則本身好不好」，
 * 那是一個關於規則的問題，不是關於某個人的帳戶——樣本愈長愈有意義。
 * 目前的追蹤天數只有個位數，用它來評規則等於什麼都沒量。
 */

const { data: fxRows } = await db.from('fx_rates')
  .select('d, rate').eq('pair', FX_PAIR).order('d', { ascending: true })
const fx: FxRates = {}
for (const r of fxRows ?? []) fx[r.d as string] = Number(r.rate)

const { data: syms } = await db.from('symbols')
  .select('id, code, market, currency, is_etf').order('code')

interface Row {
  code: string
  market: string
  days: number
  withStop: { ret: number; trades: number; dd: number; inMkt: number }
  noStop: { ret: number; trades: number; dd: number; inMkt: number }
  hold: number
  stops: number
}
const rows: Row[] = []

for (const s of syms ?? []) {
  const sym: SymbolMeta = {
    id: s.id as string, code: s.code as string, market: s.market as Market,
    currency: s.currency as string, isEtf: Boolean(s.is_etf),
  }

  const { data: barRows } = await db.from('daily_bars')
    .select('d, o, h, l, c, v').eq('symbol_id', sym.id).order('d', { ascending: true })
  const { data: anRows } = await db.from('daily_analysis')
    .select('d, levels, pct_b, k, d_val, origin')
    .eq('symbol_id', sym.id).order('d', { ascending: true })
  const { data: actRows } = await db.from('corporate_actions')
    .select('d, kind, amount').eq('symbol_id', sym.id)

  const analyses = (anRows ?? []) as unknown as Parameters<typeof toRuleDays>[0]
  if (analyses.length === 0) continue

  const startedOn = analyses[0]!.d
  const bars: Bar[] = (barRows ?? [])
    .filter((b) => (b.d as string) >= startedOn)
    .map((b) => ({
      date: b.d as string, o: Number(b.o), h: Number(b.h),
      l: Number(b.l), c: Number(b.c), v: Number(b.v ?? 0),
    }))
  if (bars.length < 20) continue

  const actions: CorporateAction[] = (actRows ?? []).map((a) => ({
    date: a.d as string, kind: a.kind as 'dividend' | 'split', amount: Number(a.amount),
  }))
  const days = toRuleDays(analyses)
  const { cash: initialCash } =
    initialCashFor(sym.market, DEFAULT_CAPITAL_TWD, rateOn(fx, startedOn))
  if (initialCash <= 0) continue

  const cfg = {
    market: sym.market, isEtf: sym.isEtf, initialCash, fees: DEFAULT_FEES, actions,
  }
  const run = (useStop: boolean) => {
    const r = simulate(
      bars, ruleDecider(days, initialCash, { ...DEFAULT_RULES, useStop }), cfg)
    const last = r.equity[r.equity.length - 1]
    return {
      ret: last?.retPct ?? 0,
      trades: r.trades.length,
      dd: maxDrawdown(r.equity.map((e) => e.equity)),
      // 在市天數才是關鍵：規則輸給買了不動，多半不是因為賣錯，而是**根本沒在場上**
      inMkt: r.equity.length > 0
        ? Math.round((r.daysInMarket / r.equity.length) * 100) : 0,
      stops: r.trades.filter((t) => t.triggers.includes('stop')).length,
    }
  }

  const a = run(true)
  const b = run(false)
  const h = simulate(bars, holdDecider(), cfg)
  const hLast = h.equity[h.equity.length - 1]

  rows.push({
    code: sym.code, market: sym.market, days: bars.length,
    withStop: a, noStop: b, hold: hLast?.retPct ?? 0, stops: a.stops,
  })
}

const f = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].length))

console.log('\n止損規則的對照實驗　（同一段資料，只差「收盤跌破止跌就出清」這一條）\n')
console.log(pad('標的', 8) + pad('天數', 6) + pad('有止損', 10) + pad('沒止損', 10)
  + pad('差', 10) + pad('買了不動', 10) + pad('止損', 6)
  + pad('回落 有／沒', 16) + '在市 有／沒')
console.log('─'.repeat(88))
for (const r of rows) {
  const diff = r.noStop.ret - r.withStop.ret
  console.log(
    pad(r.code, 8) + pad(String(r.days), 6)
    + pad(f(r.withStop.ret), 10) + pad(f(r.noStop.ret), 10)
    + pad(f(diff), 10) + pad(f(r.hold), 10)
    + pad(String(r.stops), 6)
    + pad(`${r.withStop.dd.toFixed(1)}% ／ ${r.noStop.dd.toFixed(1)}%`, 16)
    + `${r.withStop.inMkt}% ／ ${r.noStop.inMkt}%`)
}

const helped = rows.filter((r) => r.noStop.ret < r.withStop.ret)
const hurt = rows.filter((r) => r.noStop.ret > r.withStop.ret)
console.log('─'.repeat(88))
console.log(`\n止損幫上忙：${helped.length} 檔（${helped.map((r) => r.code).join('、') || '無'}）`)
console.log(`止損拖後腿：${hurt.length} 檔（${hurt.map((r) => r.code).join('、') || '無'}）`)

// 最大回落是止損存在的**理由**。只看報酬率就把它關掉，是拿沒量到的風險換報酬。
const ddBetter = rows.filter((r) => r.withStop.dd < r.noStop.dd)
console.log(`止損讓回落變小：${ddBetter.length} 檔`
  + `（${ddBetter.map((r) => r.code).join('、') || '無'}）`)
// 「在市天數」這一欄才是這張表的重點。規則輸給買了不動，如果在市只有三成，
// 那它不是賣錯，是**大部分時間根本不在場上**——那時候調止損沒有用。
const flat = rows.filter((r) => r.noStop.inMkt < 60)
console.log(`\n關掉止損之後仍然有一半以上時間空手：${flat.length} 檔`
  + `（${flat.map((r) => `${r.code} ${r.noStop.inMkt}%`).join('、') || '無'}）`)

console.log('\n這張表不是結論，是證據。要不要動規則是另一個決定——'
  + '而且動之前要先問：這段期間是不是剛好只有一種行情。\n')
