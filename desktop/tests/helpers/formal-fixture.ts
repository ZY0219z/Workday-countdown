import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createAppConfig } from '../../src/shared/config-schema'
import { loadBundledCalendarStore } from '../../src/main/services/calendar-store'
export function seedFormalProfile(profile:string){
  const path=join(profile,'lifecycle','settings.json');if(existsSync(path))return
  const config=createAppConfig({startDate:'2026-10-01',startTime:'09:00',endTime:'18:00',salaryDay:10,themeMode:'system',themeAccent:'ocean',updatedAt:'2026-10-15T00:00:00.000Z',appVersion:'2.0.0'}),calendars=loadBundledCalendarStore()
  if(!config.ok||!calendars.ok)throw Error('Invalid GUI fixture')
  config.data.revision=1;config.data.calendar.enabledYears=[2024,2025,2026];config.data.calendar.datasets=calendars.data.listMetadata()
  mkdirSync(join(profile,'lifecycle'),{recursive:true});writeFileSync(path,JSON.stringify(config.data))
}
