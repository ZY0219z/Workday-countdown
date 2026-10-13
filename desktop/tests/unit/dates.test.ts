import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Result } from '../../src/shared/contracts'
import { validateStructure } from '../../src/shared/validation'
import { dateFormat, timeFormat } from '../../src/shared/config-schema'
import {
  addDays, compareDates, daysInMonth, differenceInDays, formatLocalDate, fromDayOrdinal,
  isLeapYear, MAX_DAY_ORDINAL, normalizeLocalDate, parseLocalDate, toDayOrdinal, validateCivilDate
} from '../../src/domain/local-date'
import {
  differenceInMilliseconds, formatLocalTime, MAX_INSTANT, MIN_INSTANT, millisecondsToMinutes,
  millisecondsToSeconds, minutesSinceMidnight, minutesToMilliseconds, parseLocalTime,
  secondsToMilliseconds, timeFromMinutes, validateInstant, validateWallTime
} from '../../src/domain/local-time'
import { createClock, createFixedClock } from '../../src/domain/clock'
import { createIntlTimeZoneAdapter } from '../../src/adapters/intl-time-zone'
import { createSystemClock } from '../../src/adapters/system-clock'
import type { LocalDateTime } from '../../src/domain/time-zone'

function value<T>(result: Result<T>): T {
  assert.equal(result.ok, true, JSON.stringify(result))
  if (!result.ok) throw new Error('Expected success')
  return result.data
}
function rejected(result: Result<unknown>, code = 'VALIDATION'): void {
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.error.code, code)
    assert.equal(typeof result.error.message, 'string')
    if (result.error.code === 'VALIDATION') assert.ok(result.error.issues.length)
  }
}
const instant = (iso: string): number => Date.parse(iso) // Fixed fixtures, not system time.
const zones = createIntlTimeZoneAdapter()
const local = (date: string, time: string): LocalDateTime => ({ date, time: value(parseLocalTime(time)) })

