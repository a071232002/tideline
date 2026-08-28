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

/**
 * **不能拿 UTC 的日期字串去比台北的日期。**
 *
 * 台北 07:30 的那一輪在 UTC 是**前一天** 23:30，所以 `started_at.slice(0,10)`
 * 永遠小於 `taipeiToday()`——這支腳本因此天天回報「今天沒有任何抓取紀錄」，
 * 而抓取其實跑得好好的。工具自己謊報比沒有工具更糟。
 *
 * 改成比時間點：今天台北 00:00 換算成 UTC 之後的那個瞬間。
 */
const dayStart = Date.parse(`${today}T00:00:00+08:00`)
const todayRuns = (runs ?? []).filter((r) => Date.parse(r.started_at as string) >= dayStart)
if (todayRuns.length === 0) {
  warn(`今天沒有任何抓取紀錄。cron 的時間是 UTC——台北 07:30 是「30 23」（前一天）`)
} else {
  for (const r of todayRuns) {
    const secs = r.finished_at
      ? Math.round((Date.parse(r.finished_at as string) - Date.parse(r.started_at as string)) / 100) / 10
      : null
    // 顯示台北時間，不是 UTC——看的人腦子裡是台北時間
    const when = new Date(Date.parse(r.started_at as string) + 8 * 3600_000)
      .toISOString().slice(11, 16)
    if (r.finished_at === null) warn(`${when} 那一輪沒有結束時間——被砍掉或還在跑`)
    else if (r.ok === false) warn(`${when} 失敗：${r.error ?? '（沒有訊息）'}`)
    else ok(`${when} 台北　${r.processed} 檔　${secs}s`)
    if (r.error) note(`${when} 的紀錄帶著訊息：${r.error}`)
  }
}

// ---------------------------------------------------------------- 資料
console.log('\n每一檔的資料')
const { data: syms } = await db.from('symbols').select('id, code, market').order('code')
/** 每一檔最新的 K 棒日期。下面判斷 AI 有沒有跟上要用它，不是用今天 */
const newestBar = new Map<string, string>()
for (const s of syms ?? []) {
  const { data: b } = await db.from('daily_bars').select('d')
    .eq('symbol_id', s.id).order('d', { ascending: false }).limit(1)
  const { data: a } = await db.from('daily_analysis').select('d')
    .eq('symbol_id', s.id).order('d', { ascending: false }).limit(1)
  const bar = b?.[0]?.d as string | undefined
  const an = a?.[0]?.d as string | undefined
  if (!bar) { warn(`${s.code} 一根 K 棒都沒有`); continue }
  newestBar.set(s.code as string, bar)
  // 分析比 K 棒新 = 孤兒，頁面會顯示一個沒有價格的日期
  if (an && bar && an > bar) warn(`${s.code} 分析 ${an} 比最新 K 棒 ${bar} 還新`)
  else ok(`${s.code.padEnd(7)} K 棒 ${bar}　分析 ${an ?? '—'}`)
}

// ---------------------------------------------------------------- AI
console.log('\nAI 判斷（本機排程）')
/**
 * **AI 跟不跟得上，比的是最新的 K 棒，不是今天的日期。**
 *
 * 台股 13:30 才收盤、美股要等隔天凌晨——早上跑這支的時候，最新的 K 棒
 * 本來就是昨天的，而 AI 對著昨天的 K 棒做判斷完全正確。拿 `today` 去比
 * 的話，這支腳本每天早上都會對三檔各報一次假警報。
 *
 * 這跟畫面上那個「AI 停在 08-21」用的是同一條規則（SimNext 的 behind）。
 */
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
  const bar = newestBar.get(code)
  const behind = bar !== undefined && (last.d as string) < bar
  if (behind) {
    warn(`${code} 的 AI 判斷停在 ${last.d}，但最新 K 棒已經是 ${bar}`
      + '——那台機器沒開，或排程比抓取早跑')
  } else {
    ok(`${code.padEnd(7)} ${last.d}　${last.action}　${last.status}`)
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
