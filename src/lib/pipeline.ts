import { createAdminClient } from './supabase/admin'
import { fetchTwseDailyBars } from './sources/twse'
import { fetchYahooDailyBars } from './sources/yahoo'
import { analyze } from './analyze'
import { RULES_VERSION } from './backfill'
import { checkBars, checkAnalysis, checkOrphanAnalysis, type Issue } from './sanity'
import { fetchTwseValuation, fetchYahooValuation } from './sources/valuation'
import { fetchUsdTwd, FX_PAIR, plausible } from './sources/fx'
import { adjustBars, type Dividends, type Splits } from './adjust'
import { rebuildAll } from './sim/run'
import type { Bar } from './types'
import type { Market } from './levels'

/**
 * 抓取 → 計算 → 寫入。共用 lib，Route Handler、本機腳本、排程都呼叫這一份，
 * 不要複製三份（PLAN §7）。換執行環境只是換入口。
 */

/** 保留半年＋暖機（PLAN §7）。圖只畫最後 123 根，但要存到 185 根才算得出季線與 KD。 */
export const KEEP_BARS = 185
export const CHART_BARS = 123

export interface SymbolRow {
  id: string
  market: Market
  code: string
  yahoo_symbol: string
  name_zh: string | null
  currency: string
}

export interface IngestResult {
  code: string
  ok: boolean
  bars: number
  date?: string
  error?: string
  /** 資料健檢抓到的異常。有異常不代表失敗——資料仍然寫入，但要留下紀錄 */
  issues?: Issue[]
}

export interface FetchResult {
  bars: Bar[]
  name: string | null
  currency: string
  /** 除息日 → 每股配息。台股要另外跟 Yahoo 要，TWSE 不回這個 */
  dividends: Dividends
  /** 分割日 → 1 股變幾股 */
  splits: Splits
}

/**
 * 台股走 TWSE、美股走 Yahoo（PLAN §2）。
 *
 * `TIDELINE_FIXTURE=1` 時改讀本機 fixture，不打線上 API——E2E 一定要走這條
 * （PLAN §10 Phase B 第 9 步）。打線上會慢、會 flaky，而且 TWSE 連續請求會被
 * 限流，測試就變成在測交易所的心情而不是測我們的程式。
 */
export async function fetchBars(
  market: Market,
  code: string,
  yahooSymbol: string,
): Promise<FetchResult> {
  if (process.env.TIDELINE_FIXTURE === '1') {
    const { fixtureBars } = await import('./sources/fixture')
    const f = await fixtureBars(market, code)
    return { ...f, dividends: {}, splits: {} }
  }
  if (market === 'TW') {
    const bars = await fetchTwseDailyBars(code, 9)
    // 價格用 TWSE（權威），事件只能用 Yahoo。事件抓不到就當作沒有——
    // 少一次配息會讓帳戶少收一點現金，但擋住整檔的抓取更糟。
    let dividends: Dividends = {}
    let splits: Splits = {}
    // TWSE 不回標的名稱，所以台股的名字只能從這支請求順手帶回來。
    // 少了它，新加入的台股在頁面上只會顯示代號（實測 2454 就是一片空白）。
    let name: string | null = null
    try {
      const y = await fetchYahooDailyBars(yahooSymbol, '1y')
      dividends = y.dividends
      splits = y.splits
      name = y.name
    } catch {
      // 上層會從 issues 看到「沒有事件資料」
    }
    return { bars, name, currency: 'TWD', dividends, splits }
  }
  const r = await fetchYahooDailyBars(yahooSymbol, '1y')
  return {
    bars: r.bars, name: r.name, currency: r.currency,
    dividends: r.dividends, splits: r.splits,
  }
}

/**
 * 跑一檔：抓 → 算 → upsert。
 *
 * 全部用 upsert，重跑不會壞。抓不到就丟錯，讓上層寫進 job_runs，
 * **絕不寫空資料或猜的數字**——頁面顯示「資料未更新」比顯示錯的數字安全（PLAN §9）。
 */
