import type { Result } from '../shared/contracts'
import { LOCAL_DATE_PATTERN } from '../shared/formats'
import { issue, success, v, validateStructure, validationFailure } from '../shared/validation'
import { toDayOrdinal, normalizeLocalDate } from '../domain/local-date'
import { MAX_INSTANT, MIN_INSTANT, MILLISECONDS_PER_DAY, MILLISECONDS_PER_MINUTE, validateInstant, validateWallTime, wallTimeValidator } from '../domain/local-time'
import type { LocalDateTime, LocalTimeResolution, TimeZoneAdapter, ZonedDateTime } from '../domain/time-zone'

const EPOCH_DAY_ORDINAL = 719_162 // 1970-01-01, derived from the same Gregorian ordinal.
const MAX_OFFSET = MILLISECONDS_PER_DAY
const invalidZone = (): Result<never> => validationFailure([issue('$.timeZoneId', 'FORMAT', '时区标识不受当前运行时支持。')])
const outsideLocalRange = (result: Result<unknown>): boolean => !result.ok && result.error.code === 'VALIDATION' &&
  result.error.issues.some(item => (item.field === '$.date' || item.field === '$') && item.reason === 'RANGE')
function wallEncoding(local: LocalDateTime): Result<number> {
  const day = toDayOrdinal(local.date), time = validateWallTime(local.time)
  if (!day.ok) return day
  if (!time.ok) return time
  const { hour, minute, second, millisecond } = time.data
  // This encodes a wall time for candidate matching; it is NOT an Instant until
  // a zone offset is resolved, nor a way to measure elapsed civil dates.
  return success((day.data - EPOCH_DAY_ORDINAL) * MILLISECONDS_PER_DAY + hour * 3_600_000 + minute * 60_000 + second * 1000 + millisecond)
}

export function createIntlTimeZoneAdapter(): TimeZoneAdapter {
  // Bounded formatter reuse only. No business result, clock, or subscription cache.
  const formatters = new Map<string, Intl.DateTimeFormat>()
  function formatter(zone: string): Result<Intl.DateTimeFormat> {
    if (typeof zone !== 'string' || !zone.length || zone.length > 128 || zone.trim() !== zone) return invalidZone()
    try {
      let value = formatters.get(zone)
      if (!value) {
        value = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
          timeZone: zone, calendar: 'gregory', numberingSystem: 'latn', hourCycle: 'h23',
          era: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
        })
        if (formatters.size >= 4) formatters.delete(formatters.keys().next().value!)
        formatters.set(zone, value)
      }
      return success(value)
    } catch { return invalidZone() }
  }
  function projectWith(instant: number, value: Intl.DateTimeFormat): Result<ZonedDateTime> {
    try {
      const parts = value.formatToParts(instant)
      const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find(item => item.type === type)?.value ?? ''
      if (part('era') !== 'AD') return validationFailure([issue('$.date', 'RANGE', '本地日期超出支持范围。')])
      const date = normalizeLocalDate(`${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`)
      if (!date.ok) return date
      const time = validateWallTime({ hour: Number(part('hour')), minute: Number(part('minute')), second: Number(part('second')),
        millisecond: ((instant % 1000) + 1000) % 1000 })
      if (!time.ok) return time
      const encoded = wallEncoding({ date: date.data, time: time.data })
      if (!encoded.ok) return encoded
      const offsetMilliseconds = encoded.data - instant
      if (Math.abs(offsetMilliseconds) >= MAX_OFFSET) return { ok: false, error: { code: 'UNAVAILABLE', message: '时区偏移超出可解析范围。' } }
      return success({ date: date.data, time: time.data, timeZoneId: value.resolvedOptions().timeZone, offsetMilliseconds })
    } catch { return { ok: false, error: { code: 'UNAVAILABLE', message: '无法将瞬时时间投影到本地时间。' } } }
  }
  return {
    project(instant, zone) {
      const checked = validateInstant(instant)
      if (!checked.ok) return checked
      const value = formatter(zone)
      return value.ok ? projectWith(checked.data, value.data) : value
    },
    resolve(local, zone): Result<LocalTimeResolution> {
      const checked = validateStructure(local, v.object<LocalDateTime>({
        date: v.string(LOCAL_DATE_PATTERN, 10),
        time: wallTimeValidator
      }))
      if (!checked.ok) return checked
      const encoded = wallEncoding(checked.data)
      if (!encoded.ok) return encoded
      const value = formatter(zone)
      if (!value.ok) return value
      if (value.data.resolvedOptions().timeZone === 'UTC') {
        const instant = validateInstant(encoded.data)
        return instant.ok ? success({ kind: 'unique', instant: instant.data }) : instant
      }
      // Discover ICU/IANA offset regimes in the entire candidate UTC interval.
      // Minute sampling covers its ordinary DST, half-hour and date-line changes;
      // the offset itself retains historical seconds. Do not run this on each tick.
      // This adapter does not claim support for hypothetical sub-minute regimes.
      const offsets = new Set<number>()
      const lower = Math.max(MIN_INSTANT, encoded.data - MAX_OFFSET)
      const upper = Math.min(MAX_INSTANT, encoded.data + MAX_OFFSET)
      for (let probe = lower; probe <= upper; probe += MILLISECONDS_PER_MINUTE) {
        const projected = projectWith(probe, value.data)
        if (!projected.ok) {
          // Probes can cross the supported local calendar's ends. They are not
          // the requested wall time; other in-range probes still expose offsets.
          if (outsideLocalRange(projected)) continue
          return projected
        }
        offsets.add(projected.data.offsetMilliseconds)
      }
      const candidates: number[] = []
      let outOfRange: Result<never> | undefined
      for (const offset of offsets) {
        const candidate = encoded.data - offset
        const instant = validateInstant(candidate)
        if (!instant.ok) { outOfRange = instant; continue }
        const projected = projectWith(candidate, value.data)
        if (!projected.ok) return projected
        const roundTrip = wallEncoding(projected.data)
        if (!roundTrip.ok) return roundTrip
        if (roundTrip.data === encoded.data) candidates.push(candidate)
      }
      candidates.sort((a, b) => a - b)
      if (!candidates.length && outOfRange) return outOfRange
      if (!offsets.size) return validationFailure([issue('$.date', 'RANGE', '本地时间超出可解析范围。')])
      if (!candidates.length) return success({ kind: 'nonexistent', candidates: [] })
      if (candidates.length > 1) return success({ kind: 'ambiguous', candidates })
      return success({ kind: 'unique', instant: candidates[0] })
    }
  }
}
