import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Result } from '../../src/shared/contracts'
import { validateJsonDto } from '../../src/shared/validation'
import { addDays } from '../../src/domain/local-date'
import { annualPackagePayload, createCalendarYear, validateAnnualPackage, validateCalendarManifest,
  type AnnualCalendarPackage, type CalendarYear } from '../../src/domain/annual-calendar'
import { createCalendar, findNextRestDay, findNextWorkDay, findPreviousWorkDay, findCalendarDay, isRestDay, isWorkDay, overridesFromEntries,
  setDateOverride, validateDateOverrides, type Calendar, type CalendarRules } from '../../src/domain/calendar'
import { createCalendarStore, loadBundledCalendarStore } from '../../src/main/services/calendar-store'

function value<T>(result: Result<T>): T {
  assert.equal(result.ok, true, JSON.stringify(result))
  if (!result.ok) throw new Error('Expected success')
  return result.data
}
function rejected(result: Result<unknown>, code = 'VALIDATION'): void {
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.error.code, code)
    if (result.error.code === 'VALIDATION') assert.ok(result.error.issues.length > 0)
  }
}
const hash = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')
const readPackage = (year: number): AnnualCalendarPackage => JSON.parse(readFileSync(`resources/calendar/${year}.json`, 'utf8'))
const readManifest = (): unknown => JSON.parse(readFileSync('resources/calendar/manifest.json', 'utf8'))
const store = value(loadBundledCalendarStore())
const allYears = [2024, 2025, 2026].map(year => value(store.readYear(year))!)
const rules = (): CalendarRules => ({ workWeek: [1, 2, 3, 4, 5], overrides: {} })
const calendar = (input: CalendarRules = rules(), years: CalendarYear[] = allYears): Calendar => value(createCalendar(input, years))
const baseline = calendar()
function seal(data: AnnualCalendarPackage): AnnualCalendarPackage {
  data.restDates.sort(); data.workDates.sort()
  data.integrity.restCount = data.restDates.length; data.integrity.workCount = data.workDates.length
  data.integrity.sha256 = hash(annualPackagePayload(data))
  return data
}
function fixture(year = 2027): AnnualCalendarPackage {
  // Synthetic fixture: never official data and never shipped as a future year.
  return seal({ schemaVersion: 1, region: 'CN', year, version: 'test.1', restDates: [], workDates: [],
    source: { title: `国务院办公厅关于${year}年部分节假日安排的通知`, noticeNumber: `国办发明电〔${year - 1}〕1号`,
      url: 'https://www.gov.cn/test-fixture', references: [], publishedOn: `${year - 1}-01-01` }, coverage: 'partial',
    verification: { status: 'unverified', checkedOn: null, evidence: null },
    integrity: { algorithm: 'sha256', canonicalization: 'ordered-fields-v1', restCount: 0, workCount: 0, sha256: '0'.repeat(64) } })
}

