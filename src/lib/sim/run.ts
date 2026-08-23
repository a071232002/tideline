import { createAdminClient } from '../supabase/admin'
import { fetchPaged } from '../supabase/paged'
import { simulate, type Decider, type CorporateAction, type SimResult } from './engine'
import { ruleDecider, holdDecider, type RuleDay } from './rules'
import { DEFAULT_CAPITAL_TWD, DEFAULT_FEES, DEFAULT_RULES, PARAMS_VERSION } from './params'
import { rateOn, FX_PAIR, type FxRates } from '../sources/fx'
import { RULES_VERSION } from '../backfill'
import type { Bar } from '../types'
import type { Market } from '../levels'

/**
 * 把模擬帳戶接上資料庫（PLAN §13.6）。
 *
 * ## 什麼是真相，什麼是推導出來的
 *
 * | 表 | 地位 |
 * |---|---|
 * | `daily_analysis` | 真相。當天說了什麼 |
 * | `sim_ai_log` | 真相。當天 AI 決定做什麼。**永不重算、永不回補** |
 * | `sim_trades` / `sim_equity` | **推導**。由上面兩者加上 K 棒算出來 |
 *
 * 所以三條軌道都可以整條重建，重建不會失真——決策的紀錄沒有被動到，
 * 動的只是「照這些決策會變成什麼樣」。這也讓費率參數改動之後可以整批重跑。
 *
 * AI 那條的 decider 是**重播**紀錄，不是重新問模型。事後再問一次模型，
 * 它知道後來發生了什麼，那條曲線一定漂亮也一定沒有意義（§13.1 四）。
 */

export type Track = 'rule' | 'ai' | 'hold'
export const TRACKS: Track[] = ['rule', 'ai', 'hold']

export interface SymbolMeta {
  id: string
  code: string
  market: Market
  currency: string
  isEtf: boolean
}

interface AnalysisRow {
  d: string
  levels: Record<string, unknown>
  pct_b: number | null
  k: number | null
  d_val: number | null
  origin: string
}

/** 把 daily_analysis 轉成規則軌道看得懂的每日輸入。KD 的前一日值要自己接起來 */
export function toRuleDays(rows: readonly AnalysisRow[]): Record<string, RuleDay> {
  const out: Record<string, RuleDay> = {}
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!
    const lv = r.levels as {
      add?: { lo: number; hi: number }
      sell?: { lo: number; hi: number } | null
      stop?: { price: number } | null
    }
    // 加碼區是規則的核心，沒有它這一天就沒有可用的決策輸入
    if (!lv?.add || r.pct_b === null || r.k === null || r.d_val === null) continue
    const prev = rows[i - 1]
    out[r.d] = {
      levels: { add: lv.add, sell: lv.sell ?? null, stop: lv.stop ?? null },
      pctB: Number(r.pct_b),
      k: Number(r.k),
      d: Number(r.d_val),
      kPrev: prev?.k === null || prev?.k === undefined ? null : Number(prev.k),
      dPrev: prev?.d_val === null || prev?.d_val === undefined ? null : Number(prev.d_val),
    }
  }
  return out
}

interface AiLogRow {
  d: string
  status: string
  action: string | null
  confidence: string | null
  reason: string | null
}

/**
 * AI 軌道的 decider：**重播**當天記下來的決定。
 *
 * 動作是固定選項不是自由輸入——`buy_50` 代表「用掉一半現金」，
 * 實際股數由引擎按成交價算。AI 沒有欄位可以填數字，所以沒有機會編數字（§13.5）。
 */
export function aiDecider(logs: readonly AiLogRow[]): Decider {
  const byDate = new Map(logs.filter((l) => l.status === 'ok').map((l) => [l.d, l]))
  return (ctx) => {
    const l = byDate.get(ctx.bar.date)
    if (!l?.action || l.action === 'hold') return null

    const m = /^(buy|sell)_(25|50|100)$/.exec(l.action)
    if (!m) return null
    const pct = Number(m[2]) / 100
    const common = {
      triggers: [`ai:${l.action}`],
      decidedBy: 'ai' as const,
      confidence: l.confidence ?? undefined,
      reason: l.reason ?? undefined,
    }
    return m[1] === 'buy'
      ? { ...common, buyCash: ctx.state.cash * pct }
      : { ...common, sellFraction: pct }
  }
}

export function deciderFor(
  track: Track,
  days: Record<string, RuleDay>,
  logs: readonly AiLogRow[],
  initialCash: number,
): Decider {
  if (track === 'hold') return holdDecider()
  if (track === 'ai') return aiDecider(logs)
  return ruleDecider(days, initialCash, DEFAULT_RULES)
}

