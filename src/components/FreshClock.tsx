'use client'
import { useEffect, useState } from 'react'
import {
  agoText, nextScheduledIngest, lastScheduledIngest,
  SCHEDULE_GRACE_MS, SCHEDULE_SLACK_MS,
} from '@/lib/schedule'

/**
 * 「這份資料是什麼時候抓的、下次什麼時候、現在是新的還是舊的。」
 *
 * ## 為什麼一定要在 client 算
 *
 * 「3 小時前」如果在伺服器算，會被 `unstable_cache` 連同頁面一起凍住——
 * 畫面上會有一個**永遠停在「3 小時前」**的相對時間。一個假的新鮮度指標
 * 比沒有指標更糟：沒有的時候人會去別處確認，有的時候人會相信它。
 *
 * 所以伺服器只給事實（抓取時間的 ISO），這裡負責「現在幾點」。
 * 每分鐘重算一次，分頁放著也不會過期。
 *
 * ## 為什麼「下次」要寫「前後」
 *
 * Vercel Hobby 的 cron 只保證在該小時內觸發，不保證準時。實測排 07:30
 * 實際 07:58（遲 28 分）、排 14:30 實際 14:28（早 2 分）。寫死「14:30」
 * 的話，它遲到二十分鐘你就會以為壞了——而那是它正常的行為。
 *
 * ## 手機只在異常時顯示
 *
 * 這一行的用途是回答疑問，而正常狀態不會產生疑問。手機頂欄先前花了
 * 五輪從 171px 壓到 53px，不該為了一句「一切正常」再加回一行。
 * 延遲的時候就不一樣了——那正是你會想知道的時刻，所以那時兩邊都顯示。
 */
export function FreshClock({ fetchedAtIso }: { fetchedAtIso: string | null }) {
  // 伺服器與第一次 client render 必須一致，否則 hydration 會抱怨。
  // 先渲染 null，掛載之後才有「現在」。
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  if (now === null || fetchedAtIso === null) return null

  const fetched = Date.parse(fetchedAtIso)
  const nowDate = new Date(now)
  const next = nextScheduledIngest(nowDate)
  const expected = lastScheduledIngest(nowDate)

  /**
   * 延遲的判斷跟健檢用的是同一條線（`schedule.ts`）：過了上一個時點加寬限，
   * 而最後一次成功早於那個時點。各寫一套的話，畫面說正常而健檢說延遲，
   * 兩邊都會失去可信度。
   */
  const late = now >= expected.getTime() + SCHEDULE_GRACE_MS
    && fetched < expected.getTime() - SCHEDULE_SLACK_MS

  const hhmm = (d: Date) =>
    new Date(d.getTime() + 8 * 3600_000).toISOString().slice(11, 16)

  if (late) {
    return (
      <span className="freshclock late" data-testid="fresh-clock" data-late="1">
        已延遲 {agoText(now - expected.getTime()).replace('前', '')}
        ・最後更新 {hhmm(new Date(fetched))}（{agoText(now - fetched)}）
      </span>
    )
  }

  return (
    <span className="freshclock wide-only" data-testid="fresh-clock" data-late="0">
      更新於 {hhmm(new Date(fetched))}（{agoText(now - fetched)}）
      ・下次 {hhmm(next)} 前後
    </span>
  )
}
