import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildStamp } from '@/lib/fresh-stamp'

/**
 * 「資料變了沒」——一個字串。
 *
 * 開著頁面的人不會知道排程什麼時候跑完。這支的存在是為了讓畫面自己
 * 發現，而不是靠使用者按重新整理（他也沒有理由知道該按）。
 *
 * ## 為什麼是輪詢而不是 Realtime
 *
 * Supabase 有 Realtime，但要為它開 replication、多一條 websocket、
 * 多一套斷線重連。而這裡要偵測的事情**一天發生兩次**。
 * 一個回傳兩個時間戳的查詢，在使用者回到分頁的時候問一次，
 * 已經蓋掉絕大多數的情境——真正常見的是「早上回到昨晚開著的分頁」。
 *
 * ## 兩個查詢都很小，而且平行
 *
 * `job_runs` 有 (job, started_at desc) 索引；`sim_ai_log` 走 RLS，
 * 只看得到自己的帳戶。兩個都是 limit 1。
 *
 * 走使用者身分而不是 service role：這支會被瀏覽器直接打，
 * 用 service role 等於把一支繞過 RLS 的入口掛在網路上。
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()

  const [{ data: jobs }, { data: ai }] = await Promise.all([
    supabase.from('job_runs').select('finished_at').eq('ok', true)
      .order('finished_at', { ascending: false }).limit(1),
    supabase.from('sim_ai_log').select('created_at')
      .order('created_at', { ascending: false }).limit(1),
  ])

  return NextResponse.json({
    stamp: buildStamp({
      ingestAt: (jobs?.[0]?.finished_at as string) ?? null,
      aiAt: (ai?.[0]?.created_at as string) ?? null,
    }),
  }, {
    // 這個答案的整個用途就是「現在是什麼狀態」。快取住它等於永遠不會更新。
    headers: { 'cache-control': 'no-store' },
  })
}