/** 本金換算。美股帳內用美元記帳，本金是「建帳當日以匯率換算的 5 萬台幣」 */
export function initialCashFor(
  market: Market, capitalTwd: number, fx: number | null,
): { cash: number; fx: number | null } {
  if (market === 'TW') return { cash: capitalTwd, fx: null }
  // 匯率查不到就不能開美股帳戶——用一個猜的匯率開帳，之後每一天的台幣淨值都是錯的
  if (fx === null || !(fx > 0)) return { cash: 0, fx: null }
  return { cash: capitalTwd / fx, fx }
}

async function loadFx(): Promise<FxRates> {
  const db = createAdminClient()
  /**
   * **一定要分頁，而且一定要排序。**
   *
   * 原本是一句沒有 `order()` 的 `select()`。匯率每個交易日一列，大約四年後
   * 超過 PostgREST 的 1000 列上限——而沒有排序的查詢被截斷之後，回來的是一個
   * **任意**子集。`rateOn()` 從拿到的日期裡挑「不晚於指定日的最後一天」，
   * 拿到任意子集就會挑到一個更早的匯率，整條美股帳戶的台幣淨值全部偏掉，
   * 而且不會有任何錯誤。
   */
  const rows = await fetchPaged((from, to) => db
    .from('fx_rates').select('d, rate').eq('pair', FX_PAIR)
    .order('d', { ascending: true }).range(from, to))
  const out: FxRates = {}
  for (const r of rows) out[r.d as string] = Number(r.rate)
  return out
}

export interface RebuildResult {
  code: string
  track: Track
  trades: number
  retPct: number
  daysInMarket: number
  totalFees: number
  pending: string | null
  skipped?: string
}

/**
 * 重建一位使用者的所有模擬帳戶。
 *
 * 帳戶不存在就建立——加入觀察清單時就該建好，但既有的標的是在這個功能之前
 * 加進去的，所以這裡補建。`started_on` 用**有分析資料的第一天**，
 * 三條軌道一致，否則報酬率不能並排比較。
 */
