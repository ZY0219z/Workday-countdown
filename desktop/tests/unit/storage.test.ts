import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import type { AppConfig, ContractRequests, ImportField, ImportPreview, Result } from '../../src/shared/contracts'
import { IMPORT_FIELDS } from '../../src/shared/contracts'
import { nodeConfigFiles, configDirectory, type ConfigFiles } from '../../src/main/services/config-files'
import { createConfigStore, contentHash, type ConfigStore } from '../../src/main/services/config-store'
import { editableConfig, validateConfigSettings } from '../../src/main/services/config-validation'
import { createMigrationFiles, knownMigrationCandidates, type MigrationFiles } from '../../src/main/services/migration-files'
import { createMigrationService } from '../../src/main/services/migration-service'
import { createSettingsDraft, updateSettingsDraft, beginDraftSave, finishDraftSave } from '../../src/shared/settings-draft'
import { validateContractRequest } from '../../src/shared/capabilities'
import { context, initial, value, rejected, nativeZones } from './config-fixtures'

async function setup(t: TestContext, files: ConfigFiles = nodeConfigFiles, initialized = true) {
  const root = await mkdtemp(join(tmpdir(), 'workday-storage-'))
  t.after(async () => { assert.ok(isAbsolute(root) && root.startsWith(join(tmpdir(), 'workday-storage-'))); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) })
  const ctx = context(), options = { ...ctx, directory: root, appVersion: '2.0.0', files, retry: { attempts: 3, pause: async () => {} } }
  const store = value(createConfigStore(options)), primary = join(root, 'settings.json'), backup = join(root, 'settings.backup.json')
  if (initialized) value(await store.initialize(initial))
  return { root, ctx, options, store, primary, backup }
}
async function request(store: ConfigStore, change?: (config: ContractRequests['config.save']['settings']) => void) {
  const saved = value(await store.read()).config, settings = value(editableConfig(saved))
  change?.(settings)
  return { settings, expectedRevision: saved.revision }
}
const errno = (code: string) => Object.assign(new Error('injected private path must not leak'), { code })
async function sourceSetup(t: TestContext, kind: 'python-v1' | 'electron-poc' | 'v2' = 'python-v1', text?: string) {
  const app = await setup(t)
  const sourcePath = join(app.root, `source-${kind}.json`), exportPath = join(app.root, 'export.json')
  await writeFile(sourcePath, text ?? JSON.stringify({ start_date: '2027-01-01', work_start_time: '8:5', work_end_time: '18:0', salary_day: 31, overtime_minutes: 80 }))
  const sources = createMigrationFiles({ selectImport: async () => sourcePath, selectExport: async () => exportPath })
  const service = createMigrationService({ ...app.ctx, store: app.store, sources })
  return { ...app, sourcePath, exportPath, sources, service }
}
const application = (preview: ImportPreview, selectedFields: ImportField[] = preview.choices.filter(item => !item.issues.length && item.field !== 'overtime.entries').map(item => item.field), date: string | null = null) =>
  ({ previewToken: preview.previewToken, expectedRevision: preview.expectedRevision, selectedFields, undatedOvertimeShiftDate: date })

