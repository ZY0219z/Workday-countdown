import { createHash } from 'node:crypto'
import manifestResource from '../../../resources/calendar/manifest.json' with { type: 'json' }
import resource2024 from '../../../resources/calendar/2024.json' with { type: 'json' }
import resource2025 from '../../../resources/calendar/2025.json' with { type: 'json' }
import resource2026 from '../../../resources/calendar/2026.json' with { type: 'json' }
import type { CalendarDatasetMetadata, Result } from '../../shared/contracts'
import { issue, success, v, validateJsonDto, validateStructure, validationFailure } from '../../shared/validation'
import { createCalendarYear, validateCalendarManifest, type CalendarYear } from '../../domain/annual-calendar'

const digest = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')
// Capture a detached private registry once, before any caller can reuse JSON objects.
const reviewedManifest = validateCalendarManifest(manifestResource)
export interface CalendarStore {
  readYear(year: number): Result<CalendarYear | null>
  listMetadata(): CalendarDatasetMetadata[]
}
// Read-only, fixed bundled resources. No filesystem write, online request,
// configuration change, native chooser, preview token, or IPC registration.
export function createCalendarStore(manifest: unknown, packages: readonly unknown[]): Result<CalendarStore> {
  const checked = validateCalendarManifest(manifest)
  if (!checked.ok) return checked
  const trusted = reviewedManifest
  if (!trusted.ok) return trusted
  const safePackages = validateJsonDto(packages)
  if (!safePackages.ok) return safePackages
  if (!Array.isArray(safePackages.data) || safePackages.data.length !== checked.data.years.length) return validationFailure([issue('$.packages', 'RANGE', '包数量与清单不匹配。')])
  const years = new Map<number, CalendarYear>()
  for (const input of safePackages.data) {
    const year = createCalendarYear(input, digest)
    if (!year.ok) return year
    const entry = checked.data.years.find(item => item.year === year.data.data.year)
    if (!entry || entry.version !== year.data.data.version || entry.sha256 !== year.data.data.integrity.sha256) return validationFailure([issue('$.packages', 'FORMAT', '年度包与清单版本或摘要不匹配。')])
    if (years.has(entry.year)) return validationFailure([issue('$.packages', 'DUPLICATE', '同年重复包。')])
    // Verification is an allowlist of manually reviewed bundled digests, NOT
    // a self-asserted flag from an imported package, manifest, or user config.
    const approval = trusted.data.years.find(item => item.year === entry.year && item.version === entry.version && item.sha256 === entry.sha256)
    const approved = createCalendarYear(input, digest, approval?.sha256)
    if (!approved.ok) return approved
    years.set(entry.year, approved.data)
  }
  return success({
    readYear(input) {
      const parsed = validateStructure(input, v.number(1, 9999))
      return parsed.ok ? success(years.get(parsed.data) ?? null) : parsed
    },
    listMetadata() {
      return [...years.values()].sort((a, b) => a.data.year - b.data.year).map(year => ({ year: year.data.year,
        version: year.data.version, source: `${year.data.source.title}（${year.data.source.noticeNumber}）`,
        publishedOn: year.data.source.publishedOn, sha256: year.data.integrity.sha256, verification: year.verification }))
    }
  })
}
export const loadBundledCalendarStore = (): Result<CalendarStore> =>
  createCalendarStore(manifestResource, [resource2024, resource2025, resource2026])
