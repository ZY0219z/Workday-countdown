import type { ContractError, ContractRequests, ExpectedEndContext, MainWindowApi, Result, SettingsDraftSession, ValidationIssue } from '../../../shared/contracts'
import { checkExpectedRevision } from '../../../shared/capabilities'
import { editableConfigValidator } from '../../../shared/config-schema'
import { ipcFailure } from '../../../shared/ipc'
import { createSettingsDraft } from '../../../shared/settings-draft'
import { success, validateStructure } from '../../../shared/validation'
import { initialEditor, editorFrom, asDraft, type EditorSettings } from './settings-editor'

export type OvertimeEdit = ContractRequests['settingsDraft.setExpectedEnd']
export type OvertimeTarget = { revision: number; context: Extract<ExpectedEndContext, { available: true }> }
export const OVERTIME_CANCEL_NOTICE = '今天不加班，回去好好休息～'

const unavailable = (message: string): Result<never> => ({ ok: false, error: { code: 'UNAVAILABLE', message } })

function overtimeTarget(session: SettingsDraftSession): Result<OvertimeTarget> {
  if (!session.saved || session.configurationStatus !== 'ready') return unavailable('当前配置不可用，无法设置加班。')
  if (session.dirty || session.expectedEndEdit || session.save.status === 'saving') return unavailable('请先处理设置页中尚未保存的修改。')
  const context = session.expectedEnd
  if (!context?.available) return unavailable(context?.message ?? '当前班次尚未确认。')
  return success({ revision: session.expectedRevision, context })
}

