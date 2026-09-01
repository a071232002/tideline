/**
 * 資料健檢：跑完測試之後，證明正式資料沒有被動到。
 *
 * ## 為什麼需要它
 *
 * E2E 與正式資料共用同一個 Supabase。真正的解是給測試一個獨立的實例，
 * 在那之前，這支腳本把「希望沒事」變成「查過沒事」。
 *
 * 它檢查的每一條，都是**實際發生過**的損壞：
 *
 * 1. `fixture` 的 K 棒混進真實標的——容器輪把 0050 與 2454 洗成 151 根、
 *    結束於 08-19，2454 的價格整條變成 0050 的（2026-08-22）
 * 2. 孤兒分析——分析永不刪除、K 棒會被回收，頁面因此顯示一個沒有價格的日期
 * 3. 浮點灰塵——出清後留下 8.9e-16 股，害止損天天觸發、在市天數灌水
 * 4. 假的模型紀錄——測試用的 stub 決策留在 sim_ai_log 裡會汙染回顧
 *
 * 前三條有單元測試守著邏輯，但**邏輯正確不代表資料乾淨**：壞資料可能是
 * 修好之前留下的。這支腳本看的是資料本身。
 */
import { createAdminClient } from '../src/lib/supabase/admin'
import { judgmentStranded } from '../src/lib/sim/restart'
import { taipeiToday } from '../src/lib/freshness'
import { exitCleanly } from '../src/lib/exit'

const db = createAdminClient()
const problems: string[] = []
const note = (s: string) => problems.push(s)

const { data: syms } = await db.from('symbols').select('id, code, market').order('code')

for (const s of syms ?? []) {
  const id = s.id as string
  const code = s.code as string

  const { data: bars } = await db.from('daily_bars')
    .select('d, src').eq('symbol_id', id).order('d', { ascending: true })
  if (!bars || bars.length === 0) continue

  // 1. fixture 的資料不該出現在有真實來源的標的上
  const srcs = new Set(bars.map((b) => b.src as string))
  if (srcs.has('fixture') && srcs.size > 1) {
    note(`${code}：K 棒同時有 fixture 與真實來源（${[...srcs].join('/')}）——測試資料混進來了`)
  }

  // 2. 分析不能比最新的 K 棒還新
  const newest = bars[bars.length - 1]!.d as string
  const { data: orphan } = await db.from('daily_analysis')
    .select('d').eq('symbol_id', id).gt('d', newest)
  if ((orphan ?? []).length > 0) {
    note(`${code}：有 ${orphan!.length} 天的分析比最新 K 棒（${newest}）還新，`
      + `頁面會顯示一個沒有價格的日期`)
  }

  // 3. 日期不能重複或倒退
  for (let i = 1; i < bars.length; i++) {
    if ((bars[i]!.d as string) <= (bars[i - 1]!.d as string)) {
      note(`${code}：K 棒日期沒有遞增（${bars[i - 1]!.d} → ${bars[i]!.d}）`)
      break
    }
  }
}

// 4. 出清之後不該留下浮點灰塵
const { data: eq } = await db.from('sim_equity')
  .select('account_id, d, shares').gt('shares', 0).lt('shares', 0.0001)
if ((eq ?? []).length > 0) {
  note(`模擬帳戶有 ${eq!.length} 天留著小於一個可交易單位的殘股——`
    + `那會讓「已出清」看起來像「還有部位」`)
}

// 5. 測試用的假決策不能留在正式紀錄裡
const { data: logs } = await db.from('sim_ai_log').select('d, model')
const stub = (logs ?? []).filter((l) =>
  typeof l.model === 'string' && !l.model.startsWith('claude'))
if (stub.length > 0) {
  note(`sim_ai_log 有 ${stub.length} 筆非正式模型的決策（${[...new Set(stub.map((x) => x.model))].join('/')}）——`
    + `那會汙染回顧`)
}

// 6. AI **最新**的判斷要落在帳戶窗口內
//
//    抓的是「畫面顯示 AI 說要加碼、帳戶卻什麼都沒做」：最新那筆判斷早於
//    起算日就不會被重播，但它仍然是 ai.today，照樣顯示出來。
//
//    **不是數「有幾筆早於起算日」。** 那樣數會永遠亮著：sim_ai_log 永不
//    刪除（§13.1），而 sim:restart 把起算日往後移，於是每一次合法的重新
//    起算都留下一批窗口外的舊決策——那是設計，不是損壞。判斷邏輯與理由
//    在 judgmentStranded。
const { data: aiAccs } = await db.from('sim_accounts')
  .select('id, started_on, symbols(code)').eq('track', 'ai')
for (const a of aiAccs ?? []) {
  if (!a.started_on) continue
  const { data: newest } = await db.from('sim_ai_log')
    .select('d').eq('account_id', a.id)
    .order('d', { ascending: false }).limit(1).maybeSingle()
  const startedOn = a.started_on as string
  if (judgmentStranded({
    startedOn, newestLogD: (newest?.d as string) ?? null, today: taipeiToday(),
  })) {
    const code = (a.symbols as unknown as { code: string })?.code ?? a.id
    note(`${code}：AI 最新的判斷是 ${newest!.d}，早於帳戶起算日 ${startedOn}——`
      + `那筆判斷不會被模擬到，卻會被當成今天的判斷顯示`)
  }
}

// 7. 標的名稱不該是測試佔位字串
const { data: names } = await db.from('symbols').select('code, name_zh, name_en')
for (const n of names ?? []) {
  const txt = `${n.name_zh ?? ''}${n.name_en ?? ''}`
  if (txt.includes('fixture') || txt.includes('test')) {
    note(`${n.code}：名稱含測試字樣（${txt}）`)
  }
}

if (problems.length === 0) {
  console.log('✓ 資料乾淨：沒有測試資料混入、沒有孤兒分析、沒有殘股、沒有假決策')
  await exitCleanly(0)
}

console.error(`✗ 找到 ${problems.length} 個問題：`)
for (const p of problems) console.error(`  - ${p}`)
await exitCleanly(1)
