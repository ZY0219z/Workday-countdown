import type { Result } from '../../shared/contracts'
import { success } from '../../shared/validation'

// Wrap mutations at their Main entry point. Does not cancel/rewrite the D07
// transaction or invent a second queue. D09 must route all formal writes here.
export function createOperationBarrier() {
  const pending = new Set<Promise<Result<unknown>>>()
  let sealed = false
  return {
    async run<T>(work: () => Promise<Result<T>>): Promise<Result<T>> {
      if (sealed) return { ok: false, error: { code: 'UNAVAILABLE', message: '正在退出，不再接受新写入。' } }
      const promise = Promise.resolve().then(work).catch((): Result<never> => ({ ok: false, error: { code: 'UNAVAILABLE', message: '受控写入失败，退出未获许可。' } }))
      pending.add(promise)
      try { return await promise } finally { pending.delete(promise) }
    },
    async drain(): Promise<Result<null>> {
      while (pending.size) {
        const results = await Promise.all([...pending])
        const failure = results.find(result => !result.ok)
        if (failure && !failure.ok) return failure
      }
      return success(null)
    },
    seal() { sealed = true },
    reopen() { sealed = false },
    pendingCount: () => pending.size
  }
}
