// Main-only test policy. The boolean must come from the validated owned TEMP
// profile, never from a renderer or an arbitrary command-line switch.
export function backgroundTestEnabled(unpackagedDevelopment: boolean, ownedTestProfile: boolean, marker: unknown): boolean {
  return unpackagedDevelopment && ownedTestProfile && marker === '1'
}
const interactiveMethods = ['show', 'showInactive', 'focus', 'restore', 'minimize'] as const
type InteractiveWindow = { [Method in typeof interactiveMethods[number]]: () => void }
export function blockInteractiveWindowOperations(window: InteractiveWindow): string[] {
  const attempts: string[] = []
  for (const method of interactiveMethods) window[method] = () => {
    attempts.push(method)
    // Fail loudly, instead of pretending the native window became visible,
    // focused or restored. Real GUI assertions belong to the separate suite.
    throw new Error(`后台测试禁止原生窗口操作：${method}`)
  }
  return attempts
}
