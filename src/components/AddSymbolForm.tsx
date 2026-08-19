'use client'
import { useActionState, useEffect, useRef, useState } from 'react'
import { addSymbol } from '@/app/actions'
import { SubmitButton } from './SubmitButton'
import { Icon } from './Icon'

/**
 * 市場一定要讓使用者選，不能從代號猜——台股有 00679B 這種帶字母的代號，
 * 美股也有純數字的掛牌，猜錯就是抓錯市場的資料。
 *
 * 手機上預設收起來：375px 下這張表單加上篩選列會吃掉大半個第一屏，
 * 把真正要看的清單推到捲動之後。加入標的是偶爾才做的事，清單是每天看的。
 */
export function AddSymbolForm() {
  const [state, action] = useActionState(
    addSymbol, null as { error?: string; ok?: string } | null,
  )
  const [market, setMarket] = useState<'TW' | 'US'>('TW')
  const [open, setOpen] = useState(false)
  const codeRef = useRef<HTMLInputElement>(null)

  // 展開後直接把游標放進輸入框，少一次點擊
  useEffect(() => { if (open) codeRef.current?.focus() }, [open])
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
    <>
      <button type="button" className="addtoggle" data-testid="add-toggle"
        aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name={open ? 'chevronUp' : 'plus'} />
        <span>{open ? '收起' : '加入標的'}</span>
      </button>

      <form action={action} className={`card addform${open ? '' : ' collapsed'}`}
        data-testid="add-form">
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
    </>
  )
}
