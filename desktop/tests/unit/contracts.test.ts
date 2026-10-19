import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CONFIG_SCHEMA_VERSION, CONTRACT_VERSION, ERROR_CODES } from '../../src/shared/contracts'
import type { AppConfig, ContractRequests, ContractResponses, DashboardSnapshot, MiniWindowApi, Result } from '../../src/shared/contracts'
import { createAppConfig, validateAppConfig, validateDraftFields } from '../../src/shared/config-schema'
import { isCapabilityAllowed, validateContractRequest, checkExpectedRevision, WINDOW_CAPABILITIES } from '../../src/shared/capabilities'
import { createSettingsDraft, updateSettingsDraft, prepareDraftSave, beginDraftSave, finishDraftSave } from '../../src/shared/settings-draft'
import { MAX_DTO_BYTES, validateJsonDto } from '../../src/shared/validation'

function unwrap<T>(result: Result<T>): T { assert.ok(result.ok, JSON.stringify(result)); return result.data }
function config(): AppConfig {
  // Explicit fixture inputs, never production defaults or actual user config.
  return unwrap(createAppConfig({ updatedAt: '2026-10-13T00:00:00.000Z', appVersion: '2.0.0', startDate: null,
    startTime: '09:00', endTime: '18:00', salaryDay: 10, themeMode: 'system', themeAccent: 'ocean' }))
}
function reject(result: Result<unknown>, code = 'VALIDATION', field?: string): void {
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.error.code, code)
  assert.ok(ERROR_CODES.includes(result.error.code))
  assert.equal(typeof result.error.message, 'string')
  unwrap(validateJsonDto(result))
  if (field && result.error.code === 'VALIDATION') assert.ok(result.error.issues.some(item => item.field.includes(field)))
}
function change(path: string, value: unknown): unknown {
  const data = JSON.parse(JSON.stringify(config())) as Record<string, unknown>
  const keys = path.split('.')
  let target = data
  for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>
  target[keys.at(-1)!] = value
  return data
}

