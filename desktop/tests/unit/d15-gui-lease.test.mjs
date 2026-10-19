import {test} from 'node:test'
import assert from 'node:assert/strict'
import {validD15Lease,validD15GuiScope,d15CrashScenario} from '../../scripts/d15-gui-authorization.mjs'
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
