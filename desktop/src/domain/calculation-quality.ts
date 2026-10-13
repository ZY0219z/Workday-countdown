import type { DataQuality, SnapshotWarning } from '../shared/contracts'
import type { CalendarWarning } from './calendar'

export function exactDateQuality(): DataQuality {
  return { approximate: false, incompleteYears: [], source: 'clock', annualVerification: 'notApplicable' }
}
export function mergeQualities(values: readonly DataQuality[], source: DataQuality['source']): DataQuality {
  const incomplete = new Set<number>()
  const rank = { notApplicable: 0, verified: 1, unverified: 2, missing: 3 }
  let approximate = false, annualVerification: DataQuality['annualVerification'] = 'notApplicable'
  for (const value of values) {
    approximate ||= value.approximate
    value.incompleteYears.forEach(year => incomplete.add(year))
    if (rank[value.annualVerification] > rank[annualVerification]) annualVerification = value.annualVerification
  }
  return { approximate, incompleteYears: [...incomplete].sort((a, b) => a - b), source, annualVerification }
}
export function calendarWarnings(values: readonly CalendarWarning[], affects: SnapshotWarning['affects'][number]): SnapshotWarning[] {
  const grouped = new Map<CalendarWarning['reason'], Set<number>>()
  for (const warning of values) {
    let years = grouped.get(warning.reason)
    if (!years) { years = new Set(); grouped.set(warning.reason, years) }
    years.add(warning.year)
  }
  const message = { missing: '年度日历缺失，按当前每周规则估算。', unverified: '年度日历未核验，按当前每周规则估算。', partial: '年度日历不完整，结果属于估算。' }
  return [...grouped].map(([reason, years]) => ({ code: 'CALENDAR_INCOMPLETE', message: message[reason], affects: [affects], years: [...years].sort((a, b) => a - b) }))
}
// Per-call accumulator: memory grows with distinct years/reasons, not days.
export function createQualityAccumulator() {
  const years = new Set<number>(), warnings = new Map<string, CalendarWarning>()
  let approximate = false, annualVerification: DataQuality['annualVerification'] = 'notApplicable'
  const rank = { notApplicable: 0, verified: 1, unverified: 2, missing: 3 }
  return {
    add(value: DataQuality, entries: readonly CalendarWarning[]) {
      approximate ||= value.approximate
      value.incompleteYears.forEach(year => years.add(year))
      if (rank[value.annualVerification] > rank[annualVerification]) annualVerification = value.annualVerification
      entries.forEach(entry => warnings.set(`${entry.year}:${entry.reason}`, { code: entry.code, year: entry.year, reason: entry.reason }))
    },
    quality(source: DataQuality['source']): DataQuality { return { approximate, incompleteYears: [...years].sort((a, b) => a - b), source, annualVerification } },
    warnings(affects: SnapshotWarning['affects'][number]): SnapshotWarning[] { return calendarWarnings([...warnings.values()], affects) }
  }
}
