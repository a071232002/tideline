/**
 * 本機測試資料：兩個帳號（RLS 要兩個才驗得了）＋ 預設觀察清單。
 * 只在本機用，不進版（supabase/seed.sql 與這支都在 .gitignore 的精神下）。
 */
import { createAdminClient } from '../src/lib/supabase/admin'

// 本機開發帳號。第二個只是用來驗 RLS（兩個帳號才看得出互相看不到）。
const USERS = [
  { email: 'dev@dev.dev', password: 'dev' },
  { email: 'dev2@dev.dev', password: 'dev' },
]

/** 第一個帳號的預設清單：台股兩檔、美股兩檔 */
const DEFAULTS = [
  { market: 'TW' as const, code: '0050', yahoo: '0050.TW', name: '元大台灣50', currency: 'TWD' },
  { market: 'TW' as const, code: '2330', yahoo: '2330.TW', name: '台積電', currency: 'TWD' },
  { market: 'US' as const, code: 'PLTR', yahoo: 'PLTR', name: 'Palantir', currency: 'USD' },
  { market: 'US' as const, code: 'NVDA', yahoo: 'NVDA', name: 'NVIDIA', currency: 'USD' },
]

async function main() {
  const db = createAdminClient()

  const ids: string[] = []
  for (const u of USERS) {
    const { data: list } = await db.auth.admin.listUsers()
    const found = list?.users.find((x) => x.email === u.email)
    if (found) { ids.push(found.id); console.log(`已存在 ${u.email}`); continue }
    const { data, error } = await db.auth.admin.createUser({
      email: u.email, password: u.password, email_confirm: true,
    })
    if (error) throw error
    ids.push(data.user!.id)
    console.log(`建立 ${u.email}`)
  }

  for (const s of DEFAULTS) {
    const { data: sym } = await db.from('symbols').upsert({
      market: s.market, code: s.code, yahoo_symbol: s.yahoo,
      name_zh: s.market === 'TW' ? s.name : null,
      name_en: s.market === 'US' ? s.name : null,
      currency: s.currency,
    }, { onConflict: 'market,code' }).select('id').single()
    if (!sym) continue
    await db.from('watchlist').upsert({ user_id: ids[0]!, symbol_id: sym.id })
    console.log(`清單加入 ${s.code}`)
  }

  console.log('\n帳號：')
  for (const u of USERS) console.log(`  ${u.email} / ${u.password}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
