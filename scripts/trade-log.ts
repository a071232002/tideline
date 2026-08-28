/**
 * 買賣的歷程。**只讀，什麼都不改。**
 *
 *     npm run trades            全部
 *     npm run trades -- 2330    只看一檔
 *
 * ## 這張表跟畫面上的「最近成交」不一樣
 *
 * 畫面讀的是 `sim_trades`，那是每次重建都刪光重寫的**重算結果**。
 * 這裡讀的是 `sim_trade_log`，只進不出：系統每一次算出來的每一筆買賣
 * 都留一列，帶著算它的時間與當時的參數版本。
 *
 * ## 要看什麼
 *
 * **同一天出現兩列以上**，就是那一天的成交被改寫過。左邊的時間會告訴你
 * 是什麼時候改的、參數版本會告訴你為什麼。這是「後續要審視哪裡有問題」
 * 唯一靠得住的地方——`sim_trades` 只會顯示最後一次的結果，
 * 而它看起來永遠像是本來就那樣。
 */
import { createAdminClient } from '../src/lib/supabase/admin'
import { exitCleanly } from '../src/lib/exit'

const db = createAdminClient()
const only = process.argv[2]

const { data: accs } = await db.from('sim_accounts')
  .select('id, track, started_on, params, symbols(code)')

const byAcc = new Map((accs ?? []).map((a) => [a.id as string, a]))

const { data: rows, error } = await db.from('sim_trade_log')
  .select('*').order('signal_d', { ascending: true }).order('recorded_at', { ascending: true })
if (error) throw new Error(`讀取買賣歷程失敗：${error.message}`)

const tp = (iso: string) =>
  new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(5, 16).replace('T', ' ')

/** 同一個帳戶同一天同一邊出現幾次——大於 1 就是被改寫過 */
const times = new Map<string, number>()
for (const r of rows ?? []) {
  const k = `${r.account_id}|${r.signal_d}|${r.side}`
  times.set(k, (times.get(k) ?? 0) + 1)
}

let shown = 0
let rewritten = 0
for (const r of rows ?? []) {
  const a = byAcc.get(r.account_id as string)
  const code = (a?.symbols as never as { code: string })?.code ?? '?'
  if (only && code !== only) continue
  const k = `${r.account_id}|${r.signal_d}|${r.side}`
  const dup = (times.get(k) ?? 1) > 1
  if (dup) rewritten++
  shown++
  console.log(
    `${dup ? '⚠' : ' '} ${code.padEnd(7)}${String(a?.track ?? '?').padEnd(5)}`
    + `${r.signal_d} 決定／${r.fill_d} 成交　`
    + `${r.side === 'buy' ? '買' : '賣'} ${Number(r.qty).toFixed(4).replace(/\.?0+$/, '')}`
    + ` @ ${Number(r.price).toFixed(2)}　`
    + `[${(r.triggers as string[]).join('+')}] ${r.decided_by}`)
  console.log(`    ${r.reason}`)
  console.log(`    記於 ${tp(r.recorded_at as string)} 台北・參數 ${r.params_version}`)
}

console.log(`\n${shown} 列`)
if (rewritten > 0) {
  console.log(`⚠ 其中 ${rewritten} 列是**同一天被算出過不只一種結果**——`)
  console.log('  比對它們的參數版本與記錄時間，就知道是什麼時候、因為什麼改掉的。')
} else if (shown > 0) {
  console.log('✓ 沒有任何一天被改寫過：每一筆都只被算出過一種結果。')
}
await exitCleanly(0)
