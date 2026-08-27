/**
 * 產生部署用的兩份 SQL。
 *
 *     npm run deploy:sql -- --user you@example.com
 *
 * 產出（`deploy/`，不進版控——裡面是真的資料，而這個 repo 是公開的）：
 *
 *   deploy/01-schema.sql   建表。把 migrations 依序接起來，貼進 Supabase
 *                          的 SQL Editor 一次跑完即可，不必裝 CLI。
 *   deploy/02-data.sql     搬**不能重建的**那些列。
 *
 * ## 只搬不能重建的
 *
 * | 表 | 搬 | 為什麼 |
 * |---|---|---|
 * | `symbols`          | ✅ | 它的 id 被其他表引用；重建會換一組 id |
 * | `watchlist`        | ✅ | `added_at` 決定帳戶的起算日 |
 * | `sim_accounts`     | ✅ | 帶著 `started_on` 與本金，重建會失去起算日 |
 * | `sim_ai_log`       | ✅ | §13.1：**唯一不能重建的東西** |
 * | `recommendations`  | ✅ | 同一條規矩：那天說了什麼就是說了什麼 |
 * | `daily_analysis`   | ✅ | **只搬 `origin='live'`**（38 列）。回補的 567 列跑 `npm run backfill` 就有 |
 * | `fx_rates`         | ✅ | 很小，而且缺了匯率美股帳戶開不了帳（`rateOn` 回 null） |
 * | `daily_bars`       | ❌ | 第一次抓取就補齊，而且有 185 根的保留上限 |
 * | `sim_equity` / `sim_trades` | ❌ | 推導的，`rebuildAll` 會重算 |
 * | `daily_valuation` / `corporate_actions` | ❌ | 每次抓取重抓 |
 *
 * ## user_id 一定要重新對應
 *
 * 新專案的 `auth.users.id` 跟這裡不一樣。而 `sim_accounts.user_id` 與
 * `watchlist.user_id` **沒有 FK 到 auth.users**——照抄舊 id 不會報錯，
 * 但 RLS 是 `auth.uid() = user_id`，結果是**資料在裡面卻看不見**。
 * 那比直接失敗更糟。
 *
 * 所以產出的 SQL 用 email 去查新的 id，查不到就 raise exception 停下來。
 */
import { writeFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { createAdminClient } from '../src/lib/supabase/admin'

const db = createAdminClient()
const OUT = 'deploy'

const email = (() => {
  const i = process.argv.indexOf('--user')
  if (i < 0 || !process.argv[i + 1]) {
    console.error('用法：npm run deploy:sql -- --user you@example.com')
    console.error('（新專案裡要用哪個帳號，就填那個 email）')
    process.exit(1)
  }
  return process.argv[i + 1]!
})()

mkdirSync(OUT, { recursive: true })

// ---------------------------------------------------------------- 1. 建表
const files = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort()
const schema = [
  '-- Tideline 建表。由 scripts/deploy-sql.ts 產生，不要手改。',
  '-- 來源：supabase/migrations/*.sql，依檔名排序接起來。',
  '--',
  '-- 用法：貼進 Supabase 的 SQL Editor 一次跑完。全部都是 if not exists，',
  '-- 重跑不會壞。跑完檢查一下：15 張表、每一張都 RLS enabled。',
  '',
  ...files.map((f) => `\n-- ======== ${f} ========\n${readFileSync(`supabase/migrations/${f}`, 'utf8')}`),
].join('\n')
writeFileSync(`${OUT}/01-schema.sql`, schema, 'utf8')

// ---------------------------------------------------------------- 2. 資料
const q = (v: unknown): string => {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`
  return `'${String(v).replace(/'/g, "''")}'`
}

/** 一張表變成一段 INSERT。`userCol` 那一欄改成查新專案的 id */
function block(
  table: string, rows: Record<string, unknown>[], userCol?: string,
): string {
  if (rows.length === 0) return `-- ${table}：沒有資料\n`
  const cols = Object.keys(rows[0]!)
  const values = rows.map((r) => '  (' + cols.map((c) =>
    c === userCol ? '(select id from _uid)' : q(r[c])).join(', ') + ')').join(',\n')
  return [
    `-- ${table}：${rows.length} 列`,
    `insert into ${table} (${cols.join(', ')}) values`,
    values,
    'on conflict do nothing;',
    '',
  ].join('\n')
}

