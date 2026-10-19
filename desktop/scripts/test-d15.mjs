import {spawnSync} from 'node:child_process'
for(const args of [['scripts/test-lifecycle.mjs','d15'],['--test','tests/unit/d15-resources.test.mjs']]){
  const result=spawnSync(process.execPath,args,{stdio:'inherit',windowsHide:true})
  if(result.error)throw result.error
  if(result.status!==0){process.exitCode=result.status??1;break}
}
