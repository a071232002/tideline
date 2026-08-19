/**
 * 每日抓取。Windows 工作排程器每天早上 07:30 叫這支，
 * 兩個市場一起做——台股拿前一交易日收盤、美股拿昨夜收盤，
 * 09:30 之前一定跑完（PLAN §7）。
 */
import { runIngest } from '../src/lib/pipeline'

const started = Date.now()
const results = await runIngest('ingest-morning')

for (const r of results) {
  console.log(r.ok
    ? `  ✓ ${r.code}  ${r.date}  ${r.bars} 根`
    : `  ✗ ${r.code}  ${r.error}`)
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 成功，耗時 ${((Date.now() - started) / 1000).toFixed(1)}s`)
if (failed > 0) process.exitCode = 1
