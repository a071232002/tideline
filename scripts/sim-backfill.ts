/**
 * 重建所有模擬帳戶（PLAN §13，G-4）。
 *
 * 成交與淨值是**推導**出來的（由 daily_analysis ＋ sim_ai_log ＋ K 棒算），
 * 所以整條重跑不會失真。改了費率或規則參數之後就跑這個。
 */
import { createAdminClient } from '../src/lib/supabase/admin'
import { rebuildAll } from '../src/lib/sim/run'
import { DEFAULT_CAPITAL_TWD } from '../src/lib/sim/params'

const db = createAdminClient()
const { data: users, error } = await db.auth.admin.listUsers()
if (error) throw new Error(`讀取使用者失敗：${error.message}`)

const capital = Number(process.argv[2] ?? DEFAULT_CAPITAL_TWD)
if (!Number.isFinite(capital) || capital <= 0) {
  throw new Error(`本金要是正數，收到的是「${process.argv[2]}」`)
}

console.log(`本金 ${capital.toLocaleString()} 台幣／每檔每軌道\n`)

for (const u of users.users) {
  const rows = await rebuildAll(u.id, capital)
  if (rows.length === 0) continue
  console.log(`${u.email}`)

  const byCode = new Map<string, typeof rows>()
  for (const r of rows) {
    const list = byCode.get(r.code)
    if (list) list.push(r)
    else byCode.set(r.code, [r])
  }

  for (const [code, list] of byCode) {
    const skipped = list.find((r) => r.skipped)
    if (skipped) {
      console.log(`  ${code.padEnd(6)} — ${skipped.skipped}`)
      continue
    }
    const pick = (t: string) => list.find((r) => r.track === t)
    const rule = pick('rule'), ai = pick('ai'), hold = pick('hold')
    const pct = (v?: number) => v === undefined ? '—'
      : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`

    // 超額報酬才是「準不準」的答案。報酬率本身在上漲的市場裡誰都好看（§13.7）
    const excess = rule && hold ? rule.retPct - hold.retPct : undefined
    console.log(
      `  ${code.padEnd(6)} 規則 ${pct(rule?.retPct).padStart(8)}`
      + `  買進持有 ${pct(hold?.retPct).padStart(8)}`
      + `  超額 ${pct(excess).padStart(8)}`
      + `  AI ${pct(ai?.retPct).padStart(8)}`,
    )
    if (rule) {
      const inMarket = rule.daysInMarket
      console.log(
        `         交易 ${rule.trades} 次・在市 ${inMarket} 天`
        + `・費用 ${rule.totalFees.toFixed(0)} 元`
        + `（佔本金 ${((rule.totalFees / capital) * 100).toFixed(2)}%）`
        + (rule.pending ? `・明日：${rule.pending}` : ''),
      )
    }
  }
  console.log()
}
