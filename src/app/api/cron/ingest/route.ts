import { NextResponse } from 'next/server'
import { runIngest } from '@/lib/pipeline'

/**
 * 每日抓取的 HTTP 入口，給 Vercel Cron 用。
 *
 * ## 為什麼需要它
 *
 * 本機版是 Windows 工作排程器叫 `scripts/daily.ps1`，那支腳本做三件事：
 * 叫醒 podman、讀 `.env.local`、依序跑 ingest 與 AI。搬到雲端之後前兩件
 * 分別由「託管資料庫」與「環境變數」取代，第三件變成 cron 打這個網址。
 *
 * **抓取本身一行都沒有改**——`runIngest()` 是同一支，本機腳本與這個
 * route handler 只是兩個外殼。兩邊會不一致的東西只有觸發方式。
 *
 * ## 憑證
 *
 * 這個網址會寫資料庫，所以不能開著讓人打。Vercel Cron 會帶
 * `Authorization: Bearer $CRON_SECRET`，這裡逐字比對。
 *
 * **沒設 `CRON_SECRET` 就直接拒絕**，不要「沒設就放行」——那種預設值
 * 會在某次忘記設環境變數的部署裡把入口打開，而且不會有任何徵兆。
 *
 * ## 執行時間
 *
 * 實測每檔約 8 秒（九次 TWSE 請求，中間各隔 1.2 秒避免限流），5 檔 41 秒。
 * 雲端函式有執行時間上限，所以這裡**回報耗時**，讓它逼近上限時看得出來，
 * 而不是等到某天被砍掉才發現資料停更（那時畫面只會說「未更新」）。
 */

// 抓取要打外部 API 並寫資料庫，不能被靜態化或快取
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: '未設定 CRON_SECRET，拒絕執行' }, { status: 503 })
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: '未授權' }, { status: 401 })
  }

  const started = Date.now()
  try {
    const results = await runIngest('cron')
    const failed = results.filter((r) => !r.ok)
    const seconds = Math.round((Date.now() - started) / 100) / 10
    return NextResponse.json({
      ok: failed.length === 0,
      seconds,
      total: results.length,
      failed: failed.map((r) => ({ code: r.code, error: r.error })),
      issues: results.flatMap((r) => r.issues ?? []),
    }, { status: failed.length === 0 ? 200 : 500 })
  } catch (e) {
    // 例外也要回 JSON：cron 的紀錄只看得到狀態碼與回應內容
    return NextResponse.json({
      ok: false,
      seconds: Math.round((Date.now() - started) / 100) / 10,
      error: e instanceof Error ? e.message : String(e),
    }, { status: 500 })
  }
}
