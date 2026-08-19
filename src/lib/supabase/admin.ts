import { createClient } from '@supabase/supabase-js'

/**
 * service role 客戶端。**只能在伺服器端用。**
 *
 * SUPABASE_SERVICE_ROLE_KEY 絕不加 NEXT_PUBLIC_ 前綴——加了就會被打包進
 * 瀏覽器 bundle，等於把資料庫的鑰匙貼在網頁原始碼裡（PLAN §0 規範四）。
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('缺少 SUPABASE_SERVICE_ROLE_KEY')
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
