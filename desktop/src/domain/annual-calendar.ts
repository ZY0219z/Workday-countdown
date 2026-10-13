import type { LocalDate, Result, ValidationIssue } from '../shared/contracts'
import { LOCAL_DATE_PATTERN } from '../shared/formats'
import { issue, success, v, validateStructure, validationFailure } from '../shared/validation'
import { parseLocalDate, compareDates } from './local-date'

export interface AnnualCalendarPackage {
  schemaVersion: 1
  region: 'CN'
  year: number
  version: string
  restDates: LocalDate[]
  workDates: LocalDate[]
  source: { title: string; noticeNumber: string; url: string; references: string[]; publishedOn: LocalDate }
  coverage: 'complete' | 'partial' // Completeness of notice exceptions, NOT all days being official exceptions.
  verification: { status: 'verified' | 'unverified'; checkedOn: LocalDate | null; evidence: string | null }
  integrity: { algorithm: 'sha256'; canonicalization: 'ordered-fields-v1'; restCount: number; workCount: number; sha256: string }
}
export interface CalendarManifest {
  schemaVersion: 1
  region: 'CN'
  version: string
  years: Array<{ year: number; file: string; version: string; sha256: string }>
}
export type Sha256 = (text: string) => string // Pure injected digest; no Node/crypto import in domain.
const date = v.string(LOCAL_DATE_PATTERN, 10)
const sha = v.string(/^[a-f0-9]{64}$/, 64)
const version = v.string(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, 64)
const packageShape = v.object<AnnualCalendarPackage>({
  schemaVersion: v.enum([1] as const), region: v.enum(['CN'] as const), year: v.number(1, 9999), version,
  restDates: v.array(date, 0, 366, value => value), workDates: v.array(date, 0, 366, value => value),
  source: v.object({ title: v.string(undefined, 256), noticeNumber: v.string(/^国办发明电〔\d{4}〕[1-9]\d*号$/, 64),
    url: v.string(undefined, 2048), references: v.array(v.string(undefined, 2048), 0, 8, value => value), publishedOn: date }),
  coverage: v.enum(['complete', 'partial'] as const),
  verification: v.object({ status: v.enum(['verified', 'unverified'] as const), checkedOn: v.nullable(date), evidence: v.nullable(v.string(undefined, 256)) }),
  integrity: v.object({ algorithm: v.enum(['sha256'] as const), canonicalization: v.enum(['ordered-fields-v1'] as const),
    restCount: v.number(0, 366), workCount: v.number(0, 366), sha256: sha })
})
function officialUrl(input: string): boolean {
  if (input.trim() !== input || /\s/.test(input)) return false
  try {
    const url = new URL(input)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash &&
      (url.hostname === 'gov.cn' || url.hostname.endsWith('.gov.cn'))
  } catch { return false }
}
export function validateAnnualPackage(input: unknown): Result<AnnualCalendarPackage> {
  const checked = validateStructure(input, packageShape)
  if (!checked.ok) return checked
  const data = checked.data, issues: ValidationIssue[] = []
  const checkDate = (value: string, field: string, expectedYear?: number): void => {
    const parsed = parseLocalDate(value)
    if (!parsed.ok) issues.push(issue(field, 'FORMAT', '日期不存在或超出范围。'))
    else if (expectedYear !== undefined && parsed.data.year !== expectedYear) issues.push(issue(field, 'RANGE', '日期不属于年度包年份。'))
  }
  const rest = new Set(data.restDates)
  for (const key of ['restDates', 'workDates'] as const) data[key].forEach((value, index) => {
    checkDate(value, `$.${key}[${index}]`, data.year)
    if (index && value <= data[key][index - 1]) issues.push(issue(`$.${key}[${index}]`, 'FORMAT', '日期须唯一且按升序记录。'))
  })
  data.workDates.forEach((value, index) => { if (rest.has(value)) issues.push(issue(`$.workDates[${index}]`, 'DUPLICATE', '同日休假与补班冲突。')) })
  checkDate(data.source.publishedOn, '$.source.publishedOn')
  const noticeYear = Number(data.source.noticeNumber.match(/〔(\d{4})〕/)![1])
  const published = parseLocalDate(data.source.publishedOn)
  if (noticeYear < data.year - 1 || noticeYear > data.year || (published.ok && published.data.year !== noticeYear)) {
    issues.push(issue('$.source.noticeNumber', 'RANGE', '通知年份、发布日期与年度不匹配。'))
  }
  if (data.source.title !== `国务院办公厅关于${data.year}年部分节假日安排的通知`) issues.push(issue('$.source.title', 'FORMAT', '来源标题与全国年度通知不匹配。'))
  for (const [index, url] of [data.source.url, ...data.source.references].entries()) {
    if (!officialUrl(url)) issues.push(issue(index === 0 ? '$.source.url' : `$.source.references[${index - 1}]`, 'FORMAT', '来源须为无凭据的HTTPS政府网站URL。'))
  }
  if (data.verification.status === 'verified') {
    if (!data.verification.checkedOn || !data.verification.evidence) issues.push(issue('$.verification', 'MISSING_FIELD', '核验声明必须含日期与证据记录。'))
    else {
      checkDate(data.verification.checkedOn, '$.verification.checkedOn')
      const comparison = compareDates(data.source.publishedOn, data.verification.checkedOn)
      if (comparison.ok && comparison.data > 0) issues.push(issue('$.verification.checkedOn', 'RANGE', '核验不能早于通知发布。'))
      if (!/^D04_CALENDAR_VERIFICATION\.md#year(?:\d{4})$/.test(data.verification.evidence) || !data.verification.evidence.endsWith(String(data.year).padStart(4, '0'))) {
        issues.push(issue('$.verification.evidence', 'FORMAT', '核验证据须指向对应年度记录。'))
      }
    }
  } else if (data.verification.checkedOn !== null || data.verification.evidence !== null) issues.push(issue('$.verification', 'FORMAT', '未核验数据不得含已核验元数据。'))
  if (data.integrity.restCount !== data.restDates.length || data.integrity.workCount !== data.workDates.length) issues.push(issue('$.integrity', 'RANGE', '记录计数不匹配。'))
  return issues.length ? validationFailure(issues) : checked
}
// Fixed order, validated fields only. Digest excludes itself/counts; counts are
// separately checked. Arrays are required sorted, so content has one encoding.
export function annualPackagePayload(data: AnnualCalendarPackage): string {
  return JSON.stringify({ schemaVersion: data.schemaVersion, region: data.region, year: data.year, version: data.version,
    restDates: data.restDates, workDates: data.workDates,
    source: { title: data.source.title, noticeNumber: data.source.noticeNumber, url: data.source.url,
      references: data.source.references, publishedOn: data.source.publishedOn }, coverage: data.coverage,
    verification: { status: data.verification.status, checkedOn: data.verification.checkedOn, evidence: data.verification.evidence } })
}
export function validateCalendarManifest(input: unknown): Result<CalendarManifest> {
  const checked = validateStructure(input, v.object<CalendarManifest>({ schemaVersion: v.enum([1] as const), region: v.enum(['CN'] as const), version,
    years: v.array(v.object({ year: v.number(1, 9999), file: v.string(/^\d{4}\.json$/, 9), version, sha256: sha }), 0, 9999, value => value.year) }))
  if (!checked.ok) return checked
  const issues: ValidationIssue[] = []
  checked.data.years.forEach((entry, index) => {
    if (entry.file !== `${String(entry.year).padStart(4, '0')}.json`) issues.push(issue(`$.years[${index}].file`, 'FORMAT', '年度文件名不匹配。'))
    if (index && entry.year <= checked.data.years[index - 1].year) issues.push(issue(`$.years[${index}].year`, 'FORMAT', '年度须唯一且升序。'))
  })
  return issues.length ? validationFailure(issues) : checked
}

