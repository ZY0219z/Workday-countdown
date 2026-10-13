import type { LocalTime, Result } from '../shared/contracts'
import { LOCAL_TIME_PATTERN } from '../shared/formats'
import { success, v, validateStructure } from '../shared/validation'

export interface WallTime { hour: number; minute: number; second: number; millisecond: number }
// An Instant is an absolute epoch millisecond, never a local time or duration.
export type Instant = number
export const MILLISECONDS_PER_SECOND = 1000
export const SECONDS_PER_MINUTE = 60
export const MILLISECONDS_PER_MINUTE = 60_000
export const MILLISECONDS_PER_DAY = 86_400_000 // UTC encoding only, not a civil date difference.
export const MIN_INSTANT = -62_135_596_800_000 // 0001-01-01T00:00:00.000Z
export const MAX_INSTANT = 253_402_300_799_999 // 9999-12-31T23:59:59.999Z

export const wallTimeValidator = v.object<WallTime>({
  hour: v.number(0, 23), minute: v.number(0, 59), second: v.number(0, 59), millisecond: v.number(0, 999)
})
export function validateWallTime(input: unknown): Result<WallTime> {
  return validateStructure(input, wallTimeValidator)
}
export function parseLocalTime(input: unknown): Result<WallTime> {
  const checked = validateStructure(input, v.string(LOCAL_TIME_PATTERN, 5))
  if (!checked.ok) return checked
  const [hour, minute] = checked.data.split(':').map(Number)
  return success({ hour, minute, second: 0, millisecond: 0 })
}
export function formatLocalTime(input: WallTime): Result<LocalTime> {
  const checked = validateWallTime(input)
  return checked.ok ? success(`${String(checked.data.hour).padStart(2, '0')}:${String(checked.data.minute).padStart(2, '0')}`) : checked
}
export function minutesSinceMidnight(input: LocalTime): Result<number> {
  const time = parseLocalTime(input)
  return time.ok ? success(time.data.hour * 60 + time.data.minute) : time
}
export function timeFromMinutes(input: unknown): Result<LocalTime> {
  const checked = validateStructure(input, v.number(0, 1439))
  return checked.ok ? success(`${String(Math.floor(checked.data / 60)).padStart(2, '0')}:${String(checked.data % 60).padStart(2, '0')}`) : checked
}
export function validateInstant(input: unknown): Result<Instant> {
  return validateStructure(input, v.number(MIN_INSTANT, MAX_INSTANT))
}
export function minutesToMilliseconds(input: unknown): Result<number> { return scaleDuration(input, MILLISECONDS_PER_MINUTE) }
export function secondsToMilliseconds(input: unknown): Result<number> { return scaleDuration(input, MILLISECONDS_PER_SECOND) }
function scaleDuration(input: unknown, multiplier: number): Result<number> {
  const checked = validateStructure(input, v.number(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, false))
  if (!checked.ok) return checked
  return validateStructure(checked.data * multiplier, v.number(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
}
export function millisecondsToSeconds(input: unknown): Result<number> {
  const checked = validateStructure(input, v.number(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
  return checked.ok ? success(checked.data / MILLISECONDS_PER_SECOND) : checked
}
export function millisecondsToMinutes(input: unknown): Result<number> {
  const checked = validateStructure(input, v.number(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
  return checked.ok ? success(checked.data / MILLISECONDS_PER_MINUTE) : checked
}
export function differenceInMilliseconds(from: Instant, to: Instant): Result<number> {
  const start = validateInstant(from), end = validateInstant(to)
  if (!start.ok) return start
  return end.ok ? success(end.data - start.data) : end
}
