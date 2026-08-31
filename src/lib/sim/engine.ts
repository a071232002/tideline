import type { Bar } from '../types'
import type { Market } from '../levels'
import type { FeeParams } from './params'
import { affordableQty, buyFee, isDust, roundQty, sellCost } from './fees'

/**
 * 模擬帳戶引擎（PLAN §13）。
 *
 * 一天一根 K 棒走過去，把決策變成成交、把成交變成一條資金曲線。
 * 三條軌道（規則／AI／買進持有）共用這一份，差別只在傳進來的 `Decider`。
 *
 * ## 這個檔案裡最重要的一行
 *
 *   **訊號在第 i 天收盤後產生，成交在第 i+1 天。**
 *
 * 用第 i 天的收盤價成交是紙上交易最容易造假的一點，而且造假不會有任何錯誤訊息。
 * 我們的訊號是收盤後才算出來的（§7：台北 09:30 前才看得到），
 * 那個時候當天的收盤價早就成交完了。尤其止損那一筆——用當天收盤成交等於
 * 「跌破的瞬間就跑掉了」，實際上你隔天開盤才跑得掉，而跌破後的隔天常常跳空低開。
 *
 * 代價是最後一天的訊號還沒成交，留在 `pending`。那不是缺點，
 * 那正好就是頁面上要顯示的「**明天要送的單**」——一句可以照做的指令。
 *
 * ## 隔天怎麼成交：市價 vs 限價
 *
 * 訂單可以帶 `buyLimit` / `sellLimit`。**帶了就是限價單，沒帶就是開盤市價單。**
 *
 * 這一條是修一個對不起來的地方，不是加功能。規則軌的加碼與減碼觸發的是
 * **盤中價位**——「今日最低進了加碼區」、「今日最高碰到賣出區」——但成交
 * 一律排在次日開盤，於是那個觸發它的價位從來沒有真的成交過。碰到加碼區
 * 之後彈回去就買在加碼區上方，碰到賣出區之後回落就賣在賣出區下方，
 * **兩邊都往不利的方向偏，而且不會有任何錯誤訊息。**
 *
 * 真人拿到「明天回到 96.80 買進」這句話，會去券商掛一張 96.80 的限價單，
 * 不會用市價追。限價是**今天就決定的**，所以沒有偷看未來——這是它跟
 * 「用當日收盤成交」的分界。沒碰到就不成交，那張單當天過期；訊號如果
 * 還成立，隔天的 decider 會再送一次。
 *
 * 哪些單不掛限價，見 `rules.ts`：止損（要跑就跑，不跟市場討價還價）、
 * 底倉（配置決定，不是價格決定）、AI（它沒有欄位可以填價格，§13.5）。
 *
 * ## 一天之內的順序
 *
 *   1. 公司行動（配息／分割）——用**開盤成交前**的持股計算
 *   2. 成交前一天的訂單，成交價 = 今天的開盤
 *   3. 產生今天的訊號，留到明天
 *   4. 用今天的收盤結算淨值
 *
 * 第 1 步在第 2 步之前，是因為除息日當天才買進的人領不到那次配息。
 */

export interface AccountState {
  cash: number
  shares: number
  /** 持股的總成本（含買進手續費）。批次額度用它算，不是數買過幾次 */
  cost: number
}

/**
 * 一天的決策。買與賣可以同時出現——寬幅震盪的日子最高價碰到賣出區、
 * 最低價碰到加碼區是會發生的——引擎會把它們**相抵成一筆**。
 */
export interface Order {
  /** 想投入的現金金額。實際買幾股由引擎按成交價與現金算 */
  buyCash?: number
  /** 想賣掉的持股比例，0..1 */
  sellFraction?: number
  /**
   * 買進的限價。給了就是「明天掛這個價位」：開盤已經在它之下就用開盤價
   * （撿到更好的），否則要盤中最低碰到才成交，沒碰到就當天過期。
   * 不給就是開盤市價。
   */
  buyLimit?: number
  /** 賣出的限價。規則同上，方向相反（開盤高於它就用開盤價，否則等最高碰到） */
  sellLimit?: number
  triggers: string[]
  reason?: string
  decidedBy: 'rule' | 'ai'
  confidence?: string
  /** AI 選擇抱過止跌價位。不擋，但記分（§13.5） */
  overrodeStop?: boolean
}

