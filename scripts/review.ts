/**
 * PLAN §11 的回顧：我們自己出過的價位，事後對不對。
 * 只用 daily_analysis（當時說的）＋ daily_bars（後來發生的），不模擬下單。
 */
import { createAdminClient } from '../src/lib/supabase/admin'

const db = createAdminClient()
const { data: syms } = await db.from('symbols').select('id, code, market').order('code')

interface Ev { code: string; d: string; fwd5: number | null; fwd10: number | null }
const events: Record<'stop' | 'sell' | 'add', Ev[]> = { stop: [], sell: [], add: [] }
const stability: { code: string; changes: number; days: number; medGap: number }[] = []

for (const s of syms ?? []) {
  const { data: bars } = await db.from('daily_bars').select('d,h,l,c')
    .eq('symbol_id', s.id).order('d', { ascending: true })
  const { data: an } = await db.from('daily_analysis').select('d, levels, close')
    .eq('symbol_id', s.id).order('d', { ascending: true })
  if (!bars || !an) continue

  const idx = new Map(bars.map((b, i) => [b.d as string, i]))
  const fwd = (i: number, n: number) => {
    const a = bars[i], b = bars[i + n]
    if (!a || !b) return null
    return ((Number(b.c) - Number(a.c)) / Number(a.c)) * 100
  }

  let changes = 0
  let prevStop: number | null = null
  const gaps: number[] = []

  for (const row of an) {
    const i = idx.get(row.d as string)
    if (i === undefined) continue
    const lv = row.levels as any
    const close = Number(row.close)
    const bar = bars[i]!

    const stop = lv?.stop?.price ?? null
    if (stop !== null) {
      if (prevStop !== null && stop !== prevStop) changes++
      prevStop = stop
      gaps.push(((close - stop) / close) * 100)
      // 事件：收盤跌破止跌
      if (close < stop) events.stop.push({ code: s.code as string, d: row.d as string, fwd5: fwd(i, 5), fwd10: fwd(i, 10) })
    }
    if (lv?.sell && Number(bar.h) >= lv.sell.lo) {
      events.sell.push({ code: s.code as string, d: row.d as string, fwd5: fwd(i, 5), fwd10: fwd(i, 10) })
    }
    if (lv?.add && Number(bar.l) <= lv.add.hi && Number(bar.l) >= lv.add.lo * 0.98) {
      events.add.push({ code: s.code as string, d: row.d as string, fwd5: fwd(i, 5), fwd10: fwd(i, 10) })
    }
  }
  gaps.sort((a, b) => a - b)
  stability.push({
    code: s.code as string, changes, days: an.length,
    medGap: gaps[Math.floor(gaps.length / 2)] ?? 0,
  })
}

const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN
}

const LABEL = { stop: '跌破止跌', sell: '觸及賣出區', add: '觸及加碼區' } as const
const EXPECT = { stop: '應為負（跌破後續跌才有意義）', sell: '應為負或接近零', add: '應為正' } as const

console.log('事件            N     後5日平均   後10日平均   期望')
for (const k of ['stop', 'sell', 'add'] as const) {
  const e = events[k]
  const a5 = avg(e.map(x => x.fwd5)), a10 = avg(e.map(x => x.fwd10))
  const warn = e.length < 10 ? ' ⚠樣本不足' : ''
  console.log(
    `${LABEL[k].padEnd(12)}${String(e.length).padStart(4)}  ` +
    `${(isNaN(a5) ? '—' : (a5 >= 0 ? '+' : '') + a5.toFixed(2) + '%').padStart(10)}  ` +
    `${(isNaN(a10) ? '—' : (a10 >= 0 ? '+' : '') + a10.toFixed(2) + '%').padStart(11)}   ${EXPECT[k]}${warn}`)
}

console.log('\n止跌點的穩定度與距離')
for (const s of stability) {
  const hold = s.changes ? (s.days / s.changes).toFixed(1) : '—'
  console.log(`  ${s.code.padEnd(6)} ${s.days} 天內變動 ${String(s.changes).padStart(2)} 次（平均持續 ${hold} 天）  距現價中位 ${s.medGap.toFixed(1)}%`)
}
