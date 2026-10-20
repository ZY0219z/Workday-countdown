// Test orchestration only. A native button Invoke is not completion of the
// asynchronous close-to-tray operation. Never restore over a pending close.
export async function prepareResourceMain(port){
  port.record('close-request')
  const closing=Promise.resolve().then(port.closeMain)
  void closing.catch(()=>{}) // The awaited operation below still propagates failure.
  await port.confirmHide()
  port.record('hide-confirmation-invoked')
  const closed=await closing
  port.record('close-complete',{ok:closed?.ok})
  if(!closed?.ok)throw Error('Resource preparation close failed: '+JSON.stringify(closed?.error))
  await port.assertTrayOnly()
  port.record('show-main-request')
  const shown=await port.showMain()
  port.record('show-main-return',{ok:shown?.ok})
  if(!shown?.ok)throw Error('Resource preparation restore failed: '+JSON.stringify(shown?.error))
  await port.assertMain()
}

export function resourceModeIssues(point,mode,expectedId){
  const issues=[]
  if(point.trayAvailable!==true)issues.push('native tray unavailable')
  const visible=point.windows.filter(w=>w.visible&&!w.minimized).map(w=>w.id)
  const expected=mode==='tray'?[]:[expectedId]
  if(!['main','mini','tray'].includes(mode)||mode!=='tray'&&!Number.isInteger(expectedId)||
    visible.length!==expected.length||visible.some((id,i)=>id!==expected[i]))issues.push('resource mode visibility changed')
  if(!Number.isInteger(point.subscribers)||point.subscribers<0||point.subscribers>1)issues.push('invalid snapshot subscriber count')
  return issues
}

// Visible-window resource sampling does not require foreground ownership.
// A pre-existing foreground app with unchanged input is not interference.
export function classifyResourceInput(current,previous,activity={streak:0,startedAt:null}){
  const changed=current.lastInputTick!==previous.lastInputTick
  const streak=changed?activity.streak+1:0
  const startedAt=changed?(activity.streak?activity.startedAt:current.at):null
  // Three consecutive changing observations spanning >=2s are evidence of
  // sustained activity, not proof of its source. Keep measuring, never PASS
  // an unresolved environment. Isolated changes are diagnostic only.
  const sustained=streak>=3&&current.at-startedAt>=2000
  return {changed,activity:{streak,startedAt},
    stopReasons:/^(LogonUI|LockApp)$/i.test(current.foreground.name??'')?['test desktop unavailable']:[],
    uncertainReasons:sustained?['sustained input activity; source and performance effect unknown']:[]}
}
