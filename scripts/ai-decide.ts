/**
 * AI 帳戶的每日決策（PLAN §13.5，G-7）。
 *
 * 每天在規則帳戶算完之後跑一次，用 Claude Code 訂閱身分（`claude -p`），
 * 不需要 API 儲值，也不必把 key 放進雲端（§5「AI 那段在哪裡跑」）。
 *
 * ## 三條不能違反的規矩
 *
 * 一、**AI 不產生數字。** 它只從受限選單挑一個動作；股數由引擎算、
 *     成交價由引擎取次日開盤。理由裡的每個數字都要對得回程式算出來的值，
 *     對不上就整段退回（`src/lib/ai/decide.ts`）。
 *
 * 二、**沒跑到就記 missing，不補。** 電腦沒開、模型失敗、逾時、驗證器連續退回
 *     都算。事後補等於偷看未來——那時候後面幾天的走勢已經知道了。
 *
 * 三、**掛掉不能影響數字管線。** 價位、指標、圖表、規則帳戶都不依賴這支腳本。
 *     它整支失敗，隔天頁面照常，只是 AI 那條曲線多一天 missing。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createAdminClient } from '../src/lib/supabase/admin'
import { rebuildAll } from '../src/lib/sim/run'
import { buildPrompt, allowedNumbers, type AiFacts } from '../src/lib/ai/prompt'
import { parseDecision } from '../src/lib/ai/decide'

const run = promisify(execFile)

/** 可以換成別的指令方便測試；預設用 Claude Code 的 headless 模式 */
const AI_CMD = process.env.TIDELINE_AI_CMD ?? 'claude'
const AI_ARGS = process.env.TIDELINE_AI_ARGS?.split(' ').filter(Boolean) ?? ['-p']
const TIMEOUT_MS = Number(process.env.TIDELINE_AI_TIMEOUT ?? 120_000)
const MODEL_LABEL = process.env.TIDELINE_AI_MODEL ?? 'claude-code'
/** 只跑指定代號／使用者。除錯與第一次接線時用，正式排程不設 */
const ONLY = process.env.TIDELINE_AI_ONLY?.split(',').map((x) => x.trim()).filter(Boolean)
const ONLY_USER = process.env.TIDELINE_AI_USER

const db = createAdminClient()
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

async function ask(prompt: string): Promise<string> {
  const { stdout } = await run(AI_CMD, [...AI_ARGS, prompt], {
    timeout: TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  })
  return stdout
}

interface LogRow {
  account_id: string
  d: string
  status: 'ok' | 'missing' | 'rejected'
  action?: string | null
  confidence?: string | null
  reason?: string | null
  model?: string | null
  note?: string | null
  overrode_stop?: boolean
}

/**
 * 只寫，不覆蓋。
 *
 * 已經有紀錄的日子代表那天真的做過決策——重跑腳本不該把它改掉，
 * 否則「當天說了什麼」就不是紀錄而是可以事後編輯的東西（§13.1 四）。
 */
async function logOnce(row: LogRow): Promise<boolean> {
  const { data: exists } = await db.from('sim_ai_log')
    .select('d').eq('account_id', row.account_id).eq('d', row.d).maybeSingle()
  if (exists) return false
  const { error } = await db.from('sim_ai_log').insert(row)
  if (error) throw new Error(`寫入 sim_ai_log 失敗：${error.message}`)
  return true
}

