import type { WorkdayApi } from '../../shared/settings'
import type { MainWindowApi } from '../../shared/contracts'

declare global {
  interface Window { workday: WorkdayApi; workdayV2: MainWindowApi }
}

export {}
