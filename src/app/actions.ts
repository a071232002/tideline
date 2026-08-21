'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateSymbol } from '@/lib/sources/yahoo'
import { ingestSymbol, type SymbolRow } from '@/lib/pipeline'
import { invalidateAnalysis } from '@/lib/data'
import { rebuildAll } from '@/lib/sim/run'

/** `2330` → `2330.TW`；美股就是代號本身 */
function yahooSymbolFor(market: 'TW' | 'US', code: string): string {
  return market === 'TW' ? `${code}.TW` : code
}

/**
 * 加入觀察清單。
 *
 * 三件事在這裡就要做完（PLAN §7、§9、§13）：
 * 1. 代號**當場驗證**，回不到資料就擋下並說明原因
 * 2. 加入的當下就**同步抓一次**，不要讓人等到隔天才看得到東西
 * 3. **同時開好模擬帳戶**。原本只有每日排程會建帳，所以剛加入的標的整張
 *    「模擬帳戶」卡連同「明日開盤」那一行都不存在，頁面看起來像少了一塊，
 *    而且要等到隔天 07:30 才會冒出來。實測（2026-08-22 在瀏覽器上加 2454）。
 */
export async function addSymbol(_prev: unknown, formData: FormData) {
  const raw = String(formData.get('code') ?? '').trim().toUpperCase()
  if (!raw) return { error: '請輸入代號' }

  // 市場由使用者明講，不用代號去猜。猜不準：台股有 00679B 這種帶字母的、
  // 美股也有純數字的掛牌，而且上市與上櫃根本無法從代號分辨。
  const picked = String(formData.get('market') ?? '')
  if (picked !== 'TW' && picked !== 'US') return { error: '請選擇市場' }
  const market: 'TW' | 'US' = picked

  const yahooSymbol = yahooSymbolFor(market, raw)

  // fixture 模式（E2E）不打線上驗證，但仍保留「明顯不合法的代號要被擋」的行為
  const check = process.env.TIDELINE_FIXTURE === '1'
    ? (/^[A-Z0-9]{1,6}$/.test(raw) && raw !== 'ZZQQXX'
        ? { ok: true as const, name: null, currency: market === 'TW' ? 'TWD' : 'USD', exchange: 'fixture' }
        : { ok: false as const, reason: 'fixture 模式：不在允許清單內' })
    : await validateSymbol(yahooSymbol)
  if (!check.ok) {
    return {
      error: market === 'TW'
        ? `在台股找不到「${raw}」。請確認代號，或它可能是上櫃股（目前只支援上市）。`
        : `在美股找不到「${raw}」。請確認代號。`,
    }
  }

  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  const userId = claims?.claims?.sub as string | undefined
  if (!userId) return { error: '請先登入' }

  const db = createAdminClient()

  const { data: existing } = await db.from('symbols')
    .select('*').eq('market', market).eq('code', raw).maybeSingle()

  let sym = existing as SymbolRow | null
  if (!sym) {
    const { data: created, error } = await db.from('symbols').insert({
      market, code: raw, yahoo_symbol: yahooSymbol,
      name_en: check.name, currency: check.currency,
    }).select('*').single()
    if (error) return { error: `建立標的失敗：${error.message}` }
    sym = created as SymbolRow
  }

  // 寫入端用 service role，但 user_id 自己解析——不要相信表單傳來的身分
  const { error: wErr } = await db.from('watchlist')
    .upsert({ user_id: userId, symbol_id: sym.id })
  if (wErr) return { error: `加入清單失敗：${wErr.message}` }

  const result = await ingestSymbol(sym)

  // 有了 K 棒與分析才建得了帳戶（起跑日要用「有分析資料的第一天」）。
  // 建帳失敗不影響加入本身——清單與價位照常，只是模擬帳戶晚一天出現。
  if (result.ok) {
    try {
      await rebuildAll(userId)
    } catch {
      // 隔天的排程會補上
    }
  }

  invalidateAnalysis()
  revalidatePath('/')

  if (!result.ok) {
    return { error: `已加入清單，但抓取資料失敗：${result.error}` }
  }
  return { ok: `已加入 ${raw}` }
}

export async function removeSymbol(formData: FormData) {
  const symbolId = String(formData.get('symbol_id') ?? '')
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  const userId = claims?.claims?.sub as string | undefined
  if (!userId || !symbolId) return

  const db = createAdminClient()
  await db.from('watchlist').delete().eq('user_id', userId).eq('symbol_id', symbolId)
  revalidatePath('/')
}
