/**
 * 決策條：三個關鍵價位放在最上面，大字、語意色、一眼掃得到。
 *
 * 原本價位只寫在判斷句裡（「反彈 107.50–108.50 減碼、止跌 100.00…」），
 * 那是一段散文——要看的人得先讀完句子才找得到數字。
 * 每天真正要回答的問題只有三個：什麼價位減碼、跌到哪算破線、回到哪可以加。
 * 所以把答案抽出來擺在最前面，敘述退到後面當佐證。
 */

export interface StripLevel {
  kind: 'sell' | 'stop' | 'add'
  lo: number
  hi?: number
}

const META = {
  sell: { label: '波段賣出', hint: '反彈至此減碼', cls: 'sellc', varName: 'sell' },
  stop: { label: '止跌', hint: '收盤跌破轉弱', cls: 'stopc', varName: 'stop' },
  add: { label: '加碼', hint: '回檔至此分批進', cls: 'buyc', varName: 'buy' },
} as const

function money(v: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function LevelStrip({ levels, close }: { levels: StripLevel[]; close: number | null }) {
  if (levels.length === 0) return null

  return (
    <section className="strip" data-testid="level-strip" aria-label="關鍵價位">
      {levels.map((l) => {
        const m = META[l.kind]
        const range = l.hi !== undefined && l.hi !== l.lo
        // 距離現價多遠——決定「還早」還是「就在眼前」
        const gap = close !== null && close !== 0
          ? ((l.lo - close) / close) * 100
          : null
        return (
          <div key={l.kind} className="stripcell" data-testid={`strip-${l.kind}`}
            style={{ borderTopColor: `var(--${m.varName})` }}>
            <div className={`striplab ${m.cls}`}>{m.label}</div>
            <div className={`stripval tnum ${m.cls}`}>
              {money(l.lo)}{range && <span className="striprange">～{money(l.hi!)}</span>}
            </div>
            <div className="striphint">
              {m.hint}
              {gap !== null && (
                <span className="tnum stripgap">
                  {gap >= 0 ? '↑' : '↓'}{Math.abs(gap).toFixed(1)}%
                </span>
              )}
            </div>
          </div>
        )
      })}
    </section>
  )
}

/** 觀察清單用的緊湊版：一列裡把三個價位排開，不要塞一整句散文 */
export function LevelInline({ levels }: { levels: StripLevel[] }) {
  if (levels.length === 0) return <span className="empty">尚無分析資料</span>
  // 固定三欄。用 flex-wrap 的話高價股（2330 約 2350）數字太長會換行，
  // 各列的價位就對不齊，掃過去很難比較。
  const byKind = (k: StripLevel['kind']) => levels.find((l) => l.kind === k)

  return (
    <span className="inlinelvl">
      {(['sell', 'stop', 'add'] as const).map((k) => {
        const l = byKind(k)
        const m = META[k]
        const range = l && l.hi !== undefined && l.hi !== l.lo
        return (
          <span key={k} className="inlinecell">
            <span className="inlinelab">{m.label}</span>
            <span className={`tnum ${m.cls}`} style={{ fontWeight: 700 }}>
              {l ? `${money(l.lo)}${range ? `～${money(l.hi!)}` : ''}` : '—'}
            </span>
          </span>
        )
      })}
    </span>
  )
}
