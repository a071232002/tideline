import { getWatchlist, getFreshness } from '@/lib/data'
import { AddSymbolForm } from '@/components/AddSymbolForm'
import { WatchList } from '@/components/WatchList'
import { SubmitButton } from '@/components/SubmitButton'
import { removeSymbol } from './actions'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const [rows, fresh] = await Promise.all([getWatchlist(), getFreshness()])

  return (
    <main className="wrap">
      <header className="pagehead">
        <h1>觀察清單</h1>
        <p className="sub">
          {/* 全域狀態：排程沒跑的時候要在這裡講，不能讓每列各自顯示舊日期矇混過去 */}
          <span className={`freshness tone-${fresh.tone}`} data-testid="freshness"
            data-kind={fresh.kind}>
            {fresh.message}
          </span>
          <span className="badge">僅供參考，非投資建議</span>
        </p>
      </header>

      <AddSymbolForm />
      <WatchList rows={rows} removeAction={removeSymbol} />

      <form action="/auth/signout" method="post" style={{ marginTop: 24 }}>
        <SubmitButton className="btnquiet" pendingText="登出中…">登出</SubmitButton>
      </form>
    </main>
  )
}
