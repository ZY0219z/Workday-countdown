import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_SETTINGS, validateSettings } from '../shared/settings'
import type { SettingsLoadResult, WorkSettings } from '../shared/settings'

export function loadSettings(filePath: string): SettingsLoadResult {
  try {
    return { settings: validateSettings(JSON.parse(readFileSync(filePath, 'utf8'))), warning: null }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { settings: { ...DEFAULT_SETTINGS }, warning: null }
    }
    return {
      settings: { ...DEFAULT_SETTINGS },
      warning: '配置读取失败，暂用默认时间。原文件已保留，保存将替换该配置。'
    }
  }
}

export function saveSettings(filePath: string, value: unknown): WorkSettings {
  const settings = validateSettings(value)
  mkdirSync(dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  renameSync(temporaryPath, filePath)
  return settings
}