test('all bundled years pass structure, semantics, checksum and reviewed registry', () => {
  for (const [index, year] of [2024, 2025, 2026].entries()) {
    const data = value(validateAnnualPackage(readPackage(year)))
    assert.equal(data.integrity.sha256, hash(annualPackagePayload(data)))
    assert.equal(allYears[index].verification, 'verified')
    assert.equal(allYears[index].data.coverage, 'complete')
  }
  assert.deepEqual(allYears.map(year => [year.data.restDates.length, year.data.workDates.length]), [[28, 8], [28, 5], [33, 6]])
})
test('2024 Sunday makeup and encouraged New Year eve exclusion', () => {
  const makeup = value(baseline.getDay('2024-02-04'))
  assert.equal(makeup.weekday, 7); assert.equal(makeup.kind, 'work'); assert.equal(makeup.quality.source, 'annual')
  const eve = value(baseline.getDay('2024-02-09'))
  assert.equal(eve.kind, 'work'); assert.equal(eve.quality.source, 'weekRule')
  assert.equal(allYears[0].data.restDates.includes('2024-02-09'), false)
})
test('all eight 2024 Spring Festival dates are explicit official rest', () => {
  for (let day = 10; day <= 17; day++) {
    const result = value(baseline.getDay(`2024-02-${day}`))
    assert.equal(result.kind, 'rest'); assert.equal(result.quality.source, 'annual'); assert.equal(result.quality.approximate, false)
  }
})
test('2025 Spring Festival crosses months and has Sunday/Saturday makeup', () => {
  assert.equal(value(baseline.getDay('2025-01-26')).kind, 'work')
  for (const date of ['2025-01-28','2025-01-29','2025-01-30','2025-01-31','2025-02-01','2025-02-02','2025-02-03','2025-02-04']) assert.equal(value(baseline.getDay(date)).quality.source, 'annual')
  assert.equal(value(baseline.getDay('2025-02-08')).kind, 'work')
  assert.equal(value(baseline.getDay('2025-10-11')).kind, 'work')
})
test('2026 National Day and Saturday makeup match source', () => {
  assert.equal(value(baseline.getDay('2026-10-01')).kind, 'rest')
  const day = value(baseline.getDay('2026-10-10'))
  assert.equal(day.kind, 'work'); assert.equal(day.weekday, 6); assert.equal(day.quality.source, 'annual')
})
test('ordinary weekdays/weekends do not masquerade as official special dates', () => {
  const work = value(baseline.getDay('2026-10-13')), rest = value(baseline.getDay('2026-10-17'))
  assert.equal(work.kind, 'work'); assert.equal(rest.kind, 'rest')
  for (const day of [work, rest]) {
    assert.equal(day.quality.source, 'weekRule'); assert.equal(day.annual.verification, 'verified')
    assert.equal(day.annual.complete, true); assert.equal(day.quality.approximate, false)
  }
})
test('weekly rule changes ordinary dates but official exceptions retain priority', () => {
  const custom = calendar({ workWeek: [6, 7], overrides: {} })
  assert.equal(value(custom.getDay('2026-10-13')).kind, 'rest')
  assert.equal(value(custom.getDay('2026-10-17')).kind, 'work')
  assert.equal(value(custom.getDay('2026-10-10')).kind, 'work')
  assert.equal(value(custom.getDay('2026-10-01')).kind, 'rest')
})
test('user work/rest overrides win over official rest and makeup', () => {
  const custom = calendar({ ...rules(), overrides: { '2026-10-01': 'work', '2026-10-10': 'rest' } })
  for (const [date, kind] of [['2026-10-01','work'],['2026-10-10','rest']] as const) {
    const day = value(custom.getDay(date))
    assert.equal(day.kind, kind); assert.equal(day.quality.source, 'userOverride'); assert.equal(day.quality.approximate, false)
  }
})
test('deleting only a target override restores official/default judgment', () => {
  const input = { '2026-10-01': 'work', '2027-01-01': 'rest' } as const
  const updated = value(setDateOverride(input, '2026-10-01', null))
  assert.deepEqual(Object.keys(updated), ['2027-01-01'])
  assert.equal(value(calendar({ ...rules(), overrides: updated }).getDay('2026-10-01')).kind, 'rest')
  assert.equal(input['2026-10-01'], 'work')
})
test('calendar owns detached rules and immutable official data', () => {
  const input = rules(), custom = calendar(input)
  input.workWeek.push(6); input.overrides['2026-10-01'] = 'work'
  assert.equal(value(custom.getDay('2026-10-17')).kind, 'rest')
  assert.equal(value(custom.getDay('2026-10-01')).kind, 'rest')
  assert.ok(Object.isFrozen(allYears[0].data.restDates))
  assert.throws(() => allYears[0].data.restDates.push('2024-02-09'))
})
test('missing 2027 year falls back to weekly rule with structured quality', () => {
  const day = value(baseline.getDay('2027-01-04'))
  assert.equal(day.kind, 'work'); assert.equal(day.quality.source, 'weekRule'); assert.equal(day.quality.approximate, true)
  assert.deepEqual(day.quality.incompleteYears, [2027])
  assert.deepEqual(day.annual, { year: 2027, available: false, complete: false, verification: 'missing', version: null })
  assert.deepEqual(day.warnings, [{ code: 'CALENDAR_INCOMPLETE', year: 2027, reason: 'missing' }])
})
test('explicit missing-year override is custom and exact without inventing official coverage', () => {
  const day = value(calendar({ ...rules(), overrides: { '2027-01-04': 'rest' } }).getDay('2027-01-04'))
  assert.equal(day.kind, 'rest'); assert.equal(day.quality.source, 'userOverride'); assert.equal(day.quality.approximate, false)
  assert.equal(day.annual.available, false); assert.deepEqual(day.quality.incompleteYears, []); assert.deepEqual(day.warnings, [])
})
test('raw verified declaration cannot self-promote through package/manifest', () => {
  const changed = readPackage(2026)
  changed.restDates.push('2026-10-13'); seal(changed)
  const untrusted = value(createCalendarYear(changed, hash))
  assert.equal(untrusted.verification, 'unverified')
  const day = value(calendar(rules(), [untrusted]).getDay('2026-10-13'))
  assert.equal(day.kind, 'work'); assert.equal(day.quality.source, 'weekRule'); assert.equal(day.quality.annualVerification, 'unverified')
  assert.equal(day.annual.complete, false) // A self-declared complete package is not verified completeness.
  const manifest = { schemaVersion: 1, region: 'CN', version: 'test.1', years: [{ year: 2026, file: '2026.json', version: changed.version, sha256: changed.integrity.sha256 }] }
  assert.equal(value(value(createCalendarStore(manifest, [changed])).readYear(2026))!.verification, 'unverified')
})
test('unverified fixtures do not override weekly classification', () => {
  const data = fixture(); data.restDates = ['2027-01-04']; seal(data)
  const day = value(calendar(rules(), [value(createCalendarYear(data, hash))]).getDay('2027-01-04'))
  assert.equal(day.kind, 'work'); assert.equal(day.annual.verification, 'unverified'); assert.equal(day.quality.approximate, true)
})
test('reviewed partial data still marks incomplete annual coverage', () => {
  const data = readPackage(2026); data.coverage = 'partial'; seal(data)
  // Trusted unit-only review injection tests the pure propagation, not an approval.
  const partial = value(createCalendarYear(data, hash, data.integrity.sha256))
  const day = value(calendar(rules(), [partial]).getDay('2026-10-01'))
  assert.equal(day.kind, 'rest'); assert.equal(day.quality.source, 'annual'); assert.equal(day.annual.complete, false)
  assert.equal(day.quality.approximate, true); assert.equal(day.warnings[0].reason, 'partial')
})
test('invalid weekly elements, duplicates, empty rules and unknown fields rejected', () => {
  for (const workWeek of [[], [1,1], [0], [8], ['1'], [1.5]]) rejected(createCalendar({ workWeek, overrides: {} }, []))
  rejected(createCalendar({ ...rules(), zone: 'UTC' }, []))
})
test('override entries reject duplicate same or conflicting kinds', () => {
  for (const kind of ['work', 'rest']) rejected(overridesFromEntries([{ date: '2026-10-13', kind: 'work' }, { date: '2026-10-13', kind }]))
  assert.deepEqual(Object.keys(value(overridesFromEntries([{date:'2026-12-31',kind:'rest'},{date:'2027-01-01',kind:'work'}]))), ['2026-12-31','2027-01-01'])
})
test('override true dates, enum, unsafe keys, limits and extra schedule fields rejected', () => {
  for (const input of [{ '2026-02-29': 'rest' }, { '2026-10-13': 'holiday' }, { '2026-10-13': { startTime: '09:00' } }, JSON.parse('{"__proto__":"rest"}')]) rejected(validateDateOverrides(input))
  rejected(overridesFromEntries([{date:'2026-10-13',kind:'rest',startTime:'09:00'}]))
  rejected(setDateOverride({}, '2026-04-31', 'work'))
  rejected(setDateOverride({}, '2026-10-13', 'unknown' as 'work'))
  const tooMany = Object.fromEntries(Array.from({length:10001},(_,i)=>[String(i),'work']))
  rejected(validateDateOverrides(tooMany))
})
test('annual dates reject duplicates, wrong year, nonexistent day and conflict', () => {
  const changes: Array<(data: AnnualCalendarPackage) => void> = [
    data=>data.restDates.push('2026-10-01'), data=>data.restDates.push('2027-01-01'),
    data=>data.restDates.push('2026-02-29'), data=>data.workDates.push('2026-10-01')
  ]
  for (const change of changes) { const data = readPackage(2026); change(data); seal(data); rejected(validateAnnualPackage(data)) }
})
test('annual schema types, versions, unknown and dangerous keys rejected', () => {
  const data = readPackage(2026)
  for (const input of [null, [], {...data,schemaVersion:2}, {...data,region:'US'}, {...data,year:0}, {...data,year:'2026'}, {...data,workDates:'x'}, {...data,extra:true}]) rejected(validateAnnualPackage(input))
  rejected(validateAnnualPackage(JSON.parse(JSON.stringify(data).replace('"year":2026','"__proto__":{},"year":2026'))))
})
test('annual data ordering is canonical and deterministic', () => {
  const data = readPackage(2026); data.restDates.reverse()
  rejected(validateAnnualPackage(data))
  const original = readPackage(2026), reversed = Object.fromEntries(Object.entries(original).reverse())
  assert.equal(annualPackagePayload(value(validateAnnualPackage(reversed))), annualPackagePayload(original))
})
test('illegal source protocol, domain, credentials, port and whitespace rejected', () => {
  for (const url of ['http://www.gov.cn/a','https://www.gov.cn.evil.test/a','https://evil.test/a','file:///a','https://user:pass@www.gov.cn/a','https://www.gov.cn:444/a',' https://www.gov.cn/a']) {
    const data = readPackage(2026); data.source.url = url; rejected(validateAnnualPackage(data))
  }
})
test('source notice/title/publication date must match annual provenance', () => {
  const changes: Array<(data: AnnualCalendarPackage)=>void> = [data=>data.source.title='地方性假期', data=>data.source.noticeNumber='invalid',
    data=>data.source.noticeNumber='国办发明电〔2023〕1号', data=>data.source.publishedOn='2025-02-29', data=>data.source.publishedOn='2026-01-01']
  for (const change of changes) { const data = readPackage(2026); change(data); rejected(validateAnnualPackage(data)) }
})
test('verification declaration needs valid dated evidence and cannot precede publication', () => {
  for (const verification of [
    { status:'verified',checkedOn:null,evidence:null }, { status:'verified',checkedOn:'2025-01-01',evidence:'D04_CALENDAR_VERIFICATION.md#year2026' },
    { status:'verified',checkedOn:'2026-02-29',evidence:'D04_CALENDAR_VERIFICATION.md#year2026' },
    { status:'verified',checkedOn:'2026-10-13',evidence:'D04_CALENDAR_VERIFICATION.md#year2025' },
    { status:'unverified',checkedOn:'2026-10-13',evidence:'fake' }
  ]) rejected(validateAnnualPackage({ ...readPackage(2026), verification }))
})
test('checksum format, counts, algorithm and modified payload rejected', () => {
  const data = readPackage(2026)
  for (const integrity of [{...data.integrity,sha256:'invalid'},{...data.integrity,restCount:32},{...data.integrity,algorithm:'md5'}]) rejected(validateAnnualPackage({...data,integrity}))
  const changed = readPackage(2026); changed.version='changed'
  rejected(createCalendarYear(changed, hash))
  rejected(createCalendarYear(data, ()=>'invalid'))
  rejected(createCalendarYear(data, ()=>{ throw new Error('digest failed') }), 'UNAVAILABLE')
})
test('manifest rejects duplicate, mismatched, traversal and unsupported entries', () => {
  const data = value(validateCalendarManifest(readManifest()))
  for (const input of [{...data,schemaVersion:2},{...data,years:[data.years[0],data.years[0]]},
    {...data,years:[{...data.years[0],file:'../2024.json'}]}, {...data,years:[{...data.years[0],file:'2025.json'}]}, {...data,years:[...data.years].reverse()}]) rejected(validateCalendarManifest(input))
})
test('resource store rejects manifest/package mismatch and duplicates', () => {
  const manifest = readManifest()
  rejected(createCalendarStore(manifest, [readPackage(2024)]))
  rejected(createCalendarStore(manifest, [readPackage(2024),readPackage(2024),readPackage(2026)]))
  const changed = readPackage(2026); changed.version='changed'; seal(changed)
  rejected(createCalendarStore(manifest, [readPackage(2024),readPackage(2025),changed]))
})
test('only checked calendar years can be consumed, not serialized self-assertions', () => {
  rejected(createCalendar(rules(), [JSON.parse(JSON.stringify(allYears[0]))]))
  rejected(createCalendar(rules(), [allYears[0],allYears[0]]))
})
test('read-only metadata is detached and missing years explicit', () => {
  assert.equal(value(store.readYear(2027)), null)
  rejected(store.readYear(0))
  const metadata = store.listMetadata(); metadata[0].verification='unverified'
  assert.equal(store.listMetadata()[0].verification, 'verified')
  assert.equal(validateJsonDto(store.listMetadata()).ok, true)
})
test('explicit includeStart determines distance zero or later day', () => {
  const included = value(findNextWorkDay(baseline,'2026-10-13',{includeStart:true,maxDays:366}))
  const excluded = value(findNextWorkDay(baseline,'2026-10-13',{includeStart:false,maxDays:366}))
  assert.equal(included.status,'found'); assert.equal(excluded.status,'found')
  if(included.status==='found'&&excluded.status==='found') { assert.equal(included.distanceDays,0); assert.equal(excluded.distanceDays,1) }
})
test('search traverses official rest block and makeup weekends', () => {
  const work = value(findNextWorkDay(baseline,'2026-10-01',{includeStart:true,maxDays:366}))
  assert.equal(work.status,'found'); if(work.status==='found') assert.equal(work.date,'2026-10-08')
  const rest = value(findNextRestDay(baseline,'2026-10-09',{includeStart:false,maxDays:366}))
  assert.equal(rest.status,'found'); if(rest.status==='found') assert.equal(rest.date,'2026-10-11')
})
test('cross-year search uses next annual package when available', () => {
  const result = value(findNextWorkDay(baseline,'2024-12-31',{includeStart:false,maxDays:366}))
  assert.equal(result.status,'found')
  if(result.status==='found') { assert.equal(result.date,'2025-01-02'); assert.equal(result.distanceDays,2) }
  assert.equal(result.quality.approximate,false)
})
test('cross-year search propagates missing-year quality and warnings', () => {
  const result = value(findNextRestDay(baseline,'2026-12-31',{includeStart:false,maxDays:366}))
  assert.equal(result.status,'found')
  if(result.status==='found') assert.equal(result.date,'2027-01-02')
  assert.equal(result.quality.approximate,true); assert.deepEqual(result.quality.incompleteYears,[2027])
  assert.equal(result.warnings[0].reason,'missing')
})
test('uncertain skipped dates remain in search quality even when target is exact custom', () => {
  const custom = calendar({workWeek:[1,2,3,4,5,6,7],overrides:{'2027-01-03':'rest'}})
  const result = value(findNextRestDay(custom,'2026-12-31',{includeStart:false,maxDays:366}))
  assert.equal(result.status,'found'); if(result.status==='found') assert.equal(result.day.quality.approximate,false)
  assert.equal(result.quality.approximate,true); assert.deepEqual(result.quality.incompleteYears,[2027])
})
test('continuous work past search limit gives explicit notFound', () => {
  const result = value(findNextRestDay(calendar({workWeek:[1,2,3,4,5,6,7],overrides:{}},[]),'2026-01-01',{includeStart:false,maxDays:366}))
  assert.equal(result.status,'notFound'); assert.equal(result.checkedDays,366)
  if(result.status==='notFound') assert.equal(result.lastDate,'2027-01-02')
  assert.deepEqual(result.quality.incompleteYears,[2026,2027])
})
test('continuous rest beyond search limit gives notFound rather than today/zero', () => {
  const overrides = value(overridesFromEntries(Array.from({length:367},(_,i)=>({date:value(addDays('2026-01-01',i)),kind:'rest'}))))
  const result = value(findNextWorkDay(calendar({...rules(),overrides},[]),'2026-01-01',{includeStart:false,maxDays:366}))
  assert.equal(result.status,'notFound'); assert.equal(result.checkedDays,366)
  assert.equal('distanceDays' in result,false); assert.equal('date' in result,false)
})
test('366th-day target is included, 367th is excluded', () => {
  const target = value(addDays('2026-01-01',366))
  const exact = calendar({workWeek:[1,2,3,4,5,6,7],overrides:{[target]:'rest'}},[])
  const found = value(findNextRestDay(exact,'2026-01-01',{includeStart:false,maxDays:366}))
  assert.equal(found.status,'found'); if(found.status==='found') assert.equal(found.distanceDays,366)
  assert.equal(value(findNextRestDay(exact,'2026-01-01',{includeStart:false,maxDays:365})).status,'notFound')
  const outside = calendar({workWeek:[1,2,3,4,5,6,7],overrides:{[value(addDays('2026-01-01',367))]:'rest'}},[])
  assert.equal(value(findNextRestDay(outside,'2026-01-01',{includeStart:false,maxDays:366})).status,'notFound')
})
test('search options reject unknown, excessive, zero, fractional and implicit inclusion', () => {
  for(const maxDays of [0,367,-1,1.5,'366']) rejected(findNextWorkDay(baseline,'2026-10-13',{includeStart:true,maxDays} as never))
  rejected(findNextWorkDay(baseline,'2026-10-13',{maxDays:366} as never))
  rejected(findNextWorkDay(baseline,'2026-10-13',{includeStart:true,maxDays:366,extra:true} as never))
})
test('D03 lower/upper dates are valid, searches fail clearly on overflow', () => {
  const plain = calendar(rules(),[])
  assert.equal(value(plain.getDay('0001-01-01')).weekday,1)
  assert.equal(value(plain.getDay('9999-12-31')).kind,'work')
  assert.equal(value(findNextWorkDay(plain,'9999-12-31',{includeStart:true,maxDays:366})).status,'found')
  rejected(findNextWorkDay(plain,'9999-12-31',{includeStart:false,maxDays:366}))
  rejected(findNextRestDay(plain,'9999-12-31',{includeStart:true,maxDays:366}))
  rejected(plain.getDay('0000-12-31')); rejected(plain.getDay('2026-02-29'))
})
test('calendar decisions and search results are detached JSON DTOs', () => {
  const first = value(baseline.getDay('2027-01-04')); first.quality.incompleteYears.push(2099)
  assert.deepEqual(value(baseline.getDay('2027-01-04')).quality.incompleteYears,[2027])
  assert.equal(validateJsonDto(value(baseline.getDay('2026-10-01'))).ok,true)
  assert.equal(validateJsonDto(value(findNextRestDay(baseline,'2026-12-31',{includeStart:false,maxDays:366}))).ok,true)
})
test('T02 calendar foundation changes dates without computing employment totals', () => {
  assert.equal(value(isWorkDay(baseline,'2026-10-16')),true)
  assert.equal(value(isRestDay(baseline,'2026-10-17')),true)
  const changed = calendar({...rules(),overrides:{'2026-10-17':'work'}})
  assert.equal(value(isWorkDay(changed,'2026-10-17')),true)
  // No accumulated working-day/employment/salary calculation belongs to D04.
})
test('all notice date ranges match independently recorded official fixture', () => {
  const ranges: Record<number, Array<[string,string]>> = {
    2024:[['2024-01-01','2024-01-01'],['2024-02-10','2024-02-17'],['2024-04-04','2024-04-06'],['2024-05-01','2024-05-05'],['2024-06-10','2024-06-10'],['2024-09-15','2024-09-17'],['2024-10-01','2024-10-07']],
    2025:[['2025-01-01','2025-01-01'],['2025-01-28','2025-02-04'],['2025-04-04','2025-04-06'],['2025-05-01','2025-05-05'],['2025-05-31','2025-06-02'],['2025-10-01','2025-10-08']],
    2026:[['2026-01-01','2026-01-03'],['2026-02-15','2026-02-23'],['2026-04-04','2026-04-06'],['2026-05-01','2026-05-05'],['2026-06-19','2026-06-21'],['2026-09-25','2026-09-27'],['2026-10-01','2026-10-07']]
  }
  const makeup: Record<number,string[]> = {
    2024:['2024-02-04','2024-02-18','2024-04-07','2024-04-28','2024-05-11','2024-09-14','2024-09-29','2024-10-12'],
    2025:['2025-01-26','2025-02-08','2025-04-27','2025-09-28','2025-10-11'],
    2026:['2026-01-04','2026-02-14','2026-02-28','2026-05-09','2026-09-20','2026-10-10']
  }
  for(const year of [2024,2025,2026]) {
    const expected: string[]=[]
    for(const [start,end] of ranges[year]) for(let next=start;;) { expected.push(next); if(next===end) break; next=value(addDays(next,1)) }
    assert.deepEqual(readPackage(year).restDates,expected)
    assert.deepEqual(readPackage(year).workDates,makeup[year])
  }
})
test('original Python annual sets match reviewed packages without running Python', () => {
  const source = readFileSync('../workday_counter.py','utf8')
  for(const [constant,field] of [['HOLIDAYS','restDates'],['WORK_WEEKENDS','workDates']] as const) {
    const body = source.match(new RegExp(`${constant} = \\{([\\s\\S]*?)\\n\\}`))?.[1]
    assert.ok(body)
    const dates = [...body.matchAll(/"(\d{4}-\d{2}-\d{2})"/g)].map(match=>match[1])
    assert.equal(new Set(dates).size,dates.length)
    for(const year of [2024,2025,2026]) assert.deepEqual(dates.filter(date=>date.startsWith(String(year))).sort(),readPackage(year)[field])
  }
})
test('inclusive 366-day distance checks the start plus all 366 later candidates', () => {
  const everyDay = calendar({workWeek:[1,2,3,4,5,6,7],overrides:{}},[])
  const result = value(findNextRestDay(everyDay,'2026-01-01',{includeStart:true,maxDays:366}))
  assert.equal(result.status,'notFound'); assert.equal(result.checkedDays,367)
})
test('search retains prior missing-year uncertainty even when target year is complete', () => {
  const result = value(findNextWorkDay(baseline,'2023-12-30',{includeStart:true,maxDays:366}))
  assert.equal(result.status,'found')
  if(result.status==='found') { assert.equal(result.date,'2024-01-02'); assert.equal(result.day.quality.approximate,false) }
  assert.equal(result.quality.approximate,true); assert.deepEqual(result.quality.incompleteYears,[2023])
})
test('raw store input array is validated without invoking accessors or custom iterators', () => {
  let called = 0
  const packages = [readPackage(2024),readPackage(2025),readPackage(2026)]
  Object.defineProperty(packages,'0',{ enumerable:true, get() { called++; throw new Error('must not execute') } })
  rejected(createCalendarStore(readManifest(),packages)); assert.equal(called,0)
  const iterator = [readPackage(2024),readPackage(2025),readPackage(2026)]
  Object.defineProperty(iterator,Symbol.iterator,{ value() { called++; throw new Error('must not execute') } })
  rejected(createCalendarStore(readManifest(),iterator)); assert.equal(called,0)
})
test('D05 reverse workday lookup reuses makeup days and provenance',()=>{
  const result=value(findPreviousWorkDay(baseline,'2026-05-10',{includeStart:true,maxDays:366}))
  assert.equal(result.status,'found')
  if(result.status==='found'){assert.equal(result.date,'2026-05-09');assert.equal(result.distanceDays,1);assert.equal(result.quality.source,'annual')}
})
test('D05 reverse lookup propagates missing years and rejects lower-date overflow',()=>{
  const result=value(findPreviousWorkDay(baseline,'2027-01-03',{includeStart:true,maxDays:366}))
  assert.equal(result.quality.approximate,true);assert.deepEqual(result.quality.incompleteYears,[2027])
  rejected(findPreviousWorkDay(calendar({workWeek:[2],overrides:{}},[]),'0001-01-01',{includeStart:true,maxDays:366}))
})
test('D05 direction validation and original forward defaults remain explicit',()=>{
  rejected(findCalendarDay(baseline,'2026-05-10','work',{includeStart:true,maxDays:366},'invalid' as never))
  const original=value(findCalendarDay(baseline,'2026-05-10','work',{includeStart:true,maxDays:366}))
  assert.equal(original.status,'found');if(original.status==='found')assert.equal(original.date,'2026-05-11')
})
