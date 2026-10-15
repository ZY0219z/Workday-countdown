import type { ContractError, MainWindowApi, Result, SettingsDraftSession, ValidationIssue } from '../../../shared/contracts'
import { editableConfigValidator } from '../../../shared/config-schema'
import { validateStructure } from '../../../shared/validation'
import { initialEditor, editorFrom, asDraft, type EditorSettings } from './settings-editor'

// A small UI session adapter, no timers/files/business calculations. Every edit
// is queued to Main; failed/late saves cannot overwrite a newer local editor.
export function createSettingsController(api: MainWindowApi, changed: () => void) {
  const state = { session: null as SettingsDraftSession | null, editor: initialEditor(), pending: 0, busy: false,
    error: null as ContractError | null, issues: [] as ValidationIssue[], notice: '', dirty: false, unsynced: false }
  let queue: Promise<unknown> = Promise.resolve(), disposed = false, lastSync: Result<unknown> = { ok: true, data: null }
  const emit = () => { if(!disposed) changed() }
  function accept(session: SettingsDraftSession) { state.session=session;state.editor=editorFrom(session);state.dirty=session.dirty;state.unsynced=false;state.issues=session.issues;emit() }
  return {
    state,
    async load() { const session=await api.settingsDraft.read();if(session.ok){state.error=null;accept(session.data)}else{state.error=session.error;emit()}return session },
    edit(editor: EditorSettings) {
      if(state.busy||!state.session||disposed)return
      state.editor=structuredClone(editor);state.dirty=true;state.unsynced=true;state.pending++;state.error=null;state.notice=''
      const draft=asDraft(editor),expectedRevision=state.session.expectedRevision
      queue=queue.then(async()=>{
        try { const result=await api.settingsDraft.update({draft,expectedRevision});lastSync=result
          if(result.ok){state.session=result.data;state.issues=result.data.issues;if(state.pending===1){state.dirty=result.data.dirty;state.unsynced=false}}
          else state.error=result.error
        } catch { lastSync={ok:false,error:{code:'INTERNAL',message:'草稿同步失败，请保留输入后重试。'}};state.error=lastSync.error }
        finally { state.pending--;emit() }
      });emit()
    },
    async flush(){await queue;return lastSync},
    async save():Promise<boolean>{
      if(state.busy||!state.session)return false
      state.busy=true;state.notice='正在校验排班并安全保存，首次可能需要数十秒。请等待结果。';emit()
      try {
        await queue;if(!lastSync.ok){state.error=lastSync.error;return false}
        const checked=validateStructure(asDraft(state.editor),editableConfigValidator)
        if(!checked.ok){state.error=checked.error;if(checked.error.code==='VALIDATION')state.issues=checked.error.issues;return false}
        const saved=await api.config.save({settings:checked.data,expectedRevision:state.session.expectedRevision})
        if(!saved.ok){state.error=saved.error;if(saved.error.code==='VALIDATION')state.issues=saved.error.issues;return false}
        const current=await api.settingsDraft.read();if(!current.ok){state.error=current.error;return false}
        accept(current.data);state.error=null;state.notice='设置已保存。';return true
      } catch {state.error={code:'INTERNAL',message:'保存调用失败，输入保留；请重新确认保存状态。'};return false}
      finally{state.busy=false;if(state.error)state.notice='';emit()}
    },
    async discard():Promise<boolean>{
      if(state.busy)return false
      state.busy=true;emit()
      try{await queue;const result=await api.settingsDraft.discard();if(!result.ok){state.error=result.error;return false}
        accept(result.data);lastSync={ok:true,data:null};state.error=null;state.notice='已放弃未保存修改。';return true
      }finally{state.busy=false;emit()}
    },
    dispose(){disposed=true}
  }
}
