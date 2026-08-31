/**
 * 限價 vs 市價的對照實驗：**只量，不改。**
 *
 * ## 問題
 *
 * 規則軌的加碼與減碼是**價位觸發**的：「今日最低進了加碼區」、
 * 「今日最高碰到賣出區」。但成交排在次日，而次日一律用開盤市價成交——
 * 於是觸發它的那個價位從來沒有真的成交過。碰到加碼區之後彈回去就買在
 * 區間上方，碰到賣出區之後回落就賣在區間下方，**兩邊都往不利的方向偏。**
 *
 * `experiment:core` 量出「輸的是出場不是進場」。那個結論有一個沒排除的
 * 解釋：**規則本身沒問題，只是成交價系統性地比訊號價差一截。**
 * 這支腳本就是拿來分開這兩件事的。
 *
 * ## 兩欄的差別只有一條
 *
 *   市價（舊）  訊號隔天開盤成交，有什麼吃什麼
 *   限價（新）  訊號隔天掛在加碼區上緣／賣出區下緣，沒回到就不成交
 *
 * 止損兩欄都是市價——它的意思是離場，不是「賣得到某個價才走」。
 *
 * ## 讀法
 *
 *   超額    跟買了不動的差。這才是「準不準」
 *   次數    限價那欄一定比較少，因為有些單掛了沒成交。**少多少要看**：
 *           少太多代表規則實際上根本沒在動，那個報酬率就沒有意義
 *   未成交  掛出去但那天沒碰到的單。這是舊版本完全看不見的東西
 *   回落    中途最多虧多少
 *
 * **不要用這張表去挑限價要掛在哪。** 掛在區間邊緣是規格本來就寫好的
 * （§4 的加碼區與賣出區），這支腳本只回答「對齊之後差多少」。
 *
 *     npm run experiment:limit
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

// FxRates 是**以日期為鍵的平表**，而且只裝一種幣別——所以要先用 pair 過濾。
// 寫成巢狀不會編不過，但 rateOn() 會一律回 null，於是每一檔美股都被判成
// 「沒有匯率，開不了帳」而靜靜地退出樣本（experiment-core 踩過這個坑）。
const { data: fxRows } = await db.from('fx_rates')
  .select('d, rate').eq('pair', FX_PAIR).order('d', { ascending: true })
const fx: FxRates = {}
for (const r of fxRows ?? []) fx[r.d as string] = Number(r.rate)

const { data: syms } = await db.from('symbols')
  .select('id, code, market, currency, is_etf').order('code')

interface Cell {
  ret: number
  trades: number
  dd: number
  inMkt: number
  /** 掛出去但那天沒碰到的單。市價那欄一定是 0 */
  missed: number
}
interface Row { code: string; days: number; hold: number; mkt: Cell; lim: Cell }
const rows: Row[] = []
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

  /**
   * 未成交的單要自己數，引擎不會報。
   *
   * 做法是把同一組參數再跑一次、只是把限價拿掉，比較兩邊的成交筆數——
   * 不行，那兩條路徑的部位會分岔，數出來的差不是「沒成交的單」。
   * 所以改成用引擎自己的規則重算一次：包一層 decider，記下每一張帶限價的
   * 單，隔天用同一條判斷式看它碰到沒有。判斷式跟 `engine.ts` 的
   * `buyPriceOn` / `sellPriceOn` 必須一致，否則這一欄會說謊。
   */
  const runOne = (useLimit: boolean): Cell => {
    const inner = ruleDecider(days, initialCash, { ...DEFAULT_RULES, useLimit })
    let missed = 0
    let waiting: { buyLimit?: number; sellLimit?: number } | null = null
    const r = simulate(bars, (ctx) => {
      if (waiting) {
        const b = ctx.bar
        const buyMiss = waiting.buyLimit !== undefined
          && b.o > waiting.buyLimit && b.l > waiting.buyLimit
        const sellMiss = waiting.sellLimit !== undefined
          && b.o < waiting.sellLimit && b.h < waiting.sellLimit
        if (buyMiss || sellMiss) missed++
        waiting = null
      }
      const o = inner(ctx)
      if (o && (o.buyLimit !== undefined || o.sellLimit !== undefined)) {
        waiting = { buyLimit: o.buyLimit, sellLimit: o.sellLimit }
      }
      return o
    }, cfg)
    const last = r.equity[r.equity.length - 1]
    return {
      ret: last?.retPct ?? 0,
      trades: r.trades.length,
      dd: maxDrawdown(r.equity.map((e) => e.equity)),
      inMkt: r.equity.length > 0
        ? Math.round((r.daysInMarket / r.equity.length) * 100) : 0,
      missed,
    }
  }

  const h = simulate(bars, holdDecider(), cfg)
  rows.push({
    code: sym.code, days: bars.length,
    hold: h.equity[h.equity.length - 1]?.retPct ?? 0,
    mkt: runOne(false), lim: runOne(true),
  })
}

const f = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].length))
const cell = (c: Cell, hold: number) =>
  `${f(c.ret - hold)}  ${c.trades}次  未成交${c.missed}  ${c.inMkt}%  −${c.dd.toFixed(1)}%`

console.log(`\n${rows.length} 檔・加碼與減碼：隔天開盤市價 vs 掛在區間邊緣的限價`)
console.log('底倉維持現行的 2/3，止損兩欄都是市價（它的意思是離場，不是等好價錢）。')
console.log('超額 = 減去買了不動。未成交 = 掛出去但那天沒碰到的單。\n')
console.log(pad('代號', 8) + pad('天數', 6) + pad('買不動', 10)
  + pad('市價（舊）超額/次數/未成交/在市/回落', 40)
  + pad('限價（新）超額/次數/未成交/在市/回落', 40))

for (const r of rows) {
  console.log(pad(r.code, 8) + pad(String(r.days), 6) + pad(f(r.hold), 10)
    + pad(cell(r.mkt, r.hold), 40) + pad(cell(r.lim, r.hold), 40))
}

const sum = (pick: (r: Row) => Cell) => {
  const cs = rows.map(pick)
  return {
    beat: rows.filter((r) => pick(r).ret > r.hold).length,
    avgEx: rows.reduce((s, r) => s + (pick(r).ret - r.hold), 0) / rows.length,
    trades: cs.reduce((s, c) => s + c.trades, 0),
    missed: cs.reduce((s, c) => s + c.missed, 0),
    avgIn: Math.round(cs.reduce((s, c) => s + c.inMkt, 0) / cs.length),
  }
}
console.log('')
for (const [name, pick] of [
  ['市價（舊）', (r: Row) => r.mkt], ['限價（新）', (r: Row) => r.lim],
] as const) {
  const t = sum(pick)
  console.log(`${name}：贏過買了不動 ${t.beat}/${rows.length} 檔・`
    + `平均超額 ${f(t.avgEx)}・成交 ${t.trades} 筆・未成交 ${t.missed} 筆・`
    + `平均在市 ${t.avgIn}%`)
}

if (skipped.length > 0) {
  console.log(`\n沒有納入的（${skipped.length} 檔）：${skipped.join('・')}`)
}
console.log('\n**這張表不能拿來挑限價要掛在哪。** 加碼區上緣與賣出區下緣是 §4'
  + '本來就寫好的價位，這裡只回答「成交價對齊訊號價之後差多少」。')
console.log('樣本一樣是那幾段淨上漲的窗口——限價買單在單邊上漲裡本來就比較容易'
  + '掛不到，所以「未成交」那一欄在下跌段會是另一個樣子。')
await exitCleanly(0)