export interface DayContext {
  index: number
  bar: Bar
  /** 這一天開盤成交**之後**的帳戶狀態 */
  state: Readonly<AccountState>
}

export type Decider = (ctx: DayContext) => Order | null

export interface SimConfig {
  market: Market
  isEtf: boolean
  initialCash: number
  fees: FeeParams
  actions: CorporateAction[]
}

export interface CorporateAction {
  date: string
  kind: 'dividend' | 'split'
  /** 配息＝每股金額；分割＝1 股變幾股 */
  amount: number
}

export interface Trade {
  signalD: string
  fillD: string
  side: 'buy' | 'sell'
  qty: number
  price: number
  fee: number
  tax: number
  triggers: string[]
  reason?: string
  decidedBy: 'rule' | 'ai'
  confidence?: string
  overrodeStop: boolean
  /**
   * 賣出當下的每股平均成本；買進是 null。
   *
   * 存這個是為了回顧頁能算「幾次裡幾次賺錢」。事後用其他方式回推都會失真——
   * 部位是分批建的，成本基礎只有成交當下知道。
   */
  costBasis: number | null
}

export interface EquityPoint {
  d: string
  cash: number
  shares: number
  /** 持股總成本（含買進手續費）。問 AI 之前要告訴它自己是賺是賠 */
  cost: number
  mark: number
  equity: number
  retPct: number
}

/**
 * 明天要送出的一張單。
 *
 * 給數字不是為了精確，是為了讓這一行真的能照做：「明日買進一批」沒有股數
 * 也沒有價位，讀完還是不知道要在券商輸入什麼。
 *
 * 限價單的 `refPrice` 就是限價本身——那不是估的，是明天真的要輸入的數字。
 * 市價單只能用**今日收盤**當參考價，明天的開盤不會剛好等於它，所以要標明
 * 是估算。假裝精確更糟，但完全不給數字等於這一行沒有用。
 */
export interface PendingEstimate {
  side: 'buy' | 'sell'
  /** 限價單＝限價（照著輸入就對了）；市價單＝今日收盤（只是估） */
  refPrice: number
  /** 掛單價。市價單是 null——沒有價位可以輸入，就是開盤有什麼吃什麼 */
  limit: number | null
  qty: number
  amount: number
}

export interface PendingOrder {
  signalD: string
  order: Order
  /**
   * 明天要送的單。不動作、或算出來連一股都買不到時是空陣列——不要生一個 0 出來。
   *
   * 是陣列而不是單一物件，因為**限價不同的買單與賣單會各自成交**，
   * 那是兩張單不是一張。只有兩邊價格相同時才會相抵成一筆（見 `fill`）。
   */
  estimates: PendingEstimate[]
}

export interface SimResult {
  trades: Trade[]
  equity: EquityPoint[]
  /** 最後一天的訊號，還沒成交。這就是頁面上的「明天開盤將執行」 */
  pending: PendingOrder | null
  state: AccountState
  /** 有持股的天數。空手賺 2% 跟滿倉賺 2% 是兩回事（§13.7） */
  daysInMarket: number
  /** 累計配息現金 */
  dividendsReceived: number
  /** 累計手續費與稅。頁面要顯示它佔本金多少 */
  totalFees: number
}