export async function rebuildAll(userId: string, capitalTwd = DEFAULT_CAPITAL_TWD)
  : Promise<RebuildResult[]> {
  const db = createAdminClient()
  const fx = await loadFx()

  const { data: watched } = await db.from('watchlist')
    .select('symbol_id, added_at').eq('user_id', userId)
  const ids = [...new Set((watched ?? []).map((w) => w.symbol_id as string))]
  if (ids.length === 0) return []

  // 什麼時候開始追蹤這一檔。帳戶從這一天起算，見下方 startedOn 的註解。
  const addedAt = new Map<string, string>()
  for (const w of watched ?? []) {
    addedAt.set(w.symbol_id as string, String(w.added_at).slice(0, 10))
  }

  const { data: syms } = await db.from('symbols')
    .select('id, code, market, currency, is_etf').in('id', ids)

  const out: RebuildResult[] = []

  for (const s of syms ?? []) {
    const sym: SymbolMeta = {
      id: s.id as string, code: s.code as string, market: s.market as Market,
      currency: s.currency as string, isEtf: Boolean(s.is_etf),
    }

    const { data: barRows } = await db.from('daily_bars')
      .select('d, o, h, l, c, v').eq('symbol_id', sym.id).order('d', { ascending: true })
    // 分析永不刪除（§11），每檔每年約 250 列。由舊到新排序，所以一旦超過
    // 1000 列，被截斷丟掉的正好是**最新的**那段——模擬會停在四年前。
    const anRows = await fetchPaged((from, to) => db.from('daily_analysis')
      .select('d, levels, pct_b, k, d_val, origin')
      .eq('symbol_id', sym.id).order('d', { ascending: true }).range(from, to))
    const { data: actRows } = await db.from('corporate_actions')
      .select('d, kind, amount').eq('symbol_id', sym.id)

    const analyses = anRows as unknown as AnalysisRow[]
    if (analyses.length === 0) {
      for (const t of TRACKS) {
        out.push({ code: sym.code, track: t, trades: 0, retPct: 0, daysInMarket: 0,
          totalFees: 0, pending: null, skipped: '沒有分析資料' })
      }
      continue
    }

    /**
     * 帳戶從**開始追蹤這一檔的那天**起算。
     *
     * 原本是從「有分析可用的第一天」起算，也就是資料視窗的開頭。
     * 那會產生一個很難察覺的謊：0050 的帳戶顯示「從 2026-03-06 起、報酬 +29.32%」，
     * 但使用者是 08-19 才把它加進清單的——**在那之前這個站根本沒有對它出過建議**，
     * 那五個月是回測，不是帳戶。把回測的報酬掛在「如果照建議做」下面，
     * 等於用一段你不可能參與的歷史來證明建議有效。
     *
     * 兩條軌道都得跟著改：買進持有若從更早開始，它會憑空多賺一段，對照就失去意義。
     * 資料不足時往後退到有分析的第一天（剛加入的標的還沒有那麼多歷史）。
     */
    const trackedFrom = addedAt.get(sym.id) ?? analyses[0]!.d
    const startedOn = trackedFrom > analyses[0]!.d ? trackedFrom : analyses[0]!.d
    const bars: Bar[] = (barRows ?? [])
      .filter((b) => (b.d as string) >= startedOn)
      .map((b) => ({
        date: b.d as string, o: Number(b.o), h: Number(b.h),
        l: Number(b.l), c: Number(b.c), v: Number(b.v ?? 0),
      }))

    const actions: CorporateAction[] = (actRows ?? []).map((a) => ({
      date: a.d as string,
      kind: a.kind as 'dividend' | 'split',
      amount: Number(a.amount),
    }))

    const days = toRuleDays(analyses)
    const originByDate = new Map(analyses.map((a) => [a.d, a.origin]))

    // **已經開過的帳戶用它自己存的本金。**
    //
    // `capitalTwd` 這個參數只是「新帳戶的預設值」。如果每次重建都拿它去套用到
    // 每一檔，那麼改某一檔的本金就會靜悄悄改掉其他每一檔——而且沒有任何提示，
    // 使用者只會看到別檔的報酬率莫名其妙變了。
    const { data: existingAcc } = await db.from('sim_accounts')
      .select('initial_twd').eq('user_id', userId).eq('symbol_id', sym.id)
      .limit(1).maybeSingle()
    const capitalForSymbol = existingAcc ? Number(existingAcc.initial_twd) : capitalTwd

    const { cash: initialCash, fx: fxAtOpen } =
      initialCashFor(sym.market, capitalForSymbol, rateOn(fx, startedOn))
    if (initialCash <= 0) {
      for (const t of TRACKS) {
        out.push({ code: sym.code, track: t, trades: 0, retPct: 0, daysInMarket: 0,
          totalFees: 0, pending: null, skipped: '沒有匯率，美股帳戶無法開帳' })
      }
      continue
    }

    /**
     * 起算日之後還沒有任何交易日——**帳戶照建，只是還沒得跑。**
     *
     * 週末或收盤前加進來的標的就是這樣：起算日是今天，而最新的 K 棒是
     * 上一個交易日。原本這裡直接 `continue`，結果是帳戶根本沒被建立、
     * 也沒有留下任何紀錄——畫面上那一列沒有模擬、沒有 AI，也沒有一句話
     * 說明為什麼（實測 2026-08-23 週日加入的 00981A）。
     *
     * 帳戶建起來，起算日就記住了；下一個交易日的抓取一跑，它自己會接上。
     */
    if (bars.length === 0) {
      for (const t of TRACKS) {
        await ensureAccount(userId, sym, t, {
          capitalTwd: capitalForSymbol, initialCash, fxAtOpen, startedOn,
        })
        out.push({ code: sym.code, track: t, trades: 0, retPct: 0, daysInMarket: 0,
          totalFees: 0, pending: null, skipped: `${startedOn} 起追蹤，還沒有交易日` })
      }
      continue
    }

    for (const track of TRACKS) {
      const accountId = await ensureAccount(userId, sym, track, {
        capitalTwd: capitalForSymbol, initialCash, fxAtOpen, startedOn,
      })
      // 既有帳戶的起算日也要跟上——這個值改過定義，舊帳戶還停在舊的那天
      await db.from('sim_accounts')
        .update({ started_on: startedOn }).eq('id', accountId).neq('started_on', startedOn)

      // 決策紀錄永不刪除（§13.1 四），一樣是由舊到新——截斷會讓 AI 那條
      // 軌道停在四年前，而它是這個站的主角
      const logs = track === 'ai'
        ? await fetchPaged((from, to) => db.from('sim_ai_log')
          .select('d, status, action, confidence, reason')
          .eq('account_id', accountId).order('d', { ascending: true }).range(from, to))
        : []

      const result = simulate(
        bars,
        deciderFor(track, days, logs as unknown as AiLogRow[], initialCash),
        { market: sym.market, isEtf: sym.isEtf, initialCash, fees: DEFAULT_FEES, actions },
      )

      await writeTrack(accountId, result, originByDate)
      await db.from('sim_accounts')
        .update({ pending: pendingJson(result) })
        .eq('id', accountId)

      const last = result.equity[result.equity.length - 1]
      out.push({
        code: sym.code, track,
        trades: result.trades.length,
        retPct: last?.retPct ?? 0,
        daysInMarket: result.daysInMarket,
        totalFees: result.totalFees,
        pending: result.pending ? describePending(result.pending.order.triggers) : null,
      })
    }
  }

  return out
}