async function main() {
  const { data: users, error } = await db.auth.admin.listUsers()
  if (error) throw new Error(`讀取使用者失敗：${error.message}`)

  for (const user of users.users) {
    // 先把三條軌道重建到最新，AI 帳戶的持股與現金才是對的
    await rebuildAll(user.id)

    const { data: accounts } = await db.from('sim_accounts')
      .select('id, symbol_id, track, currency, started_on, initial_cash')
      .eq('user_id', user.id)

    /**
     * **只問還在清單裡的標的。**
     *
     * 帳戶移出清單不刪除（sim_ai_log 不能重建），但 `rebuildAll` 只重建
     * 清單裡的——所以對移出的標的問模型，等於花一次 API 額度換一筆
     * 永遠不會被模擬到的決策。實測 dev 的 2454 就是這樣天天被問。
     */
    const { data: watched } = await db.from('watchlist')
      .select('symbol_id').eq('user_id', user.id)
    const inList = new Set((watched ?? []).map((w) => w.symbol_id as string))

    const aiAccounts = (accounts ?? [])
      .filter((a) => a.track === 'ai' && inList.has(a.symbol_id as string))
    if (aiAccounts.length === 0) continue

    if (ONLY_USER && user.email !== ONLY_USER) continue
    console.log(`\n${user.email}`)

    for (const acc of aiAccounts) {
      const symbolId = acc.symbol_id as string
      const { data: sym } = await db.from('symbols')
        .select('code, name_zh, name_en, market').eq('id', symbolId).single()
      if (!sym) continue
      const code = sym.code as string
      if (ONLY && !ONLY.includes(code)) continue

      // 只問「有 K 棒撐著」的最新那天。
      //
      // daily_analysis 依 §11 永不刪除，daily_bars 會被回收，兩者的最新日期會脫節
      // （實測 0050 分析到 08-21、K 棒只到 08-19）。拿孤兒那天去問，
      // 決策會被記在一個模擬永遠跑不到的日子上——AI 那條曲線因此永遠是空的，
      // 而且完全不會報錯。這與 sanity.ts 的 checkOrphanAnalysis 是同一件事。
      const { data: newestBar } = await db.from('daily_bars')
        .select('d').eq('symbol_id', symbolId)
        .order('d', { ascending: false }).limit(1).maybeSingle()
      if (!newestBar) { console.log(`  ${code} 沒有 K 棒，跳過`); continue }

      const { data: an } = await db.from('daily_analysis')
        .select('*').eq('symbol_id', symbolId).lte('d', newestBar.d as string)
        .order('d', { ascending: false }).limit(1).maybeSingle()
      if (!an) { console.log(`  ${code} 沒有分析資料，跳過`); continue }

      const signalD = an.d as string

      /**
       * **起算日之前的日子不問。**
       *
       * 週末或收盤前加進來的標的，帳戶的起算日會比最新那根 K 棒還新
       * （帳戶照建，等下一個交易日才開跑——見 run.ts）。這時候去問模型，
       * 問的是一個帳戶還不存在的日子：那筆決策永遠不會被模擬到，
       * 而且餵進去的持股與現金全是 0，因為淨值表裡一列都還沒有。
       *
       * 實測 2026-08-23：00981A 08-23 加入，模型被問了 08-21，
       * 回「現金 0、持股 0 無可執行」——一次額度換一筆廢紀錄。
       */
      const startedOn = acc.started_on as string | null
      if (startedOn && signalD < startedOn) {
        console.log(`  ${code} ${signalD} 早於起算日 ${startedOn}，跳過`)
        continue
      }

      // 已經決策過的日子不重問。腳本一天可能被跑好幾次
      const { data: already } = await db.from('sim_ai_log')
        .select('status, action').eq('account_id', acc.id).eq('d', signalD).maybeSingle()
      if (already) {
        console.log(`  ${code} ${signalD} 已有紀錄（${already.status}／${already.action ?? '—'}）`)
        continue
      }

      const { data: bars } = await db.from('daily_bars')
        .select('d, c').eq('symbol_id', symbolId)
        .order('d', { ascending: false }).limit(20)
      const { data: eq } = await db.from('sim_equity')
        .select('shares, cash, cost, equity, ret_pct')
        .eq('account_id', acc.id).order('d', { ascending: false }).limit(1).maybeSingle()

      // 規則帳戶今天打算做什麼——AI 要能選擇不同意
      const ruleAcc = (accounts ?? []).find(
        (a) => a.symbol_id === symbolId && a.track === 'rule')
      const { data: ruleRow } = ruleAcc
        ? await db.from('sim_accounts').select('pending').eq('id', ruleAcc.id).maybeSingle()
        : { data: null }
      const pending = ruleRow?.pending as {
        buy?: boolean; sell?: boolean; reason?: string; triggers?: string[]
      } | null

      const lv = (an.levels ?? {}) as {
        sell?: { lo: number; hi: number } | null
        stop?: { price: number } | null
        add?: { lo: number; hi: number }
        why?: Record<string, string>
      }
      if (!lv.add) { console.log(`  ${code} 沒有加碼區，跳過`); continue }

      const facts: AiFacts = {
        code, name: (sym.name_zh as string) ?? (sym.name_en as string) ?? null,
        market: sym.market as 'TW' | 'US',
        currency: acc.currency as string,
        date: signalD,
        close: Number(an.close),
        chg: n(an.chg), chgPct: n(an.chg_pct),
        o: n(an.o), h: n(an.h), l: n(an.l),
        k: n(an.k), d: n(an.d_val), pctB: n(an.pct_b), bandwidth: n(an.bandwidth),
        bbUp: n(an.bb_up), bbMid: n(an.bb_mid), bbLo: n(an.bb_lo), ma60: n(an.ma60),
        levels: { sell: lv.sell ?? null, stop: lv.stop?.price ?? null, add: lv.add },
        levelWhy: lv.why ?? {},
        recentCloses: (bars ?? []).map((b) => Number(b.c)).reverse(),
        position: {
          // 淨值表還沒有任何一列時，手上就是全額現金——不是 0。
          // 上面的起算日檢查應該已經擋掉這種帳戶，但**餵錯數字的代價太大**：
          // 數字驗證器只檢查「模型引用的數字有沒有出現在事實裡」，
          // 它擋不住事實本身就是錯的。
          shares: Number(eq?.shares ?? 0),
          cash: Number(eq?.cash ?? acc.initial_cash ?? 0),
          cost: Number(eq?.cost ?? 0),
          equity: Number(eq?.equity ?? acc.initial_cash ?? 0),
          retPct: Number(eq?.ret_pct ?? 0),
        },
        ruleAction: pending
          ? {
            verb: pending.sell ? (pending.triggers?.includes('stop') ? '全部賣掉' : '賣掉一半')
              : pending.buy ? '買進一批' : '不動作',
            reason: pending.reason ?? '',
          }
          : null,
      }

      const allowed = allowedNumbers(facts)
      const base = buildPrompt(facts)

      // 退回一次就再問一次，並且**明講剛剛哪裡不合格**。
      // 兩次都不行就記 rejected——不要無限重試把額度燒光。
      let note: string | null = null
      let done = false
      for (let attempt = 1; attempt <= 2 && !done; attempt++) {
        const prompt = attempt === 1 ? base
          : `${base}\n\n上一次的回應被退回：${note}\n請重新回一個符合規則的 JSON。`
        let raw: string
        try {
          raw = await ask(prompt)
        } catch (e) {
          note = `呼叫失敗：${e instanceof Error ? e.message : String(e)}`
          break
        }
        const parsed = parseDecision(raw, allowed)
        if (!parsed.ok) { note = parsed.reason; continue }

        // 抱過止跌要記分：規則說全部賣掉，AI 卻沒有出場（§13.5「不擋，但記分」）
        const ruleWantsStop = pending?.triggers?.includes('stop') === true
        const aiExits = parsed.decision.action === 'sell_100'
        await logOnce({
          account_id: acc.id as string, d: signalD, status: 'ok',
          action: parsed.decision.action,
          confidence: parsed.decision.confidence,
          reason: parsed.decision.reason,
          model: MODEL_LABEL,
          note: parsed.decision.agreeWithRule ? null : '不同意規則帳戶的做法',
          overrode_stop: ruleWantsStop && !aiExits,
        })
        console.log(`  ${code} ${signalD} → ${parsed.decision.action}`
          + `（${parsed.decision.confidence}）${parsed.decision.reason}`)
        done = true
      }

      if (!done) {
        // missing 與 rejected 分開：前者是沒問到，後者是問到了但答得不合格。
        // 兩者都**不補**，但要分得出來——後者代表 prompt 或選單設計有問題。
        const status = note?.startsWith('呼叫失敗') ? 'missing' : 'rejected'
        await logOnce({
          account_id: acc.id as string, d: signalD, status,
          model: MODEL_LABEL, note,
        })
        console.log(`  ${code} ${signalD} ✗ ${status}：${note}`)
      }
    }

    // 決策寫完再重建一次，AI 那條曲線才會長出今天這一段
    await rebuildAll(user.id)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