export function simulate(bars: readonly Bar[], decide: Decider, cfg: SimConfig): SimResult {
  const { market, isEtf, initialCash, fees } = cfg

  const state: AccountState = { cash: initialCash, shares: 0, cost: 0 }
  const trades: Trade[] = []
  const equity: EquityPoint[] = []
  let pending: PendingOrder | null = null
  let daysInMarket = 0
  let dividendsReceived = 0
  let totalFees = 0

  // 同一天可能同時有配息與分割，所以是列表不是查表
  const actionsByDate = new Map<string, CorporateAction[]>()
  for (const a of cfg.actions) {
    const list = actionsByDate.get(a.date)
    if (list) list.push(a)
    else actionsByDate.set(a.date, [a])
  }

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]!

    // 1. 公司行動：用開盤成交前的持股。除息日當天才買進的人領不到（§13.3）
    for (const a of actionsByDate.get(bar.date) ?? []) {
      if (state.shares <= 0) continue
      if (a.kind === 'dividend') {
        const cash = state.shares * a.amount
        state.cash += cash
        dividendsReceived += cash
      } else if (a.amount > 0) {
        // 分割不改變總價值：股數乘上比例，總成本不動（每股成本自然被除開）
        state.shares = roundQty(market, state.shares * a.amount)
      }
    }

    // 2. 成交昨天的訂單。市價用今天的開盤，限價要今天碰得到才成交
    if (pending) {
      for (const t of fill(pending, bar, state, cfg)) {
        trades.push(t)
        totalFees += t.fee + t.tax
      }
      pending = null
    }

    // 3. 今天的訊號，留到明天成交
    const order = decide({ index: i, bar, state })
    if (order) {
      pending = { signalD: bar.date, order, estimates: estimateFill(order, bar.c, state, cfg) }
    }

    // 4. 收盤結算
    const eq = state.cash + state.shares * bar.c
    equity.push({
      d: bar.date,
      cash: state.cash,
      shares: state.shares,
      cost: state.cost,
      mark: bar.c,
      equity: eq,
      retPct: initialCash > 0 ? ((eq - initialCash) / initialCash) * 100 : 0,
    })
    if (state.shares > 0) daysInMarket++
  }

  return { trades, equity, pending, state, daysInMarket, dividendsReceived, totalFees }
}

/**
 * 買進這一腿今天成交在哪個價位，`null` 代表今天沒成交。
 *
 * 沒有限價就是開盤市價。有限價的話：開盤已經在限價之下，就用開盤價成交
 * ——真實的限價單就是這樣，掛 97 而開在 95，你拿到的是 95 不是 97。
 * 否則要盤中最低碰到限價才成交。都沒有的話這張單當天過期，**不留到後天**：
 * 留著等於用今天的訊號吃後天的行情，而後天的訊號自己會再算一次。
 */
function buyPriceOn(bar: Bar, limit: number | undefined): number | null {
  if (!(bar.o > 0)) return null
  if (limit === undefined) return bar.o
  if (bar.o <= limit) return bar.o
  return bar.l <= limit ? limit : null
}

/** 賣出這一腿的成交價。規則同 `buyPriceOn`，方向相反 */
function sellPriceOn(bar: Bar, limit: number | undefined): number | null {
  if (!(bar.o > 0)) return null
  if (limit === undefined) return bar.o
  if (bar.o >= limit) return bar.o
  return bar.h >= limit ? limit : null
}

/**
 * 把一張訂單變成成交——**最多兩筆**。
 *
 * **同價才相抵。** 兩腿都是市價時它們成交在同一個開盤價，分開送等於用同一個
 * 價格買進又賣出，白付兩趟手續費（台股還多撞一次最低 20 元）。真實世界沒有
 * 人會這樣做，所以相抵成一筆。
 *
 * **但限價不同就不能相抵。** 賣出區永遠在加碼區上方，所以那是「低點買進、
 * 高點賣出」兩張各自成交的單——相抵掉會把真實發生的價差抹平，帳戶少賺的那
 * 一段不會有任何痕跡。原本的相抵註解講的是「同一個開盤價」，條件本來就在
 * 價格上，只是以前所有單都是市價，看不出來。
 *
 * 買的數量一律用**成交前**手上的現金算，不預支同日賣出的價款：相抵的情況下
 * 那筆賣出根本沒發生，拆開的情況下台股 T+2 也還沒入帳。
 */
function fill(
  p: PendingOrder, bar: Bar, state: AccountState, cfg: SimConfig,
): Trade[] {
  const { market, fees } = cfg
  const o = p.order

  const buyPrice = (o.buyCash ?? 0) > 0 ? buyPriceOn(bar, o.buyLimit) : null
  const sellPrice = (o.sellFraction ?? 0) > 0 ? sellPriceOn(bar, o.sellLimit) : null
  if (buyPrice === null && sellPrice === null) return []

  const base = {
    signalD: p.signalD,
    fillD: bar.date,
    triggers: o.triggers,
    reason: o.reason,
    decidedBy: o.decidedBy,
    confidence: o.confidence,
    overrodeStop: o.overrodeStop ?? false,
  }
  // 兩條路徑都要用成交前的持股算，所以先算好
  const sellQty =
    Math.min(roundQty(market, state.shares * (o.sellFraction ?? 0)), state.shares)

  if (buyPrice !== null && sellPrice !== null && buyPrice === sellPrice) {
    const price = buyPrice
    const wantBuy = affordableQty(market, Math.min(o.buyCash!, state.cash), price, fees)
    const net = wantBuy - sellQty
    if (net === 0) return []
    const t = net > 0
      ? doBuy(base, net, price, state, cfg)
      : doSell(base, -net, price, state, cfg)
    return t ? [t] : []
  }

  const out: Trade[] = []
  const cashBefore = state.cash
  // 先賣後買，但買的額度用 cashBefore 卡住——順序只是為了讓賣出的股數
  // 用到成交前的持股，不是為了讓買進動到賣出的價款
  if (sellPrice !== null) {
    const t = doSell(base, sellQty, sellPrice, state, cfg)
    if (t) out.push(t)
  }
  if (buyPrice !== null) {
    const qty = affordableQty(market, Math.min(o.buyCash!, cashBefore), buyPrice, fees)
    const t = doBuy(base, qty, buyPrice, state, cfg)
    if (t) out.push(t)
  }
  return out
}