// A small UI session adapter, no files/business calculations. Every edit
// is queued to Main; failed/late saves cannot overwrite a newer local editor.
export function createSettingsController(api: MainWindowApi, changed: () => void, timers={set:(callback:()=>void,delay:number):unknown=>setTimeout(callback,delay),clear:(handle:unknown)=>clearTimeout(handle as ReturnType<typeof setTimeout>)}) {
  const state = { session: null as SettingsDraftSession | null, editor: initialEditor(), pending: 0, busy: false,
    error: null as ContractError | null, issues: [] as ValidationIssue[], notice: '', noticeKind:null as 'success'|'error'|null, dirty: false, unsynced: false,
    expectedEnd:null as ExpectedEndContext|null,expectedEndInput:'', overtimePending: false }
  let queue: Promise<unknown> = Promise.resolve(), disposed = false, lastSync: Result<unknown> = { ok: true, data: null }
  let noticeTimer:unknown=null,noticeGeneration=0
  let expectedEdit:ContractRequests['settingsDraft.setExpectedEnd']|null=null
  let overtimeAttempt: { edit: OvertimeEdit; mayHaveSaved: boolean } | null = null
  const emit = () => { if(!disposed) changed() }
  function clearNotice(){noticeGeneration++;if(noticeTimer!==null)timers.clear(noticeTimer);noticeTimer=null;state.notice='';state.noticeKind=null}
  function saveNotice(saved:boolean, message?:string){
    clearNotice();if(disposed)return
    state.notice=message??(saved?'设置已保存':state.error?.code==='VALIDATION'?'保存失败，请检查标记的设置项':'保存失败，修改已保留')
    state.noticeKind=saved?'success':'error'
    const generation=noticeGeneration
    noticeTimer=timers.set(()=>{if(generation===noticeGeneration){state.notice='';state.noticeKind=null;noticeTimer=null;emit()}},3000)
  }
  function acceptEnd(session:SettingsDraftSession){state.expectedEnd=session.expectedEnd??null;const context=session.expectedEnd
    state.expectedEndInput=session.expectedEndEdit?(session.expectedEndEdit.input??(context?.available?context.normalEnd.time:'')):(context?.available?context.finalEnd.time:'')}
  function accept(session: SettingsDraftSession) { expectedEdit=null;state.session=session;state.editor=editorFrom(session);state.dirty=session.dirty;state.unsynced=false;state.issues=session.issues;acceptEnd(session);emit() }
  function finishOvertime() {
    overtimeAttempt = null
    state.overtimePending = false
    lastSync = success(null)
  }
  function overtimeSaved(session: SettingsDraftSession, edit: OvertimeEdit) {
    finishOvertime()
    accept(session)
    if (edit.input === null) saveNotice(true, OVERTIME_CANCEL_NOTICE)
    return success(session.expectedRevision)
  }
  // The quick action starts with a clean Main draft and owns the settings lock.
  // A failed save can leave its staged input and a converted draft in Main.
  async function settleOvertime(): Promise<Result<number | null>> {
    const attempt = overtimeAttempt
    if (!attempt) return success(null)
    const current = await api.settingsDraft.read().catch(ipcFailure)
    if (!current.ok) return unavailable('暂时无法核对加班保存状态，请重试。')
    const session = current.data
    const { edit } = attempt
    if (!session.dirty && !session.expectedEndEdit && session.save.status !== 'saving') {
      if (attempt.mayHaveSaved && session.save.status === 'saved' && session.expectedRevision === edit.expectedRevision + 1) {
        return overtimeSaved(session, edit)
      }
      finishOvertime()
      accept(session)
      return success(null)
    }
    if (session.save.status === 'saving' || session.expectedRevision !== edit.expectedRevision ||
      session.expectedEndEdit?.targetKey !== edit.targetKey || session.expectedEndEdit.input !== edit.input) {
      return unavailable('设置草稿已变化或仍在保存，请重试核对加班状态。')
    }
    const discarded = await api.settingsDraft.discard().catch(ipcFailure)
    if (!discarded.ok) return unavailable(`暂时无法撤回快捷加班草稿。${discarded.error.message} 请重试。`)
    finishOvertime()
    accept(discarded.data)
    return success(null)
  }

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
    async readOvertime(): Promise<Result<OvertimeTarget>> {
      if (state.busy || state.pending || state.unsynced || disposed) return unavailable('设置正在处理，请稍后重试。')
      state.busy = true
      emit()
      try {
        const settled = await settleOvertime()
        if (!settled.ok) return settled
        const current = await api.settingsDraft.read().catch(ipcFailure)
        return current.ok ? overtimeTarget(current.data) : current
      } finally {
        state.busy = false
        emit()
      }
    },
    async saveOvertime(edit: OvertimeEdit): Promise<Result<number>> {
      if (state.busy || state.pending || state.unsynced || state.dirty || disposed) return unavailable('请先处理当前的设置修改。')
      state.busy = true
      clearNotice()
      emit()
      try {
        const settled = await settleOvertime()
        if (!settled.ok) return settled
        if (settled.data !== null) return success(settled.data)
        const current = await api.settingsDraft.read().catch(ipcFailure)
        if (!current.ok) return current
        const target = overtimeTarget(current.data)
        if (!target.ok) return target
        const revision = checkExpectedRevision(edit.expectedRevision, target.data.revision)
        if (!revision.ok) return revision
        if (target.data.context.targetKey !== edit.targetKey) return unavailable('当前班次或时区已变化，请重新打开加班设置。')
        const checked = validateStructure(current.data.draft, editableConfigValidator)
        if (!checked.ok) return checked

        overtimeAttempt = { edit, mayHaveSaved: false }
        state.overtimePending = true
        const staged = await api.settingsDraft.setExpectedEnd(edit).catch(ipcFailure)
        if (staged.ok) {
          const saved = await api.config.save({ settings: checked.data, expectedRevision: edit.expectedRevision }).catch(ipcFailure)
          if (saved.ok) {
            // The save response carries the committed configuration even if
            // the settings session can no longer be read back over IPC.
            const draft = createSettingsDraft(saved.data.config)
            if (draft.ok) return overtimeSaved({ ...draft.data, configurationStatus: 'ready' }, edit)
            overtimeAttempt.mayHaveSaved = true
          } else overtimeAttempt.mayHaveSaved = saved.error.code === 'INTERNAL'
          const reconciled = await settleOvertime()
          if (!reconciled.ok) return saved.ok ? reconciled : unavailable(`${saved.error.message} ${reconciled.error.message}`)
          if (reconciled.data !== null) return success(reconciled.data)
          return saved.ok ? unavailable('无法核对加班保存状态，请重新打开加班设置。') : saved
        }
        const reconciled = await settleOvertime()
        return reconciled.ok ? staged : unavailable(`${staged.error.message} ${reconciled.error.message}`)
      } finally {
        state.busy = false
        emit()
      }
    },
    clearNotice(){clearNotice();emit()},
    invalidInput(issue:ValidationIssue){
      if(state.busy||disposed)return
      state.issues=[...state.issues.filter(value=>value.field!==issue.field),issue]
      state.error={code:'VALIDATION',message:'设置未保存，请检查标记的设置项。',issues:state.issues}
      saveNotice(false);emit()
    },
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
      if(!state.session){state.error={code:'UNAVAILABLE',message:'尚未读取 Main 草稿，无法保存。请重新连接配置。'};saveNotice(false);emit();return false}
      clearNotice()
      state.busy=true;emit()
      let savedSuccessfully=false
      try {
        await queue;if(!lastSync.ok){state.error=lastSync.error;return false}
        const checked=validateStructure(asDraft(state.editor),editableConfigValidator)
        if(!checked.ok){state.error=checked.error;if(checked.error.code==='VALIDATION')state.issues=checked.error.issues;return false}
        const saved=await api.config.save({settings:checked.data,expectedRevision:state.session.expectedRevision})
        if(!saved.ok){state.error=saved.error;if(saved.error.code==='VALIDATION')state.issues=saved.error.issues;return false}
        const current=await api.settingsDraft.read();if(!current.ok){state.error=current.error;return false}
        accept(current.data);state.error=null;savedSuccessfully=true
        return true
      } catch {state.error={code:'INTERNAL',message:'保存调用失败，输入保留；请重新确认保存状态。'};return false}
      finally{state.busy=false;saveNotice(savedSuccessfully);emit()}
    },
    async discard():Promise<boolean>{
      if(state.busy)return false
      clearNotice()
      state.busy=true;emit()
      try{await queue;const result=await api.settingsDraft.discard();if(!result.ok){state.error=result.error;return false}
        accept(result.data);lastSync={ok:true,data:null};state.error=null;return true
      }finally{state.busy=false;emit()}
    },
    dispose(){clearNotice();disposed=true}
  }
}
