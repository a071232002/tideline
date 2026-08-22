'use client'
import { useActionState } from 'react'
import { SubmitButton } from './SubmitButton'

/**
 * 改本金（PLAN §13.2）。
 *
 * 改完會用新本金**整段重算**，不是把舊結果等比例縮放——台股是整數股，
 * 本金砍半不會讓股數剛好砍半，縮放出來的歷史是假的。
 *
 * 但也不需要清掉任何東西：成交與淨值本來就是推導的，真正的紀錄是規則
 * （純函數）與 AI 那幾天的判斷，兩者換個本金重跑都成立。
 */

/** 低於這個金額，每一筆都會撞到 20 元最低手續費（§13.2 實測） */
const MIN_FEE_FREE_BATCH = 14036

export function CapitalForm({
  symbolId, current, batches = 3, market,
}: {
  symbolId: string
  current: number
  batches?: number
  market: 'TW' | 'US'
}) {
  const [state, action] = useActionState(
    async (_prev: unknown, formData: FormData) => {
      const { setCapital } = await import('@/app/actions')
      return setCapital(_prev, formData)
    },
    null as { ok?: string; error?: string } | null,
  )

  const perBatch = current / batches
  const tight = market === 'TW' && perBatch < MIN_FEE_FREE_BATCH

  return (
    <form action={action} className="capform" data-testid="capital-form">
      <input type="hidden" name="symbol_id" value={symbolId} />
      <label htmlFor={`cap-${symbolId}`}>本金</label>
      {/* step 不限制。原本設 1000 會讓「25,500」這種金額被瀏覽器判定無效，
          而那是完全合理的本金——步進只是方向鍵的便利，不該變成輸入限制。
          （順帶一提，JSX 的屬性之間不能放註解，只能寫在標籤外面。） */}
      <input
        id={`cap-${symbolId}`}
        name="capital"
        type="number"
        inputMode="numeric"
        min={1000}
        step="any"
        defaultValue={current}
        className="input capinput tnum"
        data-testid="capital-input"
        aria-describedby={`caphint-${symbolId}`}
      />
      <span className="capunit">元</span>
      <SubmitButton className="btn" pendingText="重算中…">改本金</SubmitButton>

      <p className="capnote" id={`caphint-${symbolId}`}>
        改完會用新本金整段重算（不是縮放）。
        {tight && (
          <>
            {' '}目前每批 {Math.round(perBatch).toLocaleString('en-US')} 元低於{' '}
            {MIN_FEE_FREE_BATCH.toLocaleString('en-US')}，每一筆都會撞到 20 元最低手續費。
          </>
        )}
      </p>

      {state?.error && <p className="err" data-testid="capital-error">{state.error}</p>}
      {state?.ok && <p className="okmsg" data-testid="capital-ok">{state.ok}</p>}
    </form>
  )
}