type TradeBase = Omit<Trade, 'side' | 'qty' | 'price' | 'fee' | 'tax' | 'costBasis'>

function doBuy(
  base: TradeBase, qty: number, price: number, state: AccountState, cfg: SimConfig,
): Trade | null {
  if (qty <= 0) return null
  const gross = qty * price
  const fee = buyFee(cfg.market, gross, cfg.fees)
  if (gross + fee > state.cash + 1e-9) return null
  state.cash -= gross + fee
  state.shares += qty
  state.cost += gross + fee
  return { ...base, side: 'buy', qty, price, fee, tax: 0, costBasis: null }
}

function doSell(
  base: TradeBase, want: number, price: number, state: AccountState, cfg: SimConfig,
): Trade | null {
  const qty = Math.min(want, state.shares)
  if (qty <= 0) return null
  const gross = qty * price
  const { fee, tax } = sellCost(cfg.market, gross, cfg.isEtf, cfg.fees)
  // 成本用平均法退掉，讓剩餘持股的成本基礎保持正確——批次額度是用它算的
  const avgCost = state.shares > 0 ? state.cost / state.shares : 0
  state.cash += gross - fee - tax
  state.shares -= qty
  state.cost = Math.max(0, state.cost - avgCost * qty)

  // 賣完之後把灰塵掃掉。留著會讓「已出清」永遠看起來像「還有部位」——
  // 止損天天觸發、在市天數灌水，而且完全不會報錯（見 fees.ts 的 isDust）。
  if (isDust(cfg.market, state.shares)) {
    state.shares = 0
    state.cost = 0
  }
  return { ...base, side: 'sell', qty, price, fee, tax, costBasis: avgCost }
}

/**
 * 明天要送的單。**跟 `fill` 用同一條相抵規則**：同價才併成一筆，
 * 限價不同就是兩張單，畫面上也要分開列——不然讀者會以為只要下一張。
 *
 * 限價單用限價估，市價單用今日收盤估。
 */
function estimateFill(
  o: Order, closePrice: number, state: Readonly<AccountState>, cfg: SimConfig,
): PendingEstimate[] {
  const { market, fees } = cfg
  const buyRef = o.buyLimit ?? closePrice
  const sellRef = o.sellLimit ?? closePrice
  if (!(buyRef > 0) || !(sellRef > 0)) return []

  const buyQty = (o.buyCash ?? 0) > 0
    ? affordableQty(market, Math.min(o.buyCash!, state.cash), buyRef, fees)
    : 0
  const sellQty = (o.sellFraction ?? 0) > 0
    ? Math.min(roundQty(market, state.shares * o.sellFraction!), state.shares)
    : 0

  const leg = (side: 'buy' | 'sell', qty: number): PendingEstimate[] => {
    if (qty <= 0) return []
    const limit = (side === 'buy' ? o.buyLimit : o.sellLimit) ?? null
    const refPrice = limit ?? closePrice
    return [{ side, refPrice, limit, qty, amount: qty * refPrice }]
  }

  // 兩腿的掛單價相同（通常是都沒掛限價）＝ 明天會相抵，只送淨額那一張
  if (buyQty > 0 && sellQty > 0 && buyRef === sellRef) {
    const net = buyQty - sellQty
    return net === 0 ? [] : leg(net > 0 ? 'buy' : 'sell', Math.abs(net))
  }
  return [...leg('sell', sellQty), ...leg('buy', buyQty)]
}
