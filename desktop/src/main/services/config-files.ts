import { open, mkdir, rename, unlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { MAX_DTO_BYTES, issue, validationFailure } from '../../shared/validation'
import type { Result } from '../../shared/contracts'

export interface ConfigFiles {
  read(path: string): Promise<string | null>
  mkdir(path: string): Promise<void>
  writeExclusiveFlush(path: string, text: string): Promise<void>
  replace(from: string, to: string): Promise<void>
  remove(path: string): Promise<void>
}
export class FileLimitError extends Error { readonly code = 'FILE_LIMIT' }
export const nodeConfigFiles: ConfigFiles = {
  async read(path) {
    let handle
    try { handle = await open(path, constants.O_RDONLY) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size > MAX_DTO_BYTES) throw new FileLimitError('配置不是普通文件或超过1 MiB。')
      // Read at most limit+1 even if the source grows after stat; never read an
      // unbounded external file into memory and then check its size afterwards.
      const bytes = Buffer.alloc(MAX_DTO_BYTES + 1)
      let length = 0
      while (length < bytes.length) {
        const result = await handle.read(bytes, length, bytes.length - length, null)
        if (!result.bytesRead) break
        length += result.bytesRead
      }
      if (length > MAX_DTO_BYTES) throw new FileLimitError('配置超过1 MiB。')
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length))
    } finally { await handle.close() }
  },
  async mkdir(path) { await mkdir(path, { recursive: true }) },
  async writeExclusiveFlush(path, text) {
    const handle = await open(path, 'wx', 0o600)
    try { await handle.writeFile(text, 'utf8'); await handle.sync() }
    finally { await handle.close() }
  },
  async replace(from, to) { await rename(from, to) },
  async remove(path) { try { await unlink(path) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error } }
}
export function configDirectory(appDataRoot: string): Result<string> {
  return typeof appDataRoot === 'string' && isAbsolute(appDataRoot)
    ? { ok: true, data: join(appDataRoot, 'Workday Escape') }
    : validationFailure([issue('$.appDataRoot', 'FORMAT', '主进程必须提供绝对用户数据根目录。')])
}
export function fileFailure(error: unknown): Result<never> {
  const code = (error as NodeJS.ErrnoException | null)?.code
  if (code === 'FILE_LIMIT') return validationFailure([issue('$', 'LIMIT', '文件不是普通配置文件或超过1 MiB。')])
  if (code === 'EACCES' || code === 'EPERM') return { ok: false, error: { code: 'IO_DENIED', message: '配置访问被拒绝或文件仍被占用；原配置未被删除。' } }
  if (code === 'EBUSY' || code === 'EEXIST') return { ok: false, error: { code: 'IO_BUSY', message: '配置文件锁定重试已用尽，请关闭占用程序后重试。' } }
  if (code === 'ENOSPC' || code === 'EDQUOT') return { ok: false, error: { code: 'UNAVAILABLE', message: '磁盘空间不足，配置没有保存成功。' } }
  return { ok: false, error: { code: 'UNAVAILABLE', message: '配置文件操作失败，请保留草稿后重试。' } }
}
