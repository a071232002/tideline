import type { Levels } from './levels'

/**
 * 規則版結論（PLAN §5 第 3 層）。**這是地板，不是天花板。**
 *
 * AI 講評成功時覆蓋它，失敗時就用它——頁面永遠不會空白、永遠有結論。
 * 這裡只做樣板填空，不做權衡；權衡是 AI 那一層的事。
 */

export interface VerdictInput {
  close: number
  ma60: number | null
  k: number
  d: number
  kPrev: number | null
  dPrev: number | null
  pctB: number
  pctBPrev: number | null
  levels: Levels
  currency: string
}

export interface Verdict {
  headline: string
  reasons: string[]
  /** 這句話是規則拼的還是 AI 權衡的，頁面要標出來（PLAN §3） */
  source: 'rule'
}

function fmt(v: number, currency: string): string {
  const digits = currency === 'TWD' ? 2 : 2
  return v.toFixed(digits)
}

function zone(lo: number, hi: number, currency: string): string {
  return lo === hi ? fmt(lo, currency) : `${fmt(lo, currency)}–${fmt(hi, currency)}`
}

/** 趨勢：收盤 vs 季線 */
/**
 * 這三句話**只講方向，不報數字**。
 *
 * 數字就印在同一張卡的下半部（技術面依據的原始數值）。兩邊都寫的結果是
 * 季線 104.31、K 36.9、D 51.1、%b 0.58、中軌 102.68 每一個都出現兩次——
 * 原本那是兩個區塊、隔著 80px，合併之後變成上下相鄰，重複就藏不住了。
 *
 * 分工：**上半句說往哪邊動，下半部說確切是多少。**
 */
function trendPhrase(close: number, ma60: number | null): string | null {
  if (ma60 === null) return null
  const gap = (close - ma60) / ma60
  if (gap < -0.005) return '跌破季線'
  if (gap > 0.005) return '站上季線'
  return '貼著季線'
}

/** KD：交叉與高低檔 */
function kdPhrase(k: number, d: number, kPrev: number | null, dPrev: number | null): string {
  const crossed = kPrev !== null && dPrev !== null
  const deadCross = crossed && kPrev >= dPrev && k < d
  const goldCross = crossed && kPrev <= dPrev && k > d
  const high = k > 70 || d > 70
  const low = k < 30 || d < 30

  if (deadCross) return `K 跌破 D，${high ? '高檔' : ''}死亡交叉`
  if (goldCross) return `K 突破 D，${low ? '低檔' : ''}黃金交叉`
  if (k < d) return `K 在 D 之下，${high ? '高檔' : ''}持續下彎`
  if (k > d) return `K 在 D 之上，${low ? '低檔' : ''}向上`
  return 'K 與 D 糾結'
}

/** 布林：%b 位置與方向 */
function bandPhrase(pctB: number, prev: number | null): string {
  const dir = prev === null ? '' : pctB < prev ? '回落' : pctB > prev ? '上行' : '持平'
  const where =
    pctB > 1 ? '突破上軌'
    : pctB > 0.8 ? '貼近上軌'
    : pctB < 0 ? '跌破下軌'
    : pctB < 0.2 ? '貼近下軌'
    : '位於通道中段'
  return dir ? `%b ${dir}，${where}` : `%b ${where}`
}

/** 綜合三項組出一句短線／波段的定調 */
function tone(close: number, ma60: number | null, k: number, d: number, pctB: number): string {
  const belowMa = ma60 !== null && close < ma60
  const kdWeak = k < d
  if (belowMa && kdWeak) return '短線轉弱、波段中性'
  if (belowMa && !kdWeak) return '短線止穩、波段仍偏弱'
  if (!belowMa && kdWeak) return '短線回檔、波段偏多'
  if (pctB > 0.8) return '短線偏強但已近上軌'
  return '短線偏多、波段偏多'
}

export function buildVerdict(input: VerdictInput): Verdict {
  const { close, ma60, k, d, kPrev, dPrev, pctB, pctBPrev, levels, currency } = input

  // headline 只講定調。三個價位就在正上方的決策條裡，再唸一次是廢話——
  // 而且那樣寫出來的句子每天都長一樣，反而讓人不想讀。
  const headline = tone(close, ma60, k, d, pctB)

  const reasons: string[] = []
  const t = trendPhrase(close, ma60)
  if (t) reasons.push(`趨勢：${t}`)
  reasons.push(`KD：${kdPhrase(k, d, kPrev, dPrev)}`)
  reasons.push(`布林：${bandPhrase(pctB, pctBPrev)}`)

  return { headline, reasons, source: 'rule' }
}

/** 每個價位的「為什麼」。規則版——AI 版會覆蓋它（PLAN §5 第 4 層）。 */
export function levelReasons(levels: Levels): Record<string, string> {
  const out: Record<string, string> = {}
  if (levels.sell) {
    const b = levels.sell.basis
    out.sell = levels.sell.kind === 'swing' && b.swingHigh !== null
      ? `${b.swingHighDate} 前波高 ${b.swingHigh.toFixed(2)} 為第一道賣壓，`
        + `其上為布林上軌 ${b.upper.toFixed(2)}`
      : `現價已突破近期所有前波高，上方沒有明確賣壓；`
        + `以布林上軌 ${b.upper.toFixed(2)} 當第一道參考`
  }
  if (levels.stop) {
    const b = levels.stop.basis
    out.stop = `整數關卡 ${b.round} 疊加 ${b.swingLowDate} 波段低點 ${b.swingLow.toFixed(2)}；`
      + `收盤跌破代表這一段反彈結構破壞`
  }
  out.add = `布林中軌 ${levels.add.basis.mid.toFixed(2)} 附近、%b 回落 0.5 以下的相對安全區；`
    + `建議等 KD 回低檔（K<30）出現金叉再分批進場`
  return out
}
