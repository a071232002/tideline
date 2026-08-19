import { getWatchlist } from '@/lib/data'
import { NavLink } from '@/components/NavLink'
import { AddSymbolForm } from '@/components/AddSymbolForm'
import { removeSymbol } from './actions'
import { SubmitButton } from '@/components/SubmitButton'
import { LevelInline } from '@/components/LevelStrip'

export const dynamic = 'force-dynamic'

function pct(v: number | null): string {
  if (v === null) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

export default async function HomePage() {
  const rows = await getWatchlist()

  return (
    <main className="wrap">
      <header>
        <h1>觀察清單</h1>
        <p className="sub">
          每天收盤後更新
          <span className="badge">僅供參考，非投資建議</span>
        </p>
      </header>

      <AddSymbolForm />

      {rows.length === 0 ? (
        <div className="card">
          <p className="empty" data-testid="empty-watchlist">
            清單還是空的。上面輸入代號加入第一檔——台股填數字（例如 <b>0050</b>），
            美股填英文代號（例如 <b>NVDA</b>）。
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          {rows.map((r) => (
            <div key={r.symbol_id} className="row" data-testid={`watch-row-${r.code}`}>
              <div>
                <NavLink href={`/${r.market.toLowerCase()}/${r.code}`}
                  style={{ fontWeight: 700, fontSize: '1.05rem' }}>
                  {r.code}
                </NavLink>
                <span className="badge" style={{ marginLeft: 6 }}>
                  {r.market === 'TW' ? '台股' : '美股'}
                </span>
                <div style={{ fontSize: '.8rem', color: 'var(--ink2)', marginTop: 2 }}>
                  {r.name ?? ''}
                </div>
              </div>

              <div className="rprice tnum">
                <span style={{ fontSize: '1.3rem', fontWeight: 700 }}>
                  {r.close === null ? '—' : r.close.toFixed(2)}
                </span>
                <span className={r.chg_pct !== null && r.chg_pct < 0 ? 'down' : 'upc'}
                  style={{ marginLeft: 8, fontSize: '.9rem', fontWeight: 600 }}>
                  {pct(r.chg_pct)}
                </span>
                <div style={{ fontSize: '.75rem', color: 'var(--muted)', marginTop: 2 }}>
                  {r.k !== null && r.d_val !== null
                    ? `K ${r.k.toFixed(1)} / D ${r.d_val.toFixed(1)}`
                    : ''}
                </div>
              </div>

              <div className="rwhy">
                <LevelInline levels={r.levels} />
                <div style={{ fontSize: '.75rem', color: 'var(--muted)', marginTop: 4 }}>
                  {r.tone ?? ''}
                  {r.d ? `　資料日期 ${r.d}` : '　資料未更新'}
                </div>
              </div>

              <form action={removeSymbol}>
                <input type="hidden" name="symbol_id" value={r.symbol_id} />
                <SubmitButton pendingText="移除中…">移除</SubmitButton>
              </form>
            </div>
          ))}
        </div>
      )}

      <form action="/auth/signout" method="post" style={{ marginTop: 24 }}>
        <SubmitButton pendingText="登出中…">登出</SubmitButton>
      </form>
    </main>
  )
}
