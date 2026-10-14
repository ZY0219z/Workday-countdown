import assert from 'node:assert/strict'
import type { Result, InitialConfigInput } from '../../src/shared/contracts'
import { success } from '../../src/shared/validation'
import { createFixedClock } from '../../src/domain/clock'
import { toDayOrdinal } from '../../src/domain/local-date'
import { createIntlTimeZoneAdapter } from '../../src/adapters/intl-time-zone'
import type { TimeZoneAdapter } from '../../src/domain/time-zone'
import { loadBundledCalendarStore } from '../../src/main/services/calendar-store'

export function value<T>(result: Result<T>): T {
  assert.equal(result.ok, true, JSON.stringify(result))
  if (!result.ok) throw new Error('Expected success')
  return result.data
}
export function rejected(result: Result<unknown>, code = 'VALIDATION'): void {
  assert.equal(result.ok, false, JSON.stringify(result))
  if (!result.ok) assert.equal(result.error.code, code)
}
export const nativeZones = createIntlTimeZoneAdapter()
// Only the UTC fixed fixture has an O(1) inverse. Non-UTC boundary tests use the
// real D03 adapter. This is a test injection, never another production date API.
export const zones: TimeZoneAdapter = {
  project: nativeZones.project,
  resolve(local, zone) {
    if (zone !== 'UTC') return nativeZones.resolve(local, zone)
    const ordinal = toDayOrdinal(local.date)
    return ordinal.ok ? success({ kind: 'unique', instant: (ordinal.data - 719162) * 86400000 +
      local.time.hour * 3600000 + local.time.minute * 60000 + local.time.second * 1000 + local.time.millisecond }) : ordinal
  }
}
export const initial: Omit<InitialConfigInput, 'appVersion' | 'updatedAt'> = {
  startDate: '2024-02-29', startTime: '09:00', endTime: '18:00', salaryDay: 10, themeMode: 'system', themeAccent: 'ocean'
}
export function context() {
  return { clock: value(createFixedClock(Date.parse('2026-10-14T10:00:00Z'), 'UTC', zones)),
    zones, calendars: value(loadBundledCalendarStore()), maxValidationDates: 10_000 }
}