const { data: users } = await db.auth.admin.listUsers()
const me = users.users.find((u) => u.email === email)
if (!me) {
  console.error(`✗ 本機找不到 ${email}。現有：${users.users.map((u) => u.email).join('、')}`)
  process.exit(1)
}

const pick = async (table: string, cols: string, filter?: (q: never) => never) => {
  let sel = db.from(table).select(cols)
  if (filter) sel = filter(sel as never)
  const { data, error } = await sel
  if (error) throw new Error(`${table}：${error.message}`)
  return (data ?? []) as unknown as Record<string, unknown>[]
}

const symbols = await pick('symbols', '*')
const watchlist = (await pick('watchlist', '*')).filter((r) => r.user_id === me.id)
const accounts = (await pick('sim_accounts', '*')).filter((r) => r.user_id === me.id)
const accIds = new Set(accounts.map((a) => a.id as string))
const aiLog = (await pick('sim_ai_log', '*')).filter((r) => accIds.has(r.account_id as string))
const analysis = (await pick('daily_analysis', '*')).filter((r) => r.origin === 'live')
const fx = await pick('fx_rates', '*')
const recs = await pick('recommendations', '*')

const data = [
  '-- Tideline 資料搬移。由 scripts/deploy-sql.ts 產生，不要手改。',
  '--',
  '-- **先決條件**：01-schema.sql 已經跑過，而且新專案的 Auth 裡已經有',
  `-- ${email} 這個帳號（Supabase → Authentication → Users → Add user）。`,
  '--',
  '-- 只搬不能重建的那些列。daily_bars 第一次抓取就補齊；sim_equity 與',
  '-- sim_trades 是推導的，rebuildAll 會重算；回補的 daily_analysis 跑',
  '-- `npm run backfill` 就有。',
  '',
  '-- user_id 不能照抄：新專案的 auth.users.id 跟舊的不一樣，而',
  '-- sim_accounts.user_id 沒有 FK 到 auth.users——照抄不會報錯，但 RLS 是',
  '-- auth.uid() = user_id，結果是**資料在裡面卻看不見**。所以用 email 查。',
  'create temp table _uid as',
  `  select id from auth.users where email = ${q(email)};`,
  '',
  'do $$ begin',
  '  if not exists (select 1 from _uid) then',
  `    raise exception '找不到 ${email} 這個帳號。先在 Supabase Auth 建好再跑這一份。';`,
  '  end if;',
  'end $$;',
  '',
  block('symbols', symbols),
  block('fx_rates', fx),
  block('daily_analysis', analysis),
  block('watchlist', watchlist, 'user_id'),
  block('sim_accounts', accounts, 'user_id'),
  block('sim_ai_log', aiLog),
  block('recommendations', recs),
  '-- 跑完之後：',
  '--   1. 在網站上登入，確認清單看得到（看不到就是 user_id 沒對上）',
  '--   2. npm run backfill        補回歷史分析（要先跑過一次抓取拿到 K 棒）',
  '--   3. 打一次 /api/cron/ingest 讓 daily_bars 與模擬帳戶長出來',
  '',
].join('\n')
writeFileSync(`${OUT}/02-data.sql`, data, 'utf8')

const kb = (s: string) => `${Math.round(s.length / 1024)} KB`
console.log(`✓ ${OUT}/01-schema.sql   ${files.length} 支 migration，${kb(schema)}`)
console.log(`✓ ${OUT}/02-data.sql     ${kb(data)}`)
console.log(`    symbols ${symbols.length}・fx_rates ${fx.length}・daily_analysis(live) ${analysis.length}`)
console.log(`    watchlist ${watchlist.length}・sim_accounts ${accounts.length}`
  + `・sim_ai_log ${aiLog.length}・recommendations ${recs.length}`)
console.log(`    使用者：${email}`)
process.exit(0)
