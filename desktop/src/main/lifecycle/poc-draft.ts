import { createHash } from 'node:crypto'
import type { Result } from '../../shared/contracts'
import { success, v, validateStructure } from '../../shared/validation'
import { validateSettings } from '../../shared/settings'
import type { WorkSettings } from '../../shared/settings'
import type { ExitChoice, ExitDraft, ExitDraftAdapter } from './quit-coordinator'

// Compatibility adapter for the TWO existing POC form inputs, not a formal V2
// DraftState session/IPC. Reads only on exit; no renderer Node/API expansion.
export function createPocDraftAdapter(options: {
  readForm(): Promise<unknown>
  saved(): WorkSettings
  confirm(draft: ExitDraft): Promise<Result<ExitChoice>>
  save(settings: WorkSettings): Promise<Result<null>>
  discardForm(): Promise<Result<null>>
}): ExitDraftAdapter {
  let form: { workStartTime: string; workEndTime: string; busy: boolean } | null = null
  const identity = () => createHash('sha256').update(JSON.stringify([options.saved(), form])).digest('hex')
  return {
    async read() {
      try {
        const formText: ReturnType<typeof v.string> = (value, field, issues) => value === '' ? '' : v.string(undefined, 64)(value, field, issues)
        const parsed = validateStructure(await options.readForm(), v.object({ workStartTime: formText, workEndTime: formText, busy: v.boolean }))
        if (!parsed.ok) { form = null; return parsed }
        form = parsed.data; const saved = options.saved()
        return success({ dirty: form.workStartTime !== saved.workStartTime || form.workEndTime !== saved.workEndTime, saving: form.busy, identity: identity() })
      } catch { form = null; return { ok: false, error: { code: 'UNAVAILABLE', message: '无法确认当前POC表单，未静默丢弃设置。' } } }
    },
    confirm: options.confirm,
    async save(expected) {
      if (!form || identity() !== expected) return { ok: false, error: { code: 'UNAVAILABLE', message: '表单已变化，请重新确认。' } }
      try { return await options.save(validateSettings({ workStartTime: form.workStartTime, workEndTime: form.workEndTime })) }
      catch { return { ok: false, error: { code: 'VALIDATION', message: 'POC时间无法保存。', issues: [{ field: '$', reason: 'FORMAT', message: '请检查同日上下班时间，草稿仍保留。' }] } } }
    },
    async discard(expected) {
      return form && identity() === expected ? options.discardForm() : { ok: false, error: { code: 'UNAVAILABLE', message: '表单已变化，未丢弃。' } }
    }
  }
}
