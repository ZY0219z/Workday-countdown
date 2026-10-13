import type { WorkdayApi } from '../../shared/settings'

declare global {
  interface Window { workday: WorkdayApi }
}

export {}
