/**
 * AI 那七個動作的中文說法。
 *
 * 動作是**固定的列舉**（`src/lib/ai/decide.ts` 的 ACTIONS），不是自由文字——
 * 所以字典擺得住。原本這份對照寫在 WatchList 裡，個股頁要用的時候
 * 只能再抄一份；抄第二份的當下就注定會有一天兩邊講的不一樣。
 */
export const AI_ACTION: Record<string, string> = {
  hold: '觀望',
  buy_25: '買進 ¼ 現金', buy_50: '買進 ½ 現金', buy_100: '全部買進',
  sell_25: '賣出 ¼ 持股', sell_50: '賣出 ½ 持股', sell_100: '全部賣出',
}

export const aiActionText = (a: string): string => AI_ACTION[a] ?? a