test('2024-02-29 is a real date', () => {
  assert.deepEqual(value(parseLocalDate('2024-02-29')), { year: 2024, month: 2, day: 29 })
})
test('2025/2026 leap day and April 31 are rejected', () => {
  for (const date of ['2025-02-29', '2026-02-29', '2026-04-31', '2026-02-31']) rejected(parseLocalDate(date))
})
test('Gregorian century leap rules and invalid years', () => {
  for (const [year, expected] of [[1900, false], [2000, true], [2100, false], [2400, true]] as const) assert.equal(value(isLeapYear(year)), expected)
  for (const year of [0, 10000, NaN, Infinity, 2024.5, '2024', null]) rejected(isLeapYear(year))
})
test('actual month lengths support T11 foundation', () => {
  assert.equal(value(daysInMonth(2024, 2)), 29)
  assert.equal(value(daysInMonth(2026, 2)), 28)
  assert.equal(value(daysInMonth(2026, 4)), 30)
  assert.equal(value(daysInMonth(2026, 12)), 31)
  for (const month of [0, 13, 1.2, '2', null]) rejected(daysInMonth(2026, month))
})
test('strict date strings, null, object and noncanonical input', () => {
  for (const input of ['', null, undefined, 20260101, {}, '2026-1-01', '2026-01-1', ' 2026-01-01', '2026-01-01 ', '2026/01/01', '2026-00-01', '2026-13-01', '2026-01-00', '2026-01-32', '2026-01-01T00:00:00Z']) rejected(parseLocalDate(input))
})
test('supported date limits and 0-99 years have no Date remapping', () => {
  assert.equal(value(normalizeLocalDate('0001-01-01')), '0001-01-01')
  assert.equal(value(formatLocalDate({ year: 99, month: 2, day: 28 })), '0099-02-28')
  assert.equal(value(normalizeLocalDate('9999-12-31')), '9999-12-31')
  for (const input of ['0000-01-01', '10000-01-01', '-001-01-01']) rejected(parseLocalDate(input))
})
test('component formatting validates rather than normalizes overflow', () => {
  assert.equal(value(formatLocalDate({ year: 2026, month: 1, day: 2 })), '2026-01-02')
  rejected(validateCivilDate({ year: 2026, month: 4, day: 31 }))
  rejected(validateCivilDate({ year: 2026, month: 1, day: 1, unknown: true }))
  rejected(validateCivilDate(JSON.parse('{"year":2026,"month":1,"day":1,"__proto__":{}}')))
})
test('compare dates is validated and ordered', () => {
  assert.equal(value(compareDates('2026-12-31', '2027-01-01')), -1)
  assert.equal(value(compareDates('2027-01-01', '2026-12-31')), 1)
  assert.equal(value(compareDates('2026-10-13', '2026-10-13')), 0)
  rejected(compareDates('2026-02-29', '2026-03-01'))
})
test('adding/subtracting days crosses month, year and leap boundaries', () => {
  assert.equal(value(addDays('2026-12-31', 1)), '2027-01-01')
  assert.equal(value(addDays('2027-01-01', -1)), '2026-12-31')
  assert.equal(value(addDays('2024-02-28', 1)), '2024-02-29')
  assert.equal(value(addDays('2024-02-29', 1)), '2024-03-01')
  assert.equal(value(addDays('2026-04-30', 1)), '2026-05-01')
  assert.equal(value(addDays('2026-01-01', -365)), '2025-01-01')
})
test('adding days rejects fractional/unsafe values and boundary overflow', () => {
  for (const days of [0.5, '1', null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) rejected(addDays('2026-01-01', days))
  rejected(addDays('0001-01-01', -1))
  rejected(addDays('9999-12-31', 1))
  rejected(addDays('9999-12-31', Number.MAX_SAFE_INTEGER))
  assert.equal(value(addDays('0001-01-01', MAX_DAY_ORDINAL)), '9999-12-31')
})
test('ordinal anchors and out-of-range ordinals', () => {
  assert.equal(value(toDayOrdinal('0001-01-01')), 0)
  assert.equal(value(toDayOrdinal('1970-01-01')), 719162)
  assert.equal(value(toDayOrdinal('9999-12-31')), MAX_DAY_ORDINAL)
  assert.equal(value(fromDayOrdinal(MAX_DAY_ORDINAL)), '9999-12-31')
  for (const input of [-1, MAX_DAY_ORDINAL + 1, 1.5, NaN, null]) rejected(fromDayOrdinal(input))
})
test('round trip across the full range and a 400-year Gregorian cycle', () => {
  for (let day = 0; day <= MAX_DAY_ORDINAL; day += 7919) assert.equal(value(toDayOrdinal(value(fromDayOrdinal(day)))), day)
  assert.equal(value(differenceInDays('0001-01-01', '0401-01-01')), 146097)
  // Independent native UTC reference only for modern years; domain uses none.
  for (let year = 2000; year < 2400; year++) {
    const nextMarch = `${year}-03-01`
    const previous = value(addDays(nextMarch, -1))
    const reference = new Date(Date.UTC(year, 2, 0)).toISOString().slice(0, 10)
    assert.equal(previous, reference)
  }
})
test('signed natural date differences over leap months and year end', () => {
  assert.equal(value(differenceInDays('2024-02-28', '2024-03-01')), 2)
  assert.equal(value(differenceInDays('2026-02-28', '2026-03-01')), 1)
  assert.equal(value(differenceInDays('2026-12-31', '2027-01-01')), 1)
  assert.equal(value(differenceInDays('9999-12-31', '0001-01-01')), -MAX_DAY_ORDINAL)
})
test('T01 foundation: same/start-next/future dates retain signed difference', () => {
  assert.equal(value(differenceInDays('2026-10-16', '2026-10-16')), 0)
  assert.equal(value(differenceInDays('2026-10-16', '2026-10-17')), 1)
  assert.equal(value(differenceInDays('2026-10-16', '2026-10-19')), 3)
  assert.equal(value(differenceInDays('2026-10-20', '2026-10-19')), -1)
})
test('civil differences stay one across spring/fall DST and a skipped local date', () => {
  for (const [from, to] of [['2026-03-08', '2026-03-09'], ['2026-11-01', '2026-11-02'], ['2011-12-29', '2011-12-30']]) assert.equal(value(differenceInDays(from, to)), 1)
})
test('HH:MM boundary parsing and formatting', () => {
  assert.deepEqual(value(parseLocalTime('00:00')), { hour: 0, minute: 0, second: 0, millisecond: 0 })
  assert.equal(value(formatLocalTime(value(parseLocalTime('23:59')))), '23:59')
})
test('invalid times, types and leap seconds are rejected', () => {
  for (const input of ['24:00', '08:60', '8:30', '08:3', '08:30:00', ' 08:30', '08:30 ', '', null, undefined, 830]) rejected(parseLocalTime(input))
  rejected(validateWallTime({ hour: 23, minute: 59, second: 60, millisecond: 0 }))
  rejected(validateWallTime({ hour: 0, minute: 0, second: 0, millisecond: 1000 }))
})
test('D02 lexical validation remains separate from D03 date semantics', () => {
  assert.equal(validateStructure('2026-02-31', dateFormat).ok, true)
  rejected(parseLocalDate('2026-02-31'))
  for (const input of ['00:00', '23:59', '08:30', '8:30', '24:00', '08:60']) assert.equal(validateStructure(input, timeFormat).ok, parseLocalTime(input).ok)
})
test('minute of day conversion has no implicit date wrap', () => {
  assert.equal(value(minutesSinceMidnight('00:00')), 0)
  assert.equal(value(minutesSinceMidnight('23:59')), 1439)
  assert.equal(value(timeFromMinutes(510)), '08:30')
  for (const input of [-1, 1440, 1.5, '30']) rejected(timeFromMinutes(input))
})
test('signed duration conversions retain sub-second precision', () => {
  assert.equal(value(minutesToMilliseconds(90)), 5400000)
  assert.equal(value(minutesToMilliseconds(-0.5)), -30000)
  assert.equal(value(secondsToMilliseconds(0.8)), 800)
  assert.equal(value(millisecondsToSeconds(800)), 0.8)
  assert.equal(value(millisecondsToMinutes(90000)), 1.5)
})
test('duration conversion rejects lost millisecond precision and unsafe values', () => {
  for (const input of [NaN, Infinity, '10', null, Number.MAX_SAFE_INTEGER]) rejected(minutesToMilliseconds(input))
  rejected(secondsToMilliseconds(0.0001))
  rejected(millisecondsToSeconds(0.5))
})
test('instant validation is bounded and cross-day differences retain days', () => {
  assert.equal(value(validateInstant(MIN_INSTANT)), MIN_INSTANT)
  assert.equal(value(validateInstant(MAX_INSTANT)), MAX_INSTANT)
  for (const input of [MIN_INSTANT - 1, MAX_INSTANT + 1, 0.1, NaN, null]) rejected(validateInstant(input))
  const start = instant('2026-10-13T23:00:00.000Z'), end = instant('2026-10-15T01:00:00.000Z')
  assert.equal(value(millisecondsToSeconds(value(differenceInMilliseconds(start, end)))), 93600)
  assert.equal(value(differenceInMilliseconds(end, start)), -93600000)
})
test('T07 foundation: exact fractional milliseconds and boundary zero', () => {
  const end = instant('2026-10-13T18:00:00.000Z'), before = instant('2026-10-13T17:59:59.200Z')
  assert.equal(Math.ceil(value(millisecondsToSeconds(value(differenceInMilliseconds(before, end))))), 1)
  assert.equal(value(differenceInMilliseconds(end, end)), 0)
  // No schedule state or countdown target selection is implemented in D03.
})
test('one instant projects to different local dates and preserves milliseconds', () => {
  const epoch = instant('2026-10-13T16:00:00.125Z')
  const shanghai = value(zones.project(epoch, 'Asia/Shanghai'))
  assert.equal(shanghai.date, '2026-10-14')
  assert.deepEqual(shanghai.time, { hour: 0, minute: 0, second: 0, millisecond: 125 })
  assert.equal(shanghai.offsetMilliseconds, 28800000)
  assert.equal(value(zones.project(epoch, 'America/New_York')).date, '2026-10-13')
})
test('UTC projection and resolution preserve years 1/99 and epoch milliseconds', () => {
  assert.equal(value(zones.project(MIN_INSTANT, 'UTC')).date, '0001-01-01')
  const resolved = value(zones.resolve(local('0099-02-28', '00:00'), 'UTC'))
  assert.equal(resolved.kind, 'unique')
  if (resolved.kind === 'unique') assert.equal(value(zones.project(resolved.instant, 'UTC')).date, '0099-02-28')
  assert.equal(value(zones.project(-1, 'UTC')).time.millisecond, 999)
})
test('unknown zones and invalid local DTOs return structured errors', () => {
  rejected(zones.project(0, 'Invalid/Zone'))
  rejected(zones.project(NaN, 'UTC'))
  rejected(zones.resolve(local('2026-02-29', '09:00'), 'UTC'))
  rejected(zones.resolve({ ...local('2026-10-13', '09:00'), arbitrary: true } as LocalDateTime, 'UTC'))
})
test('ordinary Shanghai wall time resolves uniquely and round trips', () => {
  const resolved = value(zones.resolve(local('2026-10-13', '08:30'), 'Asia/Shanghai'))
  assert.deepEqual(resolved, { kind: 'unique', instant: instant('2026-10-13T00:30:00.000Z') })
})
test('DST spring gap is nonexistent rather than normalized', () => {
  assert.deepEqual(value(zones.resolve(local('2026-03-08', '02:30'), 'America/New_York')), { kind: 'nonexistent', candidates: [] })
})
test('DST fall fold exposes both sorted instants, choosing neither', () => {
  assert.deepEqual(value(zones.resolve(local('2026-11-01', '01:30'), 'America/New_York')), {
    kind: 'ambiguous', candidates: [instant('2026-11-01T05:30:00.000Z'), instant('2026-11-01T06:30:00.000Z')]
  })
})
test('DST transition boundaries classify exact missing and repeated endpoints', () => {
  assert.equal(value(zones.resolve(local('2026-03-08', '01:59'), 'America/New_York')).kind, 'unique')
  assert.equal(value(zones.resolve(local('2026-03-08', '02:00'), 'America/New_York')).kind, 'nonexistent')
  assert.equal(value(zones.resolve(local('2026-03-08', '03:00'), 'America/New_York')).kind, 'unique')
  assert.equal(value(zones.resolve(local('2026-11-01', '01:00'), 'America/New_York')).kind, 'ambiguous')
  assert.equal(value(zones.resolve(local('2026-11-01', '02:00'), 'America/New_York')).kind, 'unique')
})
test('non-one-hour DST change in Lord Howe is represented', () => {
  assert.equal(value(zones.resolve(local('2026-10-04', '02:15'), 'Australia/Lord_Howe')).kind, 'nonexistent')
  const fold = value(zones.resolve(local('2026-04-05', '01:45'), 'Australia/Lord_Howe'))
  assert.equal(fold.kind, 'ambiguous')
  if (fold.kind === 'ambiguous') assert.equal(fold.candidates[1] - fold.candidates[0], 1800000)
})
test('Apia skipped civil date remains valid but has no corresponding instant', () => {
  assert.equal(parseLocalDate('2011-12-30').ok, true)
  assert.equal(value(zones.resolve(local('2011-12-30', '12:00'), 'Pacific/Apia')).kind, 'nonexistent')
})
test('historical sub-minute offset survives projection and inverse matching', () => {
  const reading = value(zones.project(instant('1900-01-01T00:00:00.123Z'), 'Europe/Paris'))
  assert.equal(reading.offsetMilliseconds, 561000)
  const resolved = value(zones.resolve({ date: reading.date, time: reading.time }, 'Europe/Paris'))
  assert.deepEqual(resolved, { kind: 'unique', instant: instant('1900-01-01T00:00:00.123Z') })
})
test('DST local midnights have 23/25 instant hours but one civil day', () => {
  for (const [date, next, hours] of [['2026-03-08', '2026-03-09', 23], ['2026-11-01', '2026-11-02', 25]] as const) {
    const start = value(zones.resolve(local(date, '00:00'), 'America/New_York'))
    const end = value(zones.resolve(local(next, '00:00'), 'America/New_York'))
    assert.equal(start.kind, 'unique'); assert.equal(end.kind, 'unique')
    if (start.kind === 'unique' && end.kind === 'unique') assert.equal(value(differenceInMilliseconds(start.instant, end.instant)), hours * 3600000)
    assert.equal(value(differenceInDays(date, next)), 1)
  }
})
test('fixed clock crosses local midnight, moves backward and jumps forward', () => {
  const clock = value(createFixedClock(instant('2026-10-13T15:59:59.999Z'), 'Asia/Shanghai', zones))
  assert.equal(value(clock.read()).date, '2026-10-13')
  assert.equal(value(clock.advanceMilliseconds(1)).date, '2026-10-14')
  assert.equal(value(clock.advanceMilliseconds(-1)).date, '2026-10-13')
  assert.equal(value(clock.advanceMilliseconds(3 * 86400000)).date, '2026-10-16')
})
test('fixed clock can change zones without changing instant', () => {
  const epoch = instant('2026-10-13T16:30:00.000Z')
  const clock = value(createFixedClock(epoch, 'Asia/Shanghai', zones))
  assert.equal(value(clock.read()).date, '2026-10-14')
  const switched = value(clock.setTimeZone('America/New_York'))
  assert.equal(switched.instant, epoch); assert.equal(switched.date, '2026-10-13')
  assert.equal(value(clock.setInstant(instant('2027-01-01T05:00:00.000Z'))).date, '2027-01-01')
})
test('invalid fixed clock updates preserve its previous valid state', () => {
  const clock = value(createFixedClock(0, 'UTC', zones)), previous = value(clock.read())
  rejected(clock.advanceMilliseconds(0.1))
  rejected(clock.setInstant(MAX_INSTANT + 1))
  rejected(clock.setTimeZone('Invalid/Zone'))
  assert.deepEqual(value(clock.read()), previous)
  rejected(createFixedClock(NaN, 'UTC', zones))
})
test('injected system adapter rereads current epoch and zone without ticks', () => {
  let epoch = instant('2026-10-13T15:59:59.000Z'), zone = 'Asia/Shanghai', calls = 0
  const clock = createSystemClock({ now: () => { calls++; return epoch }, timeZoneId: () => zone }, zones)
  assert.equal(value(clock.read()).date, '2026-10-13')
  epoch = instant('2026-10-14T16:00:00.000Z')
  assert.equal(value(clock.read()).date, '2026-10-15')
  epoch = instant('2026-10-13T16:00:00.000Z'); zone = 'UTC'
  assert.equal(value(clock.read()).date, '2026-10-13')
  assert.equal(calls, 3)
})
test('real-system default adapter wiring is tested with fixed providers', () => {
  // No dependence on today's date, actual zone, or elapsed wall time.
  const originalNow = Date.now, originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions
  try {
    Date.now = () => instant('2026-10-13T12:34:56.789Z')
    Intl.DateTimeFormat.prototype.resolvedOptions = function () {
      const original = originalResolvedOptions.call(this)
      // Only the no-options system lookup uses year=numeric/month=numeric/day=numeric.
      return original.era ? original : { ...original, timeZone: 'UTC' }
    }
    const reading = value(createSystemClock().read())
    assert.equal(reading.instant, instant('2026-10-13T12:34:56.789Z'))
    assert.equal(reading.timeZoneId, 'UTC')
    assert.deepEqual(reading.time, { hour: 12, minute: 34, second: 56, millisecond: 789 })
  } finally { Date.now = originalNow; Intl.DateTimeFormat.prototype.resolvedOptions = originalResolvedOptions }
})
test('clock source exceptions and invalid sources stay structured', () => {
  rejected(createClock({ now: () => { throw new Error('private internal detail') }, timeZoneId: () => 'UTC' }, zones).read(), 'UNAVAILABLE')
  rejected(createClock({ now: () => 0, timeZoneId: () => null }, zones).read())
})
test('fixed clock follows DST jumps and folds by absolute instant', () => {
  const clock = value(createFixedClock(instant('2026-03-08T06:59:59.999Z'), 'America/New_York', zones))
  assert.equal(value(clock.read()).time.hour, 1)
  assert.equal(value(clock.advanceMilliseconds(1)).time.hour, 3)
  value(clock.setInstant(instant('2026-11-01T05:59:59.999Z')))
  assert.equal(value(clock.read()).time.hour, 1)
  const folded = value(clock.advanceMilliseconds(1))
  assert.equal(folded.time.hour, 1); assert.equal(folded.time.minute, 0)
  assert.equal(folded.offsetMilliseconds, -18000000)
})
test('non-UTC range-edge probes do not reject valid wall times', () => {
  const last = value(zones.resolve(local('9999-12-31', '23:59'), 'Asia/Shanghai'))
  assert.deepEqual(last, { kind: 'unique', instant: instant('9999-12-31T15:59:00.000Z') })
  const first = value(zones.resolve(local('0001-01-01', '12:00'), 'America/New_York'))
  assert.equal(first.kind, 'unique')
  if (first.kind === 'unique') assert.deepEqual(value(zones.project(first.instant, 'America/New_York')).time, local('0001-01-01', '12:00').time)
})
test('zone projection or resolution outside supported instant/date range is rejected', () => {
  rejected(zones.project(MIN_INSTANT, 'America/New_York'))
  rejected(zones.project(MAX_INSTANT, 'Asia/Shanghai'))
  rejected(zones.resolve(local('0001-01-01', '00:00'), 'Asia/Shanghai'))
  rejected(zones.resolve(local('9999-12-31', '23:59'), 'America/New_York'))
})
test('a failing injected zone adapter does not partially update the fixed clock', () => {
  const broken = { resolve: zones.resolve, project(epoch: number, zone: string) {
    if (epoch === 1) throw new Error('adapter failure')
    return zones.project(epoch, zone)
  } }
  const clock = value(createFixedClock(0, 'UTC', broken)), previous = value(clock.read())
  rejected(clock.setInstant(1), 'UNAVAILABLE')
  assert.deepEqual(value(clock.read()), previous)
})
