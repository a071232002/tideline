import type { Decider, Order } from './engine'
import type { RuleParams } from './params'

/**
 * 規則軌道的決策（PLAN §13.4）。**這是 AI 的對照組，不是主角。**
 *
 * 沒有這條軌道，AI 帳戶賺了錢也分不出來是判斷力還是市場本身在漲。
 * 所以它必須是確定性的、可回補的、規則寫死的——
 * 「沒有硬性規定進出場」那句話是給 AI 帳戶的（§13.5），不是給這裡的。
 *
 * ## 價格到了不代表要買
 *
 * §4 的加碼區本來就附帶兩個條件：「%b < 0.5，且建議等 K < 30 出現金叉再分批進場」。
 * 模擬的初稿把它們漏掉了，變成「碰到就買」——那會把一路下跌的過程買好買滿。
 * 任何一個條件不成立就是不買，錢繼續放著。空手是合法的結果。
 *
 * ## 但「等金叉**再**進場」是先後，不是同一天
 *
 * 第二版初稿要求四個條件同日成立，實測台股三檔**半年一次都沒進場**
 * （數據見 `params.ts` 的 2026-08-21.2）。一條永遠不觸發的規則不能當 AI 的對照組。
 *
 * 正確的讀法是三個先後事件：
 *
 *   1. **回低檔**　K 跌破 `addMaxK`（那一段回檔真的發生過）
 *   2. **金叉**　　K 之後上穿 D → 訊號架起（armed）
 *   3. **價格到位** 盤中最低進入加碼區且 %b < 0.5 → 才下單
 *
 * 第 1 與第 2 步不必同一天。上升趨勢裡 KD 的回檔又淺又快，等到金叉出現時 K 常常
 * 已經回到 30 以上——要求同日成立的話，台股這半年**一次都不會進場**。
 *
 * 訊號在 K 進入高檔（`armResetK`）或止損時解除：那時這一段已經走完了。
 *
 * ## 這個函式是有狀態的
 *
 * armed 與冷卻期都要跨天記憶，所以回傳的 decider 帶著閉包狀態。
 * **每一次 `simulate` 都要重新呼叫 `ruleDecider()` 建一個新的**，
 * 重複使用同一個會把上一次模擬的冷卻狀態帶進來。
 */

export interface RuleDay {
  levels: {
    add: { lo: number; hi: number }
    sell?: { lo: number; hi: number } | null
    stop?: { price: number } | null
  }
  pctB: number
  k: number
  d: number
  kPrev: number | null
  dPrev: number | null
}

export function ruleDecider(
  days: Record<string, RuleDay>,
  initialCash: number,
  p: RuleParams,
): Decider {
  const batchSize = initialCash / p.batches
  let cooldownUntilIndex = -1
  let dipped = false   // K 曾經回過低檔
  let armed = false    // 回過低檔之後又出現金叉

  return (ctx) => {
    const day = days[ctx.bar.date]
    if (!day) return null

    const { bar, state } = ctx
    const triggers: string[] = []
    let sellFraction: number | undefined
    let buyCash: number | undefined

    // 0. 先更新訊號狀態。回低檔與金叉是兩個先後事件，不必同一天。
    const goldenCross = day.kPrev !== null && day.dPrev !== null
      && day.kPrev <= day.dPrev && day.k > day.d
    if (day.k < p.addMaxK) dipped = true
    if (goldenCross && dipped) { armed = true; dipped = false }
    // K 進高檔：這一段走完了，再用它進場是追高
    if (day.k > p.armResetK) { armed = false; dipped = false }

    // 1. 止損：收盤跌破。跌破了就不是減碼的事，兩者互斥、止損優先
    const stop = day.levels.stop?.price
    if (stop !== undefined && state.shares > 0 && bar.c < stop) {
      cooldownUntilIndex = ctx.index + p.cooldownDays
      armed = false
      dipped = false
      return { sellFraction: 1, triggers: ['stop'], decidedBy: 'rule' }
    }

    // 2. 減碼：盤中最高觸及賣出區下緣。§4 的用詞是「減碼」不是出清
    const sellLo = day.levels.sell?.lo
    if (sellLo !== undefined && state.shares > 0 && bar.h >= sellLo) {
      sellFraction = p.trimFraction
      triggers.push('sell_zone')
    }

    // 3. 加碼：訊號要先架起來，價格與 %b 要到位，批次要有額度，且不在冷卻中
    const cooling = ctx.index <= cooldownUntilIndex
    const roomForBatch = state.cost + batchSize <= initialCash + 1e-9

    if (
      !cooling
      && armed
      && bar.l <= day.levels.add.hi
      && day.pctB < p.addMaxPctB
      && roomForBatch
      && state.cash > 0
    ) {
      buyCash = batchSize
      triggers.push('add')
    }

    if (triggers.length === 0) return null
    const order: Order = { triggers, decidedBy: 'rule' }
    if (buyCash !== undefined) order.buyCash = buyCash
    if (sellFraction !== undefined) order.sellFraction = sellFraction
    return order
  }
}

/**
 * 買進持有對照組（PLAN §13.1 三）。
 *
 * 第一天全押、之後什麼都不做。**沒有它，任何策略在上漲的市場裡都很好看**——
 * 規則帳戶與 AI 帳戶贏不過這條線，就代表它們在做白工，
 * 而這件事必須讓它自己顯示出來，不能等人去想。
 */
export function holdDecider(): Decider {
  let done = false
  return (ctx) => {
    if (done || ctx.index !== 0) return null
    done = true
    return { buyCash: Infinity, triggers: ['initial'], decidedBy: 'rule' }
  }
}
