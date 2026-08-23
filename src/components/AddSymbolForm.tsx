'use client'
import { useActionState, useEffect, useRef, useState } from 'react'
import { addSymbol } from '@/app/actions'
import { SubmitButton } from './SubmitButton'
import { Icon } from './Icon'

/**
 * 市場一定要讓使用者選，不能從代號猜——台股有 00679B 這種帶字母的代號，
 * 美股也有純數字的掛牌，猜錯就是抓錯市場的資料。
 *
 * **加入一檔標的只該有一顆按鈕。**
 *
 * 原本手機上有兩顆：一顆「加入標的」把表單展開，再一顆「加入」送出。
 * 收合是為了省空間——量出來這張表單在 375px 下有 138px（市場、輸入框、
 * 送出各佔一列），而收合鈕只要 44px。
 *
 * 但那是在解錯的問題：需要藏起來，是因為表單排成三列。排成一列就只有
 * 44px，跟收合鈕一樣高，沒有東西需要藏，也就不需要那顆按鈕。
 * 手機上順便脫掉卡片的外框與內距——一列輸入不需要一張卡。
 *
 * ## 市場為什麼是下拉，不是分段按鈕
 *
 * 原本是一組「台股｜美股」分段按鈕。問題是清單的市場篩選**也**是一組
 * 「台股｜美股」膠囊，實測相距 33px（y=150 與 y=229）——同樣四個字、
 * 幾乎同樣的形狀，一個決定「要新增哪個市場的標的」，另一個決定
 * 「清單顯示哪些」。以前表單收在按鈕後面看不到，所以不會撞。
 *
 * 換成下拉之後，兩者的**外觀類別**就分開了：下拉是表單欄位，跟旁邊的
 * 代號輸入框是同一類東西；膠囊是導覽，切換的是我看到什麼。形狀不同，
 * 就不必靠讀字去分辨。順帶也拿回鍵盤操作——原本要自己接左右鍵。
 */
export function AddSymbolForm() {
  const [state, action] = useActionState(
    addSymbol, null as { error?: string; ok?: string } | null,
  )
  const [market, setMarket] = useState<'TW' | 'US'>('TW')
  const codeRef = useRef<HTMLInputElement>(null)

  // 加入成功後清空並保持焦點，方便連續加好幾檔
  useEffect(() => {
    if (state?.ok && codeRef.current) {
      codeRef.current.value = ''
      codeRef.current.focus()
    }
  }, [state?.ok])

  return (
    <form action={action} className="card addform" data-testid="add-form">
      <select
        className="input marketsel"
        name="market"
        aria-label="市場"
        data-testid="add-market"
        value={market}
        onChange={(e) => setMarket(e.target.value as 'TW' | 'US')}
      >
        <option value="TW">台股</option>
        <option value="US">美股</option>
      </select>

      <input
        ref={codeRef}
        className="input"
        name="code"
        placeholder={market === 'TW' ? '例如 0050' : '例如 NVDA'}
        aria-label="股票代號"
        data-testid="add-code"
        autoComplete="off"
        required
      />
      <SubmitButton data-testid="add-submit" className="withicon"
        pendingText="驗證並抓取中…">
        <Icon name="plus" /><span>加入</span>
      </SubmitButton>

      {state?.error && (
        <p className="err" role="alert" data-testid="add-error">{state.error}</p>
      )}
      {state?.ok && (
        <p role="status" data-testid="add-ok" className="okmsg">{state.ok}</p>
      )}
    </form>
  )
}
