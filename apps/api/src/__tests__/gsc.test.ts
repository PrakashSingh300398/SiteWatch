import { describe, it, expect } from 'vitest'

// Pure logic extracted from checkTrafficDropAlert for unit testing
function calcWoWDrop(
  records: Array<{ date: Date; clicks: number }>,
  today: Date,
): { last7: number; prev7: number; dropPct: number | null } {
  const last7Start = new Date(today.getTime() - 7 * 86_400_000)
  const prev7Start = new Date(today.getTime() - 14 * 86_400_000)

  const last7 = records.filter(d => d.date >= last7Start).reduce((s, r) => s + r.clicks, 0)
  const prev7 = records.filter(d => d.date >= prev7Start && d.date < last7Start).reduce((s, r) => s + r.clicks, 0)

  const dropPct = prev7 > 0 ? ((prev7 - last7) / prev7) * 100 : null
  return { last7, prev7, dropPct }
}

function shouldAlert(last7: number, prev7: number, minBaseline = 50): boolean {
  return prev7 >= minBaseline && last7 < prev7 * 0.7
}

const today = new Date('2026-06-15T00:00:00Z')

function makeRecords(last7Clicks: number, prev7Clicks: number) {
  const records: Array<{ date: Date; clicks: number }> = []
  // 7 days of prev7 (days -14 to -8)
  for (let i = 14; i > 7; i--) {
    records.push({
      date: new Date(today.getTime() - i * 86_400_000),
      clicks: Math.floor(prev7Clicks / 7),
    })
  }
  // 7 days of last7 (days -7 to -1)
  for (let i = 7; i > 0; i--) {
    records.push({
      date: new Date(today.getTime() - i * 86_400_000),
      clicks: Math.floor(last7Clicks / 7),
    })
  }
  return records
}

describe('GSC WoW traffic drop', () => {
  it('flags a 50% drop correctly', () => {
    const records = makeRecords(100, 200)
    const { last7, prev7, dropPct } = calcWoWDrop(records, today)
    expect(last7).toBe(98)   // 7 * 14
    expect(prev7).toBe(196)  // 7 * 28
    expect(dropPct).toBeCloseTo(50, 0)
    expect(shouldAlert(last7, prev7)).toBe(true)
  })

  it('flags a 30% drop (exactly at threshold)', () => {
    const records = makeRecords(70, 100)
    const { last7, prev7 } = calcWoWDrop(records, today)
    // 70/100 = 70% of baseline → exactly at boundary (not < 70%)
    expect(shouldAlert(last7, prev7)).toBe(false)
  })

  it('flags a 31% drop (just over threshold)', () => {
    const records = makeRecords(69, 100)
    const { last7, prev7 } = calcWoWDrop(records, today)
    expect(last7).toBeLessThan(prev7 * 0.7)
    expect(shouldAlert(last7, prev7)).toBe(true)
  })

  it('does not alert when previous week below minimum baseline', () => {
    const records = makeRecords(10, 40) // prev7 < 50
    const { last7, prev7 } = calcWoWDrop(records, today)
    expect(shouldAlert(last7, prev7)).toBe(false)
  })

  it('does not alert when traffic is stable', () => {
    const records = makeRecords(200, 200)
    const { last7, prev7 } = calcWoWDrop(records, today)
    expect(shouldAlert(last7, prev7)).toBe(false)
  })

  it('does not alert when traffic increased', () => {
    const records = makeRecords(300, 200)
    const { last7, prev7 } = calcWoWDrop(records, today)
    expect(shouldAlert(last7, prev7)).toBe(false)
  })

  it('returns null dropPct when no previous data', () => {
    const records = makeRecords(100, 0)
    const { dropPct } = calcWoWDrop(records, today)
    expect(dropPct).toBeNull()
  })
})

// Index drop logic
function shouldAlertIndexDrop(current: number, previous: number): boolean {
  if (previous === 0) return false
  return (previous - current) / previous > 0.1
}

describe('GSC index drop alert', () => {
  it('fires at 11% drop', () => {
    expect(shouldAlertIndexDrop(890, 1000)).toBe(true)
  })

  it('does not fire at exactly 10% drop', () => {
    expect(shouldAlertIndexDrop(900, 1000)).toBe(false)
  })

  it('does not fire when indexed count increases', () => {
    expect(shouldAlertIndexDrop(1100, 1000)).toBe(false)
  })

  it('handles zero previous gracefully', () => {
    expect(shouldAlertIndexDrop(500, 0)).toBe(false)
  })
})
