'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateSymbol, yahooSymbolFor } from '@/lib/sources/yahoo'
import { ingestSymbol, type SymbolRow } from '@/lib/pipeline'
import { invalidateAnalysis } from '@/lib/data'
import { rebuildAll } from '@/lib/sim/run'

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

/**
 * 從「值得看一眼」直接加入追蹤。
 *
 * 跟 `addSymbol` 是同一件事，差別只在**形狀**：那支是 `useActionState`
 * 用的 `(prev, formData)`，要回傳錯誤字串給表單顯示；這裡是一列一個小表單，
 * 沒有地方放錯誤訊息，成功與否直接反映在清單上（加進去了就會出現）。
 *
 * 代號是我們自己寫進 hidden input 的、而且寫進資料庫之前已經驗過一次，
 * 所以這裡不需要再解釋失敗原因——真的失敗就是抓取出問題，那會顯示在
 * 頂欄的資料狀態上。
 */
export async function addFromDiscover(formData: FormData) {
  await addSymbol(null, formData)
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

/**
 * 改本金（PLAN §13.2）。
 *
 * §13.2 原本寫「改本金 = 重置該帳戶」，理由是不能等比例縮放——台股是整數股，
 * 本金砍半不會讓股數剛好砍半。那個理由成立，但結論太重了：
 *
 * **成交與淨值本來就是推導出來的**（`sim/run.ts` 每次都整條重算），
 * 真正的紀錄是規則（純函數）與 `sim_ai_log`（當天真的做過的決策）。
 * 所以改本金只要更新金額再重建一次，derived 的部分自然是用新本金重跑的，
 * 不是縮放的——而 AI 那幾天的判斷不必被刪掉。
 *
 * AI 的動作本來就是比例（`buy_50` ＝用掉一半現金），換本金重播完全成立。
 * 刪掉它反而是把唯一不能重建的東西丟了。
 */
export async function setCapital(_prev: unknown, formData: FormData) {
  const symbolId = String(formData.get('symbol_id') ?? '')
  const raw = String(formData.get('capital') ?? '').replace(/[, ]/g, '')
  const capital = Number(raw)

  if (!symbolId) return { error: '缺少標的' }
  if (!Number.isFinite(capital) || capital <= 0) return { error: '本金要是正數' }
  if (capital < 1000) return { error: '本金至少 1,000 元' }
  if (capital > 100_000_000) return { error: '本金上限 1 億元' }

  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  const userId = claims?.claims?.sub as string | undefined
  if (!userId) return { error: '請先登入' }

  const db = createAdminClient()
  const { data: accounts } = await db.from('sim_accounts')
    .select('id, currency, fx_at_open')
    .eq('user_id', userId).eq('symbol_id', symbolId)
  if (!accounts || accounts.length === 0) return { error: '這一檔還沒有模擬帳戶' }

  for (const a of accounts) {
    // 美股帳內記美元，本金是「建帳當日以匯率換算的台幣」——換匯率要用**當初那個**，
    // 用今天的匯率會讓歷史淨值整條平移
    const fx = a.fx_at_open === null ? null : Number(a.fx_at_open)
    const initialCash = a.currency === 'TWD' ? capital : (fx && fx > 0 ? capital / fx : null)
    if (initialCash === null) continue
    await db.from('sim_accounts')
      .update({ initial_twd: capital, initial_cash: initialCash })
      .eq('id', a.id)
  }

  try {
    // 不把 capital 傳進去——那個參數是「新帳戶的預設值」，
    // 傳了會把這個本金套到使用者的每一檔。上面已經把這一檔的金額寫進去了，
    // rebuildAll 會各自讀各自帳戶存的本金。
    await rebuildAll(userId)
  } catch (e) {
    return { error: `重算失敗：${e instanceof Error ? e.message : String(e)}` }
  }

  invalidateAnalysis()
  revalidatePath('/')
  return { ok: `本金已改為 ${capital.toLocaleString('en-US')} 元，整段模擬已用新本金重算` }
}
