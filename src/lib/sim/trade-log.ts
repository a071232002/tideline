/**
 * 買賣的歷程：把每一次算出來的成交轉成 `sim_trade_log` 的列。
 *
 * `sim_trades` 每次重建都先刪光再寫回去，所以它是**重算的結果**，不是紀錄。
 * 這一層記的是「系統在什麼時候、用哪一組參數、算出了什麼」——
 * 之後要審視「哪裡有問題」，看的是這張表。
 */

export interface TradeLike {
  signalD: string
  fillD: string
  side: 'buy' | 'sell'
  qty: number
  price: number
  fee: number
  tax: number
  triggers: string[]
  decidedBy: 'rule' | 'ai'
  reason?: string | undefined
}

/**
 * 一筆成交的內容指紋。
 *
 * 重建每天都跑，同一筆算出一樣的結果不該重記一列（一年會有幾萬列在講
 * 同一件事）。但只要內容變了就是新的一列，兩列都留著——那正是要看的東西。
 *
 * 觸發原因也算進去：同樣的股數可能是完全不同的決定（「底倉」與
 * 「跌破止跌全部出清」剛好同股數是有可能的）。順序不算，那只是產生的次序。
 */
export function fingerprintOf(t: TradeLike): string {
  return [t.qty, t.price, [...t.triggers].sort().join(',')].join('|')
}

export interface TradeLogRow {
  account_id: string
  signal_d: string
  fill_d: string
  side: 'buy' | 'sell'
  qty: number
  price: number
  fee: number
  tax: number
  triggers: string[]
  decided_by: string
  reason: string
  params_version: string
  fingerprint: string
}

export function logRowsFor(
  accountId: string, trades: readonly TradeLike[], paramsVersion: string,
): TradeLogRow[] {
  return trades.map((t) => ({
    account_id: accountId,
    signal_d: t.signalD, fill_d: t.fillD, side: t.side,
    qty: t.qty, price: t.price, fee: t.fee, tax: t.tax,
    triggers: t.triggers, decided_by: t.decidedBy,
    // **理由不能是 null。** 講不出來就要說「講不出來」——留一個空值的話，
    // 之後在紀錄裡看到它會分不出是「沒理由」還是「顯示壞了」。
    reason: t.reason && t.reason.trim() !== '' ? t.reason : '（沒有記錄理由）',
    params_version: paramsVersion,
    fingerprint: fingerprintOf(t),
  }))
}
