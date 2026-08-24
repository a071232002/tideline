/**
 * 每天問一次：**全世界有什麼值得看一眼**。
 *
 *     npm run recommend
 *
 * 跟 `ai-decide.ts` 是兩條不同的線，不要混：
 *
 *   ai-decide   執行層。今天這個帳戶要不要買賣。**刻意不給新聞**——
 *               模擬帳戶要可重播，餵事後資訊會讓曲線漂亮又沒有意義。
 *   recommend   發現層。用途就是跳出使用者自己的清單，所以非得上網不可。
 *
 * ## 三道關卡
 *
 * 1. **格式**（`parsePicks`）：沒有來源網址的整列丟掉，代號格式不對的丟掉。
 * 2. **真的存在**（`validateSymbol`）：模型可能給一個不存在的代號或上櫃股。
 *    寫進去之後使用者按「加入追蹤」會失敗，而失敗看起來像我們的抓取壞了。
 * 3. **永不覆蓋**：跟 `sim_ai_log` 同一條規矩。那天說了什麼就是說了什麼，
 *    重跑不會改寫已經有的那一天。
 *
 * ## 為什麼要排除已經在追蹤的
 *
 * 推薦一檔你已經在看的，等於沒推薦。清單會隨時間變長，所以每天把當下的
 * 清單塞進提示裡讓模型避開。
 */
import { createAdminClient } from '../src/lib/supabase/admin'
import { parsePicks, buildRecommendPrompt } from '../src/lib/ai/recommend'
import { validateSymbol, yahooSymbolFor } from '../src/lib/sources/yahoo'
import { fetchBars } from '../src/lib/pipeline'
import { analyze } from '../src/lib/analyze'
import { pickTop, type RankInput } from '../src/lib/ai/rank'
import { taipeiToday } from '../src/lib/freshness'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'

const run = promisify(execFile)
const db = createAdminClient()

const AI_CMD = process.env.TIDELINE_AI_CMD ?? 'claude'
/**
 * **`--allowedTools` 一定要在 `-p` 之前**，而且一定要有。
 *
 * 沒有它，headless 模式下 WebSearch 是未授權的——實測模型會直接回
 * 「無法連網」，於是這條線每天安靜地產出零筆推薦。旗標放在 `-p` 後面則是
 * 直接報 "Input must be provided either through stdin or as a prompt argument"。
 */
const AI_ARGS = process.env.TIDELINE_RECOMMEND_ARGS?.split(' ').filter(Boolean)
  ?? ['--allowedTools', 'WebSearch', '-p']
const TIMEOUT_MS = Number(process.env.TIDELINE_RECOMMEND_TIMEOUT ?? 300_000)
const MODEL_LABEL = process.env.TIDELINE_AI_MODEL ?? 'claude-code'
/**
 * 問模型要幾檔候選，以及最後留幾檔。
 *
 * 候選要比名額多，因為排序會**排除掉**跌破季線與跌破止跌的——而模型挑的是
 * 熱門股，熱門股正好常常是漲高了或剛崩掉的那些。問 3 檔留 3 檔的話，
 * 篩完可能一檔都不剩。
 */
const POOL_PER_MARKET = Number(process.env.TIDELINE_RECOMMEND_POOL ?? 8)
const PER_MARKET = Number(process.env.TIDELINE_RECOMMEND_N ?? 3)

