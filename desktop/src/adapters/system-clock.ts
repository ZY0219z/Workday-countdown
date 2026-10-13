import { createClock, type Clock, type ClockSource } from '../domain/clock'
import { createIntlTimeZoneAdapter } from './intl-time-zone'
import type { TimeZoneAdapter } from '../domain/time-zone'

// The ONLY new access point for real system time. Injection keeps tests fixed.
// A new default formatter resolves the system zone each time, rather than
// capturing it at startup. Host OS/Electron change events belong to D09.
export function createSystemClock(
  source: ClockSource = { now: () => Date.now(), timeZoneId: () => new Intl.DateTimeFormat().resolvedOptions().timeZone },
  zones: TimeZoneAdapter = createIntlTimeZoneAdapter()
): Clock {
  return createClock(source, zones)
}
