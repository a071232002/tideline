import { createAdminClient } from './supabase/admin'
import { fetchTwseDailyBars } from './sources/twse'
import { fetchYahooDailyBars } from './sources/yahoo'
import { analyze } from './analyze'
import { RULES_VERSION } from './backfill'
import { fetchTwseValuation, fetchYahooValuation } from './sources/valuation'
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
): Promise<{ bars: Bar[]; name: string | null; currency: string }> {
  if (process.env.TIDELINE_FIXTURE === '1') {
    const { fixtureBars } = await import('./sources/fixture')
    return fixtureBars(market, code)
  }
  if (market === 'TW') {
    const bars = await fetchTwseDailyBars(code, 9)
    return { bars, name: null, currency: 'TWD' }
  }
  const r = await fetchYahooDailyBars(yahooSymbol, '1y')
  return { bars: r.bars, name: r.name, currency: r.currency }
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
    const { bars, name, currency } = await fetchBars(sym.market, sym.code, sym.yahoo_symbol)
    if (bars.length === 0) throw new Error('來源沒有回傳任何 K 棒')

    const kept = bars.slice(-KEEP_BARS)

    // 名稱查得到就順手補上（TWSE 不回名稱，Yahoo 會）
    if (name && !sym.name_zh) {
      await db.from('symbols').update({ name_en: name }).eq('id', sym.id)
    }

    const rows = kept.map((b) => ({
      symbol_id: sym.id, d: b.date,
      o: b.o, h: b.h, l: b.l, c: b.c, v: b.v,
      // 還原價目前與原始價相同；除權息回溯改寫留待每月校正處理（PLAN §7）
      o_adj: b.o, h_adj: b.h, l_adj: b.l, c_adj: b.c, adj_factor: 1,
      src: sym.market === 'TW' ? 'twse' : 'yahoo',
    }))
    const { error: barErr } = await db.from('daily_bars').upsert(rows)
    if (barErr) throw new Error(`寫入 daily_bars 失敗：${barErr.message}`)

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

    return { code: sym.code, ok: true, bars: kept.length, date: a.date }
  } catch (e) {
    return { code: sym.code, ok: false, bars: 0, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 跑一輪：所有被關注的標的。沒人關注的不抓（PLAN §7）。 */
export async function runIngest(job = 'ingest'): Promise<IngestResult[]> {
  const db = createAdminClient()

  const { data: run } = await db.from('job_runs').insert({ job }).select('id').single()
  const runId = run?.id as number | undefined

  const { data: watched } = await db.from('watchlist').select('symbol_id')
  const ids = [...new Set((watched ?? []).map((w) => w.symbol_id as string))]

  const { data: syms } = ids.length > 0
    ? await db.from('symbols').select('*').in('id', ids)
    : { data: [] as SymbolRow[] }

  const results: IngestResult[] = []
  for (const s of (syms ?? []) as SymbolRow[]) {
    results.push(await ingestSymbol(s))
  }

  const failed = results.filter((r) => !r.ok)
  if (runId !== undefined) {
    await db.from('job_runs').update({
      finished_at: new Date().toISOString(),
      ok: failed.length === 0,
      processed: results.filter((r) => r.ok).length,
      error: failed.length > 0 ? failed.map((f) => `${f.code}: ${f.error}`).join('; ') : null,
    }).eq('id', runId)
  }

  return results
}
