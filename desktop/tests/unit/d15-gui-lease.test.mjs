import {test} from 'node:test'
import assert from 'node:assert/strict'
import {validD15Lease,validD15GuiScope,d15CrashScenario,d15DesktopTask,d15DesktopScenario,d15DesktopTitles,d15DesktopGrep,d15MainTask,d15MainTitle,d15MainGrep} from '../../scripts/d15-gui-authorization.mjs'
const context={desktop:'D:/owned',head:'current',now:10000,platform:'win32'}
const lease={task:'D15-crash-recheck-2026-10-19',scenario:d15CrashScenario,desktop:context.desktop,head:context.head,created:9999,expires:11000,remaining:1,groups:['d15-native.spec.ts']}
const scoped={grep:new RegExp(d15CrashScenario+'$'),repeatEach:1,retries:0}
test('D15 permit is bound to current task, repository, HEAD and exactly one native group',()=>assert.equal(validD15Lease(lease,context),true))
for(const [name,change]of Object.entries({expired:{expires:10000},future:{created:10001},long:{expires:3610000},head:{head:'stale'},repository:{desktop:'another'},task:{task:'D08'},reusable:{remaining:2},group:{groups:['desktop.spec.ts']},extra:{groups:['d15-native.spec.ts','lifecycle.spec.ts']},scenario:{scenario:'all D15'},legacy:{task:'D15-current-desktop-2026-10-19'}}))test('D15 permit rejects '+name,()=>assert.equal(validD15Lease({...lease,...change},context),false))
test('environment variables cannot grant D15 permission',()=>{process.env.WORKDAY_ESCAPE_GUI_TESTS='1';try{assert.equal(validD15Lease(null,context),false)}finally{delete process.env.WORKDAY_ESCAPE_GUI_TESTS}})
test('Playwright exact string testMatch and single scenario are accepted',()=>assert.equal(validD15GuiScope([{...scoped,testMatch:'**/d15-native.spec.ts'}]),true))
test('Playwright exact one-item array testMatch and single scenario are accepted',()=>assert.equal(validD15GuiScope([{...scoped,testMatch:['**/d15-native.spec.ts']}]),true))
test('broader, multiple or other test groups remain forbidden',()=>{for(const projects of [[{...scoped,testMatch:'**/*.spec.ts'}],[{...scoped,testMatch:['**/d15-native.spec.ts','**/lifecycle.spec.ts']}],[{...scoped,testMatch:'**/d15-native.spec.ts'},{...scoped,testMatch:'**/d15-native.spec.ts'}]])assert.equal(validD15GuiScope(projects),false)})
for(const [name,change]of Object.entries({broad:{grep:/.*/},unanchored:{grep:new RegExp(d15CrashScenario)},repeat:{repeatEach:2},retry:{retries:1},caseInsensitive:{grep:new RegExp(d15CrashScenario+'$','i')}}))test('single-scene gate rejects '+name,()=>assert.equal(validD15GuiScope([{...scoped,testMatch:'**/d15-native.spec.ts',...change}]),false))

const batch={...lease,task:d15DesktopTask,scenario:d15DesktopScenario,scenarios:d15DesktopTitles,expires:11000}
test('current D15 permit accepts only the six explicitly authorized titles or an exact subset',()=>{
  assert.equal(validD15Lease(batch,context),true)
  for(const title of d15DesktopTitles){const titles=[title];assert.equal(validD15Lease({...batch,scenarios:titles},context),true);assert.equal(validD15GuiScope([{...scoped,testMatch:'**/d15-native.spec.ts',grep:d15DesktopGrep(titles)}],titles),true)}
})
for(const [name,change]of Object.entries({unknown:{scenarios:['other GUI']},duplicate:{scenarios:[d15DesktopTitles[0],d15DesktopTitles[0]]},empty:{scenarios:[]},missing:{scenarios:undefined},oldExit:{scenarios:[d15CrashScenario]},tooLong:{expires:1210000},wrongTask:{task:'D16'},wrongHead:{head:'stale'},extraGroup:{groups:['d15-native.spec.ts','lifecycle.spec.ts']}}))test('current D15 whitelist rejects '+name,()=>assert.equal(validD15Lease({...batch,...change},context),false))
test('current exact title regex neither matches old exit scenarios nor extra suffix/prefix',()=>{
  const grep=d15DesktopGrep();assert.equal(grep.test(d15CrashScenario),false)
  for(const title of d15DesktopTitles){assert.equal(grep.test(title),true);assert.equal(grep.test('  d15-native.spec.ts '+title),true);assert.equal(grep.test('other.spec.ts '+title),false);assert.equal(grep.test('extra '+title),false);assert.equal(grep.test(title+' extra'),false)}
  assert.throws(()=>d15DesktopGrep(['arbitrary']),/Unknown/)
})
test('single-case permit cannot launch a broader native suite',()=>{
  const project={...scoped,testMatch:'**/d15-native.spec.ts',grep:d15DesktopGrep()}
  assert.equal(validD15GuiScope([project],[d15DesktopTitles[0]]),false)
  assert.equal(validD15GuiScope([project],d15DesktopTitles),true)
})

const mainLease={...lease,task:d15MainTask,scenario:d15MainTitle,scenarios:[d15MainTitle]}
test('Main-only lease and exact configuration accept only Main resource sampling',()=>{
  assert.equal(validD15Lease(mainLease,context),true)
  assert.equal(validD15GuiScope([{...scoped,testMatch:'**/d15-native.spec.ts',grep:d15MainGrep()}],[d15MainTitle]),true)
  assert.equal(d15MainGrep().test('  d15-native.spec.ts '+d15MainTitle),true)
  for(const title of d15DesktopTitles)assert.equal(d15MainGrep().test(title),false)
  assert.equal(validD15GuiScope([{...scoped,testMatch:'**/d15-native.spec.ts',grep:d15DesktopGrep()}],[d15MainTitle]),false)
})
for(const [name,change]of Object.entries({extra:{scenarios:[d15MainTitle,d15DesktopTitles[5]]},wrongScenario:{scenario:d15DesktopScenario},wrongTitle:{scenarios:[d15DesktopTitles[5]]},missing:{scenarios:undefined},expired:{expires:10000},tooLong:{expires:310000},head:{head:'stale'},repository:{desktop:'other'},reusable:{remaining:2},group:{groups:['desktop.spec.ts']}}))test('Main-only gate rejects '+name,()=>assert.equal(validD15Lease({...mainLease,...change},context),false))
