import { ACTIONS, CONFIDENCES } from './decide'

/**
 * 給 AI 的事實包（PLAN §13.5）。
 *
 * 模型不需要自己去找資料——今天的數字、三個價位、目前部位、規則帳戶打算做什麼，
 * 全部由程式算好餵進去。它的工作只有一件：**權衡，然後從選單裡挑一個動作。**
 *
 * ## 一條不變量
 *
 *   **prompt 裡出現的每個數字，都要在 `allowedNumbers` 裡。**
 *
 * 少了這條，模型引用我們自己餵給它的數字卻被驗證器擋下來——那不是模型的錯，
 * 是我們前後不一致，而且症狀是「AI 天天失敗」這種很難查的東西。
 * `test/ai-prompt.test.ts` 用整份 prompt 過一次驗證器來守這條。
 */

export interface AiFacts {
  code: string
  name: string | null
  market: 'TW' | 'US'
  currency: string
  date: string

  close: number
  chg: number | null
  chgPct: number | null
  o: number | null
  h: number | null
  l: number | null

  k: number | null
  d: number | null
  pctB: number | null
  bandwidth: number | null
  bbUp: number | null
  bbMid: number | null
  bbLo: number | null
  ma60: number | null

  levels: {
    sell?: { lo: number; hi: number } | null
    stop?: number | null
    add: { lo: number; hi: number }
  }
  levelWhy: Record<string, string>

  /** 近 20 日收盤，讓它看得到形狀而不只是一個點 */
  recentCloses: number[]

  position: {
    shares: number
    cash: number
    cost: number
    equity: number
    retPct: number
  }

  /** 規則帳戶今天打算做什麼。它要能選擇不同意 */
  ruleAction: { verb: string; reason: string } | null
}

/** 數字一律用固定位數輸出，這樣 allowed 與 prompt 才會是同一組字面值 */
const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2))

function collect(f: AiFacts): number[] {
  const out: number[] = [
    f.close, f.chg, f.chgPct, f.o, f.h, f.l,
    f.k, f.d, f.pctB, f.bandwidth, f.bbUp, f.bbMid, f.bbLo, f.ma60,
    f.levels.sell?.lo ?? null, f.levels.sell?.hi ?? null,
    f.levels.stop ?? null,
    f.levels.add.lo, f.levels.add.hi,
    f.position.shares, f.position.cash, f.position.cost,
    f.position.equity, f.position.retPct,
    ...f.recentCloses,
  ].filter((v): v is number => typeof v === 'number' && Number.isFinite(v))

  // 指標參數也算「我們算過的」：模型講「20 日均線」「K<30」時引用的是它們
  out.push(20, 2, 9, 3, 60, 30, 50, 70, 80, 100, 0, 25, 120)
  return [...new Set(out)]
}

export function allowedNumbers(f: AiFacts): number[] {
  const base = collect(f)
  // prompt 會把數字四捨五入到兩位再印出來，所以那個字面值也要算數——
  // 否則模型照抄我們印的 `-1.72`，卻對不上內部的 -1.7234
  return [...new Set([...base, ...base.map((v) => Number(v.toFixed(2)))])]
}

function zone(z: { lo: number; hi: number }): string {
  return z.lo === z.hi ? n(z.lo) : `${n(z.lo)}～${n(z.hi)}`
}

