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

      {/* 標題就是標題。「每日技術分析」「收盤後更新」「指標由程式計算」
          這三句在講同一件事，而且看的人已經知道自己來這裡幹嘛。 */}
      <header className="pagehead">
        <h1>觀察清單</h1>
      </header>

      <AddSymbolForm />
      <WatchList rows={rows} removeAction={removeSymbol} />

      {/* 免責聲明留著（PLAN §9），但放頁尾當細字，不跟標題搶位置。
          真正該顯眼的那份在個股頁的判斷卡裡。 */}
      <p className="footnote">
        指標與價位由程式計算，僅供參考，非投資建議。
      </p>
    </main>
  )
}
