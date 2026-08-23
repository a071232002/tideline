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

  /** 左右鍵切市場——手已經在鍵盤上就不必移到滑鼠 */
  function onSegKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      setMarket((m) => (m === 'TW' ? 'US' : 'TW'))
    }
  }

  return (
    <form action={action} className="card addform" data-testid="add-form">
      <div className="seg" role="radiogroup" aria-label="市場" onKeyDown={onSegKey}>
        {(['TW', 'US'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={market === m}
            data-testid={`market-${m}`}
            className={`segbtn${market === m ? ' on' : ''}`}
            onClick={() => setMarket(m)}
          >
            {m === 'TW' ? '台股' : '美股'}
          </button>
        ))}
      </div>
      <input type="hidden" name="market" value={market} />

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
