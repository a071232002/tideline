/**
 * 底倉的對照實驗：**只量，不改。**
 *
 * ## 問題
 *
 * 現行規則從 100% 現金起手，四個條件同時成立才進場。到目前為止的實測是
 * 六檔、約八個交易日、12 個規則帳戶**總共只出手一次**。那筆「規劃給這一檔
 * 的錢」從頭到尾在場外，而場外的錢跟沒有規劃它是同一件事。
 *
 * 所以問：如果一開始就先放進去一部分（底倉），其餘留給訊號調節，會怎樣？
 *
 * ## 讀法
 *
 * 每一檔四組：底倉 0%（現行）、33%、67%、以及買了不動（等於 100%）。
 *
 * **要看的是三欄一起看，不是只看報酬率：**
 *
 *   超額     跟買了不動的差。這才是「準不準」——大盤漲 10% 你賺 4% 不是準
 *   在市     有幾成的日子錢真的在場上。0% 的那一組如果在市很低，
 *            那它的報酬率高低都沒有意義，它只是沒有參與
 *   回落     中途最多虧多少。報酬率一樣的兩條曲線，回落大的那條抱不住
 *
 * **不要挑報酬率最高的那個數字當答案。** §11 明令禁止用曲線好看挑參數。
 * 底倉比例是設計決定（這筆錢有多少是長期部位），這支腳本只負責讓那個
 * 決定有依據，不負責替你決定。
 *
 *     npm run experiment:core
 */
import { createAdminClient } from '../src/lib/supabase/admin'
import { simulate, type CorporateAction } from '../src/lib/sim/engine'
import { ruleDecider, holdDecider } from '../src/lib/sim/rules'
import { toRuleDays, initialCashFor, type SymbolMeta } from '../src/lib/sim/run'
import { DEFAULT_CAPITAL_TWD, DEFAULT_FEES, DEFAULT_RULES } from '../src/lib/sim/params'
import { rateOn, FX_PAIR, type FxRates } from '../src/lib/sources/fx'
import { maxDrawdown } from '../src/lib/sim/stats'
import { exitCleanly } from '../src/lib/exit'
import type { Bar } from '../src/lib/types'
import type { Market } from '../src/lib/levels'

const db = createAdminClient()
/**
 * 1 那一欄是「預設就持有，規則只負責減碼與止損」——沒有加碼額度了。
 * 它回答的問題跟其他欄不同：不是「什麼時候進場」，是「§4 的加碼／減碼
 * 如果從滿倉開始讀，會長什麼樣」。
 */
const CORES = [0, 1 / 3, 2 / 3, 1] as const

// FxRates 是**以日期為鍵的平表**，而且只裝一種幣別——所以要先用 pair 過濾。
// 寫成巢狀（fx[pair][date]）不會編不過型別以外的東西，但 rateOn() 會一律回 null，
// 於是每一檔美股都被判成「沒有匯率，開不了帳」而靜靜地退出樣本。
const { data: fxRows } = await db.from('fx_rates')
  .select('d, rate').eq('pair', FX_PAIR).order('d', { ascending: true })
const fx: FxRates = {}
for (const r of fxRows ?? []) fx[r.d as string] = Number(r.rate)

const { data: syms } = await db.from('symbols')
  .select('id, code, market, currency, is_etf').order('code')

interface Cell { ret: number; trades: number; dd: number; inMkt: number }
interface Row {
  code: string; days: number; cells: Cell[]; hold: number; holdDd: number
  /** 減碼+止損／只有止損／只有減碼／兩條都關 */
  exits: Cell[]
}
const rows: Row[] = []
/** 被跳過的要講出來——沉默的樣本篩選會讓結論看起來比實際上更有份量 */
const skipped: string[] = []

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
  if (analyses.length === 0) { skipped.push(`${sym.code}：沒有分析資料`); continue }
  const startedOn = analyses[0]!.d
  const bars: Bar[] = (barRows ?? [])
    .filter((b) => (b.d as string) >= startedOn)
    .map((b) => ({
      date: b.d as string, o: Number(b.o), h: Number(b.h),
      l: Number(b.l), c: Number(b.c), v: Number(b.v ?? 0),
    }))
  if (bars.length < 20) { skipped.push(`${sym.code}：只有 ${bars.length} 根 K 棒`); continue }

  const actions: CorporateAction[] = (actRows ?? []).map((a) => ({
    date: a.d as string, kind: a.kind as 'dividend' | 'split', amount: Number(a.amount),
  }))
  const days = toRuleDays(analyses)
  const { cash: initialCash } =
    initialCashFor(sym.market, DEFAULT_CAPITAL_TWD, rateOn(fx, startedOn))
  if (initialCash <= 0) { skipped.push(`${sym.code}：沒有匯率，開不了帳`); continue }
  const cfg = { market: sym.market, isEtf: sym.isEtf, initialCash, fees: DEFAULT_FEES, actions }

  const run = (coreFraction: number): Cell => {
    const r = simulate(
      bars, ruleDecider(days, initialCash, { ...DEFAULT_RULES, coreFraction }), cfg)
    const last = r.equity[r.equity.length - 1]
    return {
      ret: last?.retPct ?? 0,
      trades: r.trades.length,
      dd: maxDrawdown(r.equity.map((e) => e.equity)),
      inMkt: r.equity.length > 0
        ? Math.round((r.daysInMarket / r.equity.length) * 100) : 0,
    }
  }
  const runExit = (trim: boolean, stop: boolean): Cell => {
    const r = simulate(bars, ruleDecider(days, initialCash, {
      ...DEFAULT_RULES, coreFraction: 1, trimFraction: trim ? DEFAULT_RULES.trimFraction : 0,
      useStop: stop,
    }), cfg)
    const last = r.equity[r.equity.length - 1]
    return {
      ret: last?.retPct ?? 0, trades: r.trades.length,
      dd: maxDrawdown(r.equity.map((e) => e.equity)),
      inMkt: r.equity.length > 0 ? Math.round((r.daysInMarket / r.equity.length) * 100) : 0,
    }
  }
  const h = simulate(bars, holdDecider(), cfg)
  rows.push({
    exits: [runExit(true, true), runExit(false, true), runExit(true, false), runExit(false, false)],
    code: sym.code, days: bars.length,
    cells: CORES.map(run), hold: h.equity[h.equity.length - 1]?.retPct ?? 0,
    // **只比報酬不比風險，就是這個專案一直在防的自我欺騙。**
    // 規則的回落只有買了不動的幾分之一時，「輸了多少」要配著這個看。
    holdDd: maxDrawdown(h.equity.map((e) => e.equity)),
  })
}

