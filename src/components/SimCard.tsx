import type { SimTrack } from '@/lib/data'
import { Icon } from './Icon'

/**
 * 模擬帳戶（PLAN §13.7）。
 *
 * 兩個設計決定，兩個都是為了不讓人誤讀自己的績效：
 *
 * 一、**報酬率一定要跟買進持有並排，字級一樣大。** 大盤漲 10% 而你賺 4%，
 *     那不是準，是拖後腿。只放單一個報酬率等於鼓勵自己誤讀，所以
 *     「準不準」的答案掛在**超額報酬**上，不是報酬率本身。
 *
 * 二、**「明天開盤將執行」放在最上面。** 最後一天的訊號還沒成交——
 *     那不是缺陷，那是這張卡唯一可以照做的東西。其餘都是歷史。
 */

const LABEL: Record<SimTrack['track'], string> = {
  ai: 'AI', rule: '規則', hold: '買進持有',
}

const pct = (v: number | null) =>
  v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`

const money = (v: number, currency: string) =>
  currency === 'TWD'
    ? Math.round(v).toLocaleString('en-US')
    : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function pendingText(p: NonNullable<SimTrack['pending']>): string {
  const why = p.triggers.includes('stop') ? '跌破止跌'
    : p.triggers.includes('sell_zone') ? '觸及賣出區'
    : p.triggers.includes('add') ? '回到加碼區'
    : p.triggers.join('、')
  if (p.buy && p.sell) return `買賣相抵後的淨額（${why}）`
  if (p.sell) return `賣出${p.triggers.includes('stop') ? '全部' : '一半'}持股（${why}）`
  return `買進一批（${why}）`
}

export function SimCard({ tracks, market }: { tracks: SimTrack[]; market: 'TW' | 'US' }) {
  if (tracks.length === 0) return null

  const by = (t: SimTrack['track']) => tracks.find((x) => x.track === t)
  const rule = by('rule')
  const hold = by('hold')
  const ai = by('ai')
  if (!rule || !hold) return null

  // AI 那條不能回補（§13.1 四），所以上線前它是空的。空的時候不要假裝有績效
  const aiLive = ai !== undefined && ai.trades > 0
  const lead = aiLive ? ai! : rule
  const excess = lead.retPct - hold.retPct

  const cur = rule.currency
  const inMarketPct = rule.totalDays > 0
    ? Math.round((rule.daysInMarket / rule.totalDays) * 100) : 0
  const feePct = rule.initialCash > 0 ? (rule.totalFees / rule.initialCash) * 100 : 0

  // 每批買不到 14,036 元就一直在撞最低手續費，那不是在測規則是在測手續費（§13.2）
  const perBatch = rule.initialCash / 3
  const tooSmall = market === 'TW' && perBatch < 14036

  return (
    <section className="card sim" data-testid="sim-card">
      <div className="simhead">
        <h2>模擬帳戶</h2>
        <span className="fine tnum">本金 {money(lead.initialTwd, 'TWD')} 元／{LABEL[lead.track]}</span>
      </div>

      {lead.pending ? (
        <p className="simnext" data-testid="sim-pending">
          <Icon name="chevronUp" />
          <b>明日開盤將執行</b>
          <span>{pendingText(lead.pending)}</span>
        </p>
      ) : (
        <p className="simnext quiet" data-testid="sim-pending">
          <b>明日開盤</b><span>不動作</span>
        </p>
      )}

      <div className="simscores">
        <div className="simscore lead">
          <div className="lab">{LABEL[lead.track]}</div>
          <div className={`num tnum ${lead.retPct >= 0 ? 'chg-up' : 'chg-down'}`}
            data-testid="sim-ret">{pct(lead.retPct)}</div>
        </div>
        <div className="simscore">
          <div className="lab">買進持有</div>
          <div className={`num tnum ${hold.retPct >= 0 ? 'chg-up' : 'chg-down'}`}
            data-testid="sim-hold">{pct(hold.retPct)}</div>
        </div>
        <div className="simscore">
          {/* 「準不準」的答案在這一格，不在左邊那格 */}
          <div className="lab">超額</div>
          <div className={`num tnum ${excess >= 0 ? 'chg-up' : 'chg-down'}`}
            data-testid="sim-excess">{pct(excess)}</div>
        </div>
      </div>

      <p className="simwhy">
        {excess >= 0
          ? '贏過買進持有——這段期間進出是有意義的。'
          : '輸給買進持有——這段期間不如什麼都不做。'}
        {aiLive || !ai ? '' : '　AI 軌道尚未累積資料（不回補，只能從上線那天開始長）。'}
      </p>

      <dl className="simstats tnum">
        <div><dt>持股</dt><dd>{market === 'TW' ? Math.round(lead.shares) : lead.shares.toFixed(4)} 股</dd></div>
        <div><dt>現金</dt><dd>{money(lead.cash, cur)}</dd></div>
        <div><dt>在市</dt><dd>{lead.daysInMarket}/{lead.totalDays} 天（{inMarketPct}%）</dd></div>
        <div><dt>交易</dt><dd>{lead.trades} 次</dd></div>
        <div><dt>費用</dt><dd>{money(rule.totalFees, cur)}（{feePct.toFixed(2)}%）</dd></div>
      </dl>

      {lead.recent.length > 0 && (
        <table className="simtrades tnum">
          <tbody>
            {lead.recent.map((t) => (
              <tr key={`${t.signalD}-${t.side}`}>
                <td>{t.fillD.slice(5)}</td>
                <td className={t.side === 'buy' ? 'chg-down' : 'chg-up'}>
                  {t.side === 'buy' ? '買' : '賣'}
                </td>
                <td>{market === 'TW' ? Math.round(t.qty) : t.qty.toFixed(4)}</td>
                <td>{t.price.toFixed(2)}</td>
                <td className="quiet">{t.triggers.join('+')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tooSmall && (
        <p className="simwarn" data-testid="sim-too-small">
          本金過小：每批 {money(perBatch, cur)} 元低於 14,036，
          每一筆都會撞到 20 元最低手續費（實際費率 {((20 / perBatch) * 100).toFixed(2)}%，
          標準費率的 {(20 / perBatch / 0.001425).toFixed(1)} 倍）。建議至少 50,000 元。
        </p>
      )}

      <p className="fine" data-testid="sim-assumptions">
        次日開盤成交・含手續費與證交稅・未計滑價
        {market === 'TW' ? '・以零股計算・配息以現金入帳（未扣股利所得稅與二代健保）' : '・允許小數股'}
        ・樣本 {rule.totalDays} 個交易日・<b>不代表實際可獲得之報酬</b>
      </p>
    </section>
  )
}
