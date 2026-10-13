import type { WorkSettings } from './settings'

export function getCountdown(now: Date, settings: WorkSettings) {
  const atTime = (time: string) => {
    const [hour, minute] = time.split(':').map(Number)
    const target = new Date(now)
    target.setHours(hour, minute, 0, 0)
    return target
  }
  const start = atTime(settings.workStartTime)
  const end = atTime(settings.workEndTime)
  const seconds = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 1000))
  const status = now < start ? '尚未上班' : now >= end ? '已经下班啦！' : '距离下班'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds % 3600 / 60)
  const remainder = seconds % 60
  return {
    seconds,
    status,
    text: [hours, minutes, remainder].map(part => String(part).padStart(2, '0')).join(':')
  }
}