async function main() {
  const d = taipeiToday()

  // 已經有今天的就不要再問一次。這支腳本一天可能被跑好幾次（排程重試、手動）
  const { count } = await db.from('recommendations')
    .select('*', { count: 'exact', head: true }).eq('d', d)
  if ((count ?? 0) > 0) {
    console.log(`${d} 已經有 ${count} 筆推薦，跳過`)
    return
  }

  // 排除所有人正在追蹤的。這張表是全站共用的，所以看的是整個 watchlist
  const { data: watched } = await db.from('watchlist').select('symbol_id')
  const ids = [...new Set((watched ?? []).map((w) => w.symbol_id as string))]
  const { data: syms } = ids.length > 0
    ? await db.from('symbols').select('code').in('id', ids)
    : { data: [] as { code: string }[] }
  const exclude = [...new Set((syms ?? []).map((s) => s.code as string))].sort()

  console.log(`${d}　問模型（每個市場 ${POOL_PER_MARKET} 檔候選，排除 ${exclude.length} 檔已追蹤）…`)
  const prompt = buildRecommendPrompt(POOL_PER_MARKET, exclude)

  let raw: string
  try {
    const { stdout } = await run(AI_CMD, [...AI_ARGS, prompt], {
      timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
    })
    raw = stdout
  } catch (e) {
    console.error(`✗ 呼叫失敗：${e instanceof Error ? e.message : String(e)}`)
    process.exitCode = 1
    return
  }

  const parsed = parsePicks(raw)
  if (!parsed.ok) {
    // 寧可今天沒有推薦，也不要寫入看起來正常但站不住的東西
    console.error(`✗ 回應不合格：${parsed.reason}`)
    console.error(raw.slice(0, 400))
    process.exitCode = 1
    return
  }

  const rows: Record<string, unknown>[] = []
  for (const [market, list] of [['TW', parsed.picks.tw], ['US', parsed.picks.us]] as const) {
    /**
     * 題材負責發現，指標負責排序。
     *
     * 每一檔候選都要**真的抓一次 K 棒、跑一次跟清單上完全相同的計算**——
     * 沒有這一步就只是在轉貼新聞。候選不在 watchlist 裡，所以抓回來的
     * 東西不寫進 daily_bars（那些列不會被每日抓取更新，留著只會變成
     * 沒人維護的舊資料），算完的事實直接存進這一列。
     */
    const scored: { code: string; input: RankInput; pick: typeof list[number]; facts: Record<string, unknown> }[] = []

    for (const p of list) {
      // 真的存在嗎。查不到就丟掉——上櫃股與編出來的代號都擋在這裡
      const check = await validateSymbol(yahooSymbolFor(market, p.code))
      if (!check.ok) {
        console.log(`  ✗ ${market} ${p.code} ${p.name ?? ''}：來源查不到`)
        continue
      }

      let a: ReturnType<typeof analyze> = null
      try {
        const r = await fetchBars(market, p.code, yahooSymbolFor(market, p.code), true)
        a = analyze(r.bars, market === 'TW' ? 'TWD' : 'USD', market)
      } catch (e) {
        console.log(`  ✗ ${market} ${p.code}：抓取失敗 ${e instanceof Error ? e.message : String(e)}`)
        continue
      }
      if (!a) { console.log(`  ✗ ${market} ${p.code}：資料不足，算不出指標`); continue }

      scored.push({
        code: p.code, pick: p,
        input: {
          close: a.close, k: a.k, pctB: a.pctB, ma60: a.ma60,
          addHi: a.levels.add.hi, addLo: a.levels.add.lo,
          stop: a.levels.stop?.price ?? null,
        },
        facts: {
          close: a.close, chgPct: a.chgPct, k: a.k, d: a.d,
          pctB: a.pctB, ma60: a.ma60,
          add: { lo: a.levels.add.lo, hi: a.levels.add.hi },
          stop: a.levels.stop?.price ?? null,
          asOf: a.date,
        },
      })
    }

    const { picked, dropped } = pickTop(scored, PER_MARKET)
    for (const dr of dropped) console.log(`  – ${market} ${dr.code}：${dr.why}，不列入`)

    picked.forEach((it, i) => {
      rows.push({
        d, market, code: it.code,
        name: it.pick.name ?? null,
        theme: it.pick.theme, source: it.pick.source,
        rank: i + 1, verified: true, model: MODEL_LABEL,
        score: Number(it.score.toFixed(4)), facts: it.facts,
      })
      console.log(`  ✓ ${market} ${i + 1}. ${it.code} ${it.pick.name ?? ''}`
        + `　分數 ${it.score.toFixed(2)}`
        + `（%b ${(it.input.pctB).toFixed(2)}／K ${it.input.k.toFixed(0)}`
        + `／收 ${it.input.close} vs 加碼上緣 ${it.input.addHi}）`)
    })
  }

  if (rows.length === 0) {
    console.error('✗ 沒有任何候選通過驗證')
    process.exitCode = 1
    return
  }

  // 永不覆蓋：那天說了什麼就是說了什麼（跟 sim_ai_log 同一條規矩）
  const { error } = await db.from('recommendations').insert(rows)
  if (error) {
    console.error(`✗ 寫入失敗：${error.message}`)
    process.exitCode = 1
    return
  }
  console.log(`\n寫入 ${rows.length} 筆`)
}

await main()
process.exit(process.exitCode ?? 0)
