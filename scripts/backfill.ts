/**
 * 回補歷史建議，讓「當時說的價位」可以疊在走勢上回顧。
 *   npm run backfill
 * 只會補沒有 live 紀錄的日子——當天真的產出的那一列永遠不動。
 */
import { backfillAll, RULES_VERSION } from '../src/lib/backfill'

console.log(`回補規則版本 ${RULES_VERSION}`)
const results = await backfillAll()
for (const r of results) {
  console.log(`  ${r.code}  寫入 ${r.written} 天` + (r.skippedLive ? `（保留 ${r.skippedLive} 天 live）` : ''))
}