/**
 * 第二張表：**輸的是進場還是出場？**
 *
 * 第一張表裡「底倉 100%」那一欄完全沒有進場決策（一開始就滿倉），
 * 卻仍然大幅落後買了不動。那就把問題指向出場：減碼與止損。
 *
 * 這裡固定底倉 100%，只開關那兩條，看各自要為多少落後負責。
 * 一樣是只量不改——`trimFraction: 0` 與 `useStop: false` 都只有這支腳本會傳。
 */
const exitRows = rows.map((r) => r)
const f = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].length))

console.log(`\n${rows.length} 檔・${CORES.map((c) => `底倉 ${Math.round(c * 100)}%`).join('／')}`)
console.log('超額 = 減去買了不動。在市 = 有幾成的日子錢真的在場上。\n')
console.log(pad('代號', 8) + pad('天數', 6) + pad('買不動', 10) + pad('它的回落', 10)
  + CORES.map((c) => pad(`底倉${Math.round(c * 100)}%：超額/在市/次數/回落`, 34)).join(''))

for (const r of rows) {
  console.log(pad(r.code, 8) + pad(String(r.days), 6) + pad(f(r.hold), 10)
    + pad(`−${r.holdDd.toFixed(1)}%`, 10)
    + r.cells.map((c) => pad(
      `${f(c.ret - r.hold)}  ${c.inMkt}%  ${c.trades}次  −${c.dd.toFixed(1)}%`, 34)).join(''))
}

console.log('')
for (let i = 0; i < CORES.length; i++) {
  const cells = rows.map((r) => ({ c: r.cells[i]!, hold: r.hold }))
  const beat = cells.filter((x) => x.c.ret > x.hold).length
  const never = cells.filter((x) => x.c.trades === 0).length
  const avgIn = Math.round(cells.reduce((s, x) => s + x.c.inMkt, 0) / cells.length)
  console.log(`底倉 ${String(Math.round(CORES[i]! * 100)).padStart(3)}%：`
    + `贏過買了不動 ${beat}/${rows.length} 檔・`
    + `一次都沒出手 ${never} 檔・平均在市 ${avgIn}%`)
}
// ---------------------------------------------------------------- 第二張表
console.log('\n輸在進場還是出場？固定底倉 100%（不做進場決策），只開關兩條出場規則\n')
console.log(pad('代號', 8) + pad('買不動', 10)
  + ['減碼+止損（現行）', '只有止損', '只有減碼', '兩條都關'].map((h) => pad(h, 22)).join(''))
for (const r of exitRows) {
  const cells = r.exits.map((c) => pad(`${f(c.ret - r.hold)}  ${c.inMkt}%  −${c.dd.toFixed(1)}%`, 22))
  console.log(pad(r.code, 8) + pad(f(r.hold), 10) + cells.join(''))
}
console.log('\n（「兩條都關」等於買了不動，超額應該接近 0——那是這張表的對照點，'
  + '不接近 0 就是這支腳本自己算錯了。）')

if (skipped.length > 0) {
  console.log(`\n沒有納入的（${skipped.length} 檔）：${skipped.join('・')}`)
}
console.log('\n**不要挑報酬率最高的那一欄。** 底倉比例是設計決定'
  + '（這筆錢有多少是長期部位），不是可以用曲線好看去挑的參數（§11）。')
await exitCleanly(0)
