/** 補抓匯率（PLAN §13.2）。平常由每日 ingest 順帶抓，這支是手動補的入口。 */
import { createAdminClient } from '../src/lib/supabase/admin'
import { fetchUsdTwd, FX_PAIR, plausible } from '../src/lib/sources/fx'

const range = process.argv[2] ?? '1y'
const rates = await fetchUsdTwd(range)
const rows = Object.entries(rates)
  .filter(([, r]) => plausible(r))
  .map(([d, rate]) => ({ d, pair: FX_PAIR, rate, src: 'yahoo' }))

if (rows.length === 0) throw new Error('來源沒有回傳合理的匯率')

const { error } = await createAdminClient().from('fx_rates').upsert(rows)
if (error) throw new Error(`寫入 fx_rates 失敗：${error.message}`)

const first = rows[0]!, last = rows[rows.length - 1]!
console.log(`USD/TWD ${rows.length} 筆：${first.d} ${first.rate} → ${last.d} ${last.rate}`)