test('explicit factory inputs and only D01-confirmed defaults', () => {
  const value = config()
  assert.equal(value.schemaVersion, CONFIG_SCHEMA_VERSION)
  assert.equal(value.revision, 0)
  assert.equal(CONTRACT_VERSION, 1)
  assert.deepEqual(value.schedule.workWeek, [1, 2, 3, 4, 5])
  assert.deepEqual(value.schedule.breaks, [])
  assert.equal(value.schedule.startTime, '09:00')
  assert.equal(value.salary.nonWorkingPolicy, 'delay')
  assert.equal(value.salary.missingDayPolicy, 'monthEnd')
  assert.equal(value.salary.showPaydayAsToday, true)
  assert.equal(value.calendar.region, 'CN')
  assert.deepEqual(value.calendar.datasets, [])
  assert.equal(value.desktop.closeAction, 'hideToTray')
  assert.equal(value.desktop.miniEnabled, false)
  assert.equal(value.desktop.alwaysOnTop, false)
  assert.equal(value.desktop.displayMode, 'exclusive')
  assert.equal(value.employee.startDate, null)
  reject(createAppConfig({ updatedAt: '2026-10-13T00:00:00.000Z', appVersion: '2.0.0' } as never))
})
test('full configuration is copied, not aliased or mutated', () => {
  const input = config(), before = JSON.stringify(input)
  const result = unwrap(validateAppConfig(input))
  assert.equal(JSON.stringify(input), before)
  result.schedule.workWeek.push(6)
  result.employee.startDate = '2026-10-16'
  assert.deepEqual(input.schedule.workWeek, [1, 2, 3, 4, 5])
  assert.equal(input.employee.startDate, null)
})
test('null, arrays, primitives and class objects are not configurations', () => {
  for (const input of [null, [], false, 4, 'json', new Date(), new Map()]) reject(validateAppConfig(input))
})
test('required root and nested fields are identified', () => {
  const input = JSON.parse(JSON.stringify(config()))
  delete input.revision
  delete input.schedule.startTime
  const result = validateAppConfig(input)
  reject(result)
  if (!result.ok && result.error.code === 'VALIDATION') {
    assert.ok(result.error.issues.some(i => i.field === '$.revision' && i.reason === 'MISSING_FIELD'))
    assert.ok(result.error.issues.some(i => i.field === '$.schedule.startTime' && i.reason === 'MISSING_FIELD'))
  }
})
test('unknown root, nested and entry fields are rejected', () => {
  for (const path of ['serverUrl', 'schedule.backend', 'desktop.windowId']) reject(validateAppConfig(change(path, 'not allowed')), 'VALIDATION', path)
  reject(validateAppConfig(change('overtime.entries', [{ shiftDate: '2026-10-12', minutes: 60, extra: 1 }])), 'VALIDATION', 'extra')
})
test('each group validates primitive types without coercion', () => {
  for (const [path, value] of [['revision', '0'], ['employee.startDate', 123], ['schedule.crossMidnight', 'false'],
    ['salary.day', true], ['appearance.reduceMotion', 1], ['desktop.miniEnabled', null], ['migration.completed', {}]]) {
    reject(validateAppConfig(change(path as string, value)), 'VALIDATION', path as string)
  }
})
test('enums include all approved choices and reject unsupported features', () => {
  for (const policy of ['delay', 'advance', 'none']) unwrap(validateAppConfig(change('salary.nonWorkingPolicy', policy)))
  for (const mode of ['system', 'light', 'dark']) unwrap(validateAppConfig(change('appearance.mode', mode)))
  for (const accent of ['ocean', 'coral']) unwrap(validateAppConfig(change('appearance.accent', accent)))
  unwrap(validateAppConfig(change('desktop.closeAction', 'quit')))
  for (const [path, value] of [['salary.nonWorkingPolicy', 'random'], ['salary.missingDayPolicy', 'skip'],
    ['salary.showPaydayAsToday', false], ['calendar.region', 'US'], ['appearance.mode', 'auto'],
    ['appearance.accent', 'rainbow'], ['desktop.displayMode', 'coexist']]) reject(validateAppConfig(change(path as string, value)))
})
test('work week elements, nonempty length and duplicates', () => {
  for (const days of [[], [0], [8], [1.5], ['1'], [1, 1], [true]]) reject(validateAppConfig(change('schedule.workWeek', days)))
  unwrap(validateAppConfig(change('schedule.workWeek', [6, 7])))
})
test('overtime integer bounds, unique shift dates and preserved history/zero', () => {
  for (const minutes of [-1, 601, 2.5, '80', true, NaN, Infinity]) reject(validateAppConfig(change('overtime.entries', [{ shiftDate: '2025-01-01', minutes }])))
  const value = unwrap(validateAppConfig(change('overtime.entries', [{ shiftDate: '2024-01-01', minutes: 0 }, { shiftDate: '2025-01-01', minutes: 600 }])))
  assert.equal(value.overtime.entries.length, 2)
  assert.equal(value.overtime.entries[0].minutes, 0)
  reject(validateAppConfig(change('overtime.entries', [{ shiftDate: '2026-10-13', minutes: 1 }, { shiftDate: '2026-10-13', minutes: 2 }])))
})
test('basic date/time notation rejects bad ranges but defers calendar semantics', () => {
  for (const date of ['2026-2-01', '2026-00-01', '2026-13-01', '2026-02-00', '2026-02-32', '']) reject(validateAppConfig(change('employee.startDate', date)))
  for (const time of ['8:30', '24:00', '08:60', '09:00:00', '']) reject(validateAppConfig(change('schedule.startTime', time)))
  unwrap(validateAppConfig(change('employee.startDate', '2026-02-31')))
  unwrap(validateAppConfig(change('employee.startDate', '2027-01-01')))
  unwrap(validateAppConfig(change('schedule.startTime', '22:00'))) // No temporary interval calculator.
  unwrap(validateAppConfig(change('schedule.breaks', [
    { startTime: '12:00', endTime: '13:00', startDayOffset: 0, endDayOffset: 0 },
    { startTime: '12:30', endTime: '13:30', startDayOffset: 0, endDayOffset: 0 }
  ]))) // D06 will reject overlap.
  reject(validateAppConfig(change('schedule.breaks', [{ startTime: '12:00', endTime: '13:00', startDayOffset: 2, endDayOffset: 0 }])))
})
test('schema versions cannot be silently migrated or downgraded', () => {
  for (const version of [0, 1, 3, 99]) {
    const result = validateAppConfig(change('schemaVersion', version))
    reject(result, 'UNSUPPORTED_SCHEMA')
    if (!result.ok && result.error.code === 'UNSUPPORTED_SCHEMA') assert.equal(result.error.direction, version > 2 ? 'future' : 'legacy')
  }
  for (const version of ['2', null, -1, 2.5]) reject(validateAppConfig(change('schemaVersion', version)))
})
test('revision and metadata format/ranges', () => {
  for (const revision of [-1, 0.1, Number.MAX_SAFE_INTEGER + 1]) reject(validateAppConfig(change('revision', revision)))
  for (const value of ['', '2026-10-13', '2026-10-13T25:00:00.000Z']) reject(validateAppConfig(change('updatedAt', value)))
  reject(validateAppConfig(change('appVersion', 'latest')))
  unwrap(validateAppConfig(change('appVersion', '2.0.0-beta.1+test')))
})
test('calendar metadata, overrides and migration bookkeeping', () => {
  const input = config()
  input.calendar.enabledYears = [2026]
  input.calendar.datasets = [{ year: 2026, version: '1', source: 'Fixture citation, not verified official data',
    publishedOn: '2025-11-04', sha256: 'a'.repeat(64), verification: 'unverified' }]
  input.calendar.overrides['2026-10-13'] = 'rest'
  input.migration.completed = [{ sourceKind: 'python-v1', sourceHash: 'b'.repeat(64), migratedAt: input.updatedAt }]
  unwrap(validateAppConfig(input))
  reject(validateAppConfig(change('calendar.enabledYears', [2026, 2026])))
  reject(validateAppConfig(change('calendar.overrides', { '2026-13-01': 'work' })))
  reject(validateAppConfig(change('calendar.overrides', { '2026-10-13': 'shift' })))
  input.calendar.datasets[0].sha256 = 'invalid'
  reject(validateAppConfig(input))
})
test('finite window bounds only; physical display clamping is deferred', () => {
  unwrap(validateAppConfig(change('desktop.bounds.main', { x: -100, y: 0, width: 480.5, height: 560 })))
  reject(validateAppConfig(change('desktop.bounds.main', { x: 0, y: 0, width: 0, height: 560 })))
  reject(validateAppConfig(change('desktop.bounds.main', { x: Infinity, y: 0, width: 480, height: 560 })))
})
test('dangerous keys at any depth including arrays and records are rejected', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const input = JSON.parse(JSON.stringify(config()))
    Object.defineProperty(input.employee, key, { enumerable: true, value: { polluted: true } })
    reject(validateAppConfig(input))
    const nested = JSON.parse(`{"entries":[{"${key}":1}]}`)
    reject(validateJsonDto(nested))
  }
  assert.equal(({} as Record<string, unknown>).polluted, undefined)
})
test('accessors are rejected without executing user getters or toJSON', () => {
  let called = false
  const input = config()
  Object.defineProperty(input, 'employee', { enumerable: true, get() { called = true; throw new Error('must not run') } })
  reject(validateAppConfig(input))
  reject(validateJsonDto({ toJSON() { called = true; return {} } }))
  assert.equal(called, false)
})
test('non-JSON data, cycles, sparse arrays, symbols and proxies fail as Result', () => {
  class NativeEventLike { sender = { send() {} } }
  const cycle: Record<string, unknown> = {}; cycle.self = cycle
  const sparse = new Array(2)
  const symbol = { [Symbol('event')]: 1 }
  const proxy = Proxy.revocable({}, {}); proxy.revoke()
  for (const input of [new NativeEventLike(), cycle, sparse, symbol, proxy.proxy, new Date(), { value: undefined }, { value: BigInt(1) }, { value: () => {} }]) {
    assert.doesNotThrow(() => reject(validateJsonDto(input)))
  }
})
test('DTO size/depth limits do not silently truncate data', () => {
  reject(validateJsonDto('x'.repeat(MAX_DTO_BYTES + 1)))
  let input: unknown = null
  for (let i = 0; i < 70; i++) input = { nested: input }
  reject(validateJsonDto(input))
})
test('main/mini capability lists and denied requests', () => {
  for (const method of WINDOW_CAPABILITIES.main) assert.equal(isCapabilityAllowed('main', method), true)
  for (const method of WINDOW_CAPABILITIES.mini) assert.equal(isCapabilityAllowed('mini', method), true)
  for (const method of ['config.read', 'config.save', 'settingsDraft.update', 'data.applyImport', 'calendar.applyImport'] as const) {
    assert.equal(isCapabilityAllowed('mini', method), false)
    reject(validateContractRequest('mini', method, null), 'FORBIDDEN')
  }
  reject(validateContractRequest('main', 'arbitrary-channel' as never, null), 'FORBIDDEN')
  reject(validateContractRequest('unknown' as never, 'snapshot.read', null), 'FORBIDDEN')
  assert.ok(Object.isFrozen(WINDOW_CAPABILITIES.mini))
})
test('window operations are enums, do not accept IDs/paths, mini is restricted', () => {
  unwrap(validateContractRequest('main', 'window.perform', { action: 'showMini' }))
  unwrap(validateContractRequest('mini', 'window.perform', { action: 'showMain' }))
  unwrap(validateContractRequest('mini', 'window.perform', { action: 'setMiniTop', enabled: false }))
  reject(validateContractRequest('mini', 'window.perform', { action: 'showMini' }), 'FORBIDDEN')
  for (const input of [{ action: 'openFile', path: 'C:/test' }, { action: 'showMain', windowId: 8 }, { action: 'setMiniTop' }]) reject(validateContractRequest('main', 'window.perform', input))
})
test('request DTOs reject paths, raw events, metadata writes and duplicate import fields', () => {
  const state = unwrap(createSettingsDraft(config()))
  const request = unwrap(prepareDraftSave(state, 0))
  unwrap(validateContractRequest('main', 'config.save', request))
  reject(validateContractRequest('main', 'config.save', { config: config(), expectedRevision: 0 }))
  reject(validateContractRequest('main', 'config.save', { ...request, schemaVersion: 99 }))
  reject(validateContractRequest('main', 'data.previewImport', { sourceKind: 'python-v1', path: 'C:/config.json' }))
  unwrap(validateContractRequest('main', 'data.applyImport', { previewToken: 'token', expectedRevision: 0,
    selectedFields: ['schedule.startTime'], undatedOvertimeShiftDate: null }))
  reject(validateContractRequest('main', 'data.applyImport', { previewToken: 'token', expectedRevision: 0,
    selectedFields: ['schedule.startTime', 'schedule.startTime'], undatedOvertimeShiftDate: null }))
  reject(validateContractRequest('main', 'snapshot.subscribe', { event: { sender: 1 } }))
})
test('all response DTO examples and failure results are JSON round-trip data', () => {
  const saved = config(), draft = unwrap(createSettingsDraft(saved))
  const quality = { approximate: false, incompleteYears: [], source: 'clock', annualVerification: 'notApplicable' } as const
  const snapshot: DashboardSnapshot = { sequence: 0, computedAt: 0, localDate: '2026-10-13', timeZoneId: 'Asia/Shanghai', configRevision: 0, calendarRevision: 0,
    state: 'incomplete', activeShift: null, employment: { status: 'unset', elapsedNaturalDays: null, plannedWorkDays: null,
      excludesToday: true, isActualAttendance: false, quality: { ...quality, incompleteYears: [] } }, nextRest: null, salary: null, countdown: null, progress: null, warnings: [] }
  const responses: ContractResponses = {
    'config.read': { config: saved, warnings: [] }, 'config.save': { config: saved, warnings: [] },
    'settingsDraft.read': draft, 'settingsDraft.update': draft, 'settingsDraft.discard': draft, 'settingsDraft.setExpectedEnd':draft,
    'snapshot.read': snapshot, 'snapshot.subscribe': null, 'snapshot.unsubscribe': null, 'window.perform': null, 'window.readVisibility':{visible:false,sequence:1}, 'window.readPresentation':{appearance:saved.appearance,miniEnabled:false,alwaysOnTop:false,sequence:1}, 'app.quit': null,
    'data.previewImport': { previewToken: 'token', sourceKind: 'python-v1', sourceHash: 'a'.repeat(64), expectedRevision: 0,
      choices: [{ field: 'schedule.startTime', current: '09:00', incoming: '08:30', issues: [] }], undatedOvertimeMinutes: 80 },
    'data.applyImport': { config: saved, warnings: [] }, 'data.export': null,
    'data.previewRecovery': { previewToken: 'recovery', sourceKind:'v2', sourceHash:'b'.repeat(64), expectedRevision:0, choices:[], undatedOvertimeMinutes:null },
    'data.cancelImport':null, 'calendar.readMetadata':[],
    'calendar.previewImport': { previewToken: 'token', expectedCalendarRevision: 0, metadata: {
      year: 2026, version: '1', source: 'fixture', publishedOn: '2025-11-04', sha256: 'a'.repeat(64), verification: 'unverified'
    }, restDateCount: 0, makeupDateCount: 0, issues: [] }, 'calendar.applyImport': { calendarRevision: 1 }
  }
  for (const data of Object.values(responses)) {
    const result = { ok: true, data }
    const checked = unwrap(validateJsonDto(result))
    assert.equal(JSON.stringify(checked), JSON.stringify(result))
  }
  reject(checkExpectedRevision(0, 1), 'REVISION_CONFLICT')
})
test('draft editing preserves saved and input configuration, and invalid values remain visible', () => {
  const saved = config(), before = JSON.stringify(saved)
  const state = unwrap(createSettingsDraft(saved))
  const input = JSON.parse(JSON.stringify(state.draft))
  input.salary.day = 'abc'
  const edited = unwrap(updateSettingsDraft(state, input))
  assert.equal(JSON.stringify(saved), before)
  assert.equal(state.dirty, false)
  assert.equal(edited.dirty, true)
  assert.ok(edited.issues.some(i => i.field === '$.salary.day'))
  assert.equal((edited.draft.salary as Record<string, unknown>).day, 'abc')
  input.schedule.workWeek.push(7)
  assert.deepEqual((edited.draft.schedule as Record<string, unknown>).workWeek, [1, 2, 3, 4, 5])
  reject(prepareDraftSave(edited, 0))
})
test('draft cannot change trusted metadata or smuggle unknown fields', () => {
  const state = unwrap(createSettingsDraft(config()))
  reject(updateSettingsDraft(state, { ...state.draft, revision: 9 }))
  const input = JSON.parse(JSON.stringify(state.draft)); input.calendar.datasets = []
  reject(updateSettingsDraft(state, input))
  reject(validateDraftFields({ employee: { startDate: null, backend: true } }))
})
test('unchanged draft is clean irrespective of top-level key order', () => {
  const state = unwrap(createSettingsDraft(config()))
  const reversed = Object.fromEntries(Object.entries(state.draft).reverse())
  assert.equal(unwrap(updateSettingsDraft(state, reversed)).dirty, false)
})
test('reordering calendar date keys does not falsely mark the draft dirty', () => {
  const saved = config()
  saved.calendar.overrides = { '2026-10-13': 'work', '2026-10-14': 'rest' }
  const state = unwrap(createSettingsDraft(saved))
  const input = JSON.parse(JSON.stringify(state.draft))
  input.calendar.overrides = { '2026-10-14': 'rest', '2026-10-13': 'work' }
  assert.equal(unwrap(updateSettingsDraft(state, input)).dirty, false)
})
test('save requests cannot forge the saved baseline revision or mutate metadata', () => {
  const state = unwrap(createSettingsDraft(config()))
  state.saved.revision = 1
  reject(prepareDraftSave(state, 0), 'REVISION_CONFLICT')
  state.saved.revision = 0
  const request = unwrap(prepareDraftSave(state, 0))
  assert.equal('updatedAt' in request.settings, false)
  assert.equal('datasets' in request.settings.calendar, false)
  assert.equal('migration' in request.settings, false)
})
test('revision conflict is expressible without mutating saved state', () => {
  const state = unwrap(createSettingsDraft(config()))
  reject(prepareDraftSave(state, 1), 'REVISION_CONFLICT')
  reject(beginDraftSave(state, 1), 'REVISION_CONFLICT')
  reject(checkExpectedRevision(-1, 0))
  assert.equal(state.save.status, 'idle')
  assert.equal(state.saved.revision, 0)
})
test('saving failure retains draft/old config; success accepts a validated new revision', () => {
  const state = unwrap(createSettingsDraft(config()))
  const input = JSON.parse(JSON.stringify(state.draft)); input.salary.day = 20
  const edited = unwrap(updateSettingsDraft(state, input))
  const saving = unwrap(beginDraftSave(edited, 0))
  assert.equal(saving.save.status, 'saving')
  assert.equal(edited.save.status, 'idle')
  reject(updateSettingsDraft(saving, saving.draft), 'UNAVAILABLE')
  const failed = unwrap(finishDraftSave(saving, { ok: false, error: { code: 'IO_DENIED', message: 'fixture failure' } }))
  assert.equal(failed.save.status, 'failed')
  assert.equal(failed.dirty, true)
  assert.equal(failed.saved.salary.day, 10)
  assert.equal((failed.draft.salary as Record<string, unknown>).day, 20)
  const accepted = config(); accepted.revision = 1; accepted.salary.day = 20
  const finished = unwrap(finishDraftSave(saving, { ok: true, data: accepted }))
  assert.equal(finished.save.status, 'saved')
  assert.equal(finished.dirty, false)
  assert.equal(finished.expectedRevision, 1)
  reject(finishDraftSave(saving, { ok: true, data: config() }), 'REVISION_CONFLICT')
})
test('failure state keeps its own copy of error data and rejects non-DTO failures', () => {
  const state = unwrap(beginDraftSave(unwrap(createSettingsDraft(config())), 0))
  const failure: Result<AppConfig> = { ok: false, error: { code: 'IO_BUSY', message: 'before' } }
  const failed = unwrap(finishDraftSave(state, failure))
  failure.error.message = 'after'
  assert.equal(failed.save.status, 'failed')
  if (failed.save.status === 'failed') assert.equal(failed.save.error.message, 'before')
  reject(finishDraftSave(state, { ok: false, error: { code: 'IO_BUSY', message: () => {} } } as never))
})
test('revision conflict metadata remains safe at the maximum allowed revision', () => {
  const saved = config(); saved.revision = Number.MAX_SAFE_INTEGER
  const state = unwrap(beginDraftSave(unwrap(createSettingsDraft(saved)), saved.revision))
  const result = finishDraftSave(state, { ok: true, data: saved })
  reject(result, 'REVISION_CONFLICT')
  if (!result.ok && result.error.code === 'REVISION_CONFLICT') assert.ok(Number.isSafeInteger(result.error.expectedRevision))
})

