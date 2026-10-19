// A Playwright 'close' event / cmd.exe exit is not proof of a healthy Main exit.
export function verifyOwnedExit(launcher,main,expected){
  const issues=[]
  if(!launcher||launcher.exitCode!==0||launcher.signalCode)issues.push('launcher did not exit normally with code 0')
  if(!expected||!Number.isSafeInteger(expected.pid)||typeof expected.createdFileTime!=='string'||!/^\d+$/.test(expected.createdFileTime)||
    main?.pid!==expected.pid||main?.createdFileTime!==expected.createdFileTime)issues.push('native Main identity not verified')
  if(main?.exited!==true||main?.exitCode!==0)issues.push('native Main did not exit normally with code 0')
  return {status:issues.length?'FAIL':'PASS',issues}
}
