import { createAdminClient } from './supabase/admin'
import { fetchTwseDailyBars } from './sources/twse'
import { fetchYahooDailyBars } from './sources/yahoo'
import { analyze, MIN_BARS } from './analyze'
import { RULES_VERSION } from './backfill'
import { checkBars, checkAnalysis, checkOrphanAnalysis, type Issue } from './sanity'
import { fetchTwseValuation, fetchYahooValuation } from './sources/valuation'
import { fetchUsdTwd, FX_PAIR, plausible } from './sources/fx'
import { adjustBars, type Dividends, type Splits } from './adjust'
import { taipeiToday } from './freshness'
import { mergeBars, needsFullFetch } from './merge'
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
  /**
   * `false` 只抓最近一個月（PLAN §7 的增量策略）。
   *
   * 台股完整是九次 TWSE 請求、中間各隔 1.2 秒避免限流，一檔 9 秒；
   * 增量是一次請求。指標只需要最新那根 K 棒，其餘 DB 裡本來就有——
   * 差別在合併（`mergeBars`）與**不刪除**，見 `ingestSymbol`。
   */
  full = true,
): Promise<FetchResult> {
  if (process.env.TIDELINE_FIXTURE === '1') {
    const { fixtureBars } = await import('./sources/fixture')
    const f = await fixtureBars(market, code)
    return { ...f, dividends: {}, splits: {} }
  }
  if (market === 'TW') {
    const bars = await fetchTwseDailyBars(code, full ? 9 : 1)
    // 價格用 TWSE（權威），事件只能用 Yahoo。事件抓不到就當作沒有——
    // 少一次配息會讓帳戶少收一點現金，但擋住整檔的抓取更糟。
    let dividends: Dividends = {}
    let splits: Splits = {}
    // TWSE 不回標的名稱，所以台股的名字只能從這支請求順手帶回來。
    // 少了它，新加入的台股在頁面上只會顯示代號（實測 2454 就是一片空白）。
    let name: string | null = null
    try {
      const y = await fetchYahooDailyBars(yahooSymbol, full ? '1y' : '1mo')
      dividends = y.dividends
      splits = y.splits
      name = y.name
    } catch {
      // 上層會從 issues 看到「沒有事件資料」
    }
    return { bars, name, currency: 'TWD', dividends, splits }
  }
  const r = await fetchYahooDailyBars(yahooSymbol, full ? '1y' : '1mo')
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
/**
 * fixture 模式**絕對不能碰已經有真實資料的標的**。
 *
 * 2026-08-22 實測：容器 E2E 跑完之後，0050 與 2454 的 K 棒都變成 151 根、
 * 結束於 08-19——那是 fixture 的長度與結束日。真實的 08-20、08-21 被
 * 「刪掉比最新一根還新的資料」那段清掉了，而 2454 的價格整條變成 0050 的。
 *
 * `daily_analysis` 依 §11 永不刪除，於是留下兩天沒有 K 棒撐著的孤兒列——
 * 那個孤兒問題我先前只修了症狀（頁面忽略它們），根因就在這裡。
 *
 * E2E 與正式資料共用同一個資料庫是架構問題，真正的解是分開；在那之前，
 * 這道閘門保證測試資料只會流向**還沒有真實資料**的標的。
 */
async function fixtureWouldClobber(symbolId: string): Promise<boolean> {
  if (process.env.TIDELINE_FIXTURE !== '1') return false
  const db = createAdminClient()
  const { data } = await db.from('daily_bars')
    .select('d').eq('symbol_id', symbolId).neq('src', 'fixture').limit(1)
  return (data ?? []).length > 0
}

/**
 * 讀出這一檔目前存著的 K 棒，給增量模式合併用。
 *
 * 不必分頁：`daily_bars` 是全站唯一有保留上限的表（`KEEP_BARS` = 185）。
 *
 * 但**增量模式不修剪**（修剪只在完整抓取時發生），所以兩次每月校正之間
 * 這個數字會慢慢超過 185——一個月大約多 22 根。那是預期的，不是壞掉：
 * 頁面只畫 `CHART_BARS` 根、指標只看最後幾根，而下一次校正會把它修回去。
 * 離 PostgREST 的 1000 列上限還很遠。
 */
async function readBars(symbolId: string): Promise<Bar[]> {
  const db = createAdminClient()
  const { data } = await db.from('daily_bars')
    .select('d, o, h, l, c, v').eq('symbol_id', symbolId)
    .order('d', { ascending: true })
  return (data ?? []).map((b) => ({
    date: b.d as string,
    o: Number(b.o), h: Number(b.h), l: Number(b.l), c: Number(b.c), v: Number(b.v ?? 0),
  }))
}

export async function ingestSymbol(
  sym: SymbolRow,
  /**
   * 完整抓取（九個月）還是增量（一個月）。
   *
   * 預設**完整**：新加入標的、手動重跑、每月校正都該拿到完整的一段。
   * 只有每日排程會傳 `false`——那是唯一「已經有歷史、只要接上最新幾根」
   * 的情境，也是唯一需要省那 9 秒的地方。
   */
  full = true,
): Promise<IngestResult> {
  const db = createAdminClient()
  try {
    if (await fixtureWouldClobber(sym.id)) {
      return {
        code: sym.code, ok: true, bars: 0,
        issues: [{
          code: sym.code, kind: 'fixture-skip',
          detail: 'fixture 模式：這一檔已經有真實資料，略過以免覆蓋',
        }],
      }
    }
    /**
     * 增量模式要先知道手上有什麼——合併之後才算得出指標（布林要 20 根、
     * KD 要 9 根、季線要 60 根），而且**保留策略只能在完整抓取時執行**。
     *
     * 下面那個 `delete where d < kept[0].date` 是照著「這次拿到的第一根」
     * 刪的。增量模式下那是這個月的第一天——照著刪就是把整段歷史刪光。
     */
    const existing: Bar[] = full ? [] : await readBars(sym.id)

    let r = await fetchBars(sym.market, sym.code, sym.yahoo_symbol, full)
    let fullRun = full

    if (!fullRun) {
      const check = needsFullFetch({
        existingCount: existing.length,
        /**
         * 門檻是**指標的暖機需求**（季線 60 根），不是保留上限（185）。
         *
         * 一開始寫成 KEEP_BARS，結果是每一輪都退回完整抓取：台股九個月的
         * TWSE 資料只有 175 根，永遠小於 185。增量等於沒開，實測 59.6 秒
         * 跟改之前一樣——而且不會有任何錯誤，只是「怎麼沒變快」。
         */
        minBars: MIN_BARS,
        dividendCount: Object.keys(r.dividends).length,
        splitCount: Object.keys(r.splits).length,
        fetchedNewest: r.bars[r.bars.length - 1]?.date ?? null,
        existingNewest: existing[existing.length - 1]?.date ?? null,
      })
      if (check.full) {
        // 退回完整抓取。一年幾次，不值得為了省一次請求去手算回溯還原價
        r = await fetchBars(sym.market, sym.code, sym.yahoo_symbol, true)
        fullRun = true
      }
    }

    const { name, currency, dividends, splits } = r
    if (r.bars.length === 0) throw new Error('來源沒有回傳任何 K 棒')

    const merged = fullRun ? r.bars : mergeBars(existing, r.bars)
    const kept = merged.slice(-KEEP_BARS)

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
      // fixture 的資料要標得出來，否則之後分不清哪幾根是測試寫進去的
      src: process.env.TIDELINE_FIXTURE === '1' ? 'fixture'
        : sym.market === 'TW' ? 'twse' : 'yahoo',
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
    //
    // **fixture 模式不做任何刪除**——它的視窗比真實資料短，刪起來會把真的資料
    // 一起帶走（實測就是這樣弄丟 0050 的 08-20、08-21）。
    //
    // **增量模式也不刪除**，理由一模一樣：`kept[0]` 是這個月的第一天，
    // 照著它刪就是把整段歷史刪光。修剪交給每月校正那一輪的完整抓取。
    const cleanup = process.env.TIDELINE_FIXTURE !== '1' && fullRun
    const cutoff = kept[0]?.date
    if (cleanup && cutoff) {
      await db.from('daily_bars').delete().eq('symbol_id', sym.id).lt('d', cutoff)
    }

    // 比最新一根還新的資料要刪掉。upsert 只會新增或覆蓋，**不會移除來源
    // 已經不再提供的那一根**——實測就發生過：盤中抓到一根還沒收盤的美股 K 棒，
    // 抓取邏輯修好之後那根仍然躺在資料庫裡，讓頁面顯示錯的收盤日。
    const newest = kept[kept.length - 1]?.date
    if (cleanup && newest) {
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

/**
 * 執行紀錄保留幾天。
 *
 * 純粹是「這輪跑了沒、幾檔成功」的日誌，不是回顧的素材（那是
 * `daily_analysis` 與 `sim_ai_log` 的工作，那兩張明令永不刪除）。
 * 一天四列，不清就是每年 1,460 列的垃圾。90 天足夠回答
 * 「上週是不是有幾天沒跑」，再久就沒人會去看。
 */
export const KEEP_JOB_RUNS_DAYS = 90

/**
 * 每月校正（PLAN §10 步驟 22）：當月第一次成功的那一輪，整段重抓。
 *
 * 增量抓取只看得到最近一個月，所以**來源對更早那幾天的事後修正補不回來**
 * ——TWSE 會回頭改除權息調整後的價格，Yahoo 會補上漏掉的分割。增量永遠
 * 讀不到那些改動，因為它根本不會去讀那幾天。校正就是為了這個。
 *
 * 它同時也是**唯一會執行保留策略的那一輪**：修剪到 185 根、刪掉比最新
 * 還新的殘留，都只在完整抓取時發生（見 `ingestSymbol` 的 `cleanup`）。
 *
 * 判斷「這個月跑過了沒」問 `job_runs`，不另外開一張表——那張表本來就記著
 * 每一輪的時間。注意 `job_runs` 只留 90 天，而這個查詢只看當月，不受影響。
 */
async function isFirstRunThisMonth(): Promise<boolean> {
  const db = createAdminClient()
  const monthStart = `${taipeiToday().slice(0, 7)}-01`
  const { count } = await db.from('job_runs')
    .select('*', { count: 'exact', head: true })
    .eq('ok', true).gte('started_at', monthStart)
  return (count ?? 0) === 0
}

/** 跑一輪：所有被關注的標的。沒人關注的不抓（PLAN §7）。 */
export async function runIngest(job = 'ingest'): Promise<IngestResult[]> {
  const db = createAdminClient()

  // 當月第一輪整段重抓，其餘只接最新一個月（§7）。開頭就決定，
  // 免得中途插進來的 job_runs 列改變了答案。
  const monthly = await isFirstRunThisMonth()

  /**
   * **寫不進 job_runs 就整輪失敗，不要往下做。**
   *
   * 這一列本來只是執行紀錄，錯了也不影響數字——原本因此忽略它的錯誤。
   * 但它同時是**第一個寫入動作**，所以它失敗代表的往往不是「日誌壞了」，
   * 是「這個環境根本寫不進資料庫」。
   *
   * 實測（2026-08-27 第一次部署）：Vercel 上的 SUPABASE_SERVICE_ROLE_KEY
   * 不是那把 secret，於是 admin client 退化成 anon，每一個寫入都被 RLS 擋掉
   * （42501），而端點回報 **ok:true、seconds:14.3、failed:[]**——
   * 抓取「成功」了，資料庫一列都沒進去。那正是這個站最怕的那種錯誤：
   * 錯得很像對的。
   */
  const { data: run, error: runErr } = await db.from('job_runs')
    .insert({ job }).select('id').single()
  if (runErr) {
    throw new Error(
      `寫不進 job_runs：${runErr.message}`
      + `（${runErr.code === '42501'
        ? 'RLS 擋下——這通常代表 SUPABASE_SERVICE_ROLE_KEY 不是 service role 那一把，'
          + '或者環境變數改過但沒有重新部署'
        : '權限或連線問題'}）`,
    )
  }
  const runId = run?.id as number | undefined

  const fxNote = await ingestFx()

  const { data: watched } = await db.from('watchlist').select('symbol_id')
  const ids = [...new Set((watched ?? []).map((w) => w.symbol_id as string))]

  const { data: syms } = ids.length > 0
    ? await db.from('symbols').select('*').in('id', ids)
    : { data: [] as SymbolRow[] }

  const results: IngestResult[] = []
  for (const s of (syms ?? []) as SymbolRow[]) {
    results.push(await ingestSymbol(s, monthly))
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

  // 執行紀錄的保留期。放在最後、包在 try 裡——清不掉不該讓整輪算失敗，
  // 那只是日誌。
  try {
    const cutoff = new Date(Date.now() - KEEP_JOB_RUNS_DAYS * 86_400_000)
      .toISOString().slice(0, 10)
    await db.from('job_runs').delete().lt('started_at', cutoff)
  } catch {
    // 日誌清不掉不影響任何數字
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
