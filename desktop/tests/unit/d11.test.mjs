import {test} from 'node:test'
import assert from 'node:assert/strict'
import {fixtures,renderDashboard,renderSettings,createSettingsController,initialEditor,editorFrom,createSettingsDraft,durationText,wallLabel,qualityText,createV2Bridge,validateContractRequest,fieldIssues,fieldMessage,createDefaultAppConfig,salaryMonthLabel} from '../../test-results/d11-ssr/components.mjs'
const f=fixtures(),ok=data=>({ok:true,data}),fail=code=>({ok:false,error:{code,message:'fixture failure',...(code==='REVISION_CONFLICT'?{expectedRevision:1,actualRevision:2}:{})}})
test('UI-02 excludes only field-owned errors and preserves group, legacy and indexed errors',()=>{
  const fields=['$.schedule','$.schedule.startTime','$.schedule.startTimeExtra','$.schedule.breaks[0].endTime','$.salary.day']
  const issues=fields.map(field=>Object.freeze({field,reason:'FORMAT',message:'invalid fixture'}))
  assert.deepEqual(fieldIssues(issues,'$.schedule',['$.schedule.startTime']).map(issue=>issue.field),[fields[0],fields[2],fields[3]])
  assert.deepEqual(fieldIssues(issues,'$.schedule.breaks').map(issue=>issue.field),[fields[3]])
  assert.deepEqual(issues.map(issue=>issue.field),fields)
})
test('UI-02 renders field errors once while retaining genuine schedule and calendar errors',async()=>{
  const issues=[['$.schedule.startTime','FORMAT'],['$.schedule.endTime','FORMAT'],['$.expectedEndTime','RANGE'],['$.employee.startDate','FORMAT'],['$.salary.day','RANGE'],['$.schedule','RANGE'],['$.schedule.breaks[0].endTime','DUPLICATE'],['$.calendar.enabledYears[0]','ENUM'],['$.calendar.overrides.2026-10-22','ENUM']].map(([field,reason])=>({field,reason,message:'本班次预计结束时间无效。'}))
  const html=await renderSettings(initialEditor(),f.metadata,{issues})
  assert.equal((html.match(/class="field-error"/g)||[]).length,issues.length)
  assert.equal((html.match(/请输入 24 小时制 HH:MM（00:00–23:59），例如 08:30。/g)||[]).length,2)
  assert.ok(html.includes('数值或时间区间超出允许范围。'))
  assert.ok(html.includes('存在重复或冲突记录。'))
  assert.ok(html.includes('本班次预计结束时间无效。'))
  const controls=[...html.matchAll(/<(?:input|select)\b[^>]*aria-invalid="true"[^>]*>/g)].map(match=>match[0])
  assert.ok(controls.length>=5)
  for(const control of controls){
    const describedBy=control.match(/aria-describedby="([^"]+)"/)?.[1]
    assert.ok(describedBy,control)
    for(const id of describedBy.split(' '))assert.equal(html.split(`id="${id}"`).length-1,1,id)
  }
})
test('UI-02 keeps stable error IDs and drops invalid state and stale references after correction',async()=>{
  const model=initialEditor(),issues=[{field:'$.schedule.startTime',reason:'FORMAT',message:'invalid fixture'}]
  const first=await renderSettings(model,f.metadata,{issues}),again=await renderSettings(model,f.metadata,{issues}),valid=await renderSettings(model,f.metadata)
  const input=html=>html.match(/<input\b[^>]*aria-label="上班时间"[^>]*>/)?.[0]
  const errorId=input(first).match(/aria-describedby="[^"]* ([^"]+)"/)?.[1]
  assert.ok(errorId)
  assert.ok(input(again).includes(errorId))
  assert.ok(!input(valid).includes(errorId))
  assert.ok(!valid.includes('aria-invalid="true"'))
  assert.ok(!valid.includes('class="field-error"'))
  for(const match of valid.matchAll(/aria-describedby="([^"]+)"/g))for(const id of match[1].split(' '))assert.equal(valid.split(`id="${id}"`).length-1,1,id)
})
function harness({missing=false,saveFail=null,timers}={}){
  let session=missing?{saved:null,draft:{},dirty:false,issues:[],expectedRevision:0,save:{status:'idle'},configurationStatus:'missing'}:{...createSettingsDraft(f.config).data,configurationStatus:'ready'}
  const calls=[],api={settingsDraft:{read:async()=>ok(structuredClone(session)),update:async request=>{calls.push(['update',structuredClone(request)]);session={...session,draft:request.draft,dirty:true};return ok(structuredClone(session))},discard:async()=>{calls.push(['discard']);session=missing?{saved:null,draft:{},dirty:false,issues:[],expectedRevision:0,save:{status:'idle'},configurationStatus:'missing'}:{...createSettingsDraft(f.config).data,configurationStatus:'ready'};return ok(session)}},config:{save:async request=>{calls.push(['save',structuredClone(request)]);if(saveFail)return fail(saveFail);const config={...structuredClone(f.config),...structuredClone(request.settings),calendar:{...structuredClone(f.config.calendar),...structuredClone(request.settings.calendar)},revision:request.expectedRevision+1};session={...createSettingsDraft(config).data,configurationStatus:'ready'};return ok({config,warnings:[]})}}}
  return {api,calls,get session(){return session},controller:createSettingsController(api,()=>{},timers)}
}
for(const [name,label] of Object.entries({working:'工作中',beforeWork:'上班前',break:'午休中',finished:'已下班',rest:'休息日',overtime:'加班中'}))test(`real D09 ${name} snapshot renders correct state`,async()=>{const html=await renderDashboard(f.snapshots[name]);assert.ok(html.includes(label));for(const title of ['下个休息日','下次预计发薪','已工作'])assert.ok(html.includes(title));assert.ok(!html.includes('在职自然日'));assert.ok(!html.includes('累计计划工作日'))})
test('lunch counts to final end; supplied net progress is rendered without new computation',async()=>{const s=f.snapshots.break,html=await renderDashboard(s);assert.equal(s.countdown.seconds,19800);assert.ok(html.includes('05:30:00'));assert.ok(html.includes(s.progress.percent.toFixed(1).replace(/\.0$/,'')))})
test('overnight target shows explicit next-day date; active shift stays original',async()=>{const s=f.snapshots.overnight,html=await renderDashboard(s);assert.equal(s.activeShift.shiftDate,'2026-10-15');assert.ok(html.includes('2026-10-16 06:00'));assert.ok(html.includes('05:59:00'))})
test('overtime changes supplied progress backwards without stale value',async()=>{assert.ok(f.snapshots.rollback.progress.percent<f.snapshots.working.progress.percent);const html=await renderDashboard(f.snapshots.rollback);assert.ok(html.includes(f.snapshots.rollback.progress.percent.toFixed(1)))})
test('missing-year warnings appear at dependent cards; natural days remain independent',async()=>{const html=await renderDashboard(f.snapshots.estimate);assert.ok(html.includes('2027'));assert.ok(html.includes('估算'));assert.ok(!qualityText(f.snapshots.estimate.employment.naturalQuality).includes('估算'))})
test('null snapshot has no invented timer or progress zero',async()=>{const html=await renderDashboard(null);assert.ok(html.includes('暂无可用倒计时'));assert.ok(!html.includes('role="timer"'));assert.ok(html.includes('无工作进度'))})
test('salary ambiguity must not mask missing-year warnings or render a unique selected cycle',async()=>{const s=structuredClone(f.snapshots.working);s.salary=null;s.salaryAmbiguity={matchingCycles:['2026-09','2026-10']};s.warnings.push({code:'CALENDAR_INCOMPLETE',affects:['salary'],years:[2027],message:'2027年度数据不完整，估算'});const html=await renderDashboard(s);assert.ok(html.includes('发薪周期存在歧义'));assert.ok(html.includes('多个名义周期重合，未选择唯一归属'));assert.ok(html.includes('2027年度数据不完整，估算'));assert.ok(!html.includes('计划日期，不代表已到账'))})
test('display formatting uses supplied seconds/instant/timezone only',()=>{assert.equal(durationText(0),'00:00:00');assert.equal(durationText(360000),'100:00:00');for(const x of [null,-1,NaN,1.2])assert.equal(durationText(x),null);assert.deepEqual(wallLabel(Date.parse('2026-10-15T23:30:00Z'),'Asia/Shanghai'),{date:'2026-10-16',time:'07:30'})})
test('disconnected editor is only a placeholder, never a first-use wizard',async()=>{const h=harness({missing:true});await h.controller.load();assert.equal(h.controller.state.editor.schedule.startTime,'');assert.equal(h.controller.state.editor.salary.day,null);assert.equal(h.session.saved,null);assert.equal(h.calls.length,0);const html=await renderSettings(initialEditor(),f.metadata);assert.ok(html.includes('设置中心'));assert.ok(!html.includes('首次设置'));assert.ok(html.includes('更多设置'))})
test('queued rapid edits retain last input and Main draft without mutating saved config',async()=>{const h=harness();await h.controller.load();for(const time of ['18:10','18:20','18:30']){const edit=structuredClone(h.controller.state.editor);edit.schedule.endTime=time;h.controller.edit(edit)}await h.controller.flush();assert.equal(h.controller.state.editor.schedule.endTime,'18:30');assert.equal(h.session.draft.schedule.endTime,'18:30');assert.equal(h.session.saved.schedule.endTime,'18:00');assert.equal(h.controller.state.pending,0)})
test('save waits for edits, uses expected revision and accepts only actual successful save',async()=>{const h=harness();await h.controller.load();const edit=structuredClone(h.controller.state.editor);edit.schedule.endTime='19:00';h.controller.edit(edit);assert.equal(await h.controller.save(),true);assert.deepEqual(h.calls.map(x=>x[0]),['update','save']);assert.equal(h.calls[1][1].expectedRevision,1);assert.equal(h.controller.state.session.saved.revision,2);assert.equal(h.controller.state.dirty,false)})
for(const code of ['IO_DENIED','REVISION_CONFLICT','UNAVAILABLE'])test(`${code} preserves editor, saved authority and dirty state`,async()=>{const h=harness({saveFail:code});await h.controller.load();const edit=structuredClone(h.controller.state.editor);edit.schedule.endTime='19:00';h.controller.edit(edit);assert.equal(await h.controller.save(),false);assert.equal(h.controller.state.editor.schedule.endTime,'19:00');assert.equal(h.controller.state.session.saved.schedule.endTime,'18:00');assert.equal(h.controller.state.dirty,true);assert.equal(h.controller.state.error.code,code)})
test('invalid first form reports fields and never calls config.save',async()=>{const h=harness({missing:true});await h.controller.load();assert.equal(await h.controller.save(),false);assert.equal(h.controller.state.error.code,'VALIDATION');assert.ok(h.controller.state.issues.some(x=>x.field.includes('startTime')));assert.equal(h.calls.length,0)})
test('explicit discard restores saved theme and does not remove historical overtime',async()=>{const h=harness();await h.controller.load();const edit=structuredClone(h.controller.state.editor);edit.appearance.accent='coral';h.controller.edit(edit);await h.controller.flush();assert.equal(await h.controller.discard(),true);assert.equal(h.controller.state.editor.appearance.accent,'ocean');assert.equal(h.controller.state.dirty,false)})
test('reload reads Main dirty draft instead of replacing it with defaults',async()=>{const h=harness();await h.controller.load();const edit=structuredClone(h.controller.state.editor);edit.schedule.endTime='20:00';h.controller.edit(edit);await h.controller.flush();const reloaded=createSettingsController(h.api,()=>{});await reloaded.load();assert.equal(reloaded.state.editor.schedule.endTime,'20:00');assert.equal(reloaded.state.dirty,true)})
test('new fixed operations reject mini and arbitrary path injection',()=>{for(const [method,input]of [['data.previewRecovery',null],['data.cancelImport',{previewToken:'x'}],['calendar.readMetadata',null]]){assert.equal(validateContractRequest('main',method,input).ok,true);assert.equal(validateContractRequest('mini',method,input).error.code,'FORBIDDEN')}assert.equal(validateContractRequest('main','data.cancelImport',{previewToken:'x',path:'C:/private'}).ok,false)})
test('main bridge exposes fixed recovery/cancel/metadata DTOs only',async()=>{const calls=[],api=createV2Bridge('main',{invoke:async(c,input)=>{calls.push([c,input]);return ok(null)},listen:()=>()=>{}});await api.data.previewRecovery();await api.data.cancelImport({previewToken:'x'});await api.calendar.readMetadata();assert.deepEqual(calls.map(x=>x[1]),[null,{previewToken:'x'},null]);assert.equal('invoke'in api,false);const mini=createV2Bridge('mini',{invoke:async()=>ok(null),listen:()=>()=>{}});assert.equal('data'in mini,false)})

test('failed synchronization remains visibly unsynced until retry or explicit discard',async()=>{const h=harness();await h.controller.load();h.api.settingsDraft.update=async()=>fail('UNAVAILABLE');const edit=structuredClone(h.controller.state.editor);edit.schedule.endTime='19:00';h.controller.edit(edit);assert.equal((await h.controller.flush()).ok,false);assert.equal(h.controller.state.unsynced,true);assert.equal(h.controller.state.editor.schedule.endTime,'19:00');await h.controller.discard();assert.equal(h.controller.state.unsynced,false)})
test('current-rule estimate does not invent a missing calendar year',()=>{const q=f.snapshots.working.employment.quality;assert.equal(q.incompleteYears.length,0);assert.ok(!qualityText(q).includes('不完整'))})

test('rejected draft initialization cannot masquerade as a successful save',async()=>{const h=harness({missing:true});h.api.settingsDraft.read=async()=>fail('FORBIDDEN');assert.equal((await h.controller.load()).ok,false);assert.equal(h.controller.state.session,null);assert.equal(await h.controller.save(),false);assert.equal(h.controller.state.error.code,'UNAVAILABLE');assert.match(h.controller.state.error.message,/重新连接/);assert.equal(h.calls.length,0)})
test('thrown initialization is a structured failure and retry reads the real session',async()=>{const h=harness(),read=h.api.settingsDraft.read;h.api.settingsDraft.read=async()=>{throw Error('private transport detail')};const failure=await h.controller.load();assert.equal(failure.ok,false);assert.equal(failure.error.code,'INTERNAL');assert.ok(!JSON.stringify(failure).includes('private'));h.api.settingsDraft.read=read;assert.equal((await h.controller.load()).ok,true);assert.equal(h.controller.state.session.saved.revision,1);assert.equal(h.controller.state.error,null)})
test('unknown draft UI disables saving and does not claim clean',async()=>{const html=await renderSettings(initialEditor(),f.metadata,{sessionReady:false,canSave:false});assert.ok(html.includes('草稿状态未知'));assert.ok(!html.includes('没有未保存修改'));assert.match(html,/type="submit"[^>]*disabled/);assert.ok(html.includes('不能编辑或保存'))})
test('settings remove lunch edits while retaining the read-only historic break warning',async()=>{const model=initialEditor();model.schedule.breaks=[{startTime:'12:00',endTime:'13:00',startDayOffset:0,endDayOffset:0}];const html=await renderSettings(model,f.metadata);assert.equal((html.match(/placeholder="HH:MM"/g)||[]).length,3);assert.ok(html.includes('保留了历史午休配置'));assert.ok(!html.includes('添加午休'));assert.ok(!html.includes('休息开始'));assert.equal((html.match(/type="time"/g)||[]).length,0)})
for(const time of ['0','08:','24:00','08:60','8:30'])test(`raw time ${time} stays in draft but cannot be saved`,async()=>{const h=harness();await h.controller.load();const editor=structuredClone(h.controller.state.editor);editor.schedule.startTime=time;h.controller.edit(editor);await h.controller.flush();assert.equal(h.session.draft.schedule.startTime,time);assert.equal(await h.controller.save(),false);assert.equal(h.controller.state.error.code,'VALIDATION');assert.equal(h.controller.state.editor.schedule.startTime,time);assert.equal(h.calls.filter(call=>call[0]==='save').length,0)})
test('missing salary has a specific field error, and input time explains its range',async()=>{const h=harness({missing:true});await h.controller.load();const editor=structuredClone(h.controller.state.editor);editor.schedule.startTime='08:30';editor.schedule.endTime='18:00';h.controller.edit(editor);assert.equal(await h.controller.save(),false);const issue=h.controller.state.issues.find(issue=>issue.field==='$.salary.day');assert.ok(issue);assert.match(fieldMessage(issue),/每月发薪日.*1–31/);assert.match(fieldMessage({field:'$.schedule.breaks[0].endTime',reason:'FORMAT'}),/HH:MM.*23:59/)})

test('approved factory produces isolated defaults; presentation attributes prior nominal month',()=>{const input={updatedAt:'2026-10-15T00:00:00.000Z',appVersion:'2.0.0'},a=createDefaultAppConfig(input,f.metadata).data,b=createDefaultAppConfig(input,f.metadata).data;assert.equal(a.employee.startDate,'2025-07-17');assert.equal(a.schedule.startTime,'08:30');assert.equal(a.schedule.endTime,'18:00');assert.equal(a.salary.day,10);assert.equal(a.appearance.accent,'ocean');a.schedule.workWeek.pop();assert.equal(b.schedule.workWeek.length,5);assert.equal(salaryMonthLabel('2026-10-10'),'2026年9月工资');assert.equal(salaryMonthLabel('2027-01-10'),'2026年12月工资');assert.equal(salaryMonthLabel('0001-01-10'),'');assert.equal(salaryMonthLabel('bad'),'')})
test('UI-09 keeps common settings and More/Mini without daily advanced controls',async()=>{const html=await renderSettings(editorFrom(createSettingsDraft(f.config).data),f.metadata);for(const text of ['上班时间','下班时间','入职日期','每月发薪日','今天预计下班时间','启用迷你窗'])assert.ok(html.includes(text));assert.match(html,/<summary[^>]*>更多设置<\/summary>/);for(const text of ['设置分组','离线工作日历','外观主题','窗口与托盘偏好','导出已保存配置','预览最近有效备份','每周工作日','跨夜班次（下班在次日）','遇休息日<select','value="advance"','value="none"'])assert.ok(!html.includes(text),text);assert.ok(!html.includes('请先填写发薪日'))})

test('UI-09 exposes safe recovery only for a loaded read-only configuration',async()=>{
  const model=editorFrom(createSettingsDraft(f.config).data)
  const html=await renderSettings(model,f.metadata,{canSave:false})
  for(const text of ['安全恢复','选择配置并预览','预览最近有效备份'])assert.ok(html.includes(text))
  for(const text of ['导出已保存配置','导入来源','Python V1','设置分组'])assert.ok(!html.includes(text))
  assert.match(html,/<fieldset[^>]*disabled[^>]*class="settings-fields"/)
  const unavailable=await renderSettings(model,f.metadata,{canSave:false,sessionReady:false})
  assert.ok(!unavailable.includes('aria-label="安全恢复"'))
})

test('dashboard has exactly three concise metrics, no standalone date, and retains actual target dates',async()=>{
  const snapshot=f.snapshots.working,original=structuredClone(snapshot),html=await renderDashboard(snapshot)
  assert.equal((html.match(/class="we-surface we-metric(?: [^"]*)?"/g)||[]).length,3)
  for(const text of ['dashboard-date','累计计划工作日','非实际出勤','按工作日历','计划日期，不代表已到账','不包含今天；入职当天为 0','自然日累计','截至 '+snapshot.localDate])assert.ok(!html.includes(text),text)
  assert.ok(html.includes(snapshot.nextRest.date));assert.ok(html.includes(snapshot.salary.actualDate));assert.ok(html.includes('2026-10-15 18:00'))
  assert.equal(typeof snapshot.employment.plannedWorkDays,'number');assert.deepEqual(snapshot,original)
})
test('concise metrics still show dependent calculation errors and future/unset employment states',async()=>{
  const snapshot=structuredClone(f.snapshots.working);snapshot.warnings=[{code:'CONFIG_INCOMPLETE',affects:['nextRest'],message:'休息日无法计算',years:[]},{code:'CONFIG_INCOMPLETE',affects:['salary'],message:'发薪日期无法计算',years:[]}]
  snapshot.nextRest=null;snapshot.salary=null;snapshot.employment.status='notStarted';snapshot.employment.elapsedNaturalDays=0
  const html=await renderDashboard(snapshot);assert.ok(html.includes('休息日无法计算'));assert.ok(html.includes('发薪日期无法计算'));assert.ok(html.includes('尚未入职'))
  snapshot.employment.status='unset';snapshot.employment.elapsedNaturalDays=null;assert.ok((await renderDashboard(snapshot)).includes('尚未设置入职日期'))
})
for(const policy of ['advance','none'])test(`hidden legacy settings ${policy} remain intact with concise read-only notices`,async()=>{
  const model=editorFrom(createSettingsDraft(f.config).data);model.schedule.crossMidnight=true;model.schedule.workWeek=[1,6];model.salary.nonWorkingPolicy=policy
  const original=structuredClone(model),html=await renderSettings(model,f.metadata)
  assert.ok(html.includes('保留历史跨夜班次'));assert.ok(html.includes('保留历史工作周：周一、周六'));assert.ok(html.includes(policy==='advance'?'提前至上一个工作日':'休息日不调整'))
  assert.ok(!html.includes('每周工作日'));assert.ok(!html.includes('value="advance"'));assert.ok(!html.includes('value="none"'));assert.deepEqual(model,original)
})
test('editor retains both work/rest date overrides without aliasing the Main saved config or draft',()=>{
  const session=createSettingsDraft(f.config).data;session.draft.calendar.overrides={'2026-10-10':'rest','2027-01-03':'work'}
  const original=JSON.stringify(session),editor=editorFrom(session);assert.deepEqual(editor.calendar.overrides,session.draft.calendar.overrides)
  editor.calendar.overrides['2026-10-10']='work';delete editor.calendar.overrides['2027-01-03'];assert.equal(JSON.stringify(session),original)
})
test('dynamic date dictionary does not bypass unknown-field or dangerous-key checks',()=>{
  for(const calendar of [{...f.config.calendar,datasets:undefined,extra:'injected'},JSON.parse('{"overrides":{"__proto__":"work"}}'),JSON.parse('{"overrides":{"constructor":"rest"}}')]){
    delete calendar.datasets;const session=createSettingsDraft(f.config).data;session.draft.calendar=calendar;assert.deepEqual(editorFrom(session),initialEditor())
  }
})

function noticeClock(){let now=0,next=0;const jobs=new Map(),cleared=[];return {port:{set(fn,delay){const id=++next;jobs.set(id,{fn,at:now+delay});return id},clear(id){cleared.push(jobs.get(id)?.fn);jobs.delete(id)}},advance(delta){now+=delta;for(const [id,job]of [...jobs])if(job.at<=now){jobs.delete(id);job.fn()}},old(){for(const fn of cleared)fn?.()},size:()=>jobs.size}}
test('successful save notice expires at 2 seconds and old callbacks cannot clear a newer notice',async()=>{
  const clock=noticeClock(),h=harness({timers:clock.port});await h.controller.load();assert.equal(await h.controller.save(),true);assert.equal(h.controller.state.notice,'设置已保存。');clock.advance(1999);assert.equal(h.controller.state.notice,'设置已保存。');clock.advance(1);assert.equal(h.controller.state.notice,'')
  await h.controller.save();clock.advance(1500);await h.controller.save();clock.old();assert.equal(h.controller.state.notice,'设置已保存。');clock.advance(500);assert.equal(h.controller.state.notice,'设置已保存。');clock.advance(1500);assert.equal(h.controller.state.notice,'');h.controller.dispose()
})
test('new edit/load/dispose clears notice timers, expiry never clears persistent errors',async()=>{
  const clock=noticeClock(),h=harness({timers:clock.port});await h.controller.load();await h.controller.save();h.controller.edit(structuredClone(h.controller.state.editor));assert.equal(h.controller.state.notice,'');assert.equal(clock.size(),0);await h.controller.flush();await h.controller.save();await h.controller.load();assert.equal(clock.size(),0)
  await h.controller.save();h.controller.state.error={code:'IO_DENIED',message:'persistent failure'};clock.advance(2000);assert.equal(h.controller.state.error.code,'IO_DENIED');await h.controller.save();h.controller.dispose();assert.equal(clock.size(),0);clock.old();assert.equal(h.controller.state.notice,'')
})

test('unmount during an in-flight save never starts a late success timer',async()=>{
  const clock=noticeClock(),h=harness({timers:clock.port});await h.controller.load();const save=h.api.config.save;let release;const gate=new Promise(resolve=>{release=resolve});h.api.config.save=async request=>{await gate;return save(request)};const pending=h.controller.save();await Promise.resolve();h.controller.dispose();release();assert.equal(await pending,true);assert.equal(clock.size(),0);assert.equal(h.controller.state.notice,'')
})
