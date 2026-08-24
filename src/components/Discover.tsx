import type { Recommendation } from '@/lib/data'
import { SubmitButton } from './SubmitButton'
import { Icon } from './Icon'

/**
 * 「今天值得看一眼」——AI 從全球資訊挑的，不是從你的清單挑的。
 *
 * ## 這一區跟站上其他數字的保證不一樣，而且必須說出來
 *
 * 清單與個股頁的每個價位都是我們自己從 K 棒算出來的，AI 引用的每個數字
 * 都經過驗證器比對。**這一區沒有。** 題材是模型上網查到的，裡面的
 * 「營收年增 85%」我們驗不了——它不在我們的資料庫裡。
 *
 * 我們驗的是另外兩件事：代號**真的存在**（過 Yahoo 一次），敘述**帶著
 * 來源網址**。所以每一列都掛著出處，而區塊開頭一句話講清楚界線。
 * 兩種保證長得像但不是同一種，讀者有權知道自己在看哪一種。
 *
 * ## 排序不是熱度
 *
 * 題材只負責**發現**（把視野推出使用者自己的清單）；排在前面的是
 * 「以這個站的規則現在價位進得去」的那些——回檔到加碼區、%b 在中軌以下、
 * KD 在低檔。所以每一列都要把那幾個數字印出來，讀者才看得出為什麼是它。
 *
 * 標題因此不能寫「今日精選」。最熱的那幾檔常常正好被排除（實測 8 檔美股
 * 候選有 6 檔跌破季線），那不是漏掉，是這一區的定義。
 *
 * ## 為什麼放在清單下面
 *
 * 清單是每天要看的，這一區是偶爾逛的。之前花了五輪把第一屏從 1482px
 * 壓到 1307px，不該為了一個新功能又推回去。
 */

const n2 = (v: number): string =>
  v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const MARKET = { TW: '台股', US: '美股' } as const

export function Discover({ items, addAction }: {
  items: Recommendation[]
  addAction: (formData: FormData) => void
}) {
  if (items.length === 0) return null

  const byMarket = (m: 'TW' | 'US') => items.filter((r) => r.market === m)
  const asOf = items[0]!.d

  return (
    <section className="discover" data-testid="discover">
      <div className="dischead">
        {/* 不叫「今日精選」也不叫「熱門」：最熱的那幾檔常常正好被排除
            （實測 8 檔美股候選有 6 檔跌破季線）。名字要對得起篩選規則。 */}
        <h2>值得看一眼</h2>
        <span className="fine">
          {/* 界線就寫在這裡，而且要**精確**。
              上一版寫「還沒有經過這個站的價位分析」——那句話在排序改成用
              站上指標之後就變成錯的了。現在的界線在另一個地方：
              下面那行數字是我們算的，題材那句話裡的數字不是。 */}
          AI 從新聞找標的，<b>排序用這個站自己算的指標</b>（回檔到加碼區、%b 低、KD 低檔）。
          題材那句話裡的數字來自新聞，未經驗證，請看出處・{asOf}
        </span>
      </div>

      {(['TW', 'US'] as const).map((m) => {
        const list = byMarket(m)
        if (list.length === 0) return null
        return (
          <div key={m} className="discgroup">
            <div className="disclab">{MARKET[m]}</div>
            <ul className="disclist">
              {list.map((r) => (
                <li key={`${r.market}-${r.code}`} data-testid={`disc-${r.code}`}>
                  <div className="dischd">
                    <span className="disccode tnum">{r.code}</span>
                    {r.name && <span className="discname">{r.name}</span>}
                    {r.tracked ? (
                      <span className="discmine">追蹤中</span>
                    ) : (
                      <form action={addAction} className="discadd">
                        <input type="hidden" name="market" value={r.market} />
                        <input type="hidden" name="code" value={r.code} />
                        <SubmitButton className="linkbtn" pendingText="加入中…">
                          <Icon name="plus" /><span>加入追蹤</span>
                        </SubmitButton>
                      </form>
                    )}
                  </div>
                  {/* **我們自己算的**那幾個數字。它們才是排序的依據，
                      所以排在題材之前——題材是為什麼被發現，這行是為什麼被排這裡。 */}
                  {r.facts && (
                    <div className="discfacts tnum">
                      <span>收 {n2(r.facts.close)}</span>
                      <span>%b {r.facts.pctB.toFixed(2)}</span>
                      <span>K {r.facts.k.toFixed(0)}</span>
                      <span>加碼 ~{n2(r.facts.add.hi)}</span>
                    </div>
                  )}
                  <p className="disctheme">
                    {r.theme}{' '}
                    {/* 出處貼著題材，不是另起一行——它是這半邊唯一的保證 */}
                    <a className="discsrc" href={r.source}
                      target="_blank" rel="noopener noreferrer">出處</a>
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </section>
  )
}
