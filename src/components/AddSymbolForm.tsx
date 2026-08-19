'use client'
import { useActionState, useState } from 'react'
import { addSymbol } from '@/app/actions'
import { SubmitButton } from './SubmitButton'

/**
 * 市場一定要讓使用者選，不能從代號猜——台股有 00679B 這種帶字母的代號，
 * 美股也有純數字的掛牌，猜錯就是抓錯市場的資料。
 */
export function AddSymbolForm() {
  const [state, action] = useActionState(
    addSymbol, null as { error?: string; ok?: string } | null,
  )
  const [market, setMarket] = useState<'TW' | 'US'>('TW')

  return (
    <form action={action} className="card addform">
      <div className="seg" role="radiogroup" aria-label="市場">
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
        className="input"
        name="code"
        placeholder={market === 'TW' ? '例如 0050' : '例如 NVDA'}
        aria-label="股票代號"
        data-testid="add-code"
        required
      />
      <SubmitButton data-testid="add-submit" pendingText="驗證並抓取中…">加入</SubmitButton>

      {state?.error && (
        <p className="err" role="alert" data-testid="add-error">{state.error}</p>
      )}
      {state?.ok && (
        <p role="status" data-testid="add-ok" className="okmsg">{state.ok}</p>
      )}
    </form>
  )
}
