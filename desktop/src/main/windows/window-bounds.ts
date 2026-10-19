import type { Result, WindowBounds } from '../../shared/contracts'
import { issue, success, v, validateStructure, validationFailure } from '../../shared/validation'

// Outer native window sizes in DIP; saved bounds still take precedence.
export const MAIN_WINDOW_DEFAULT_SIZE=Object.freeze({width:720,height:660})
export const MAIN_WINDOW_MINIMUM_SIZE=Object.freeze({width:480,height:520})
// Frameless mini: outer and content DIP sizes coincide.
export const MINI_WINDOW_DEFAULT_SIZE=Object.freeze({width:280,height:132})
export const MINI_WINDOW_MINIMUM_SIZE=Object.freeze({width:240,height:112})

export interface DisplayArea { id: number; workArea: WindowBounds; scaleFactor: number }
export interface BoundsWindow {
  getBounds(): WindowBounds
  setBounds(bounds: WindowBounds): void
  setMinimumSize(width: number, height: number): void
}
const rect = v.object<WindowBounds>({ x: v.number(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, false), y: v.number(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, false),
  width: v.number(1, Number.MAX_SAFE_INTEGER, false), height: v.number(1, Number.MAX_SAFE_INTEGER, false) })
export function restoreWindowBounds(saved: unknown, displays: readonly DisplayArea[], primaryId: number,
  defaults: WindowBounds, minimum: { width: number; height: number }): Result<{ bounds: WindowBounds; minimum: { width: number; height: number }; displayId: number }> {
  const areas = validateStructure(displays, v.array(v.object<DisplayArea>({ id: v.number(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
    workArea: rect, scaleFactor: v.number(0.1, 10, false) }), 1, 100, item => item.id))
  const original = validateStructure(saved === null ? defaults : saved, rect)
  const min = validateStructure(minimum, v.object({ width: v.number(1, 10000), height: v.number(1, 10000) }))
  if (!areas.ok) return areas
  if (!original.ok) return original
  if (!min.ok) return min
  const value = original.data
  const intersection = (area: WindowBounds) => Math.max(0, Math.min(value.x + value.width, area.x + area.width) - Math.max(value.x, area.x)) *
    Math.max(0, Math.min(value.y + value.height, area.y + area.height) - Math.max(value.y, area.y))
  let display = areas.data.find(item => item.id === primaryId) ?? areas.data[0], largest = 0
  for (const item of areas.data) { const overlap = intersection(item.workArea); if (overlap > largest) { largest = overlap; display = item } }
  // Electron workArea and BrowserWindow bounds are BOTH DIP. Do not multiply
  // or divide by scaleFactor; only physical-screen inputs would need conversion.
  const area = display.workArea, width = Math.min(Math.floor(area.width), Math.max(min.data.width, Math.round(value.width))),
    height = Math.min(Math.floor(area.height), Math.max(min.data.height, Math.round(value.height)))
  return success({ bounds: { x: Math.max(Math.ceil(area.x), Math.min(Math.round(value.x), Math.floor(area.x + area.width - width))),
    y: Math.max(Math.ceil(area.y), Math.min(Math.round(value.y), Math.floor(area.y + area.height - height))), width, height },
    minimum: { width: Math.min(min.data.width, width), height: Math.min(min.data.height, height) }, displayId: display.id })
}
// Windows native frames can report 1–2 extra DIP after a setBounds at fractional
// scaling. Correct from observed bounds rather than guessing a fixed DPI factor
// or allowing an offscreen tolerance. Odd DIP sizes can be unrepresentable at
// fractional scale: accept a measured rectangle wholly INSIDE the target, not
// exact equality that would oscillate between the neighbouring native sizes.
// No persistence or unbounded loop; settling is injectable in unit tests.
export async function applyRestoredBounds(window: BoundsWindow, restoration: { bounds: WindowBounds; minimum: { width: number; height: number } },
  settle: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 16))): Promise<Result<WindowBounds>> {
  let requested = { ...restoration.bounds }
  try {
    // Let the native DPI change caused by the previous move finish BEFORE
    // establishing a correction basis; do not chase its queued stale geometry.
    await settle()
    for (let attempt = 0; attempt < 3; attempt++) {
      const checked = validateStructure(requested, rect)
      if (!checked.ok) return checked
      const minimum = { width: Math.min(restoration.minimum.width, requested.width), height: Math.min(restoration.minimum.height, requested.height) }
      window.setMinimumSize(minimum.width, minimum.height)
      const target = restoration.bounds
      const fits = (actual: WindowBounds) => actual.x >= target.x && actual.y >= target.y &&
        actual.x + actual.width <= target.x + target.width && actual.y + actual.height <= target.y + target.height &&
        actual.width >= minimum.width && actual.height >= minimum.height
      const current = validateStructure(window.getBounds(), rect)
      if (!current.ok) return current
      if (fits(current.data)) return success(current.data)
      window.setBounds(requested)
      // Moving back from an absent/offscreen monitor queues a native DPI change.
      // Measuring in the same JS callback uses the previous conversion basis.
      await settle()
      const observed = validateStructure(window.getBounds(), rect)
      if (!observed.ok) return observed
      const actual = observed.data
      if (fits(actual)) return success(actual)
      requested = { x: requested.x + target.x - actual.x, y: requested.y + target.y - actual.y,
        width: requested.width + target.width - actual.width, height: requested.height + target.height - actual.height }
    }
    return validationFailure([issue('$.bounds', 'LIMIT', '原生窗口未接受有界位置修正，未宣称恢复成功。')])
  } catch { return { ok: false, error: { code: 'UNAVAILABLE', message: '无法调整原生窗口位置，请保留可操作主窗口。' } } }
}
