/**
 * 候選標的的排序：**用這個站自己的尺，不是用新聞的熱度。**
 *
 * ## 為什麼不照題材熱度排
 *
 * 模型從新聞挑出來的東西，熱度本身就是「已經漲上去了」的同義詞——
 * 南亞科連三根漲停、MRNA 單日 +170%。照熱度排，這個站就變成一個轉貼
 * 新聞的區塊，而它的價值從來不是新聞。
 *
 * 所以題材只負責**發現**（把視野推出使用者自己的清單），排序交給這個站
 * 判斷任何一檔標的時用的同一套規則（§4）：回檔到加碼區、%b 在中軌以下、
 * KD 在低檔。這樣一來推薦跟清單、跟模擬帳戶用的是同一把尺，
 * §11 的回顧之後可以直接量「推薦準不準」，不必另外做一套。
 *
 * ## 代價要說清楚
 *
 * 這把尺會**系統性地濾掉最熱的那幾檔**——熱門的定義就是沒有回檔。
 * 所以這一區給的不是「最受關注的三檔」，是「有人在談、而且以我們的規則
 * 現在價位進得去的三檔」。畫面上要照這個講法寫，不要寫成「今日精選」。
 */

export interface RankInput {
  close: number
  k: number
  pctB: number
  ma60: number | null
  /** 加碼區。沒有它就沒得比——`analyze` 一定會給，除非資料不足 */
  addHi: number
  addLo: number
  /** 止跌價。可能沒有（找不到有效的波段低點） */
  stop: number | null
}

export interface Ranked {
  score: number
  /** 三個分項，讓畫面說得出「為什麼排這裡」 */
  parts: { pctB: number; k: number; zone: number }
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * 硬性排除。這兩條不是分數，是「不該出現在名單上」。
 *
 * - **跌破季線**：波段方向已經轉下，回檔到加碼區只是下跌途中的一站。
 *   這個站的規則本來就只在波段偏多時分批進場。
 * - **跌破止跌**：規則對已持有的部位是「全部出清」，那就沒有道理
 *   同時把它推薦給還沒進場的人。
 */
export function excluded(x: RankInput): string | null {
  if (x.ma60 !== null && x.close < x.ma60) return '收盤在季線之下'
  if (x.stop !== null && x.close < x.stop) return '已跌破止跌'
  return null
}

/**
 * 分數：三項等權，各自壓在 0～1。
 *
 * **權重是猜的**，跟 §4 的 k=3 一樣——驗收場是 §11 的回顧，不是手感。
 * 改動要記日期（`PARAMS_VERSION` 那條規矩）。
 *
 * - `pctB`：0 是通道下緣、1 是上緣。越低越好。
 * - `k`：KD 的 K 值，越低代表越接近低檔。越低越好。
 * - `zone`：離加碼區上緣多遠。已經在區內或更低 → 滿分；
 *   高出 10% 以上 → 0 分。10% 這個數字同樣是猜的。
 */
export const ZONE_TOLERANCE = 0.10

export function rank(x: RankInput): Ranked {
  const pctB = clamp01(1 - x.pctB)
  const k = clamp01(1 - x.k / 100)

  let zone: number
  if (x.addHi <= 0) {
    zone = 0
  } else if (x.close <= x.addHi) {
    zone = 1
  } else {
    const over = (x.close - x.addHi) / x.addHi
    zone = clamp01(1 - over / ZONE_TOLERANCE)
  }

  return { score: (pctB + k + zone) / 3, parts: { pctB, k, zone } }
}

/** 排除之後依分數由高到低。同分時代號小的在前，讓結果可重現 */
export function pickTop<T extends { input: RankInput; code: string }>(
  items: readonly T[],
  n: number,
): { picked: (T & Ranked)[]; dropped: { code: string; why: string }[] } {
  const dropped: { code: string; why: string }[] = []
  const scored: (T & Ranked)[] = []

  for (const it of items) {
    const why = excluded(it.input)
    if (why) { dropped.push({ code: it.code, why }); continue }
    scored.push({ ...it, ...rank(it.input) })
  }

  scored.sort((a, b) => (b.score - a.score) || (a.code < b.code ? -1 : 1))
  return { picked: scored.slice(0, n), dropped }
}
