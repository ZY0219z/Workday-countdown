import {readFileSync,lstatSync,unlinkSync} from 'node:fs'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {execFileSync} from 'node:child_process'

const desktop=resolve(dirname(fileURLToPath(import.meta.url)),'..')
export const d15LeasePath=resolve(desktop,'test-results/d15-gui-lease.json')
export const d15CrashScenario='D15 native unsaved dialog: 继续编辑'
export const d15MainTask='D15-main-g05-2026-10-20'
export const d15MainTitle='D15 native resources main: visible main only, 30+120 seconds'
export function d15MainGrep(){return exactGrep([d15MainTitle])}
export const d15DesktopTask='D15-native-g05-2026-10-19'
export const d15DesktopScenario='D15 authorized native and G05 acceptance'
export const d15DesktopTitles=[
  'D15 native main: production page, real foreground, countdown, fish and sandbox',
  'D15 native mini: exclusive activation, pin, real mouse drag, restored position and dirty draft',
  'D15 native tray: first hide notice, close hides, physical tray restore, mini menu and minimize',
  'D15 native second-instance: original focus assertion and foreground evidence',
  'D15 native 100 switches: real exclusive windows, focus, listeners, subscriptions, draft and recovery',
  'D15 native resources: visible main, visible mini and real tray-only, 30+120 seconds each'
]
function validTitles(titles){return Array.isArray(titles)&&titles.length>0&&titles.length<=d15DesktopTitles.length&&new Set(titles).size===titles.length&&titles.every(title=>d15DesktopTitles.includes(title))}
export function d15DesktopGrep(titles=d15DesktopTitles){
  if(!validTitles(titles))throw Error('Unknown or duplicate D15 desktop scenario')
  return exactGrep(titles)
}
function exactGrep(titles){
  // Playwright prepends empty root/project titles and this exact file name
  // when evaluating grep. No arbitrary project/file/title prefix is accepted.
  return new RegExp('^\\s*(?:d15-native\\.spec\\.ts\\s+)?(?:'+titles.map(title=>title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')$')
}
function leaseTitles(lease){return lease.task===d15MainTask?[d15MainTitle]:lease.task===d15DesktopTask?lease.scenarios:[d15CrashScenario]}
export function validD15Lease(lease,context){
  const current=lease?.task===d15DesktopTask,main=lease?.task===d15MainTask
  const task=main?lease.scenario===d15MainTitle&&Array.isArray(lease.scenarios)&&lease.scenarios.length===1&&lease.scenarios[0]===d15MainTitle:current?lease.scenario===d15DesktopScenario&&validTitles(lease.scenarios):lease?.task==='D15-crash-recheck-2026-10-19'&&lease.scenario===d15CrashScenario
  return context.platform==='win32' && task &&
    lease.desktop===context.desktop && lease.head===context.head &&
    Number.isSafeInteger(lease.created) && Number.isSafeInteger(lease.expires) &&
    lease.created<=context.now && context.now<lease.expires && lease.expires>lease.created && lease.expires-lease.created<=(main?300000:current?1200000:3600000) &&
    lease.remaining===1 && Array.isArray(lease.groups) && lease.groups.length===1 && lease.groups[0]==='d15-native.spec.ts'
}
export function validD15GuiScope(projects,titles=[d15CrashScenario]){
  if(!Array.isArray(projects)||projects.length!==1)return false
  const project=projects[0],match=project.testMatch,grep=project.grep
  const source=titles.length===1&&titles[0]===d15CrashScenario?d15CrashScenario+'$':titles.length===1&&titles[0]===d15MainTitle?d15MainGrep().source:validTitles(titles)?d15DesktopGrep(titles).source:null
  return (match==='**/d15-native.spec.ts'||Array.isArray(match)&&match.length===1&&match[0]==='**/d15-native.spec.ts')&&
    grep instanceof RegExp&&grep.source===source&&grep.flags===''&&project.repeatEach===1&&project.retries===0
}
export default function authorizeD15(config){
  try{
    const file=lstatSync(d15LeasePath)
    if(!file.isFile()||file.isSymbolicLink()||file.size>4096)throw Error('invalid file')
    const lease=JSON.parse(readFileSync(d15LeasePath,'utf8'))
    const head=execFileSync('git',['rev-parse','HEAD'],{cwd:desktop,windowsHide:true,encoding:'utf8'}).trim()
    if(!validD15Lease(lease,{desktop,head,now:Date.now(),platform:process.platform}))throw Error('invalid lease binding')
    if(!validD15GuiScope(config.projects,leaseTitles(lease))||config.workers!==1)throw Error('invalid explicit scenario scope')
    // One-shot: consume BEFORE any native window launches. No reusable permit
    // survives a test failure, and no environment variable unlocks this path.
    unlinkSync(d15LeasePath)
  }catch(error){throw Error('D15 GUI默认禁止：缺少绑定当前仓库、HEAD、测试组的一次性限时许可。'+String(error))}
}