// Compile-time API checks; this function is never invoked and installs no bridge.
function checkMiniSurface(api: MiniWindowApi): void {
  // @ts-expect-error mini has no configuration write/read capability
  api.config.read()
  // @ts-expect-error generic Electron channels are not part of the contract
  api.invoke('arbitrary-channel')
  // @ts-expect-error arbitrary window IDs cannot be passed
  api.window.perform({ action: 'showMain', windowId: 42 })
  // @ts-expect-error mini cannot request main-only showMini even at compile time
  api.window.perform({ action: 'showMini' })
  // @ts-expect-error raw string paths are not request arguments
  const request: ContractRequests['calendar.previewImport'] = 'C:/calendar.json'
  void request
}
void checkMiniSurface

test('expected-end capability is main-only, bounded scratch data with no arbitrary target date or path',()=>{
  const request={expectedRevision:1,targetKey:'a'.repeat(64),input:'19:'}
  unwrap(validateContractRequest('main','settingsDraft.setExpectedEnd',request))
  unwrap(validateContractRequest('main','settingsDraft.setExpectedEnd',{...request,input:''}))
  unwrap(validateContractRequest('main','settingsDraft.setExpectedEnd',{...request,input:null}))
  reject(validateContractRequest('mini','settingsDraft.setExpectedEnd',request),'FORBIDDEN')
  for(const extra of [{shiftDate:'2026-10-15'},{path:'C:/arbitrary'},{windowId:1}])reject(validateContractRequest('main','settingsDraft.setExpectedEnd',{...request,...extra}))
  reject(validateContractRequest('main','settingsDraft.setExpectedEnd',{...request,input:'a'.repeat(33)}))
})
