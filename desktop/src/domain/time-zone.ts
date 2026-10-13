import type { LocalDate, Result } from '../shared/contracts'
import type { Instant, WallTime } from './local-time'

export type TimeZoneId = string
export interface LocalDateTime { date: LocalDate; time: WallTime }
export interface ZonedDateTime extends LocalDateTime {
  timeZoneId: TimeZoneId
  offsetMilliseconds: number // local wall-clock encoding minus UTC epoch.
}
export type LocalTimeResolution =
  | { kind: 'unique'; instant: Instant }
  | { kind: 'nonexistent'; candidates: [] }
  | { kind: 'ambiguous'; candidates: Instant[] }

// Explicit inputs: never choose the machine's zone inside a business calculation.
// A gap/fold is a successful classification, NOT permission to normalize/select.
export interface TimeZoneAdapter {
  project(instant: Instant, timeZoneId: TimeZoneId): Result<ZonedDateTime>
  resolve(local: LocalDateTime, timeZoneId: TimeZoneId): Result<LocalTimeResolution>
}
