import { createAdminClient } from '../src/lib/supabase/admin'
const db = createAdminClient()
const email = 'perf-probe@tideline.test'
const arg = process.argv[2]
if (arg === 'create') {
  const { data, error } = await db.auth.admin.createUser({
    email, password: 'probe-only-1234', email_confirm: true,
  })
  console.log(error ? '失敗：' + error.message : '建立 ' + data.user?.id)
} else {
  const { data: users } = await db.auth.admin.listUsers()
  const u = users.users.find((x) => x.email === email)
  if (u) { await db.auth.admin.deleteUser(u.id); console.log('已刪除') }
  else console.log('沒有那個帳號')
}
process.exit(0)