export async function ingestSymbol(sym: SymbolRow): Promise<IngestResult> {
  const db = createAdminClient()
  try {
    const { bars, name, currency, dividends, splits } =
      await fetchBars(sym.market, sym.code, sym.yahoo_symbol)
    if (bars.length === 0) throw new Error('來源沒有回傳任何 K 棒')

    const kept = bars.slice(-KEEP_BARS)

    // 寫進資料庫之前先問「這批資料本身合理嗎」。
    // 之前的每個資料錯誤都是眼睛看出來的，那不是系統。
    const issues = checkBars(sym.code, sym.market, kept)

    // 名稱查得到就順手補上（TWSE 不回名稱，Yahoo 會）。
    //
    // **fixture 模式一律不寫。** fixture 給的是「2454 (fixture)」這種佔位字串，
    // 而 `symbols` 是全站共用的正式資料表——寫進去之後，正式頁面就會把
    // 測試用的假名字當成標的名稱顯示出來。實測就發生過（2026-08-22 在瀏覽器上看到）。
    if (name && !sym.name_zh && process.env.TIDELINE_FIXTURE !== '1') {
      await db.from('symbols').update({ name_en: name }).eq('id', sym.id)
    }

    // 還原價：除息日之前的價格回溯打折，讓那道跳空消失（PLAN §13.3）。
    // 之前這四個欄位是原始價的複本、adj_factor 恆為 1——那是資料庫裡的一句謊話。
    // 指標與模擬帳戶都走原始價，這裡存的是**另一套**，供日後比對與偵測分割。
    const adjusted = adjustBars(kept, dividends, splits)

    const rows = adjusted.map((b) => ({
      symbol_id: sym.id, d: b.date,
      o: b.o, h: b.h, l: b.l, c: b.c, v: b.v,
      o_adj: b.o_adj, h_adj: b.h_adj, l_adj: b.l_adj, c_adj: b.c_adj,
      adj_factor: b.adj_factor,
      src: sym.market === 'TW' ? 'twse' : 'yahoo',
    }))
    const { error: barErr } = await db.from('daily_bars').upsert(rows)
    if (barErr) throw new Error(`寫入 daily_bars 失敗：${barErr.message}`)

    // 公司行動：模擬帳戶用原始價成交，所以配息要發現金、分割要調股數（PLAN §13.3）。
    // 只留視窗內的——視窗外的事件不會影響任何一筆模擬成交。
    const first = kept[0]!.date
    const actions = [
      ...Object.entries(dividends).map(([d, amount]) => ({ d, kind: 'dividend', amount })),
      ...Object.entries(splits).map(([d, amount]) => ({ d, kind: 'split', amount })),
    ].filter((a) => a.d >= first && a.amount > 0)
      .map((a) => ({
        symbol_id: sym.id, d: a.d, kind: a.kind, amount: a.amount,
        src: 'yahoo',
      }))
    if (actions.length > 0) {
      await db.from('corporate_actions').upsert(actions)
    }

    const a = analyze(kept, currency, sym.market)
    if (!a) throw new Error(`資料不足，只有 ${kept.length} 根 K 棒`)

    const { error: anErr } = await db.from('daily_analysis').upsert({
      symbol_id: sym.id, d: a.date,
      close: a.close, chg: a.chg, chg_pct: a.chgPct,
      o: a.o, h: a.h, l: a.l,
      k: a.k, d_val: a.d,
      bb_mid: a.bb.mid, bb_up: a.bb.upper, bb_lo: a.bb.lower,
      pct_b: a.pctB, bandwidth: a.bandwidth, ma60: a.ma60,
      levels: { ...a.levels, why: a.levelWhy },
      verdict: a.verdict,
      // 當天真的產出的紀錄。回補永遠不會覆蓋它（PLAN §11）
      origin: 'live',
      rules_version: RULES_VERSION,
    })
    if (anErr) throw new Error(`寫入 daily_analysis 失敗：${anErr.message}`)

    // 估值是加分項：抓不到就跳過，不能因為它失敗就讓整檔的技術分析也不見
    try {
      if (process.env.TIDELINE_FIXTURE === '1') throw new Error('fixture')
      const v = sym.market === 'TW'
        ? await fetchTwseValuation(sym.code, a.date.slice(0, 7).replace('-', ''))
        : await fetchYahooValuation(sym.yahoo_symbol)
      if (v && (v.pe !== null || v.pb !== null || v.dividendYield !== null)) {
        await db.from('daily_valuation').upsert({
          symbol_id: sym.id, d: a.date,
          pe: v.pe, forward_pe: v.forwardPe, pb: v.pb, dividend_yield: v.dividendYield,
          src: sym.market === 'TW' ? 'twse' : 'yahoo',
        })
      }
    } catch {
      // 估值抓不到不影響任何價位與圖表
    }

    // daily_bars 只留 KEEP_BARS 根；daily_analysis 一列都不刪（PLAN §11）
    const cutoff = kept[0]?.date
    if (cutoff) {
      await db.from('daily_bars').delete().eq('symbol_id', sym.id).lt('d', cutoff)
    }

    // 比最新一根還新的資料要刪掉。upsert 只會新增或覆蓋，**不會移除來源
    // 已經不再提供的那一根**——實測就發生過：盤中抓到一根還沒收盤的美股 K 棒，
    // 抓取邏輯修好之後那根仍然躺在資料庫裡，讓頁面顯示錯的收盤日。
    const newest = kept[kept.length - 1]?.date
    if (newest) {
      await db.from('daily_bars').delete().eq('symbol_id', sym.id).gt('d', newest)
    }

    // 分析永不刪除、K 棒會被回收，兩者的最新日期會脫節。發生時頁面會顯示
    // 一個我們沒有價格的日期，而且完全不會報錯——所以每次抓完都要問一次。
    const { data: anDates } = await db.from('daily_analysis')
      .select('d').eq('symbol_id', sym.id)
      .gt('d', kept[kept.length - 1]!.date)
    issues.push(...checkOrphanAnalysis(
      sym.code, kept[kept.length - 1]!.date, (anDates ?? []).map((x) => x.d as string),
    ))

    issues.push(...checkAnalysis(sym.code, {
      close: a.close, bb_lo: a.bb.lower, bb_mid: a.bb.mid, bb_up: a.bb.upper,
      pct_b: a.pctB, k: a.k, d_val: a.d, ma60: a.ma60,
    }))

    return { code: sym.code, ok: true, bars: kept.length, date: a.date, issues }
  } catch (e) {
    return { code: sym.code, ok: false, bars: 0, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * 匯率：一輪抓一次，不是每檔抓一次（PLAN §13.2）。
 *
 * 抓不到不算失敗——`rateOn` 會沿用之前最後一筆。回傳訊息讓上層寫進 job_runs，
 * 這樣「今天的美股淨值是用哪一天的匯率換的」是查得到的，不是猜的。
 */
async function ingestFx(): Promise<string | null> {
  if (process.env.TIDELINE_FIXTURE === '1') return null
  try {
    const rates = await fetchUsdTwd('1mo')
    const rows = Object.entries(rates)
      .filter(([, r]) => plausible(r))
      .map(([d, rate]) => ({ d, pair: FX_PAIR, rate, src: 'yahoo' }))
    if (rows.length === 0) return '匯率：來源沒有回傳合理的數值，沿用舊值'
    const db = createAdminClient()
    const { error } = await db.from('fx_rates').upsert(rows)
    if (error) return `匯率：寫入失敗 ${error.message}，沿用舊值`
    return null
  } catch (e) {
    return `匯率：${e instanceof Error ? e.message : String(e)}，沿用舊值`
  }
}

/** 跑一輪：所有被關注的標的。沒人關注的不抓（PLAN §7）。 */
export async function runIngest(job = 'ingest'): Promise<IngestResult[]> {
  const db = createAdminClient()

  const { data: run } = await db.from('job_runs').insert({ job }).select('id').single()
  const runId = run?.id as number | undefined

  const fxNote = await ingestFx()

  const { data: watched } = await db.from('watchlist').select('symbol_id')
  const ids = [...new Set((watched ?? []).map((w) => w.symbol_id as string))]

  const { data: syms } = ids.length > 0
    ? await db.from('symbols').select('*').in('id', ids)
    : { data: [] as SymbolRow[] }

  const results: IngestResult[] = []
  for (const s of (syms ?? []) as SymbolRow[]) {
    results.push(await ingestSymbol(s))
  }

  // 模擬帳戶：價格更新完才重建，否則今天的訊號還進不到帳戶裡（PLAN §13）。
  // 失敗不影響數字管線——帳戶是加分項，價位與圖表不能因為它掛掉就不見。
  let simNote: string | null = null
  try {
    const { data: users } = await db.auth.admin.listUsers()
    for (const u of users?.users ?? []) await rebuildAll(u.id)
  } catch (e) {
    simNote = `模擬帳戶重建失敗：${e instanceof Error ? e.message : String(e)}`
  }

  const failed = results.filter((r) => !r.ok)
  const flagged = results.flatMap((r) => r.issues ?? [])
  if (runId !== undefined) {
    await db.from('job_runs').update({
      finished_at: new Date().toISOString(),
      ok: failed.length === 0,
      processed: results.filter((r) => r.ok).length,
      // 健檢異常也寫進紀錄。抓失敗是「沒資料」，健檢異常是「資料可能是錯的」，
      // 後者更危險——它會安靜地被畫成圖表。
      error: [
        ...failed.map((f) => `${f.code}: ${f.error}`),
        ...flagged.map((i) => `⚠ ${i.code} ${i.date ?? ''} [${i.kind}] ${i.detail}`),
        ...(fxNote ? [`⚠ ${fxNote}`] : []),
        ...(simNote ? [`⚠ ${simNote}`] : []),
      ].join('; ') || null,
    }).eq('id', runId)
  }

  return results
}
