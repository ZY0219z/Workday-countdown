import type { ContractError, ContractRequests, ExpectedEndContext, MainWindowApi, Result, SettingsDraftSession, ValidationIssue } from '../../../shared/contracts'
import { editableConfigValidator } from '../../../shared/config-schema'
import { validateStructure } from '../../../shared/validation'
import { initialEditor, editorFrom, asDraft, type EditorSettings } from './settings-editor'

// A small UI session adapter, no files/business calculations. Every edit
// is queued to Main; failed/late saves cannot overwrite a newer local editor.
export function createSettingsController(api: MainWindowApi, changed: () => void, timers={set:(callback:()=>void,delay:number):unknown=>setTimeout(callback,delay),clear:(handle:unknown)=>clearTimeout(handle as ReturnType<typeof setTimeout>)}) {
  const state = { session: null as SettingsDraftSession | null, editor: initialEditor(), pending: 0, busy: false,
    error: null as ContractError | null, issues: [] as ValidationIssue[], notice: '', dirty: false, unsynced: false,
    expectedEnd:null as ExpectedEndContext|null,expectedEndInput:'' }
  let queue: Promise<unknown> = Promise.resolve(), disposed = false, lastSync: Result<unknown> = { ok: true, data: null }
  let noticeTimer:unknown=null,noticeGeneration=0
  let expectedEdit:ContractRequests['settingsDraft.setExpectedEnd']|null=null
  const emit = () => { if(!disposed) changed() }
  function clearNotice(){noticeGeneration++;if(noticeTimer!==null)timers.clear(noticeTimer);noticeTimer=null;state.notice=''}
  function acceptEnd(session:SettingsDraftSession){state.expectedEnd=session.expectedEnd??null;const context=session.expectedEnd
    state.expectedEndInput=session.expectedEndEdit?(session.expectedEndEdit.input??(context?.available?context.normalEnd.time:'')):(context?.available?context.finalEnd.time:'')}
  function accept(session: SettingsDraftSession) { expectedEdit=null;state.session=session;state.editor=editorFrom(session);state.dirty=session.dirty;state.unsynced=false;state.issues=session.issues;acceptEnd(session);emit() }
  // A retry includes both the form and any not-yet-saved expected time, so
  // another successful field update cannot silently erase a failed time edit.
  function enqueue(editor:EditorSettings){
      clearNotice();state.editor=structuredClone(editor);state.dirty=true;state.unsynced=true;state.pending++;state.error=null
      const draft=asDraft(editor),expectedRevision=state.session!.expectedRevision,expected=expectedEdit?structuredClone(expectedEdit):null
      queue=queue.then(async()=>{
        try { let result=await api.settingsDraft.update({draft,expectedRevision});if(result.ok&&expected)result=await api.settingsDraft.setExpectedEnd(expected);lastSync=result
          if(result.ok){state.session=result.data;state.issues=result.data.issues;if(state.pending===1){state.dirty=result.data.dirty;state.unsynced=false;acceptEnd(result.data)}}
          else state.error=result.error
        } catch { lastSync={ok:false,error:{code:'INTERNAL',message:'草稿同步失败，请保留输入后重试。'}};state.error=lastSync.error }
        finally { state.pending--;emit() }
      });emit()
  }
  return {
    state,
    clearNotice(){clearNotice();emit()},
    async load():Promise<Result<SettingsDraftSession>> {
      clearNotice()
      try{const session=await api.settingsDraft.read();if(session.ok){state.error=null;accept(session.data)}else{state.error=session.error;emit()}return session}
      catch{const result:Result<SettingsDraftSession>={ok:false,error:{code:'INTERNAL',message:'IPC 初始化失败，尚未读取 Main 草稿。请重新连接配置。'}};state.error=result.error;emit();return result}
    },
    edit(editor: EditorSettings) {
      if(state.busy||disposed)return
      if(!state.session){state.error={code:'UNAVAILABLE',message:'尚未读取 Main 草稿，无法编辑或保存。请重新连接配置。'};emit();return}
      enqueue(editor)
    },
    editExpectedEnd(input:string|null){
      if(state.busy||disposed)return
      const context=state.expectedEnd
      if(!state.session||!context?.available){state.error={code:'UNAVAILABLE',message:context&&!context.available?context.message:'当前班次尚未确认。'};emit();return}
      state.expectedEndInput=input??context.normalEnd.time
      expectedEdit={targetKey:context.targetKey,expectedRevision:state.session.expectedRevision,input};enqueue(state.editor)
    },
    retry(){if(expectedEdit)this.editExpectedEnd(expectedEdit.input);else this.edit(state.editor)},
    async flush(){await queue;return lastSync},
    async save():Promise<boolean>{
      if(state.busy)return false
      if(!state.session){state.error={code:'UNAVAILABLE',message:'尚未读取 Main 草稿，无法保存。请重新连接配置。'};emit();return false}
      clearNotice()
      state.busy=true;state.notice='正在校验并保存…';emit()
      try {
        await queue;if(!lastSync.ok){state.error=lastSync.error;return false}
        const checked=validateStructure(asDraft(state.editor),editableConfigValidator)
        if(!checked.ok){state.error=checked.error;if(checked.error.code==='VALIDATION')state.issues=checked.error.issues;return false}
        const saved=await api.config.save({settings:checked.data,expectedRevision:state.session.expectedRevision})
        if(!saved.ok){state.error=saved.error;if(saved.error.code==='VALIDATION')state.issues=saved.error.issues;return false}
        const current=await api.settingsDraft.read();if(!current.ok){state.error=current.error;return false}
        accept(current.data);state.error=null;state.notice='设置已保存。'
        const generation=noticeGeneration
        if(!disposed)noticeTimer=timers.set(()=>{if(generation===noticeGeneration){state.notice='';noticeTimer=null;emit()}},2000)
        else state.notice=''
        return true
      } catch {state.error={code:'INTERNAL',message:'保存调用失败，输入保留；请重新确认保存状态。'};return false}
      finally{state.busy=false;if(state.error)state.notice='';emit()}
    },
    async discard():Promise<boolean>{
      if(state.busy)return false
      clearNotice()
      state.busy=true;emit()
      try{await queue;const result=await api.settingsDraft.discard();if(!result.ok){state.error=result.error;return false}
        accept(result.data);lastSync={ok:true,data:null};state.error=null;state.notice='已放弃未保存修改。';return true
      }finally{state.busy=false;emit()}
    },
    dispose(){clearNotice();disposed=true}
  }
}
