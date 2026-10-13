export interface WorkSettings {
  workStartTime: string
  workEndTime: string
}

export interface SettingsLoadResult {
  settings: WorkSettings
  warning: string | null
}

export interface WorkdayApi {
  loadSettings(): Promise<SettingsLoadResult>
  saveSettings(settings: WorkSettings): Promise<WorkSettings>
  quit(): Promise<void>
}

export const DEFAULT_SETTINGS: Readonly<WorkSettings> = {
  workStartTime: '08:30',
  workEndTime: '18:00'
}

export function validateSettings(value: unknown): WorkSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('上下班时间配置无效。')
  }
  const input = value as Record<string, unknown>
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/
  if (typeof input.workStartTime !== 'string' || !timePattern.test(input.workStartTime) ||
      typeof input.workEndTime !== 'string' || !timePattern.test(input.workEndTime)) {
    throw new Error('请使用有效的 HH:MM 时间。')
  }
  if (input.workEndTime <= input.workStartTime) {
    throw new Error('下班时间必须晚于上班时间；此演示仅支持同日班次。')
  }
  return { workStartTime: input.workStartTime, workEndTime: input.workEndTime }
}
