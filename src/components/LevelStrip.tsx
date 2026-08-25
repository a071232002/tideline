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
  /** 這個價位是怎麼來的。原本另開一張「關鍵價位」卡放它，
      但那張卡把同一組數字又印了一次——理由跟著數字走就好。 */
  why?: string
}

const META = {
  // `short` 給清單用：標籤要貼著數字，一個字就夠，不需要把「波段賣出」搬過去
  sell: { label: '波段賣出', short: '賣', hint: '反彈至此減碼', cls: 'sellc', varName: 'sell' },
  stop: { label: '止跌', short: '止', hint: '收盤跌破轉弱', cls: 'stopc', varName: 'stop' },
  add: { label: '加碼', short: '加', hint: '回檔至此分批進', cls: 'buyc', varName: 'buy' },
} as const

function money(v: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function LevelStrip({ levels, close }: { levels: StripLevel[]; close: number | null }) {
  if (levels.length === 0) return null

  const whys = levels.filter((l) => l.why)

  return (
    <>
    <section className="strip" data-testid="level-strip" aria-label="關鍵價位">
      {levels.map((l) => {
        const m = META[l.kind]
        const range = l.hi !== undefined && l.hi !== l.lo
        /**
         * 距離現價多遠——決定「還早」還是「就在眼前」。
         *
         * **量到區間比較近的那一邊**，跟頁首那顆狀態徽章同一條規則
         * （`status.ts` 的 near-add）。
         *
         * 原本一律量下緣，於是 0050 的膠囊寫「接近加碼區 −1.3%」（算到
         * 上緣 103.00），下面的加碼卡寫「↓2.3%」（算到下緣 102.00）——
         * 同一個問題兩個答案，相隔 300px。兩個都對，但讀者會以為其中
         * 一個是錯的。
         */
        const near = l.hi !== undefined && close !== null && close > l.hi ? l.hi : l.lo
        const gap = close !== null && close !== 0
          ? ((near - close) / close) * 100
          : null
        return (
          <div key={l.kind} className="stripcell" data-testid={`strip-${l.kind}`}
            style={{ borderTopColor: `var(--${m.varName})` }}>
            <div className={`striplab ${m.cls}`}>{m.label}</div>
            <div className={`stripval tnum ${m.cls}`}>
              {money(l.lo)}{range && <span className="striprange">～{money(l.hi!)}</span>}
            </div>
            <div className="striphint">
              {/* 手機上只留距離。「波段賣出／反彈至此減碼」是同一句話說兩次，
                  而下面的「為什麼是這些價位」本來就在解釋這件事。 */}
              <span className="hinttext">{m.hint}</span>
              {gap !== null && (
                <span className="tnum stripgap">
                  {gap >= 0 ? '↑' : '↓'}{Math.abs(gap).toFixed(1)}%
                </span>
              )}
            </div>
            {/* 「為什麼」在桌機留在卡內，手機收到下面的摺疊區——
                手機上三段理由佔 144px，而決策條整個已經吃掉第一屏的 65%。
                它必須留著（是使用者要求的），但不必永遠攤開。 */}
            {l.why && <p className="stripwhy wide-only">{l.why}</p>}
          </div>
        )
      })}
    </section>

    {/* 手機專用：三段理由收成一個摺疊區。桌機那邊卡內已經有了，不重複。 */}
    {whys.length > 0 && (
      <details className="stripwhys narrow-only" data-testid="strip-whys">
        <summary>為什麼是這些價位</summary>
        <dl>
          {whys.map((l) => (
            <div key={l.kind}>
              <dt className={META[l.kind].cls}>{META[l.kind].label}</dt>
              <dd>{l.why}</dd>
            </div>
          ))}
        </dl>
      </details>
    )}
    </>
  )
}

/**
 * 觀察清單用的緊湊版。
 *
 * **只給會動作的那一邊，不給整個區間。** 三個價位在清單上原本各印一段
 * 「228.00～230.00」，三欄加起來佔掉整列的 44%（實測 404/926px），
 * 把真正的決策資訊擠到 16%。
 *
 * 而區間的另一邊在清單上是用不到的：
 *   賣出區看**下緣**——那是第一道壓力，碰到就開始減碼
 *   加碼區看**上緣**——回到這裡以下才進場
 *   止跌本來就是單一價位
 *
 * 完整區間留在個股頁的決策條上，那裡才是要細看的地方。
 */
const EDGE: Record<StripLevel['kind'], 'lo' | 'hi'> = {
  sell: 'lo', stop: 'lo', add: 'hi',
}

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
        const edge = l ? (EDGE[k] === 'hi' && l.hi !== undefined ? l.hi : l.lo) : null
        const isRange = l !== undefined && l.hi !== undefined && l.hi !== l.lo
        return (
          <span key={k} className={`inlinecell ${m.cls}`}
            title={isRange ? `${m.label} ${money(l!.lo)}～${money(l!.hi!)}` : m.label}>
            {/* 標籤貼著數字，不再排成三小欄。
                子網格會逼出固定寬度（實測 264px），而三個帶標籤的數字
                一行就放得下——標籤貼著數字，每個數字自己說得出自己是什麼，
                不需要靠欄位對齊來解釋。 */}
            <span className="inlinelab">{m.short}</span>
            <span className="tnum inlineval">
              {edge === null ? '—' : money(edge)}
              {isRange && <span className="edgemark" aria-hidden="true">
                {EDGE[k] === 'lo' ? '↑' : '↓'}
              </span>}
            </span>
          </span>
        )
      })}
    </span>
  )
}
