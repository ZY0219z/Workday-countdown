import {readFileSync,lstatSync,unlinkSync} from 'node:fs'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {execFileSync} from 'node:child_process'

const desktop=resolve(dirname(fileURLToPath(import.meta.url)),'..')
export const d15LeasePath=resolve(desktop,'test-results/d15-gui-lease.json')
export const d15CrashScenario='D15 native unsaved dialog: 继续编辑'
export function validD15Lease(lease,context){
  return context.platform==='win32' && lease?.task==='D15-crash-recheck-2026-10-19' && lease.scenario===d15CrashScenario &&
    lease.desktop===context.desktop && lease.head===context.head &&
    Number.isSafeInteger(lease.created) && Number.isSafeInteger(lease.expires) &&
    lease.created<=context.now && context.now<lease.expires && lease.expires>lease.created && lease.expires-lease.created<=3600000 &&
    lease.remaining===1 && Array.isArray(lease.groups) && lease.groups.length===1 && lease.groups[0]==='d15-native.spec.ts'
}
export function validD15GuiScope(projects){
  if(!Array.isArray(projects)||projects.length!==1)return false
  const project=projects[0],match=project.testMatch,grep=project.grep
  return (match==='**/d15-native.spec.ts'||Array.isArray(match)&&match.length===1&&match[0]==='**/d15-native.spec.ts')&&
    grep instanceof RegExp&&grep.source===d15CrashScenario+'$'&&grep.flags===''&&project.repeatEach===1&&project.retries===0
}
export default function authorizeD15(config){
  try{
    const file=lstatSync(d15LeasePath)
    if(!file.isFile()||file.isSymbolicLink()||file.size>4096)throw Error('invalid file')
    const lease=JSON.parse(readFileSync(d15LeasePath,'utf8'))
    const head=execFileSync('git',['rev-parse','HEAD'],{cwd:desktop,windowsHide:true,encoding:'utf8'}).trim()
    if(!validD15Lease(lease,{desktop,head,now:Date.now(),platform:process.platform}))throw Error('invalid lease binding')
    if(!validD15GuiScope(config.projects)||config.workers!==1)throw Error('invalid single-scenario scope')
    // One-shot: consume BEFORE any native window launches. No reusable permit
    // survives a test failure, and no environment variable unlocks this path.
    unlinkSync(d15LeasePath)
  }catch(error){throw Error('D15 GUI默认禁止：缺少绑定当前仓库、HEAD、测试组的一次性限时许可。'+String(error))}
}
