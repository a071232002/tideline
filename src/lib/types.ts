/** 一根日 K 棒。價格一律是「原始價」，還原價另外放（見 PLAN §2）。 */
export interface Bar {
  /** 交易日，`YYYY-MM-DD` */
  date: string
  /** 開盤 */
  o: number
  /** 最高 */
  h: number
  /** 最低 */
  l: number
  /** 收盤 */
  c: number
  /** 成交量（股） */
  v: number
}

export interface BollingerBands {
  upper: number
  mid: number
  lower: number
}

export interface KdValue {
  k: number
  d: number
}