export function buildPrompt(f: AiFacts): string {
  const p = f.position
  const lines: string[] = []

  lines.push(`你是一個紀律嚴謹的部位管理者，替一個**模擬帳戶**做今天的決策。`)
  lines.push(``)
  lines.push(`## 標的`)
  lines.push(`${f.code}${f.name ? `（${f.name}）` : ''}，${f.market === 'TW' ? '台股' : '美股'}，資料日期 ${f.date}`)
  lines.push(``)
  lines.push(`## 今天的數字（全部由程式計算）`)
  lines.push(`收盤 ${n(f.close)}`
    + (f.chg !== null ? `，漲跌 ${n(f.chg)}` : '')
    + (f.chgPct !== null ? `（${n(f.chgPct)}%）` : ''))
  if (f.o !== null && f.h !== null && f.l !== null) {
    lines.push(`開 ${n(f.o)}／高 ${n(f.h)}／低 ${n(f.l)}`)
  }
  if (f.k !== null && f.d !== null) lines.push(`KD(9,3,3)：K ${n(f.k)}、D ${n(f.d)}`)
  if (f.pctB !== null) lines.push(`布林 %b ${n(f.pctB)}`
    + (f.bbUp !== null ? `，上軌 ${n(f.bbUp)}／中軌 ${n(f.bbMid!)}／下軌 ${n(f.bbLo!)}` : ''))
  if (f.ma60 !== null) lines.push(`60 日均線 ${n(f.ma60)}`)
  if (f.recentCloses.length > 0) {
    lines.push(`近期收盤：${f.recentCloses.map(n).join('、')}`)
  }
  lines.push(``)
  lines.push(`## 三個關鍵價位（程式算的，不是你算的）`)
  if (f.levels.sell) {
    lines.push(`波段賣出區 ${zone(f.levels.sell)}${f.levelWhy.sell ? `　${f.levelWhy.sell}` : ''}`)
  }
  if (f.levels.stop !== null && f.levels.stop !== undefined) {
    lines.push(`止跌 ${n(f.levels.stop)}${f.levelWhy.stop ? `　${f.levelWhy.stop}` : ''}`)
  }
  lines.push(`加碼區 ${zone(f.levels.add)}${f.levelWhy.add ? `　${f.levelWhy.add}` : ''}`)
  lines.push(``)
  lines.push(`## 這個帳戶現在的狀態`)
  lines.push(`持股 ${n(p.shares)} 股，現金 ${n(p.cash)} ${f.currency}，`
    + `持股成本 ${n(p.cost)}，淨值 ${n(p.equity)}，累計報酬 ${n(p.retPct)}%`)
  lines.push(``)
  lines.push(`## 規則帳戶今天打算做什麼`)
  lines.push(f.ruleAction
    ? `${f.ruleAction.verb}——${f.ruleAction.reason}`
    : `（沒有規則建議）`)
  lines.push(``)
  lines.push(`## 你要回什麼`)
  lines.push(`只回一個 JSON，不要有其他文字：`)
  lines.push('```json')
  lines.push(`{ "action": "${ACTIONS.join(' | ')}",`)
  lines.push(`  "confidence": "${CONFIDENCES.join(' | ')}",`)
  lines.push(`  "agree_with_rule": true,`)
  lines.push(`  "reason": "一句話" }`)
  lines.push('```')
  lines.push(``)
  lines.push(`規矩：`)
  lines.push(`- buy_25 / buy_50 / buy_100 是「用掉目前現金的百分之幾」；`)
  lines.push(`  sell_25 / sell_50 / sell_100 是「賣掉目前持股的百分之幾」。`)
  lines.push(`- **不要寫價格、不要寫股數。** 實際成交價與股數由程式用次日開盤價計算，`)
  lines.push(`  你寫的任何價格都不會被使用，只會讓整個決策被退回。`)
  lines.push(`- reason 不得超過 120 字，而且**裡面每一個數字都必須出自上面給你的數值**。`)
  lines.push(`  出現一個上面沒有的數字，整段退回重來。`)
  lines.push(`- **不強制進場、不強制出場。** 判斷不該動就回 hold，空手等待是合法的決策。`)
  lines.push(`- agree_with_rule 填你是否同意規則帳戶今天的做法。不同意就照你的判斷選，`)
  lines.push(`  但要在 reason 說出為什麼。`)
  lines.push(`- 目標是這個帳戶的報酬率，不是猜對方向的次數。`)

  return lines.join('\n')
}
