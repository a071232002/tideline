/**
 * 模擬帳戶的參數（PLAN §13.2、§13.4）。
 *
 * **全部集中在這個檔案**，跟 §11「參數進設定檔、不要散在程式裡」是同一條規矩。
 * 理由也一樣：過三個月回頭看曲線，要分得出「規則變好了」還是「規則換了」。
 *
 * **改了任何一個值，請一併更新 `PARAMS_VERSION` 與下面的異動紀錄。**
 */

/** 參數版本。寫進 sim_trades，之後回顧才知道哪一段歷史是哪組參數跑的 */
export const PARAMS_VERSION = '2026-08-21.1'

/**
 * 異動紀錄
 *
 * - 2026-08-21.1  初版。本金 50,000（§13.2 實測：低於 14,036/批 會撞到最低手續費）。
 *                 手續費不打折、最低 20 元——保守值，券商折數確認後再改。
 */

/** 預設本金（台幣）。台股美股一致，兩邊同額報酬率才能並排比較（§13.2 定案） */
export const DEFAULT_CAPITAL_TWD = 50_000

export interface FeeParams {
  /** 台股手續費率，證交所公定 0.1425% */
  twFeeRate: number
  /** 券商折扣。1 = 不打折。電子下單常見 6 折，確認後改這裡 */
  twFeeDiscount: number
  /** 台股單筆最低手續費。**這是本金門檻的來源**，見 §13.2 */
  twMinFee: number
  /** 台股 ETF 證交稅 */
  twTaxEtf: number
  /** 台股個股證交稅 */
  twTaxStock: number
  /** 美股手續費率。假設用零手續費券商（複委託會完全不同，在假設裡揭露） */
  usFeeRate: number
  /** 美股最低手續費 */
  usMinFee: number
}

export const DEFAULT_FEES: FeeParams = {
  twFeeRate: 0.001425,
  twFeeDiscount: 1,
  twMinFee: 20,
  twTaxEtf: 0.001,
  twTaxStock: 0.003,
  usFeeRate: 0,
  usMinFee: 0,
}

export interface RuleParams {
  /** 分幾批進場。**這些是猜的**，跟 §4 的 k=3 一樣，驗收場是資金曲線本身 */
  batches: number
  /** 觸及賣出區時賣掉持股的多少。§4 的用詞是「減碼」不是出清 */
  trimFraction: number
  /** 止損後幾個交易日內不重新進場。沒有冷卻的話跌破當天就會再進場，來回被巴 */
  cooldownDays: number
  /** 加碼的附帶條件：%b 要低於這個值（§4） */
  addMaxPctB: number
  /** 加碼的附帶條件：K 要低於這個值且上穿 D（§4） */
  addMaxK: number
}

export const DEFAULT_RULES: RuleParams = {
  batches: 3,
  trimFraction: 0.5,
  cooldownDays: 5,
  addMaxPctB: 0.5,
  addMaxK: 30,
}
