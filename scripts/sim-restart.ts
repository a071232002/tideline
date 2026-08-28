/**
 * 換了規則參數之後，從指定的交易日**重新起算**所有模擬帳戶。
 *
 *     npm run sim:restart -- --from 2026-08-31
 *
 * ## 為什麼不是直接 `npm run sim`
 *
 * 成交與淨值是推導的，所以「整條重跑」平常沒問題——同一套算式再算一次，
 * 結果一樣。但**規則本身變了**的時候不一樣：重跑等於用今天才決定的規則
 * 去寫上週的成交，而上週的走勢已經知道了。
 *
 * 實測 2026-08-29（週六，沒有開市）：改完 `coreFraction` 之後重建，
 * 週五憑空多出三筆成交，而那一天實際上什麼都沒發生過。那不是紀錄，
 * 是重算的結果——而畫面上兩者長得一模一樣。
 *
 * 這跟 `ai-decide` 的「沒跑到就記 missing，不補，事後補等於偷看未來」
 * 是同一條規矩，只是換成規則軌。`rebuildAll` 現在會擋下版本不符的重建，
 * 這支腳本是唯一合法的換版路徑。
 *
 * ## 它做什麼
 *
 *   1. 檢查起算日在**未來**（今天也不行，今天的 K 棒可能已經收了）
 *   2. 把每個帳戶的 `started_on` 移到那一天，`params` 換成現在這一組
 *   3. 重建
 *
 * 舊的那段歷史就讓它結束——它是另一套規則跑出來的，本來就不該接在一起比。
 * `sim_ai_log` **不刪**（§13.1），那些是模型當天真的做過的判斷；
 * 它們早於新的起算日，所以不會被重播，但紀錄留著。
 *
 * ## `--fixture`：只給本機測試資料用
 *
 *     npm run sim:restart -- --from 2026-08-19 --fixture
 *
 * 本機那份資料庫裝的是**測試素材**，不是任何人的紀錄——E2E 需要一段有
 * 成交、有曲線的歷史，所以它必須能往回設。這個旗標存在的意義是讓那件事
 * 有一條明確的、講得出理由的路徑，而不是讓人繞過上面那道檢查。
 *
 * 它**拒絕對非本機的資料庫執行**：`.env.cloud` 帶著這個旗標跑會直接停下來。
 * 少了這一條，這個旗標就只是「檢查可以關掉」，那等於沒有檢查。
 */
import { createAdminClient } from '../src/lib/supabase/admin'
import { rebuildAll } from '../src/lib/sim/run'
import { DEFAULT_FEES, DEFAULT_RULES, PARAMS_VERSION } from '../src/lib/sim/params'
import { taipeiToday } from '../src/lib/freshness'
import { checkRestartDate } from '../src/lib/sim/restart'
import { exitCleanly } from '../src/lib/exit'

const db = createAdminClient()

const from = (() => {
  const i = process.argv.indexOf('--from')
  return i >= 0 ? process.argv[i + 1] : undefined
})()

if (!from) {
  console.error('用法：npm run sim:restart -- --from YYYY-MM-DD')
  console.error('那一天要是**下一個還沒發生的交易日**。今天不行——今天的 K 棒可能已經收了。')
  await exitCleanly(1)
}

const fixture = process.argv.includes('--fixture')
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const isLocal = /127\.0\.0\.1|localhost/.test(url)

if (fixture && !isLocal) {
  console.error(`✗ --fixture 只能對本機資料庫用，而現在指向的是 ${url}`)
  console.error('  那個旗標的用途是準備測試素材。對著真的資料庫用，它就只是')
  console.error('  「把檢查關掉」——那等於沒有檢查。')
  await exitCleanly(1)
}

const today = taipeiToday()
if (fixture) {
  console.log('（--fixture：本機測試素材，略過「起算日必須在未來」的檢查）')
} else {
  const check = checkRestartDate(from!, today)
  if (!check.ok) {
    console.error(`✗ ${check.why}`)
    await exitCleanly(1)
  }
}

const { data: accs, error: accErr } = await db.from('sim_accounts')
  .select('id, track, started_on, params, symbols(code)')
if (accErr) throw new Error(`讀取帳戶失敗：${accErr.message}`)

console.log(`\n從 ${from} 重新起算　參數 ${PARAMS_VERSION}　（今天 ${today}）\n`)
if ((accs ?? []).length === 0) {
  console.log('沒有任何模擬帳戶，不用做事')
  await exitCleanly(0)
}

for (const a of accs ?? []) {
  const code = (a.symbols as never as { code: string })?.code ?? '?'
  const was = (a.params as { version?: string } | null)?.version ?? '（沒記）'
  const { error } = await db.from('sim_accounts')
    .update({
      started_on: from,
      params: { fees: DEFAULT_FEES, rules: DEFAULT_RULES, version: PARAMS_VERSION },
    })
    .eq('id', a.id as string)
  if (error) throw new Error(`${code}/${a.track} 更新失敗：${error.message}`)
  console.log(`  ${code.padEnd(7)} ${String(a.track).padEnd(5)}`
    + ` ${a.started_on} → ${from}　參數 ${was} → ${PARAMS_VERSION}`)
}

console.log('\n重建：')
const { data: users, error } = await db.auth.admin.listUsers()
if (error) throw new Error(`讀取使用者失敗：${error.message}`)
for (const u of users.users) {
  const rows = await rebuildAll(u.id)
  if (rows.length === 0) continue
  console.log(`  ${u.email}`)
  for (const r of rows) {
    console.log(`    ${r.code.padEnd(7)} 交易 ${r.trades} 次・在市 ${r.daysInMarket} 天`)
  }
}

console.log(`\n✓ 所有帳戶從 ${from} 起算。在那之前的成交與淨值已經清掉——`)
console.log('  它們是另一套規則跑出來的，接在一起比沒有意義。')
console.log('  sim_ai_log 沒有動（§13.1）：那些是模型當天真的做過的判斷。')
await exitCleanly(0)