test('fixed APPDATA directory is isolated; no writable EXE-directory assumption', () => {
  assert.equal(value(configDirectory('C:\\Users\\fixture\\AppData\\Roaming')), 'C:\\Users\\fixture\\AppData\\Roaming\\Workday Escape')
  rejected(configDirectory('relative')); rejected(createConfigStore({ ...context(), directory: 'relative', appVersion: '2.0.0' }))
})
test('missing config stays missing without writes or guessed initial values T22', async t => {
  const app = await setup(t, nodeConfigFiles, false)
  assert.equal(value(await app.store.load()).status, 'missing'); rejected(await app.store.read(), 'UNAVAILABLE')
  assert.deepEqual(await readdir(app.root), [])
  rejected(await app.store.initialize({ ...initial, salaryDay: undefined } as never))
  assert.deepEqual(await readdir(app.root), [])
})
test('initialize and normal save increment exactly once, backup is previous valid config T20/T21', async t => {
  const app = await setup(t), first = await readFile(app.primary, 'utf8')
  assert.equal(value(await app.store.read()).config.revision, 1)
  const saved = value(await app.store.save(await request(app.store, s => { s.appearance.accent = 'coral' })))
  assert.equal(saved.config.revision, 2); assert.equal(await readFile(app.backup, 'utf8'), first)
  assert.equal(value(await value(createConfigStore(app.options)).load()).status, 'ready')
  assert.deepEqual((await readdir(app.root)).sort(), ['settings.backup.json','settings.json'])
})
test('same revision concurrent saves serialize; only first succeeds T21', async t => {
  const app = await setup(t), first = await request(app.store), second = structuredClone(first)
  first.settings.appearance.accent = 'coral'; second.settings.appearance.mode = 'dark'
  const [a,b] = await Promise.all([app.store.save(first), app.store.save(second)])
  assert.equal(value(a).config.revision, 2); rejected(b, 'REVISION_CONFLICT')
  assert.equal(value(await app.store.read()).config.appearance.mode, 'system')
})
test('external same-revision byte change is a conflict; reload makes a new deliberate base', async t => {
  const app = await setup(t), pending = await request(app.store)
  const config = value(await app.store.read()).config; config.appearance.mode = 'dark'
  await writeFile(app.primary, JSON.stringify(config)); rejected(await app.store.save(pending), 'REVISION_CONFLICT')
  assert.equal(value(await app.store.load()).status, 'ready')
  value(await app.store.save(await request(app.store))); assert.equal(value(await app.store.read()).config.appearance.mode, 'dark')
})
test('external backup modification cannot be silently overwritten', async t => {
  const app = await setup(t), pending = await request(app.store)
  await writeFile(app.backup, '{}'); rejected(await app.store.save(pending), 'REVISION_CONFLICT')
  assert.equal(value(await app.store.read()).config.revision, 1)
})
test('external future schema is read-only even when revision equals memory', async t => {
  const app = await setup(t), pending = await request(app.store)
  await writeFile(app.primary, '{"schemaVersion":3}'); rejected(await app.store.save(pending), 'UNSUPPORTED_SCHEMA')
  assert.equal(await readFile(app.primary,'utf8'), '{"schemaVersion":3}')
})
for (const [name, data, code] of [
  ['JSON corruption', '{bad', 'VALIDATION'], ['missing fields', '{"schemaVersion":2}', 'VALIDATION'],
  ['future schema', '{"schemaVersion":9}', 'UNSUPPORTED_SCHEMA'], ['primitive', 'null', 'VALIDATION']
] as const) test(`${name} distinguished from first launch and bytes preserved T22`, async t => {
  const app = await setup(t, nodeConfigFiles, false); await writeFile(app.primary, data)
  const loaded = value(await app.store.load()); assert.equal(loaded.status, name === 'future schema' ? 'future' : 'invalid')
  rejected(await app.store.initialize(initial), name === 'future schema' ? code : 'UNAVAILABLE')
  assert.equal(await readFile(app.primary,'utf8'), data)
})
test('valid backup is visible, ordinary save blocked pending confirmed recovery', async t => {
  const app = await setup(t); value(await app.store.save(await request(app.store)))
  await writeFile(app.primary, '{broken'); const loaded = value(await app.store.load())
  assert.equal(loaded.status, 'recoverable'); assert.equal(value(await app.store.read()).warnings.length,1)
  rejected(await app.store.save(await request(app.store)), 'UNAVAILABLE'); assert.equal(await readFile(app.primary,'utf8'), '{broken')
})
test('both broken files and future backup never reset defaults T22', async t => {
  const app = await setup(t); await writeFile(app.primary, 'oops'); await writeFile(app.backup, 'bad')
  assert.equal(value(await app.store.load()).status,'invalid')
  await writeFile(app.backup,'{"schemaVersion":3}'); assert.equal(value(await app.store.load()).status,'future')
  rejected(await app.store.initialize(initial),'UNSUPPORTED_SCHEMA')
})
test('denied and other reads return sanitized I/O results, no writes', async t => {
  for (const code of ['EACCES','EIO']) {
    const app = await setup(t, { ...nodeConfigFiles, read: async () => { throw errno(code) } }, false)
    const result = await app.store.load(); rejected(result, code === 'EACCES' ? 'IO_DENIED' : 'UNAVAILABLE')
    assert.ok(!JSON.stringify(result).includes('private path')); assert.deepEqual(await readdir(app.root), [])
  }
})
test('oversized and malformed UTF-8 source rejected before parsing', async t => {
  const app = await setup(t, nodeConfigFiles, false)
  await writeFile(app.primary, ' '.repeat(1024*1024+1)); rejected(await app.store.load())
  await writeFile(app.primary, Buffer.from([0xff])); rejected(await app.store.load(), 'UNAVAILABLE')
})
test('structure and real-date semantic failures leave old config and revision T22/T23', async t => {
  const app = await setup(t), before = await readFile(app.primary,'utf8')
  for (const change of [
    (s: ContractRequests['config.save']['settings']) => { s.employee.startDate='2026-02-29' },
    (s: ContractRequests['config.save']['settings']) => { s.calendar.overrides['2026-04-31']='rest' },
    (s: ContractRequests['config.save']['settings']) => { s.salary.day=32 },
    (s: ContractRequests['config.save']['settings']) => { s.schedule.endTime='08:00' },
    (s: ContractRequests['config.save']['settings']) => { s.schedule.breaks=[{startTime:'08:00',endTime:'10:00',startDayOffset:0,endDayOffset:0}] },
    (s: ContractRequests['config.save']['settings']) => { s.schedule.breaks=[{startTime:'09:00',endTime:'18:00',startDayOffset:0,endDayOffset:0}] }
  ]) { rejected(await app.store.save(await request(app.store,change))); assert.equal(await readFile(app.primary,'utf8'),before) }
})
test('dangerous keys, accessors, unknown fields and unserializable objects refused without invoking getters T23', async t => {
  const app = await setup(t), before = await readFile(app.primary,'utf8')
  for (const key of ['__proto__','constructor','prototype']) {
    const req=await request(app.store); Object.defineProperty(req.settings,key,{value:{evil:true},enumerable:true}); rejected(await app.store.save(req))
  }
  for (const extra of [{revision:999}, {schemaVersion:2}, {migration:{completed:[]}}, {updatedAt:'now'}, {shell:'open'}]) rejected(await app.store.save({...await request(app.store),...extra} as never))
  const accessor=await request(app.store); let invoked=false
  Object.defineProperty(accessor.settings.employee,'startDate',{enumerable:true,get(){invoked=true;return '2026-10-13'}})
  rejected(await app.store.save(accessor)); assert.equal(invoked,false)
  const req=await request(app.store); req.settings.employee.startDate = new Date() as never; rejected(await app.store.save(req))
  assert.equal(await readFile(app.primary,'utf8'),before)
})
test('annual verification metadata is never writable from settings; forged stored metadata rejected', async t => {
  const app=await setup(t), req=await request(app.store)
  Object.assign(req.settings.calendar,{datasets:[{verification:'verified'}]});rejected(await app.store.save(req))
  const config=value(await app.store.read()).config; config.calendar.enabledYears=[2026]; config.calendar.datasets=app.ctx.calendars.listMetadata().filter(x=>x.year===2026); config.calendar.datasets[0].sha256='0'.repeat(64)
  await writeFile(app.primary,JSON.stringify(config));const loaded=value(await app.store.load());assert.equal(loaded.status,'invalid')
  if(loaded.status==='invalid')assert.equal(loaded.primaryError.code,'FORBIDDEN')
})
test('calendar metadata is generated only from the host trusted registry', async t => {
  const app=await setup(t);const saved=value(await app.store.save(await request(app.store,s=>{s.calendar.enabledYears=[2026,2027]})))
  assert.deepEqual(saved.config.calendar.datasets,app.ctx.calendars.listMetadata().filter(x=>x.year===2026))
  assert.ok(saved.warnings.some(x=>x.message.includes('2027')))
})
test('changed overtime requires valid shift even for zero and past dates', async t => {
  const app=await setup(t)
  for(const [date,minutes]of [['2026-10-18',80],['2026-10-18',0],['2024-02-04',80],['2026-10-14',601]]as const){
    // Enabled years initially empty: 2024-02-04 is a weekly Sunday here.
    rejected(await app.store.save(await request(app.store,s=>{s.overtime.entries.push({shiftDate:date,minutes})})))
  }
})
test('future far-date overtime, neighbouring overlaps and changed calendar overrides are checked', async t => {
  const app=await setup(t)
  value(await app.store.save(await request(app.store,s=>{s.overtime.entries=[{shiftDate:'2028-01-03',minutes:600}]})))
  const bad=await request(app.store,s=>{s.schedule.startTime='03:00';s.schedule.endTime='18:00'})
  rejected(await app.store.save(bad));assert.equal(value(await app.store.read()).config.schedule.startTime,'09:00')
})
test('past inactive history survives schedule/week edits, reads, saves, restart and export', async t => {
  const app=await sourceSetup(t,'v2')
  const config=value(await app.store.read()).config;config.overtime.entries=[{shiftDate:'2024-02-04',minutes:80},{shiftDate:'2024-02-05',minutes:0}]
  await writeFile(app.sourcePath,JSON.stringify(config));const preview=value(await app.service.preview({sourceKind:'v2'}))
  value(await app.service.apply(application(preview,['overtime.entries'])))
  value(await app.store.save(await request(app.store,s=>{s.schedule.workWeek=[2,3,4,5]})))
  const loaded=value(await value(createConfigStore(app.options)).load());assert.deepEqual(loaded.config?.overtime.entries,config.overtime.entries)
  value(await app.service.exportConfig());assert.deepEqual(JSON.parse(await readFile(app.exportPath,'utf8')).overtime.entries,config.overtime.entries)
})
test('budget refusal does not claim unlimited global validation or save partial results', async t => {
  const app=await setup(t), config=value(await app.store.read()).config, settings=value(editableConfig(config));settings.schedule.startTime='08:30'
  rejected(validateConfigSettings(settings,config,{...app.ctx,maxValidationDates:20}))
  const result=value(validateConfigSettings(settings,config,app.ctx));assert.ok(result.checkedShiftDates.length>=367);assert.ok(result.warnings.some(x=>x.message.includes('未证明无限未来')))
})
test('DST gap in a relevant global edit fails instead of choosing a silent normalization', async t => {
  const app=await setup(t), config=value(await app.store.read()).config
  value(app.ctx.clock.setInstant(Date.parse('2026-03-08T06:00:00Z')));value(app.ctx.clock.setTimeZone('America/New_York'))
  const settings=value(editableConfig(config));settings.schedule.workWeek=[7];settings.schedule.startTime='02:30';settings.schedule.endTime='04:00'
  rejected(validateConfigSettings(settings,config,app.ctx))
})
for(const [label,operation,code] of [
  ['temporary write','write','EIO'],['flush/space exhaustion','write','ENOSPC'],['directory permission','mkdir','EACCES'],
  ['backup failure','backup','EIO'],['final replace failure','replace','EIO'],['file lock timeout','replace','EBUSY']
]as const)test(`${label} failure retains old valid bytes/revision and permits retry T20`,async t=>{
  let armed=false
  const files:ConfigFiles={...nodeConfigFiles,
    async mkdir(path){if(armed&&operation==='mkdir')throw errno(code);await nodeConfigFiles.mkdir(path)},
    async writeExclusiveFlush(path,text){if(armed&&operation==='write')throw errno(code);await nodeConfigFiles.writeExclusiveFlush(path,text)},
    async replace(from,to){if(armed&&((operation==='backup'&&to.endsWith('settings.backup.json'))||(operation==='replace'&&to.endsWith('settings.json'))))throw errno(code);await nodeConfigFiles.replace(from,to)}
  }
  const app=await setup(t,files),before=await readFile(app.primary,'utf8'),req=await request(app.store,s=>{s.appearance.mode='dark'})
  armed=true;rejected(await app.store.save(req),code==='EACCES'?'IO_DENIED':code==='EBUSY'?'IO_BUSY':'UNAVAILABLE')
  assert.equal(await readFile(app.primary,'utf8'),before);assert.equal(value(await app.store.read()).config.revision,1)
  armed=false;assert.equal(value(await app.store.save(req)).config.revision,2)
})
test('partial write interruption leaves original and valid backup, no false success T20',async t=>{
  let armed=false
  const files={...nodeConfigFiles,async writeExclusiveFlush(path:string,text:string){if(armed&&path.endsWith('.tmp')){await writeFile(path,text.slice(0,15));throw errno('EIO')}await nodeConfigFiles.writeExclusiveFlush(path,text)}}
  const app=await setup(t,files),before=await readFile(app.primary,'utf8');armed=true
  rejected(await app.store.save(await request(app.store)),'UNAVAILABLE');assert.equal(await readFile(app.primary,'utf8'),before)
  assert.equal((await readdir(app.root)).filter(x=>x.endsWith('.tmp')).length,0)
})
test('locked replacement retries finitely and recovers without deleting destination',async t=>{
  let armed=false,count=0
  const files={...nodeConfigFiles,async replace(from:string,to:string){if(armed&&to.endsWith('settings.json')&&++count<3)throw errno('EPERM');await nodeConfigFiles.replace(from,to)}}
  const app=await setup(t,files);armed=true;value(await app.store.save(await request(app.store)));assert.equal(count,3)
})
test('cleanup failure returns successful config plus warning; failed writes still fail',async t=>{
  let armed=false
  const files={...nodeConfigFiles,async remove(path:string){if(armed)throw errno('EACCES');await nodeConfigFiles.remove(path)}}
  const app=await setup(t,files);armed=true
  const saved=value(await app.store.save(await request(app.store)));assert.equal(saved.config.revision,2);assert.ok(saved.warnings.some(x=>x.message.includes('清理失败')))
})
test('random temp files use exclusive create; queue does not reuse a fixed tmp name',async t=>{
  const paths:string[]=[]
  const files={...nodeConfigFiles,async writeExclusiveFlush(path:string,text:string){paths.push(path);await nodeConfigFiles.writeExclusiveFlush(path,text)}}
  const app=await setup(t,files);value(await app.store.save(await request(app.store)));value(await app.store.save(await request(app.store)))
  assert.equal(new Set(paths).size,paths.length);assert.ok(paths.every(path=>path.startsWith(app.root)&&/\.[a-f0-9-]+\.tmp$/.test(path)))
})
test('external edit during temp write is caught immediately before replacement',async t=>{
  let armed=false,primary=''
  const files={...nodeConfigFiles,async writeExclusiveFlush(path:string,text:string){await nodeConfigFiles.writeExclusiveFlush(path,text);if(armed&&path.includes('settings.')){armed=false;await writeFile(primary,'{"schemaVersion":3}')}}}
  const app=await setup(t,files);primary=app.primary;armed=true
  rejected(await app.store.save(await request(app.store)),'UNSUPPORTED_SCHEMA');assert.equal(await readFile(primary,'utf8'),'{"schemaVersion":3}')
})
test('draft changes and failed save keep saved state and disk untouched T21',async t=>{
  const app=await setup(t),saved=value(await app.store.read()).config,before=await readFile(app.primary,'utf8')
  let draft=value(createSettingsDraft(saved));const raw=structuredClone(draft.draft);(raw.appearance as Record<string,unknown>).mode='dark'
  draft=value(updateSettingsDraft(draft,raw));assert.equal(draft.saved.appearance.mode,'system');assert.equal(await readFile(app.primary,'utf8'),before)
  const saving=value(beginDraftSave(draft,saved.revision)),failure:Result<AppConfig>={ok:false,error:{code:'REVISION_CONFLICT',message:'冲突',expectedRevision:1,actualRevision:2}}
  const failed=value(finishDraftSave(saving,failure));assert.equal(failed.dirty,true);assert.equal(failed.save.status,'failed');assert.deepEqual(failed.draft,draft.draft)
})
test('revision at maximum is rejected without arithmetic overflow',async t=>{
  const app=await setup(t),config=value(await app.store.read()).config;config.revision=Number.MAX_SAFE_INTEGER
  await writeFile(app.primary,JSON.stringify(config));value(await app.store.load());rejected(await app.store.save(await request(app.store)))
})
test('actual child interruption before final replacement preserves old data on restart T20',async t=>{
  const app=await setup(t),before=await readFile(app.primary,'utf8')
  const moduleRoot=dirname(fileURLToPath(import.meta.url)),storeUrl=new URL('../../src/main/services/config-store.mjs',import.meta.url).href,fixtureUrl=new URL('./config-fixtures.mjs',import.meta.url).href,filesUrl=new URL('../../src/main/services/config-files.mjs',import.meta.url).href,validationUrl=new URL('../../src/main/services/config-validation.mjs',import.meta.url).href
  const script=`import {createConfigStore} from ${JSON.stringify(storeUrl)};import {context,value} from ${JSON.stringify(fixtureUrl)};import {nodeConfigFiles} from ${JSON.stringify(filesUrl)};import {editableConfig} from ${JSON.stringify(validationUrl)};const files={...nodeConfigFiles,replace:async(a,b)=>{if(b.endsWith('settings.json')){process.send('before-replace');await new Promise(()=>{});}else await nodeConfigFiles.replace(a,b)}};const store=value(createConfigStore({...context(),directory:process.argv[1],appVersion:'2.0.0',files}));const c=value(await store.read()).config;await store.save({settings:value(editableConfig(c)),expectedRevision:c.revision});`
  const child=spawn(process.execPath,['--input-type=module','-e',script,app.root],{cwd:moduleRoot,stdio:['ignore','ignore','pipe','ipc'],windowsHide:true})
  t.after(()=>{if(child.exitCode===null)child.kill()})
  await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('child checkpoint timeout')),15000);child.once('message',()=>{clearTimeout(timer);resolve()});child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(new Error(`child exited ${code}`))})})
  const ended=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill();await ended
  assert.equal(await readFile(app.primary,'utf8'),before);assert.equal(await readFile(app.backup,'utf8'),before)
  assert.equal(value(await value(createConfigStore(app.options)).load()).status,'ready')
  // Process interruption leaves an owned temp file; do not call this a physical power-loss proof.
  assert.ok((await readdir(app.root)).some(x=>x.endsWith('.tmp')))
})
test('Python five fields normalize in read-only preview, preserve future start and policy T30',async t=>{
  const app=await sourceSetup(t),before=await readFile(app.sourcePath,'utf8'),primary=await readFile(app.primary,'utf8')
  value(await app.store.save(await request(app.store,s=>{s.salary.nonWorkingPolicy='advance'})))
  const preview=value(await app.service.preview({sourceKind:'python-v1'}));assert.equal(preview.undatedOvertimeMinutes,80)
  assert.equal(preview.choices.find(x=>x.field==='schedule.startTime')?.incoming,'08:05');assert.ok(preview.notes?.some(x=>x.message.includes('规范化')))
  assert.equal(value(await app.store.read()).config.migration.completed.length,0)
  const result=value(await app.service.apply(application(preview)));assert.equal(result.config.employee.startDate,'2027-01-01');assert.equal(result.config.salary.day,31);assert.equal(result.config.salary.nonWorkingPolicy,'advance')
  assert.deepEqual(result.config.schedule.breaks,[]);assert.deepEqual(result.config.overtime.entries,[])
  assert.equal(await readFile(app.sourcePath,'utf8'),before);assert.notEqual(await readFile(app.primary,'utf8'),primary)
  assert.equal(await readFile(join(app.root,`migration.${preview.sourceHash}.json`),'utf8'),before)
})
test('invalid Python fields are visible and cannot be selected; valid fields remain selectable',async t=>{
  const app=await sourceSetup(t,'python-v1',JSON.stringify({start_date:'2026-02-29',work_start_time:'25:00',salary_day:'10'}))
  const preview=value(await app.service.preview({sourceKind:'python-v1'}));assert.ok(preview.choices.every(x=>x.issues.length))
  rejected(await app.service.apply(application(preview,['employee.startDate'])))
})
test('missing Python fields and unknown legacy keys do not reset other values',async t=>{
  const app=await sourceSetup(t,'python-v1',JSON.stringify({salary_day:15,unknown:{privatePath:'do not apply'}}))
  const preview=value(await app.service.preview({sourceKind:'python-v1'}));assert.deepEqual(preview.choices.map(x=>x.field),['salary.day']);assert.ok(preview.notes?.some(x=>x.reason==='UNKNOWN_FIELD'))
  const saved=value(await app.service.apply(application(preview)));assert.equal(saved.config.schedule.startTime,'09:00');assert.equal(saved.config.employee.startDate,'2024-02-29')
})
test('POC migrates only present times, preserves salary/date/history and old file hash',async t=>{
  const app=await sourceSetup(t,'electron-poc',JSON.stringify({workStartTime:'08:30',workEndTime:'18:00'})),hash=contentHash(await readFile(app.sourcePath,'utf8'))
  const preview=value(await app.service.preview({sourceKind:'electron-poc'}));const saved=value(await app.service.apply(application(preview)))
  assert.equal(saved.config.employee.startDate,'2024-02-29');assert.equal(saved.config.salary.day,10);assert.equal(contentHash(await readFile(app.sourcePath,'utf8')),hash)
})
test('Python and POC coexist as independent selectable sources, never automatically merge',async t=>{
  const app=await sourceSetup(t),poc=join(app.root,'poc.json');await writeFile(poc,JSON.stringify({workStartTime:'10:00'}))
  const service=createMigrationService({...app.ctx,store:app.store,sources:createMigrationFiles({selectImport:async kind=>kind==='python-v1'?app.sourcePath:poc,selectExport:async()=>null})})
  const python=value(await service.preview({sourceKind:'python-v1'})),electron=value(await service.preview({sourceKind:'electron-poc'}))
  assert.equal(python.expectedRevision,electron.expectedRevision);assert.equal(value(await app.store.read()).config.schedule.startTime,'09:00')
  value(await service.apply(application(electron)));rejected(await service.apply(application(python)),'REVISION_CONFLICT')
  const refreshed=value(await service.preview({sourceKind:'python-v1'}));value(await service.apply(application(refreshed,['salary.day'])))
  assert.equal(value(await app.store.read()).config.schedule.startTime,'10:00')
})
test('old undated 80 minutes is skipped without an explicit date, valid date imports only one shift T31',async t=>{
  const app=await sourceSetup(t),preview=value(await app.service.preview({sourceKind:'python-v1'}))
  value(await app.service.apply(application(preview,['overtime.entries'])));assert.deepEqual(value(await app.store.read()).config.overtime.entries,[])
  const next=value(await app.service.preview({sourceKind:'python-v1'}));const req={...application(next,['overtime.entries'],'2026-10-14'),confirmPreviouslyImported:true}
  const saved=value(await app.service.apply(req));assert.deepEqual(saved.config.overtime.entries,[{shiftDate:'2026-10-14',minutes:80}])
})
test('explicit old overtime rejects rest-day/date errors and keeps unrelated history',async t=>{
  const app=await sourceSetup(t);value(await app.store.save(await request(app.store,s=>{s.overtime.entries=[{shiftDate:'2026-10-13',minutes:0}]})))
  const preview=value(await app.service.preview({sourceKind:'python-v1'}))
  for(const date of ['2026-10-18','2026-02-29'])rejected(await app.service.apply(application(preview,['overtime.entries'],date)))
  const saved=value(await app.service.apply(application(preview,['overtime.entries'],'2026-10-14')));assert.equal(saved.config.overtime.entries.length,2);assert.equal(saved.config.overtime.entries[0].minutes,0)
})
test('legacy inverted times never silently enable overnight or lunch',async t=>{
  const app=await sourceSetup(t,'python-v1',JSON.stringify({work_start_time:'22:00',work_end_time:'06:00'}))
  const preview=value(await app.service.preview({sourceKind:'python-v1'}));rejected(await app.service.apply(application(preview)))
  assert.equal(value(await app.store.read()).config.schedule.crossMidnight,false)
})
test('token source change requires new preview and does not write a ledger T32',async t=>{
  const app=await sourceSetup(t),before=await readFile(app.primary,'utf8'),preview=value(await app.service.preview({sourceKind:'python-v1'}))
  await writeFile(app.sourcePath,JSON.stringify({salary_day:20}));rejected(await app.service.apply(application(preview)),'UNAVAILABLE')
  assert.equal(await readFile(app.primary,'utf8'),before);value(await app.service.apply(application(value(await app.service.preview({sourceKind:'python-v1'})))))
})
test('token binds revision and allowed fields, no renderer path or forged token T23/T32',async t=>{
  const app=await sourceSetup(t,'electron-poc',JSON.stringify({workEndTime:'19:00'})),preview=value(await app.service.preview({sourceKind:'electron-poc'}))
  rejected(await app.service.apply(application(preview,['salary.day'])))
  rejected(await app.service.apply({...application(preview),previewToken:'forged'}),'UNAVAILABLE')
  rejected(await app.service.preview({sourceKind:'electron-poc',path:app.sourcePath}as never))
  assert.ok(!JSON.stringify(preview).includes(app.root));value(await app.store.save(await request(app.store)));rejected(await app.service.apply(application(preview)),'REVISION_CONFLICT')
})
test('token expires and clock rollback invalidates preview without writes',async t=>{
  for(const delta of [600000,-1]){
    const app=await sourceSetup(t),preview=value(await app.service.preview({sourceKind:'python-v1'})),before=await readFile(app.primary,'utf8')
    value(app.ctx.clock.advanceMilliseconds(delta));rejected(await app.service.apply(application(preview)),'UNAVAILABLE');assert.equal(await readFile(app.primary,'utf8'),before)
  }
})
test('cancel and semantic failure never add completion T32',async t=>{
  const app=await sourceSetup(t),preview=value(await app.service.preview({sourceKind:'python-v1'})),before=await readFile(app.primary,'utf8')
  value(app.service.cancel(preview.previewToken));rejected(await app.service.apply(application(preview)),'UNAVAILABLE');assert.equal(await readFile(app.primary,'utf8'),before)
  const invalid=value(await app.service.preview({sourceKind:'python-v1'}));rejected(await app.service.apply(application(invalid,['overtime.entries'],'2026-10-18')))
  assert.equal(value(await app.store.read()).config.migration.completed.length,0)
})
test('duplicate digest needs a fresh preview and explicit repeat confirmation, no duplicate ledger entries',async t=>{
  const app=await sourceSetup(t),preview=value(await app.service.preview({sourceKind:'python-v1'}));value(await app.service.apply(application(preview)))
  const repeated=value(await app.service.preview({sourceKind:'python-v1'}));assert.equal(repeated.alreadyProcessed,true)
  rejected(await app.service.apply(application(repeated)),'FORBIDDEN')
  value(await app.service.apply({...application(repeated),confirmPreviouslyImported:true}));assert.equal(value(await app.store.read()).config.migration.completed.length,1)
})
test('V2 export/reimport preserves business fields, overtime and overrides but not external system identity T33',async t=>{
  const app=await sourceSetup(t,'v2')
  value(await app.store.save(await request(app.store,s=>{s.overtime.entries=[{shiftDate:'2026-10-13',minutes:0}];s.calendar.overrides['2026-10-18']='work';s.appearance.mode='dark'})))
  value(await app.service.exportConfig());const exported=JSON.parse(await readFile(app.exportPath,'utf8'));assert.equal(exported.revision,0);assert.deepEqual(exported.migration.completed,[]);assert.deepEqual(exported.calendar.datasets,[])
  assert.ok(!JSON.stringify(exported).includes(app.root));await writeFile(app.sourcePath,JSON.stringify(exported))
  const preview=value(await app.service.preview({sourceKind:'v2'}));const result=value(await app.service.apply(application(preview,[...IMPORT_FIELDS])))
  assert.deepEqual(result.config.overtime,exported.overtime);assert.deepEqual(result.config.calendar.overrides,exported.calendar.overrides);assert.equal(result.config.appearance.mode,'dark');assert.equal(result.config.revision,3)
})
test('V2 unselected appearance/windows stay current and existing historical records are not purged',async t=>{
  const app=await sourceSetup(t,'v2');value(await app.store.save(await request(app.store,s=>{s.overtime.entries=[{shiftDate:'2026-10-13',minutes:0}]})))
  const incoming=value(await app.store.read()).config;incoming.appearance.mode='dark';incoming.desktop.miniEnabled=true;incoming.overtime.entries=[{shiftDate:'2024-02-04',minutes:80}];incoming.revision=999;incoming.appVersion='9.9.9';incoming.migration.completed=[{sourceKind:'v2',sourceHash:'0'.repeat(64),migratedAt:'2026-10-13T00:00:00.000Z'}]
  await writeFile(app.sourcePath,JSON.stringify(incoming));const preview=value(await app.service.preview({sourceKind:'v2'}));const saved=value(await app.service.apply(application(preview,['overtime.entries'])))
  assert.equal(saved.config.appearance.mode,'system');assert.equal(saved.config.desktop.miniEnabled,false);assert.equal(saved.config.overtime.entries.length,2);assert.equal(saved.config.appVersion,'2.0.0');assert.equal(saved.config.migration.completed.length,1)
})
test('V2 future schema refuses downgrade and untrusted yearly identity cannot assert verification',async t=>{
  const app=await sourceSetup(t,'v2','{"schemaVersion":3}');rejected(await app.service.preview({sourceKind:'v2'}),'UNSUPPORTED_SCHEMA')
  const config=value(await app.store.read()).config;config.calendar.enabledYears=[2027];config.calendar.datasets=[{year:2027,version:'fake',source:'fake',publishedOn:'2026-01-01',sha256:'0'.repeat(64),verification:'verified'}]
  await writeFile(app.sourcePath,JSON.stringify(config));const preview=value(await app.service.preview({sourceKind:'v2'}));const result=value(await app.service.apply(application(preview,['calendar.enabledYears'])))
  assert.deepEqual(result.config.calendar.datasets,[]);assert.ok(result.warnings.some(x=>x.message.includes('2027')))
})
test('recoverable damaged primary needs preview/confirmation, preserves damaged bytes and backup revision T33',async t=>{
  const app=await sourceSetup(t);value(await app.store.save(await request(app.store,s=>{s.appearance.mode='dark'})))
  const oldBackup=await readFile(app.backup,'utf8');await writeFile(app.primary,'{damaged');const preview=value(await app.service.previewRecovery())
  assert.equal(await readFile(app.primary,'utf8'),'{damaged');const saved=value(await app.service.apply(application(preview,[...IMPORT_FIELDS])))
  assert.equal(saved.config.revision,2);assert.equal(saved.config.appearance.mode,'system');assert.equal(await readFile(app.backup,'utf8'),oldBackup)
  const corrupt=(await readdir(app.root)).find(x=>x.startsWith('settings.corrupt.'))!;assert.equal(await readFile(join(app.root,corrupt),'utf8'),'{damaged')
  assert.equal(value(await app.store.load()).config?.revision,2)
})
test('healthy primary can preview older backup and safely save new revision',async t=>{
  const app=await sourceSetup(t);value(await app.store.save(await request(app.store,s=>{s.appearance.mode='dark'})))
  const before=await readFile(app.primary,'utf8'),preview=value(await app.service.previewRecovery());const result=value(await app.service.apply(application(preview,['appearance.mode'])))
  assert.equal(result.config.revision,3);assert.equal(result.config.appearance.mode,'system');assert.equal(await readFile(app.backup,'utf8'),before)
})
test('future schema and corrupt backup refuse recovery',async t=>{
  const app=await sourceSetup(t);await writeFile(app.backup,'bad');rejected(await app.service.previewRecovery())
  await writeFile(app.primary,'{"schemaVersion":3}');rejected(await app.service.previewRecovery(),'UNSUPPORTED_SCHEMA')
})
test('trusted handles and known source discovery never scan extraction/system paths',async t=>{
  const app=await sourceSetup(t);rejected(await app.sources.read({kind:'python-v1'}),'FORBIDDEN')
  assert.deepEqual(knownMigrationCandidates(app.root,null),[{kind:'electron-poc',path:join(app.root,'Workday Escape POC','settings.json')}])
  assert.equal(knownMigrationCandidates(app.root,join(app.root,'portable')).length,2);assert.deepEqual(knownMigrationCandidates('relative',null),[])
})
test('canceled chooser/export and existing export target do not overwrite any source',async t=>{
  const app=await setup(t),sources:MigrationFiles=createMigrationFiles({selectImport:async()=>null,selectExport:async()=>null}),service=createMigrationService({...app.ctx,store:app.store,sources})
  rejected(await service.preview({sourceKind:'python-v1'}),'CANCELLED');rejected(await service.exportConfig(),'CANCELLED')
  const guarded=createMigrationService({...app.ctx,store:app.store,sources:createMigrationFiles({selectImport:async()=>app.primary,selectExport:async()=>app.primary})})
  const before=await readFile(app.primary,'utf8');rejected(await guarded.exportConfig(),'IO_BUSY');assert.equal(await readFile(app.primary,'utf8'),before)
})
test('additive repeat-confirmation contract retains role restrictions and DTO errors',()=>{
  const req={previewToken:'fixture',expectedRevision:1,selectedFields:['salary.day'],undatedOvertimeShiftDate:null,confirmPreviouslyImported:true}
  value(validateContractRequest('main','data.applyImport',req));rejected(validateContractRequest('mini','data.applyImport',req),'FORBIDDEN')
  rejected(validateContractRequest('main','data.applyImport',{...req,confirmPreviouslyImported:'yes'}))
})
test('Python fixture source SHA-256 is identical after preview',async t=>{
  const app=await setup(t),fixture=JSON.stringify({start_date:'2026-01-01',work_start_time:'08:30',work_end_time:'18:00',salary_day:10,overtime_minutes:80})
  const copied=join(app.root,'python-readonly.json');await writeFile(copied,fixture);const before=contentHash(await readFile(copied,'utf8'))
  const service=createMigrationService({...app.ctx,store:app.store,sources:createMigrationFiles({selectImport:async()=>copied,selectExport:async()=>null})})
  value(await service.preview({sourceKind:'python-v1'}));assert.equal(contentHash(await readFile(copied,'utf8')),before)
})
test('failed migration replacement leaves no completion record and can retry the same preview',async t=>{
  let fail=false
  const files={...nodeConfigFiles,async replace(a:string,b:string){if(fail&&b.endsWith('settings.json'))throw errno('EIO');await nodeConfigFiles.replace(a,b)}}
  const app=await setup(t,files),path=join(app.root,'python.json');await writeFile(path,JSON.stringify({salary_day:31}))
  const service=createMigrationService({...app.ctx,store:app.store,sources:createMigrationFiles({selectImport:async()=>path,selectExport:async()=>null})})
  const preview=value(await service.preview({sourceKind:'python-v1'})),before=await readFile(app.primary,'utf8');fail=true
  rejected(await service.apply(application(preview)),'UNAVAILABLE');assert.equal(await readFile(app.primary,'utf8'),before);assert.equal(value(await app.store.read()).config.migration.completed.length,0)
  fail=false;const saved=value(await service.apply(application(preview)));assert.equal(saved.config.revision,2);assert.equal(saved.config.migration.completed.length,1)
})
test('backup source change after preview refuses confirmed recovery',async t=>{
  const app=await sourceSetup(t);value(await app.store.save(await request(app.store)))
  const preview=value(await app.service.previewRecovery()),before=await readFile(app.primary,'utf8');await writeFile(app.backup,'{}')
  rejected(await app.service.apply(application(preview)),'UNAVAILABLE');assert.equal(await readFile(app.primary,'utf8'),before)
})
test('source change during commit staging is caught again before replacing config',async t=>{
  let armed=false,sourcePath=''
  const files={...nodeConfigFiles,async writeExclusiveFlush(path:string,text:string){await nodeConfigFiles.writeExclusiveFlush(path,text);if(armed&&path.includes('settings.')){armed=false;await writeFile(sourcePath,'{"salary_day":20}')}}}
  const app=await setup(t,files);sourcePath=join(app.root,'python.json');await writeFile(sourcePath,'{"salary_day":10}')
  const service=createMigrationService({...app.ctx,store:app.store,sources:createMigrationFiles({selectImport:async()=>sourcePath,selectExport:async()=>null})})
  const preview=value(await service.preview({sourceKind:'python-v1'})),before=await readFile(app.primary,'utf8');armed=true
  rejected(await service.apply(application(preview)),'UNAVAILABLE');assert.equal(await readFile(app.primary,'utf8'),before);assert.equal(value(await app.store.read()).config.migration.completed.length,0)
})
test('future schema cannot bypass protection by choosing Python or POC source kind',async t=>{
  for(const kind of ['python-v1','electron-poc']as const){const app=await sourceSetup(t,kind,'{"schemaVersion":3,"salary_day":10,"workStartTime":"08:30"}');rejected(await app.service.preview({sourceKind:kind}),'UNSUPPORTED_SCHEMA')}
})
test('future-header load DTO cannot mutate internal read-only protection',async t=>{
  const app=await setup(t);await writeFile(app.primary,'{"schemaVersion":3,"__proto__":{}}')
  const state=value(await app.store.load());assert.equal(state.status,'future');Object.assign(state,{status:'missing'})
  rejected(await app.store.initialize(initial),'UNSUPPORTED_SCHEMA');assert.equal(await readFile(app.primary,'utf8'),'{"schemaVersion":3,"__proto__":{}}')
})
test('future backup blocks saving supported primary rather than downgrading the backup',async t=>{
  const app=await setup(t),pending=await request(app.store);await writeFile(app.backup,'{"schemaVersion":3}')
  assert.equal(value(await app.store.load()).status,'future');rejected(await app.store.save(pending),'UNSUPPORTED_SCHEMA')
  assert.equal(await readFile(app.backup,'utf8'),'{"schemaVersion":3}')
})
test('first explicit full settings can initialize overnight without guessing times or adding lunch',async t=>{
  const app=await setup(t,nodeConfigFiles,false),template=value(await (await setup(t)).store.read()).config,settings=value(editableConfig(template))
  settings.schedule.startTime='22:00';settings.schedule.endTime='06:00';settings.schedule.crossMidnight=true
  const initialized=value(await app.store.initializeSettings(settings));assert.equal(initialized.config.revision,1);assert.equal(initialized.config.schedule.crossMidnight,true);assert.deepEqual(initialized.config.schedule.breaks,[])
})
test('native D03 time-zone adapter resolves real dates in the service validation chain',async t=>{
  const app=await setup(t),config=value(await app.store.read()).config
  const result=value(validateConfigSettings(value(editableConfig(config)),config,{...app.ctx,zones:nativeZones}))
  assert.ok(result.checkedShiftDates.includes('2026-10-14'))
})
test('queued save owns a detached candidate; later caller mutation cannot change submitted values',async t=>{
  const app=await setup(t),req=await request(app.store,s=>{s.appearance.mode='dark'}),saving=app.store.save(req)
  req.settings.appearance.mode='light';assert.equal(value(await saving).config.appearance.mode,'dark')
})
test('JSON import dangerous keys, arrays, overlarge sources and malformed types are structured failures',async t=>{
  for(const text of ['{"constructor":{},"salary_day":10}','{"prototype":{},"salary_day":10}','{"__proto__":{},"salary_day":10}','[]','bad',' '.repeat(1024*1024+1)]){
    const app=await sourceSetup(t,'python-v1',text);rejected(await app.service.preview({sourceKind:'python-v1'}));assert.equal(value(await app.store.read()).config.revision,1)
  }
})
test('V2 impossible historical dates are visible preview errors and cannot be imported',async t=>{
  const app=await sourceSetup(t,'v2'),config=value(await app.store.read()).config;config.overtime.entries=[{shiftDate:'2025-02-29',minutes:80}]
  await writeFile(app.sourcePath,JSON.stringify(config));const preview=value(await app.service.preview({sourceKind:'v2'}));assert.ok(preview.choices.find(x=>x.field==='overtime.entries')?.issues.length)
  rejected(await app.service.apply(application(preview,['overtime.entries'])))
})
test('regular 24-hour edit with overtime is refused on real affected future dates',async t=>{
  const app=await setup(t);value(await app.store.save(await request(app.store,s=>{s.overtime.entries=[{shiftDate:'2026-10-14',minutes:1}]})))
  const change=await request(app.store,s=>{s.schedule.endTime='09:00';s.schedule.crossMidnight=true})
  rejected(await app.store.save(change));assert.equal(value(await app.store.read()).config.schedule.crossMidnight,false)
})
test('recent ended/rest-day historical overtime imports as inactive history without fabricating a shift',async t=>{
  const app=await sourceSetup(t,'v2');value(app.ctx.clock.setInstant(Date.parse('2026-10-19T10:00:00Z')))
  const config=value(await app.store.read()).config;config.overtime.entries=[{shiftDate:'2026-10-18',minutes:80}]
  await writeFile(app.sourcePath,JSON.stringify(config));const preview=value(await app.service.preview({sourceKind:'v2'}))
  assert.deepEqual(value(await app.service.apply(application(preview,['overtime.entries']))).config.overtime.entries,config.overtime.entries)
})
test('expired DST gap in stored history does not make current valid config unreadable',async t=>{
  const app=await setup(t),config=value(await app.store.read()).config;config.schedule.workWeek=[1,2,3,4,5,6,7];config.schedule.startTime='02:30';config.schedule.endTime='04:00'
  await writeFile(app.primary,JSON.stringify(config));value(app.ctx.clock.setInstant(Date.parse('2026-03-09T10:00:00Z')));value(app.ctx.clock.setTimeZone('America/New_York'))
  assert.equal(value(await app.store.load()).status,'ready')
})
test('same-revision restored or externally reloaded base still invalidates a prior migration preview',async t=>{
  const app=await sourceSetup(t),preview=value(await app.service.preview({sourceKind:'python-v1'})),config=value(await app.store.read()).config
  config.appearance.mode='dark';await writeFile(app.primary,JSON.stringify(config));value(await app.store.load())
  rejected(await app.service.apply(application(preview)),'REVISION_CONFLICT');assert.equal(value(await app.store.read()).config.salary.day,10)
})
test('real Windows sharing lock permits read but blocks replacement; retry after release succeeds',async t=>{
  assert.equal(process.platform,'win32') // D07 environment is Windows; no skipped proof.
  const app=await setup(t),before=await readFile(app.primary,'utf8'),quoted=app.primary.replaceAll("'","''")
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$handle=[IO.File]::Open('${quoted}',[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);[Console]::WriteLine('locked');[Console]::Out.Flush();Start-Sleep -Seconds 30;$handle.Dispose()`],{stdio:['ignore','pipe','pipe'],windowsHide:true})
  t.after(()=>{if(child.exitCode===null)child.kill()})
  await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Windows lock checkpoint timeout')),15000);child.stdout.once('data',()=>{clearTimeout(timeout);resolve()});child.once('error',reject);child.once('exit',code=>{clearTimeout(timeout);reject(new Error(`lock helper exited ${code}`))})})
  const pending=await request(app.store),failed=await app.store.save(pending)
  assert.equal(failed.ok,false);if(!failed.ok)assert.ok(['IO_DENIED','IO_BUSY'].includes(failed.error.code))
  assert.equal(await readFile(app.primary,'utf8'),before);assert.equal(value(await app.store.read()).config.revision,1)
  const ended=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill();await ended
  assert.equal(value(await app.store.save(pending)).config.revision,2)
})
test('both damaged files can recover only from complete explicit V2 preview, preserving original bytes',async t=>{
  const app=await sourceSetup(t,'v2'),config=value(await app.store.read()).config;config.overtime.entries=[{shiftDate:'2026-10-11',minutes:80}]
  await writeFile(app.sourcePath,JSON.stringify(config));await writeFile(app.primary,'{damaged-primary');await writeFile(app.backup,'{damaged-backup')
  const sourceHash=contentHash(await readFile(app.sourcePath,'utf8')),preview=value(await app.service.preview({sourceKind:'v2'}))
  assert.equal(preview.expectedRevision,0);assert.ok(preview.choices.every(x=>x.current===null));assert.equal(await readFile(app.primary,'utf8'),'{damaged-primary')
  rejected(await app.service.apply(application(preview,['employee.startDate'])))
  const restored=value(await app.service.apply(application(preview,[...IMPORT_FIELDS])));assert.equal(restored.config.revision,1);assert.deepEqual(restored.config.overtime,config.overtime)
  const names=await readdir(app.root),first=names.find(x=>x.startsWith('settings.corrupt.'))!,second=names.find(x=>x.startsWith('settings.backup.corrupt.'))!
  assert.equal(await readFile(join(app.root,first),'utf8'),'{damaged-primary');assert.equal(await readFile(join(app.root,second),'utf8'),'{damaged-backup');assert.equal(contentHash(await readFile(app.sourcePath,'utf8')),sourceHash)
})
test('missing first config can import a complete V2 source without guessing or writing during preview',async t=>{
  const app=await setup(t,nodeConfigFiles,false),template=value(await (await setup(t)).store.read()).config,source=join(app.root,'export.json')
  await writeFile(source,JSON.stringify(template));const service=createMigrationService({...app.ctx,store:app.store,sources:createMigrationFiles({selectImport:async()=>source,selectExport:async()=>null})})
  const preview=value(await service.preview({sourceKind:'v2'}));assert.deepEqual(await readdir(app.root),['export.json']);assert.equal(preview.expectedRevision,0)
  assert.equal(value(await service.apply(application(preview,[...IMPORT_FIELDS]))).config.revision,1)
})
test('a changed disk while full-recovery preview is open still blocks replacement',async t=>{
  const app=await sourceSetup(t,'v2'),template=value(await app.store.read()).config;await writeFile(app.sourcePath,JSON.stringify(template));await writeFile(app.primary,'bad')
  const preview=value(await app.service.preview({sourceKind:'v2'}));await writeFile(app.primary,'{"schemaVersion":3}')
  rejected(await app.service.apply(application(preview,[...IMPORT_FIELDS])),'UNSUPPORTED_SCHEMA');assert.equal(await readFile(app.primary,'utf8'),'{"schemaVersion":3}')
})
test('valid backup base with an external source can be explicitly recovered and partially merged',async t=>{
  const app=await sourceSetup(t);value(await app.store.save(await request(app.store)));await writeFile(app.primary,'broken')
  const preview=value(await app.service.preview({sourceKind:'python-v1'}));assert.ok(preview.notes?.some(x=>x.message.includes('备份')))
  const saved=value(await app.service.apply(application(preview,['salary.day'])));assert.equal(saved.config.salary.day,31);assert.equal(saved.config.revision,2)
})
test('external future update during final source recheck is caught before replacing primary',async t=>{
  const app=await sourceSetup(t),upstream=app.sources
  let armed=false
  const sources:MigrationFiles={...upstream,async read(handle){const data=await upstream.read(handle);if(armed&&await nodeConfigFiles.read(app.backup)!==null){armed=false;await writeFile(app.primary,'{"schemaVersion":3}')}return data}}
  const service=createMigrationService({...app.ctx,store:app.store,sources}),preview=value(await service.preview({sourceKind:'python-v1'}));armed=true
  rejected(await service.apply(application(preview)),'UNSUPPORTED_SCHEMA');assert.equal(await readFile(app.primary,'utf8'),'{"schemaVersion":3}')
})
test('clock/date/zone change during staging retains previous config and revision',async t=>{
  let change:(()=>void)|undefined
  const files={...nodeConfigFiles,async writeExclusiveFlush(path:string,text:string){await nodeConfigFiles.writeExclusiveFlush(path,text);if(change&&path.includes('settings.')){const action=change;change=undefined;action()}}}
  const app=await setup(t,files),before=await readFile(app.primary,'utf8');change=()=>{value(app.ctx.clock.setTimeZone('Asia/Shanghai'))}
  rejected(await app.store.save(await request(app.store)),'UNAVAILABLE');assert.equal(await readFile(app.primary,'utf8'),before);assert.equal(value(await app.store.read()).config.revision,1)
})
test('unexpected trusted adapter exceptions still return structured migration failure',async t=>{
  const app=await sourceSetup(t),service=createMigrationService({...app.ctx,store:app.store,sources:{...app.sources,async read(){throw errno('EIO')}}})
  rejected(await service.preview({sourceKind:'python-v1'}),'UNAVAILABLE')
  const brokenClock=createMigrationService({...app.ctx,store:app.store,sources:app.sources,clock:{read(){throw new Error('private adapter exception')}}})
  rejected(await brokenClock.preview({sourceKind:'python-v1'}),'UNAVAILABLE');rejected(await brokenClock.apply({previewToken:'none',expectedRevision:1,selectedFields:['salary.day'],undatedOvertimeShiftDate:null}),'UNAVAILABLE')
})
test('actual tracked Python config is read-only during migration into a temporary V2 profile',async t=>{
  const app=await setup(t),source=join(process.cwd(),'..','config.json'),original=await readFile(source,'utf8'),hash=contentHash(original)
  const service=createMigrationService({...app.ctx,store:app.store,sources:createMigrationFiles({selectImport:async()=>source,selectExport:async()=>null})})
  const preview=value(await service.preview({sourceKind:'python-v1'}));assert.equal(preview.sourceHash,hash);assert.equal(preview.undatedOvertimeMinutes,80)
  value(await service.apply(application(preview,['salary.day'])))
  assert.equal(contentHash(await readFile(source,'utf8')),hash);assert.equal(await readFile(join(app.root,`migration.${hash}.json`),'utf8'),original)
})
