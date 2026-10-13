import type { Result } from '../shared/contracts'
import { issue, success, validationFailure } from '../shared/validation'
import { validateInstant, type Instant } from './local-time'
import type { TimeZoneAdapter, TimeZoneId, ZonedDateTime } from './time-zone'

export interface ClockReading extends ZonedDateTime { instant: Instant }
export interface Clock { read(): Result<ClockReading> }
export interface ClockSource { now(): unknown; timeZoneId(): unknown }

// Sampling both inputs on EVERY read handles jumps and changed zones. No timer,
// accumulated ticks, snapshot service, or resume/lifecycle handler lives here.
export function createClock(source: ClockSource, zones: TimeZoneAdapter): Clock {
  return { read() {
    try {
      const instant = validateInstant(source.now())
      if (!instant.ok) return instant
      const timeZoneId = source.timeZoneId()
      if (typeof timeZoneId !== 'string') return validationFailure([issue('$.timeZoneId', 'TYPE', '时区标识必须为字符串。')])
      const projected = zones.project(instant.data, timeZoneId)
      if (!projected.ok) return projected
      return success({ instant: instant.data, date: projected.data.date, time: projected.data.time,
        timeZoneId: projected.data.timeZoneId, offsetMilliseconds: projected.data.offsetMilliseconds })
    } catch {
      return { ok: false, error: { code: 'UNAVAILABLE', message: '无法读取当前系统时钟或时区。' } }
    }
  } }
}
export interface FixedClock extends Clock {
  setInstant(instant: Instant): Result<ClockReading>
  advanceMilliseconds(delta: number): Result<ClockReading>
  setTimeZone(timeZoneId: TimeZoneId): Result<ClockReading>
}
export function createFixedClock(initial: Instant, timeZoneId: TimeZoneId, zones: TimeZoneAdapter): Result<FixedClock> {
  let current = initial, zone = timeZoneId
  const clock = createClock({ now: () => current, timeZoneId: () => zone }, zones)
  const initialRead = clock.read()
  if (!initialRead.ok) return initialRead
  function update(instant: Instant, nextZone: TimeZoneId): Result<ClockReading> {
    const candidate = createClock({ now: () => instant, timeZoneId: () => nextZone }, zones).read()
    if (!candidate.ok) return candidate
    current = candidate.data.instant; zone = nextZone
    return candidate
  }
  return success({ read: clock.read, setInstant: instant => update(instant, zone),
    advanceMilliseconds: delta => Number.isSafeInteger(delta)
      ? update(current + delta, zone)
      : validationFailure([issue('$.delta', 'RANGE', '时钟增量必须为安全整数毫秒。')]),
    setTimeZone: nextZone => update(current, nextZone) })
}
