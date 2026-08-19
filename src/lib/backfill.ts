import { createAdminClient } from './supabase/admin'
import { analyze, MIN_BARS } from './analyze'
import type { Bar } from './types'
import type { Market } from './levels'

/**
 * 回補歷史建議，讓「當時說的價位」可以疊在走勢上回顧（PLAN §11）。
 *
 * 兩條規矩，少一條這份回顧就沒有意義：
 *
 * 一、**不偷看未來。** 第 i 天只餵 bars[0..i]，跟當天實際能拿到的資料一樣。
 *     這聽起來理所當然，但只要一個 `bars.slice()` 寫錯邊界，整份回顧就會
 *     漂亮得不像話，而且看不出哪裡錯。
 *
 * 二、**不覆蓋 live。** 當天真的產出的那一列永遠不動。回補的標成 backfill，
 *     並記下規則版本——之後規則改了，回補值會變、live 值不會，兩者要分得開。
 *     否則回顧會變成自我證明：把規則調到好看為止，再回補一份漂亮的歷史。
 */

/** 規則改動時要手動加版號，回顧頁才知道哪一段歷史是哪套規則算的 */
export const RULES_VERSION = '2026-08-19.1'

export interface BackfillResult {
  code: string
  written: number
  skippedLive: number
}

export async function backfillSymbol(
  symbolId: string,
  code: string,
  market: Market,
  currency: string,
): Promise<BackfillResult> {
  const db = createAdminClient()

  const { data: rows } = await db.from('daily_bars')
    .select('d, o, h, l, c, v')
    .eq('symbol_id', symbolId)
    .order('d', { ascending: true })

  const bars: Bar[] = (rows ?? []).map((r) => ({
    date: r.d as string,
    o: Number(r.o), h: Number(r.h), l: Number(r.l), c: Number(r.c), v: Number(r.v ?? 0),
  }))

  // 已經有 live 紀錄的日子不能碰
  const { data: live } = await db.from('daily_analysis')
    .select('d').eq('symbol_id', symbolId).eq('origin', 'live')
  const protectedDays = new Set((live ?? []).map((x) => x.d as string))

  const payload: Record<string, unknown>[] = []
  let skippedLive = 0

  for (let i = MIN_BARS - 1; i < bars.length; i++) {
    const day = bars[i]!.date
    if (protectedDays.has(day)) { skippedLive++; continue }

    // 只餵到第 i 天為止——這一行就是「不偷看未來」的全部內容
    const a = analyze(bars.slice(0, i + 1), currency, market)
    if (!a) continue

    payload.push({
      symbol_id: symbolId, d: a.date,
      close: a.close, chg: a.chg, chg_pct: a.chgPct,
      o: a.o, h: a.h, l: a.l,
      k: a.k, d_val: a.d,
      bb_mid: a.bb.mid, bb_up: a.bb.upper, bb_lo: a.bb.lower,
      pct_b: a.pctB, bandwidth: a.bandwidth, ma60: a.ma60,
      levels: { ...a.levels, why: a.levelWhy },
      verdict: a.verdict,
      origin: 'backfill',
      rules_version: RULES_VERSION,
    })
  }

  for (let i = 0; i < payload.length; i += 200) {
    const { error } = await db.from('daily_analysis').upsert(payload.slice(i, i + 200))
    if (error) throw new Error(`回補 ${code} 失敗：${error.message}`)
  }

  return { code, written: payload.length, skippedLive }
}

export async function backfillAll(): Promise<BackfillResult[]> {
  const db = createAdminClient()
  const { data: syms } = await db.from('symbols').select('id, code, market, currency')
  const out: BackfillResult[] = []
  for (const s of syms ?? []) {
    out.push(await backfillSymbol(
      s.id as string, s.code as string, s.market as Market, s.currency as string,
    ))
  }
  return out
}
