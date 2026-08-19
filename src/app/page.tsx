import { getWatchlist, getFreshness } from '@/lib/data'
import { AddSymbolForm } from '@/components/AddSymbolForm'
import { WatchList } from '@/components/WatchList'
import { TopBar } from '@/components/TopBar'
import { removeSymbol } from './actions'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const [rows, fresh] = await Promise.all([getWatchlist(), getFreshness()])

  return (
    <main className="wrap">
      <TopBar fresh={fresh} />

      <header className="pagehead">
        <span className="eyebrow">每日技術分析</span>
        <h1>觀察清單</h1>
        <p className="sub">
          收盤後更新，指標與價位由程式計算
          <span className="badge">僅供參考，非投資建議</span>
        </p>
      </header>

      <AddSymbolForm />
      <WatchList rows={rows} removeAction={removeSymbol} />
    </main>
  )
}
