import { describe, it, expect } from 'vitest'
import { inFlight, waitForIngestToFinish, waitForFreshIngest, INGEST_STALE_MS, type JobRow } from '../src/lib/jobs'

/**
 * 部署之後抓取在 Vercel、AI 在本機，兩邊都會 `rebuildAll()`，而重建的做法是
 * 「整段刪掉再寫回去」。同時跑就會有人讀到半截的資金曲線，而且畫面不會報錯。
 *
 * 這裡驗的是那道互斥的三種邊界：沒東西在跑、有東西在跑、以及**卡死的那一列**。
 * 第三種最重要——雲端函式被時間上限砍掉時不會填 `finished_at`，
 * 少了門檻，AI 會從那天起每天都在等一個永遠不會結束的東西。
 */

const t = (iso: string): number => Date.parse(iso)
const NOW = t('2026-08-24T06:30:00Z')

const row = (started: string, finished: string | null = null): JobRow =>
  ({ started_at: started, finished_at: finished })

describe('inFlight', () => {
  it('剛開始還沒結束 → 算在跑', () => {
    expect(inFlight([row('2026-08-24T06:29:00Z')], NOW)).toHaveLength(1)
  })

  it('已經結束 → 不算', () => {
    expect(inFlight([row('2026-08-24T06:29:00Z', '2026-08-24T06:29:54Z')], NOW))
      .toHaveLength(0)
  })

  it('沒有結束時間但已經超過門檻 → 當作死了，不要永遠等下去', () => {
    const dead = new Date(NOW - INGEST_STALE_MS - 1000).toISOString()
    expect(inFlight([row(dead)], NOW)).toHaveLength(0)
  })

  it('門檻之內的還是算在跑', () => {
    const recent = new Date(NOW - INGEST_STALE_MS + 60_000).toISOString()
    expect(inFlight([row(recent)], NOW)).toHaveLength(1)
  })
})

describe('waitForIngestToFinish', () => {
  /** 假的時鐘：sleep 直接把時間往前撥，測試不用真的等 */
  function clock(start = NOW) {
    let ms = start
    return {
      now: () => ms,
      sleep: (d: number) => { ms += d; return Promise.resolve() },
      advance: (d: number) => { ms += d },
    }
  }

  it('沒有東西在跑 → 立刻放行，一次都不睡', async () => {
    const c = clock()
    let calls = 0
    const r = await waitForIngestToFinish({
      fetchRows: async () => { calls++; return [] },
      now: c.now, sleep: c.sleep,
    })
    expect(r).toBe('clear')
    expect(calls).toBe(1)
  })

  it('在跑 → 等到它結束', async () => {
    const c = clock()
    let calls = 0
    const r = await waitForIngestToFinish({
      fetchRows: async () => {
        calls++
        // 第三次來問的時候抓取已經收工
        return calls < 3 ? [row(new Date(c.now() - 5_000).toISOString())] : []
      },
      now: c.now, sleep: c.sleep, intervalMs: 10_000,
    })
    expect(r).toBe('clear')
    expect(calls).toBe(3)
  })

  it('一直在跑 → 逾時，但回報而不是丟例外', async () => {
    // AI 那條線的價值在於每天都有判斷。為了一個可能卡住的抓取而整天不判斷，
    // 是拿確定的損失換不確定的風險——所以回 'timeout' 讓呼叫端自己決定。
    const c = clock()
    const logs: string[] = []
    const r = await waitForIngestToFinish({
      fetchRows: async () => [row(new Date(c.now() - 5_000).toISOString())],
      now: c.now, sleep: c.sleep,
      timeoutMs: 60_000, intervalMs: 10_000,
      log: (m) => logs.push(m),
    })
    expect(r).toBe('timeout')
    // 只講一次，不要每十秒洗一行 log
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain('抓取還在跑')
  })

  it('卡死的那一列不會讓它等下去', async () => {
    const c = clock()
    const dead = new Date(NOW - INGEST_STALE_MS - 1).toISOString()
    const r = await waitForIngestToFinish({
      fetchRows: async () => [row(dead)],
      now: c.now, sleep: c.sleep,
    })
    expect(r).toBe('clear')
  })
})

/**
 * 「等時鐘」不夠，要「等資料」。
 *
 * 實測 2026-08-28：Vercel Cron 排 23:30 UTC，**實際 23:58 才跑**，而本機的
 * AI 準時 07:35 開跑——比抓取早了 23 分鐘。它看到的是昨天的資料，
 * 於是整輪安靜地什麼都沒做，log 看起來卻完全正常。
 *
 * `waitForIngestToFinish` 擋不住這種：它只在抓取**正在跑**的時候等，
 * 而那次抓取根本還沒開始。
 */
describe('等到今天的抓取真的跑完', () => {
  const t = (iso: string) => new Date(iso)
  function clock(startIso: string) {
    let ms = Date.parse(startIso)
    return { now: () => ms, sleep: (d: number) => { ms += d; return Promise.resolve() } }
  }

  it('已經有夠新的完成紀錄 → 立刻放行', async () => {
    const c = clock('2026-08-28T00:10:00Z')
    const r = await waitForFreshIngest({
      since: t('2026-08-27T23:00:00Z'),
      fetchRows: async () => [row('2026-08-27T23:58:00Z', '2026-08-27T23:59:00Z')],
      now: c.now, sleep: c.sleep,
    })
    expect(r).toBe('fresh')
  })

  it('**只有舊的完成紀錄不算數**——那正是今天踩到的', async () => {
    // 昨天的抓取早就結束了，但今天的還沒來。照舊邏輯會直接放行，
    // 然後 AI 對著昨天的 K 棒做判斷。
    const c = clock('2026-08-28T00:10:00Z')
    let calls = 0
    const r = await waitForFreshIngest({
      since: t('2026-08-27T23:00:00Z'),
      fetchRows: async () => {
        calls++
        return calls < 3
          ? [row('2026-08-26T23:30:00Z', '2026-08-26T23:31:00Z')]   // 昨天的
          : [row('2026-08-27T23:58:00Z', '2026-08-27T23:59:00Z')]   // 今天的到了
      },
      now: c.now, sleep: c.sleep, intervalMs: 60_000,
    })
    expect(r).toBe('fresh')
    expect(calls).toBe(3)
  })

  it('還在跑但還沒結束 → 繼續等', async () => {
    const c = clock('2026-08-28T00:10:00Z')
    const r = await waitForFreshIngest({
      since: t('2026-08-27T23:00:00Z'),
      fetchRows: async () => [row('2026-08-27T23:58:00Z')],   // finished_at 是 null
      now: c.now, sleep: c.sleep, timeoutMs: 120_000, intervalMs: 60_000,
    })
    expect(r).toBe('timeout')
  })

  it('等太久 → 回報而不是丟例外，呼叫端自己決定', async () => {
    const c = clock('2026-08-28T00:10:00Z')
    const logs: string[] = []
    const r = await waitForFreshIngest({
      since: t('2026-08-27T23:00:00Z'),
      fetchRows: async () => [],
      now: c.now, sleep: c.sleep, timeoutMs: 180_000, intervalMs: 60_000,
      log: (m) => logs.push(m),
    })
    expect(r).toBe('timeout')
    expect(logs).toHaveLength(1)   // 只講一次，不要每分鐘洗一行
  })
})
