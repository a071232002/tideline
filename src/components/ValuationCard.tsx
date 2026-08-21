import type { StockPage } from '@/lib/data'

/**
 * 估值卡。**刻意獨立、刻意放在價位之後。**
 *
 * 本益比回答「現在貴不貴」，上面的三個價位回答「現在在哪裡」——
 * 兩者用的是完全不同的邏輯，混在一起出錯時分不出是哪一邊錯（PLAN §4）。
 * 所以這張卡不影響任何價位，卡上也明說。
 */
export function ValuationCard({
  valuation, market, code,
}: {
  valuation: StockPage['valuation']
  market: 'TW' | 'US'
  code: string
}) {
  const isEtf = market === 'TW' && /^00/.test(code)

  const items: { label: string; value: string; hint?: string }[] = []
  if (valuation) {
    items.push({
      label: '本益比',
      value: valuation.pe === null ? '—' : valuation.pe.toFixed(2),
      hint: valuation.pe === null ? '虧損或無資料' : undefined,
    })
    if (valuation.forwardPe !== null) {
      items.push({ label: '預估本益比', value: valuation.forwardPe.toFixed(2) })
    }
    items.push({
      label: '股價淨值比',
      value: valuation.pb === null ? '—' : valuation.pb.toFixed(2),
    })
    items.push({
      label: '殖利率',
      value: valuation.dividendYield === null ? '—' : `${valuation.dividendYield.toFixed(2)}%`,
    })
  }

  // 沒有估值資料時整張卡只剩一句「這裡沒有東西」——實測手機上 123px 高、
  // 內容 29 個字。那正是 PLAN §3 要避開的「每個區塊都配一句文案」。
  // 標題與正文併成一行，卡片高度砍半，該說的原因一個字都沒少。
  if (items.length === 0) {
    return (
      <section className="card cardline" data-testid="valuation-card">
        <h2>估值</h2>
        <p className="empty" data-testid="valuation-empty">
          {isEtf
            ? 'ETF 由一籃子成分股組成，沒有單一的本益比與淨值比。'
            : '目前沒有估值資料——可能是尚未抓到，或這檔標的的來源沒有提供。'}
        </p>
      </section>
    )
  }

  return (
    <section className="card" data-testid="valuation-card">
      <h2>估值</h2>

      {items.length > 0 ? (
        <>
          <div className="valgrid">
            {items.map((it) => (
              <div key={it.label} className="valcell">
                <div className="lab">{it.label}</div>
                <div className="valnum tnum">{it.value}</div>
                {it.hint && <div className="valhint">{it.hint}</div>}
              </div>
            ))}
          </div>
          <p className="fine" data-testid="valuation-note">
            估值資料來自{market === 'TW' ? ' TWSE 個股本益比' : ' Yahoo Finance'}
            {valuation?.d ? `（${valuation.d}）` : ''}。
            <b>這些數字不參與上面的價位計算</b>——關鍵價位來自價格結構，估值只是另一個參考面向。
          </p>
        </>
      ) : (
        <p className="empty" data-testid="valuation-empty">
          {isEtf
            ? 'ETF 由一籃子成分股組成，沒有單一的本益比與淨值比。'
            : '目前沒有估值資料——可能是尚未抓到，或這檔標的的來源沒有提供。'}
        </p>
      )}
    </section>
  )
}
