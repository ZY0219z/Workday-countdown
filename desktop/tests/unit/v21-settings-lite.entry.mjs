import { createApp, nextTick } from 'vue'
import App from '../../src/renderer/src/App.vue'
import MiniApp from '../../src/renderer/src/MiniApp.vue'
import '../../src/renderer/src/styles/tokens.css'
import '../../src/renderer/src/styles/base.css'
import '../../src/renderer/src/style.css'

// Real App/Settings/controller, entirely in-memory ports: no Electron, files or OS windows.
let app
const clone=value=>structuredClone(value), ok=data=>({ok:true,data:clone(data)})
window.__settingsInit=async fixture=>{
  app?.unmount()
  let session=clone(fixture.session),saved=clone(session),snapshot=clone(fixture.snapshot)
  const calls={save:[],expectedEnd:[],quitRequests:0,quit:0,recovery:0,import:[],apply:0}
  window.workdayV2={
    settingsDraft:{read:async()=>ok(session),update:async request=>{session={...session,draft:clone(request.draft),dirty:true};return ok(session)},discard:async()=>{session=clone(saved);return ok(session)},setExpectedEnd:async request=>{calls.expectedEnd.push(clone(request));session.expectedEndEdit=clone(request);return ok(session)}},
    config:{save:async request=>{calls.save.push(clone(request));session={...session,saved:{...session.saved,...clone(request.settings),revision:session.expectedRevision+1},draft:clone(request.settings),dirty:false,expectedRevision:session.expectedRevision+1,issues:[]};saved=clone(session);snapshot.configRevision=session.expectedRevision;return ok({config:session.saved,warnings:[]})}},
    calendar:{readMetadata:async()=>ok(fixture.metadata)},
    snapshot:{read:async()=>ok(snapshot),subscribe:async()=>ok(null),unsubscribe:async()=>ok(null)},
    window:{onOpenSettings:()=>()=>{},subscribeVisibility:async listener=>{listener(ok({visible:true,sequence:1}));return ok(null)},unsubscribeVisibility:async()=>ok(null),perform:async()=>ok(null),subscribePresentation:async listener=>{listener(ok({appearance:session.saved.appearance,sequence:1}));return ok(null)},unsubscribePresentation:async()=>ok(null)},
    app:{quit:async()=>{calls.quitRequests++;if(session.dirty)return {ok:false,error:{code:'CANCELLED',message:'Main 未保存草稿退出保护'}};calls.quit++;return ok(null)}},
    data:{previewRecovery:async()=>{calls.recovery++;if(session.configurationStatus==='future')return {ok:false,error:{code:'UNAVAILABLE',message:'较新版本配置只读，不覆盖。'}};return ok({previewToken:'memory-only-preview',expectedRevision:session.expectedRevision,choices:[{field:'employee.startDate',current:session.draft.employee.startDate,incoming:'2026-09-01',issues:[]}],notes:[],undatedOvertimeMinutes:null,alreadyProcessed:false})},previewImport:async input=>{calls.import.push(input);return {ok:false,error:{code:'CANCELLED',message:'已取消'}}},cancelImport:async()=>ok(null),applyImport:async()=>{calls.apply++;return {ok:false,error:{code:'FORBIDDEN',message:'只读版本保护，未覆盖任何配置。'}}}}
  }
  window.__settingsState=()=>clone({session,saved,calls})
  app=fixture.mini?createApp(MiniApp,{api:window.workdayV2}):createApp(App);app.mount('#app');await nextTick()
}
