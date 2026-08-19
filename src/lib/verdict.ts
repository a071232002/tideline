import type { Levels } from './levels.js'

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
function trendPhrase(close: number, ma60: number | null): string | null {
  if (ma60 === null) return null
  const gap = (close - ma60) / ma60
  if (gap < -0.005) return `跌破季線 ${ma60.toFixed(2)}`
  if (gap > 0.005) return `站上季線 ${ma60.toFixed(2)}`
  return `貼著季線 ${ma60.toFixed(2)}`
}

/** KD：交叉與高低檔 */
function kdPhrase(k: number, d: number, kPrev: number | null, dPrev: number | null): string {
  const crossed = kPrev !== null && dPrev !== null
  const deadCross = crossed && kPrev >= dPrev && k < d
  const goldCross = crossed && kPrev <= dPrev && k > d
  const high = k > 70 || d > 70
  const low = k < 30 || d < 30

  if (deadCross) return `K ${k.toFixed(1)} 跌破 D ${d.toFixed(1)}，${high ? '高檔' : ''}死亡交叉`
  if (goldCross) return `K ${k.toFixed(1)} 突破 D ${d.toFixed(1)}，${low ? '低檔' : ''}黃金交叉`
  if (k < d) return `K ${k.toFixed(1)} 低於 D ${d.toFixed(1)}，${high ? '高檔' : ''}持續下彎`
  if (k > d) return `K ${k.toFixed(1)} 高於 D ${d.toFixed(1)}，${low ? '低檔' : ''}向上`
  return `K 與 D 糾結於 ${k.toFixed(1)}`
}

/** 布林：%b 位置與方向 */
function bandPhrase(pctB: number, prev: number | null, mid: number): string {
  const dir = prev === null ? '' : pctB < prev ? '回落' : pctB > prev ? '上行' : '持平'
  const where =
    pctB > 1 ? '突破上軌'
    : pctB > 0.8 ? '貼近上軌'
    : pctB < 0 ? '跌破下軌'
    : pctB < 0.2 ? '貼近下軌'
    : '位於通道中段'
  const from = prev === null ? '' : `自 ${prev.toFixed(2)} `
  return `%b ${from}${dir}至 ${pctB.toFixed(2)}，${where}（中軌 ${mid.toFixed(2)}）`
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

  const parts: string[] = []
  if (levels.sell) parts.push(`反彈 ${zone(levels.sell.lo, levels.sell.hi, currency)} 減碼`)
  if (levels.stop) parts.push(`止跌 ${fmt(levels.stop.price, currency)}`)
  parts.push(`回檔 ${zone(levels.add.lo, levels.add.hi, currency)} 分批加碼`)

  const headline = `${tone(close, ma60, k, d, pctB)}。${parts.join('、')}。`

  const reasons: string[] = []
  const t = trendPhrase(close, ma60)
  if (t) reasons.push(`趨勢：${t}`)
  reasons.push(`KD：${kdPhrase(k, d, kPrev, dPrev)}`)
  reasons.push(`布林：${bandPhrase(pctB, pctBPrev, levels.add.basis.mid)}`)

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
