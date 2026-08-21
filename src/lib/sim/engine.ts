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
 *   **訊號在第 i 天收盤後產生，成交在第 i+1 天的開盤價。**
 *
 * 用第 i 天的收盤價成交是紙上交易最容易造假的一點，而且造假不會有任何錯誤訊息。
 * 我們的訊號是收盤後才算出來的（§7：台北 09:30 前才看得到），
 * 那個時候當天的收盤價早就成交完了。尤其止損那一筆——用當天收盤成交等於
 * 「跌破的瞬間就跑掉了」，實際上你隔天開盤才跑得掉，而跌破後的隔天常常跳空低開。
 *
 * 代價是最後一天的訊號還沒成交，留在 `pending`。那不是缺點，
 * 那正好就是頁面上要顯示的「**明天開盤將執行**」——一句可以照做的指令。
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
  mark: number
  equity: number
  retPct: number
}

/**
 * 明日開盤大概會成交多少。
 *
 * 明天的開盤價當然不知道，所以用**今日收盤**當參考價。給估算不是為了精確，
 * 是為了讓這一行真的能照做：「明日開盤買進一批」沒有股數也沒有價位，
 * 讀完還是不知道要在券商輸入什麼。
 *
 * 標明是估算就好；假裝精確更糟，但完全不給數字等於這一行沒有用。
 */
export interface PendingEstimate {
  side: 'buy' | 'sell'
  /** 參考價＝今日收盤。明天的開盤價不會剛好等於它 */
  refPrice: number
  qty: number
  amount: number
}

export interface PendingOrder {
  signalD: string
  order: Order
  /** 不動作、或算出來連一股都買不到時是 null——不要生一個 0 出來 */
  estimate: PendingEstimate | null
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

    // 2. 成交昨天的訂單，成交價 = 今天的開盤
    if (pending) {
      const t = fill(pending, bar, state, cfg)
      if (t) {
        trades.push(t)
        totalFees += t.fee + t.tax
      }
      pending = null
    }

    // 3. 今天的訊號，留到明天成交
    const order = decide({ index: i, bar, state })
    if (order) {
      pending = { signalD: bar.date, order, estimate: estimateFill(order, bar.c, state, cfg) }
    }

    // 4. 收盤結算
    const eq = state.cash + state.shares * bar.c
    equity.push({
      d: bar.date,
      cash: state.cash,
      shares: state.shares,
      mark: bar.c,
      equity: eq,
      retPct: initialCash > 0 ? ((eq - initialCash) / initialCash) * 100 : 0,
    })
    if (state.shares > 0) daysInMarket++
  }

  return { trades, equity, pending, state, daysInMarket, dividendsReceived, totalFees }
}

/**
 * 把一張訂單變成最多一筆成交。
 *
 * **買賣相抵**：兩張單都在同一個開盤價成交，分開送等於用同一個價格買進又賣出，
 * 白付兩趟手續費（台股還多撞一次最低 20 元）。真實世界沒有人會這樣做。
 *
 * 買的數量只用**手上現有的現金**算，不預支同日賣出的價款——相抵之後那筆賣出
 * 根本沒有發生，價款也就不存在。
 */
function fill(
  p: PendingOrder, bar: Bar, state: AccountState, cfg: SimConfig,
): Trade | null {
  const { market, isEtf, fees } = cfg
  const price = bar.o
  if (!(price > 0)) return null

  const o = p.order

  const wantBuy = o.buyCash && o.buyCash > 0
    ? affordableQty(market, Math.min(o.buyCash, state.cash), price, fees)
    : 0
  const wantSell = o.sellFraction && o.sellFraction > 0
    ? Math.min(roundQty(market, state.shares * o.sellFraction), state.shares)
    : 0

  const net = wantBuy - wantSell
  if (net === 0) return null

  const base = {
    signalD: p.signalD,
    fillD: bar.date,
    price,
    triggers: o.triggers,
    reason: o.reason,
    decidedBy: o.decidedBy,
    confidence: o.confidence,
    overrodeStop: o.overrodeStop ?? false,
  }

  if (net > 0) {
    const qty = net
    const gross = qty * price
    const fee = buyFee(market, gross, fees)
    if (gross + fee > state.cash + 1e-9) return null
    state.cash -= gross + fee
    state.shares += qty
    state.cost += gross + fee
    return { ...base, side: 'buy', qty, fee, tax: 0, costBasis: null }
  }

  const qty = Math.min(-net, state.shares)
  if (qty <= 0) return null
  const gross = qty * price
  const { fee, tax } = sellCost(market, gross, isEtf, fees)
  // 成本用平均法退掉，讓剩餘持股的成本基礎保持正確——批次額度是用它算的
  const avgCost = state.shares > 0 ? state.cost / state.shares : 0
  state.cash += gross - fee - tax
  state.shares -= qty
  state.cost = Math.max(0, state.cost - avgCost * qty)

  // 賣完之後把灰塵掃掉。留著會讓「已出清」永遠看起來像「還有部位」——
  // 止損天天觸發、在市天數灌水，而且完全不會報錯（見 fees.ts 的 isDust）。
  if (isDust(market, state.shares)) {
    state.shares = 0
    state.cost = 0
  }
  return { ...base, side: 'sell', qty, fee, tax, costBasis: avgCost }
}

/** 用今日收盤估明日開盤的成交量。相抵之後只剩淨額那一邊。 */
function estimateFill(
  o: Order, refPrice: number, state: Readonly<AccountState>, cfg: SimConfig,
): PendingEstimate | null {
  if (!(refPrice > 0)) return null
  const buyQty = o.buyCash && o.buyCash > 0
    ? affordableQty(cfg.market, Math.min(o.buyCash, state.cash), refPrice, cfg.fees)
    : 0
  const sellQty = o.sellFraction && o.sellFraction > 0
    ? Math.min(roundQty(cfg.market, state.shares * o.sellFraction), state.shares)
    : 0
  const net = buyQty - sellQty
  if (net === 0) return null
  const qty = Math.abs(net)
  return {
    side: net > 0 ? 'buy' : 'sell',
    refPrice,
    qty,
    amount: qty * refPrice,
  }
}
