import type { AppConfig, LocalDate, Result } from '../shared/contracts'
import { editableValidators } from '../shared/config-schema'
import { issue, success, v, validateStructure, validationFailure } from '../shared/validation'
import { normalizeLocalDate } from './local-date'

export type OvertimeConfig = AppConfig['overtime']
export type OvertimeEntry = OvertimeConfig['entries'][number]
export type OvertimeGuard = (candidate: OvertimeConfig, shiftDate: LocalDate) => Result<unknown>

export function validateOvertime(input: unknown): Result<OvertimeConfig> {
  const checked = validateStructure(input, editableValidators.overtime)
  if (!checked.ok) return checked
  for (const entry of checked.data.entries) {
    if (!normalizeLocalDate(entry.shiftDate).ok) return validationFailure([issue('$.entries.shiftDate', 'FORMAT', '加班归属日期不存在或越界。')])
  }
  return checked // Includes zero and history. No clock, purge or inferred date.
}
export function overtimeForDate(input: unknown, shiftDate: LocalDate): Result<number> {
  const checked = validateOvertime(input), date = normalizeLocalDate(shiftDate)
  if (!checked.ok) return checked
  if (!date.ok) return date
  return success(checked.data.entries.find(entry => entry.shiftDate === date.data)?.minutes ?? 0)
}
// Caller must supply the schedule conflict guard; there is no unchecked default.
export function setOvertimeForShift(input: unknown, shiftDate: LocalDate, minutes: number, guard: OvertimeGuard): Result<OvertimeConfig> {
  const checked = validateOvertime(input), date = normalizeLocalDate(shiftDate), amount = validateStructure(minutes, v.number(0, 600))
  if (!checked.ok) return checked
  if (!date.ok) return date
  if (!amount.ok) return amount
  const entry = checked.data.entries.find(item => item.shiftDate === date.data)
  if (entry) entry.minutes = amount.data
  else checked.data.entries.push({ shiftDate: date.data, minutes: amount.data })
  try {
    const approved = guard(checked.data, date.data)
    return approved.ok ? checked : approved
  } catch { return { ok: false, error: { code: 'UNAVAILABLE', message: '无法校验候选加班，原数据未修改。' } } }
}
export function clearOvertimeForShift(input: unknown, shiftDate: LocalDate): Result<OvertimeConfig> {
  const checked = validateOvertime(input), date = normalizeLocalDate(shiftDate)
  if (!checked.ok) return checked
  if (!date.ok) return date
  return success({ entries: checked.data.entries.filter(entry => entry.shiftDate !== date.data) })
}
