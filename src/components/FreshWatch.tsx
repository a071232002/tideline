'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { shouldRefresh } from '@/lib/fresh-stamp'

/**
 * 資料更新了就自己更新畫面，不要等使用者按重新整理。
 *
 * ## 這解的是哪一個情境
 *
 * 這個站的資料一天更新兩次，都在清晨：抓取跑在 Vercel Cron，AI 判斷
 * 跑在本機排程。而最常見的使用方式是**分頁一直開著**——隔天早上回到
 * 那個分頁，看到的是昨天的畫面，上面沒有任何東西說「這是舊的」。
 * 使用者沒有理由知道該按 F5。
 *
 * ## 為什麼主要靠「回到分頁」而不是計時器
 *
 * 一天兩次的更新配上每分鐘一次的輪詢，是 1,438 次白問。而真正要接住的
 * 那一刻就是「人回到這個分頁」——`visibilitychange` 精確地就是那一刻。
 * 計時器仍然留著（可見時每五分鐘一次），為的是另一種人：整天開著螢幕
 * 不切分頁的。
 *
 * ## 為什麼是 router.refresh() 而不是 location.reload()
 *
 * `refresh()` 只重新取伺服器元件並就地調和，**client 元件的狀態留著**：
 * 打到一半的搜尋字、展開的區塊、`useActionState` 裡改本金的成功訊息。
 * 整頁重載會把這些全部丟掉——那是拿一個使用者沒要求的動作去破壞他
 * 正在做的事。（這裡特別小心：先前加 loading.tsx 引進 Suspense 邊界時，
 * 重新驗證會讓 client 元件重新掛載，改本金的成功訊息因此不會渲染。）
 *
 * ## 為什麼要說一聲
 *
 * 畫面上的數字自己變了而沒有任何說明，讀起來像故障。一行小字停幾秒，
 * 講清楚剛才發生的是更新不是錯亂。`role="status"` 讓螢幕閱讀器也聽得到。
 */

/** 可見時每隔多久問一次。一天只更新兩次，密集輪詢是純浪費 */
const POLL_MS = 5 * 60_000

export function FreshWatch() {
  const router = useRouter()
  const [updated, setUpdated] = useState(false)
  // 用 ref 不用 state：指紋變動不該觸發重新渲染，它只是拿來比對的
  const seen = useRef<string | null>(null)
  // 拿不到（沒登入、離線、部署到一半）就停手，不要每五分鐘重試一次失敗
  const stopped = useRef(false)

  useEffect(() => {
    let alive = true

    const check = async () => {
      if (stopped.current || document.visibilityState !== 'visible') return
      let stamp = ''
      try {
        const res = await fetch('/api/fresh', { cache: 'no-store' })
        if (!res.ok) { stopped.current = true; return }
        stamp = String(((await res.json()) as { stamp?: unknown }).stamp ?? '')
      } catch {
        // 離線或請求被中斷。當作沒事——重整本身也要網路，此刻做只會更糟
        return
      }
      if (!alive || stamp === '') return

      if (shouldRefresh(seen.current, stamp)) {
        // **先記下來再重整。** 反過來的話 refresh 期間又輪詢一次，
        // 會看到同一個新指紋、再重整一次，然後停不下來。
        seen.current = stamp
        router.refresh()
        setUpdated(true)
        setTimeout(() => { if (alive) setUpdated(false) }, 6000)
        return
      }
      seen.current = stamp
    }

    void check()
    const timer = setInterval(() => void check(), POLL_MS)
    const onVisible = () => void check()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)

    return () => {
      alive = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [router])

  if (!updated) return null
  return (
    <div className="freshtoast" role="status" aria-live="polite" data-testid="fresh-toast">
      資料已更新
    </div>
  )
}
