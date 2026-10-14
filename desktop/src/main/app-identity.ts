import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Result } from '../shared/contracts'
import { issue, success, validationFailure } from '../shared/validation'

export const APPLICATION_NAME = 'Workday Escape'
export const APPLICATION_ID = 'com.workdayescape'
export interface ApplicationPaths {
  userData: string
  sessionData: string
  pocSettings: string
  testProfile: boolean
}
// Called before ready and before the lock. EXE/extraction/working-directory and
// version are deliberately absent. These paths are Main-only, never IPC DTOs.
export function resolveApplicationPaths(input: { appData: string; temp: string; testMode: boolean; testProfile: string | null }): Result<ApplicationPaths> {
  if (!isAbsolute(input.appData) || !isAbsolute(input.temp)) return validationFailure([issue('$', 'FORMAT', '应用目录必须是绝对路径。')])
  if (input.testMode && input.testProfile !== null) {
    if (!isAbsolute(input.testProfile)) return validationFailure([issue('$.testProfile', 'FORMAT', '测试profile必须是绝对临时目录。')])
    const profile = resolve(input.testProfile), inside = relative(resolve(input.temp), profile)
    if (!inside || inside.startsWith('..' + sep) || inside === '..' || isAbsolute(inside) ||
        !/^(workday-(?:desktop|d08|lifecycle)-|Workday Escape POC 独立验证 )/i.test(inside.split(sep)[0])) {
      return validationFailure([issue('$.testProfile', 'FORMAT', '只接受测试工具拥有的临时profile。')])
    }
    const userData = join(profile, 'lifecycle')
    return success({ userData, sessionData: join(userData, 'runtime'), pocSettings: join(profile, 'settings.json'), testProfile: true })
  }
  const userData = join(resolve(input.appData), APPLICATION_NAME)
  return success({ userData, sessionData: join(userData, 'runtime'),
    pocSettings: join(resolve(input.appData), 'Workday Escape POC', 'settings.json'), testProfile: false })
}
