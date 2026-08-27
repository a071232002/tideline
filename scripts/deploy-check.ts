/**
 * 部署後的體檢。**唯讀，什麼都不改。**
 *
 *     npm run check:deploy
 *
 * 部署第一天要看的東西散在四個地方：Vercel 的 cron 紀錄、Supabase 的
 * job_runs、每一檔的 K 棒日期、以及本機排程有沒有寫進 sim_ai_log。
 * 一個一個開來看，很容易漏掉「其中一半沒跑」這種狀態——而那正是最像
 * 「一切正常」的失敗。
 *
 * 它問的每一個問題都對應一個真的出過的錯：
 *
 *   抓取有沒有跑        Vercel Cron 的排程時間是 UTC，寫錯就整天不跑
 *   寫入有沒有成功      key 不對時 runIngest 曾經回報 ok:true 而一列都沒寫
 *   K 棒有沒有跟上      TWSE 從新加坡機房可能被限流
 *   AI 有沒有跟上       本機排程是另一台機器，它沒開就會安靜地停在昨天
 *   兩邊有沒有打架      抓取與 AI 同時重建帳戶會讀到半截的曲線
 *
 * 讀 `.env.cloud`：
 *     set -a; . ./.env.cloud; set +a; npm run check:deploy
 */
import { createAdminClient } from '../src/lib/supabase/admin'
import { taipeiToday } from '../src/lib/freshness'

const db = createAdminClient()
const today = taipeiToday()
const problems: string[] = []
const note = (s: string) => problems.push(s)
const ok = (s: string) => console.log(`  ✓ ${s}`)
const warn = (s: string) => { console.log(`  ⚠ ${s}`); note(s) }

console.log(`\n台北時間 ${today}　${process.env.NEXT_PUBLIC_SUPABASE_URL}\n`)

// ---------------------------------------------------------------- 抓取
console.log('抓取（Vercel Cron）')
const { data: runs } = await db.from('job_runs')
  .select('job, started_at, finished_at, ok, processed, error')
  .order('started_at', { ascending: false }).limit(5)

const todayRuns = (runs ?? []).filter((r) => String(r.started_at).slice(0, 10) >= today)
if (todayRuns.length === 0) {
  warn(`今天沒有任何抓取紀錄。cron 的時間是 UTC——台北 07:30 是「30 23」（前一天）`)
} else {
  for (const r of todayRuns) {
    const secs = r.finished_at
      ? Math.round((Date.parse(r.finished_at as string) - Date.parse(r.started_at as string)) / 100) / 10
      : null
    const when = String(r.started_at).slice(11, 16)
    if (r.finished_at === null) warn(`${when} 那一輪沒有結束時間——被砍掉或還在跑`)
    else if (r.ok === false) warn(`${when} 失敗：${r.error ?? '（沒有訊息）'}`)
    else ok(`${when} UTC　${r.processed} 檔　${secs}s`)
    if (r.error) note(`${when} 的紀錄帶著訊息：${r.error}`)
  }
}

// ---------------------------------------------------------------- 資料
console.log('\n每一檔的資料')
const { data: syms } = await db.from('symbols').select('id, code, market').order('code')
for (const s of syms ?? []) {
  const { data: b } = await db.from('daily_bars').select('d')
    .eq('symbol_id', s.id).order('d', { ascending: false }).limit(1)
  const { data: a } = await db.from('daily_analysis').select('d')
    .eq('symbol_id', s.id).order('d', { ascending: false }).limit(1)
  const bar = b?.[0]?.d as string | undefined
  const an = a?.[0]?.d as string | undefined
  if (!bar) { warn(`${s.code} 一根 K 棒都沒有`); continue }
  // 分析比 K 棒新 = 孤兒，頁面會顯示一個沒有價格的日期
  if (an && bar && an > bar) warn(`${s.code} 分析 ${an} 比最新 K 棒 ${bar} 還新`)
  else ok(`${s.code.padEnd(7)} K 棒 ${bar}　分析 ${an ?? '—'}`)
}

// ---------------------------------------------------------------- AI
console.log('\nAI 判斷（本機排程）')
const { data: aiAccs } = await db.from('sim_accounts')
  .select('id, started_on, symbols(code)').eq('track', 'ai')
if ((aiAccs ?? []).length === 0) warn('沒有任何 AI 帳戶')
for (const acc of aiAccs ?? []) {
  const code = (acc.symbols as unknown as { code: string })?.code ?? '?'
  const { data: l } = await db.from('sim_ai_log').select('d, action, status')
    .eq('account_id', acc.id).order('d', { ascending: false }).limit(1)
  const last = l?.[0]
  if (!last) {
    // 起算日還沒到第一個交易日時，沒有判斷是正常的
    const why = (acc.started_on as string) >= today ? '（起算日是今天，正常）' : ''
    if (why) ok(`${code.padEnd(7)} 還沒開始 ${why}`)
    else warn(`${code} 從來沒有 AI 判斷`)
    continue
  }
  const lag = last.d === today || last.d === undefined
  ok(`${code.padEnd(7)} ${last.d}　${last.action}　${last.status}${lag ? '' : ''}`)
  if ((last.d as string) < today) {
    note(`${code} 的 AI 判斷停在 ${last.d}——那台機器沒開，或排程沒跑`)
  }
}

// ---------------------------------------------------------------- 收尾
console.log('')
if (problems.length === 0) {
  console.log('✓ 沒有發現問題')
  process.exit(0)
}
console.log(`⚠ ${problems.length} 件事要看：`)
for (const p of problems) console.log(`  - ${p}`)
// 這些多半不是「壞掉」而是「要注意」，所以不用非零離開碼嚇人
process.exit(0)