// Registered checked values are in-memory capabilities, not IPC DTOs. Raw JSON
// cannot forge effective verification by copying a status or checksum field.
export interface CalendarYear {
  readonly data: Readonly<AnnualCalendarPackage>
  readonly verification: 'verified' | 'unverified'
}
const checkedYears = new WeakSet<object>()
export const isCheckedCalendarYear = (input: unknown): input is CalendarYear =>
  typeof input === 'object' && input !== null && checkedYears.has(input)
function freezeTree(value: object): void {
  for (const child of Object.values(value)) if (child !== null && typeof child === 'object') freezeTree(child)
  Object.freeze(value)
}
export function createCalendarYear(input: unknown, digest: Sha256, reviewedDigest?: string): Result<CalendarYear> {
  const validated = validateAnnualPackage(input)
  if (!validated.ok) return validated
  const data = validated.data
  try {
    const actual = digest(annualPackagePayload(data))
    if (!/^[a-f0-9]{64}$/.test(actual) || actual !== data.integrity.sha256) return validationFailure([issue('$.integrity.sha256', 'FORMAT', '年度内容摘要不匹配。')])
    const verification = reviewedDigest === actual && data.verification.status === 'verified' ? 'verified' : 'unverified'
    freezeTree(data)
    const output: CalendarYear = Object.freeze({ data, verification })
    checkedYears.add(output)
    return success(output)
  } catch { return { ok: false, error: { code: 'UNAVAILABLE', message: '无法校验年度数据摘要。' } } }
}
