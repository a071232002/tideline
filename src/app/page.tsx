import { getWatchlist } from '@/lib/data'
import { AddSymbolForm } from '@/components/AddSymbolForm'
import { WatchList } from '@/components/WatchList'
import { SubmitButton } from '@/components/SubmitButton'
import { removeSymbol } from './actions'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const rows = await getWatchlist()

  return (
    <main className="wrap">
      <header className="pagehead">
        <h1>觀察清單</h1>
        <p className="sub">
          每天收盤後更新
          <span className="badge">僅供參考，非投資建議</span>
        </p>
      </header>

      <AddSymbolForm />
      <WatchList rows={rows} removeAction={removeSymbol} />

      <form action="/auth/signout" method="post" style={{ marginTop: 24 }}>
        <SubmitButton pendingText="登出中…">登出</SubmitButton>
      </form>
    </main>
  )
}