function describePending(triggers: string[]): string {
  return triggers.join('+')
}

/**
 * 「明天開盤將執行」。最後一天的訊號還沒成交——那不是缺陷，
 * 那是整張帳戶卡最重要的一行：一句可以在真實世界照做的指令（§13.1 一）。
 *
 * 只記方向與觸發原因，不記股數：股數要用明天的開盤價才算得出來，
 * 今天先寫一個數字進去就是在編造一個不存在的成交。
 */
function pendingJson(r: SimResult): Record<string, unknown> | null {
  if (!r.pending) return null
  const o = r.pending.order
  const buy = (o.buyCash ?? 0) > 0
  const sell = (o.sellFraction ?? 0) > 0
  // 不動作也要留下來——理由在 `reason` 裡，「今天為什麼不做」跟
  // 「今天要做什麼」一樣需要被說出口（PLAN §13.7）
  return {
    signalD: r.pending.signalD,
    buy, sell,
    sellFraction: o.sellFraction ?? null,
    triggers: o.triggers,
    reason: o.reason ?? null,
    estimate: r.pending.estimate,
  }
}

async function ensureAccount(
  userId: string, sym: SymbolMeta, track: Track,
  o: { capitalTwd: number; initialCash: number; fxAtOpen: number | null; startedOn: string },
): Promise<string> {
  const db = createAdminClient()
  const { data: existing } = await db.from('sim_accounts')
    .select('id').eq('user_id', userId).eq('symbol_id', sym.id).eq('track', track)
    .maybeSingle()
  if (existing) return existing.id as string

  const { data, error } = await db.from('sim_accounts').insert({
    user_id: userId, symbol_id: sym.id, track,
    initial_twd: o.capitalTwd, initial_cash: o.initialCash,
    currency: sym.currency, fx_at_open: o.fxAtOpen,
    params: { fees: DEFAULT_FEES, rules: DEFAULT_RULES, version: PARAMS_VERSION },
    started_on: o.startedOn,
  }).select('id').single()
  if (error) throw new Error(`建立模擬帳戶失敗（${sym.code}/${track}）：${error.message}`)
  return data.id as string
}

/**
 * 成交與淨值是推導出來的，所以整條重寫。
 *
 * 先刪再寫而不是 upsert：規則或費率改了之後，舊的成交筆數可能**變少**，
 * upsert 不會移除已經不該存在的那幾筆——那正是 `daily_bars` 踩過的坑
 * （盤中半根修好之後仍然躺在資料庫裡）。
 */
async function writeTrack(
  accountId: string, r: SimResult, originByDate: Map<string, string>,
): Promise<void> {
  const db = createAdminClient()
  await db.from('sim_trades').delete().eq('account_id', accountId)
  await db.from('sim_equity').delete().eq('account_id', accountId)

  if (r.trades.length > 0) {
    const rows = r.trades.map((t) => ({
      account_id: accountId,
      signal_d: t.signalD, fill_d: t.fillD, side: t.side,
      qty: t.qty, price: t.price, fee: t.fee, tax: t.tax,
      triggers: t.triggers, decided_by: t.decidedBy,
      confidence: t.confidence ?? null,
      overrode_stop: t.overrodeStop,
      cost_basis: t.costBasis,
      reason: t.reason ?? null,
      // AI 的決定是當天真的做的；規則的則跟著產生訊號那天的分析走
      origin: t.decidedBy === 'ai' ? 'live' : (originByDate.get(t.signalD) ?? 'backfill'),
      rules_version: RULES_VERSION,
      params_version: PARAMS_VERSION,
    }))
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await db.from('sim_trades').insert(rows.slice(i, i + 200))
      if (error) throw new Error(`寫入 sim_trades 失敗：${error.message}`)
    }
  }

  const eq = r.equity.map((e) => ({
    account_id: accountId, d: e.d,
    cash: e.cash, shares: e.shares, cost: e.cost, mark: e.mark,
    equity: e.equity, ret_pct: e.retPct,
  }))
  for (let i = 0; i < eq.length; i += 500) {
    const { error } = await db.from('sim_equity').insert(eq.slice(i, i + 500))
    if (error) throw new Error(`寫入 sim_equity 失敗：${error.message}`)
  }
}
