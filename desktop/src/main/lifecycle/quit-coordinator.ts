import type { Result } from '../../shared/contracts'
import { success, v, validateStructure } from '../../shared/validation'

export interface ExitDraft { dirty: boolean; saving: boolean; identity: string }
export type ExitChoice = 'save' | 'discard' | 'continueEditing'
export interface ExitDraftAdapter {
  read(): Promise<Result<ExitDraft>>
  confirm(draft: ExitDraft): Promise<Result<ExitChoice>>
  save(identity: string): Promise<Result<null>>
  discard(identity: string): Promise<Result<null>>
}
export interface QuitOptions {
  waitForWrites(): Promise<Result<null>>
  restoreMain(): void
  commitQuit(): Result<null>
  waitMilliseconds: number
  confirmationMilliseconds: number
}
const unavailable = (message: string): Result<never> => ({ ok: false, error: { code: 'UNAVAILABLE', message } })
export function createQuitCoordinator(options: QuitOptions) {
  let draft: ExitDraftAdapter | null = null, active: Promise<Result<null>> | null = null
  let authorized = false, disposed = false, pendingSave = false, pendingConfirmation = false
  const timers = new Map<ReturnType<typeof setTimeout>, (result: Result<never>) => void>()
  async function bounded<T>(promise: Promise<Result<T>>, milliseconds: number): Promise<Result<T>> {
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 1 || milliseconds > 120_000) return unavailable('退出等待期限不合法。')
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([promise, new Promise<Result<never>>(resolve => {
        timer = setTimeout(() => resolve({ ok: false, error: { code: 'IO_BUSY', message: '退出等待超时；保存未被取消，窗口和草稿保留，请稍后重试。' } }), milliseconds)
        timers.set(timer, resolve)
      })])
    } finally { if (timer) { clearTimeout(timer); timers.delete(timer) } }
  }
  async function read(adapter: ExitDraftAdapter): Promise<Result<ExitDraft>> {
    const result = await bounded(adapter.read(), options.waitMilliseconds)
    return result.ok ? validateStructure(result.data, v.object<ExitDraft>({ dirty: v.boolean, saving: v.boolean, identity: v.string(undefined, 4096) })) : result
  }
  async function perform(): Promise<Result<null>> {
    if (disposed) return unavailable('退出协调器已释放。')
    if (!draft) return unavailable('尚未注册可信草稿会话，不能假定没有未保存内容。')
    if (pendingSave || pendingConfirmation) return { ok: false, error: { code: 'IO_BUSY', message: '上次保存或确认尚未结束，不重复发起退出操作。' } }
    const adapter = draft
    const drained = await bounded(options.waitForWrites(), options.waitMilliseconds)
    if (!drained.ok) return drained
    const snapshot = await read(adapter)
    if (!snapshot.ok) return snapshot
    if (snapshot.data.saving) return { ok: false, error: { code: 'IO_BUSY', message: '设置仍在处理中，请待完成后退出。' } }
    if (snapshot.data.dirty) {
      options.restoreMain()
      pendingConfirmation = true
      const confirmation = Promise.resolve().then(() => adapter.confirm(snapshot.data)).finally(() => { pendingConfirmation = false })
      const choice = await bounded(confirmation, options.confirmationMilliseconds)
      if (!choice.ok) return choice
      const checked = validateStructure(choice.data, v.enum(['save', 'discard', 'continueEditing'] as const))
      if (!checked.ok) return checked
      if (checked.data === 'continueEditing') return { ok: false, error: { code: 'CANCELLED', message: '已取消退出，继续编辑。' } }
      const current = await read(adapter)
      if (!current.ok) return current
      if (draft !== adapter || current.data.identity !== snapshot.data.identity) return unavailable('确认期间草稿已改变，请重新确认。')
      pendingSave = true
      const operation = Promise.resolve().then(() => checked.data === 'save' ? adapter.save(snapshot.data.identity) : adapter.discard(snapshot.data.identity)).finally(() => { pendingSave = false })
      const completed = await bounded(operation, options.waitMilliseconds)
      if (!completed.ok) return completed
    }
    const finalWrites = await bounded(options.waitForWrites(), options.waitMilliseconds)
    if (!finalWrites.ok) return finalWrites
    const final = await read(adapter)
    if (!final.ok) return final
    if (disposed || draft !== adapter || final.data.dirty || final.data.saving) return unavailable('仍有未保存或未同步设置，退出被取消。')
    const committed = options.commitQuit()
    if (committed.ok) authorized = true
    return committed
  }
  return {
    registerDraft(adapter: ExitDraftAdapter): () => void {
      if (disposed || active || authorized) throw new Error('退出处理中，不能更换草稿会话。')
      draft = adapter
      return () => { if (draft === adapter) draft = null }
    },
    requestQuit(): Promise<Result<null>> {
      if (authorized) return Promise.resolve(success(null))
      if (active) return active
      active = Promise.resolve().then(perform).catch(() => unavailable('无法完成退出确认，应用和草稿仍保留。')).then(result => {
        if (!result.ok && !disposed) options.restoreMain()
        active = null
        return result
      })
      return active
    },
    isAuthorized: () => authorized,
    isPending: () => active!==null,
    dispose() { disposed = true; draft = null; for (const [timer, resolve] of timers) { clearTimeout(timer); resolve({ ok: false, error: { code: 'CANCELLED', message: '退出协调器已释放。' } }) }; timers.clear() }
  }
}
