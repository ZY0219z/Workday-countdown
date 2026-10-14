import { isAbsolute, join } from 'node:path'
import type { MigrationSource, Result } from '../../shared/contracts'
import { success } from '../../shared/validation'
import { nodeConfigFiles, fileFailure, type ConfigFiles } from './config-files'

export interface ImportSourceHandle { readonly kind: MigrationSource }
export interface MigrationFiles {
  choose(kind: MigrationSource): Promise<Result<ImportSourceHandle | null>>
  read(handle: ImportSourceHandle): Promise<Result<string | null>>
  export(text: string): Promise<Result<null>>
}
// The chooser is a trusted Main adapter, not a public path API. D09/D11 will
// supply actual native dialogs. Handles carry no private path into the preview.
export function createMigrationFiles(options: {
  selectImport(kind: MigrationSource): Promise<string | null>
  selectExport(): Promise<string | null>
  files?: ConfigFiles
}): MigrationFiles {
  const files = options.files ?? nodeConfigFiles
  const paths = new WeakMap<ImportSourceHandle, string>()
  return {
    async choose(kind) {
      try {
        const path = await options.selectImport(kind)
        if (path === null) return success(null)
        if (!isAbsolute(path)) return { ok: false, error: { code: 'FORBIDDEN', message: '文件选择适配器未返回绝对路径。' } }
        const handle = Object.freeze({ kind }); paths.set(handle, path); return success(handle)
      } catch (error) { return fileFailure(error) }
    },
    async read(handle) {
      const path = paths.get(handle)
      if (!path) return { ok: false, error: { code: 'FORBIDDEN', message: '来源没有主进程文件选择授权。' } }
      try { return success(await files.read(path)) } catch (error) { return fileFailure(error) }
    },
    async export(text) {
      try {
        const path = await options.selectExport()
        if (path === null) return { ok: false, error: { code: 'CANCELLED', message: '已取消导出。' } }
        if (!isAbsolute(path)) return { ok: false, error: { code: 'FORBIDDEN', message: '导出目标未经过主进程选择。' } }
        // Exclusive create protects an existing file. UI must select a new name;
        // D07 never silently overwrites a source or user's unrelated document.
        await files.writeExclusiveFlush(path, text)
        return success(null)
      } catch (error) { return fileFailure(error) }
    }
  }
}
// Only these two known candidates; no disk scan, no app.getPath('exe') fallback
// that could mistake Electron's extraction directory for the portable location.
export function knownMigrationCandidates(appDataRoot: string, portableOriginalDirectory: string | null): Array<{ kind: MigrationSource; path: string }> {
  if (!isAbsolute(appDataRoot) || (portableOriginalDirectory !== null && !isAbsolute(portableOriginalDirectory))) return []
  const candidates: Array<{ kind: MigrationSource; path: string }> = [{ kind: 'electron-poc', path: join(appDataRoot, 'Workday Escape POC', 'settings.json') }]
  if (portableOriginalDirectory !== null) candidates.push({ kind: 'python-v1', path: join(portableOriginalDirectory, 'config.json') })
  return candidates
}
