import {test} from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {readFileSync,realpathSync} from 'node:fs'
import {verifyOwnedExit} from '../helpers/d15-exit-verdict.mjs'

const launcher={exitCode:0,signalCode:null}
const identity={pid:12,createdFileTime:'134368542135630856',exited:false,exitCode:null}
const main={...identity,exited:true,exitCode:0}
test('normal wrapper AND retained native Main exit are required',()=>assert.equal(verifyOwnedExit(launcher,main,identity).status,'PASS'))
for(const [name,wrapper,native,expected]of [
  ['already-crashed Main despite wrapper 0',launcher,{...main,exitCode:0xc0000005},identity],
  ['already-exited failing wrapper',{exitCode:73,signalCode:null},main,identity],
  ['live wrapper',{exitCode:null,signalCode:null},main,identity],
  ['signalled wrapper',{exitCode:0,signalCode:'SIGTERM'},main,identity],
  ['live Main',launcher,identity,identity],
  ['missing Main proof',launcher,null,identity],
  ['PID reuse',launcher,{...main,createdFileTime:'134368542135630857'},identity],
  ['different PID',launcher,{...main,pid:13},identity],
  ['missing expected identity',launcher,main,undefined]
])test('exit verdict rejects '+name,()=>assert.equal(verifyOwnedExit(wrapper,native,expected).status,'FAIL'))

test('CIM precision conversion is exact; adjacent microseconds/unknown zones are rejected',{skip:process.platform!=='win32'},()=>{
  const source=readFileSync(new URL('../helpers/d15-native-driver.ps1',import.meta.url),'utf8')
  const body=/public sealed class D15OwnerExit[\s\S]*?(?=public static class D15Native)/.exec(source)[0]
  const script=`$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;using System.ComponentModel;
${body}
'@
$utc=[DateTime]::FromFileTimeUtc(134368709065865100)
$values=@{
 exact=[D15OwnerExit]::MatchesCimCreation('134368709065865100',$utc)
 subMicrosecond=[D15OwnerExit]::MatchesCimCreation('134368709065865106',$utc)
 local=[D15OwnerExit]::MatchesCimCreation('134368709065865106',$utc.ToLocalTime())
 nextMicrosecond=[D15OwnerExit]::MatchesCimCreation('134368709065865110',$utc)
 previousMicrosecond=[D15OwnerExit]::MatchesCimCreation('134368709065865099',$utc)
 noZone=[D15OwnerExit]::MatchesCimCreation('134368709065865106',[DateTime]::SpecifyKind($utc,[DateTimeKind]::Unspecified))
 impossibleCimPrecision=[D15OwnerExit]::MatchesCimCreation('134368709065865106',$utc.AddTicks(6))
 invalid=[D15OwnerExit]::MatchesCimCreation('not ticks',$utc)
}
[Console]::WriteLine(($values|ConvertTo-Json -Compress))`
  const values=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command',script],{windowsHide:true,encoding:'utf8',timeout:20000}))
  for(const name of ['exact','subMicrosecond','local'])assert.equal(values[name],true,name)
  for(const name of ['nextMicrosecond','previousMicrosecond','noZone','impossibleCimPrecision','invalid'])assert.equal(values[name],false,name)
})

test('real owned Node identity guard repeats safely and rejects wrong PID/birth/path/exited state',{skip:process.platform!=='win32'},()=>{
  const source=readFileSync(new URL('../helpers/d15-native-driver.ps1',import.meta.url),'utf8')
  const body=/public sealed class D15OwnerExit[\s\S]*?(?=public static class D15Native)/.exec(source)[0]
  const guard=/function ConfirmIdentity[\s\S]*?(?=function OwnedElements)/.exec(source)[0]
  const literal=value=>"'"+value.replaceAll("'","''")+"'"
  const script=`$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;using System.ComponentModel;
${body}
'@
${guard}
$start=[Diagnostics.ProcessStartInfo]::new()
$start.FileName=${literal(realpathSync(process.execPath))};$start.Arguments='-e "process.stdin.resume();process.stdin.once(''data'',()=>process.exit(0))"'
$start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.RedirectStandardInput=$true
$child=[Diagnostics.Process]::Start($start);$handle=$null
try{
 $handle=[D15OwnerExit]::new($child.Id);$row=Get-CimInstance Win32_Process -Filter "ProcessId=$($child.Id)"
 function CopyRow { [pscustomobject]@{ProcessId=$row.ProcessId;ParentProcessId=$row.ParentProcessId;CreationDate=$row.CreationDate;ExecutablePath=$row.ExecutablePath} }
 function Rejected($candidate){try{$null=ConfirmIdentity $handle $candidate 'negative-fixture';$false}catch{$true}}
 $identities=@(1..3|ForEach-Object {(ConfirmIdentity $handle $row 'repeat-fixture').createdFileTime})
 $bad=CopyRow;$bad.ProcessId++;$wrongPid=Rejected $bad
 $bad=CopyRow;$bad.CreationDate=$bad.CreationDate.AddTicks(10);$wrongBirth=Rejected $bad
 $bad=CopyRow;$bad.ExecutablePath+='-wrong';$wrongPath=Rejected $bad
 $child.StandardInput.WriteLine('finish');$child.StandardInput.Flush();if(!$child.WaitForExit(5000)){throw 'Node fixture did not exit'}
 $dead=Rejected $row
 [Console]::WriteLine((@{identities=$identities;wrongPid=$wrongPid;wrongBirth=$wrongBirth;wrongPath=$wrongPath;dead=$dead;final=$handle.Read()}|ConvertTo-Json -Depth 5 -Compress))
}finally{if($handle){$handle.Dispose()};if(!$child.HasExited){$child.StandardInput.WriteLine('finish');$child.StandardInput.Close();if(!$child.WaitForExit(5000)){throw 'Owned Node still running'}};$child.Dispose()}
`
  const result=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command',script],{windowsHide:true,encoding:'utf8',timeout:20000,stdio:['pipe','pipe','pipe']}))
  assert.equal(new Set(result.identities).size,1)
  for(const name of ['wrongPid','wrongBirth','wrongPath','dead'])assert.equal(result[name],true,name)
  assert.equal(result.final.exitCode,0)
})

// Compile ONLY the read-only kernel32 handle class, never the GUI RPC entrypoint.
// Owned Node fixtures exit naturally after stdin; no Electron, UIA, clicks or kills.
for(const code of [0,73,259])test('retained Windows handle sees actual owned Node exit '+code,{skip:process.platform!=='win32'},()=>{
  const source=readFileSync(new URL('../helpers/d15-native-driver.ps1',import.meta.url),'utf8')
  const match=/public sealed class D15OwnerExit[\s\S]*?(?=public static class D15Native)/.exec(source)
  assert.ok(match)
  const literal=value=>"'"+value.replaceAll("'","''")+"'"
  const script=`$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;using System.ComponentModel;
${match[0]}
'@
$start=[Diagnostics.ProcessStartInfo]::new()
$start.FileName=${literal(process.execPath)}
$start.Arguments='-e "process.stdin.resume();process.stdin.once(''data'',()=>process.exit(${code}))"'
$start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.RedirectStandardInput=$true
$child=[Diagnostics.Process]::Start($start);$handle=$null
try{
 $handle=[D15OwnerExit]::new($child.Id);$before=$handle.Read()
 if($before.exited){throw 'fixture exited before observation'}
 $child.StandardInput.WriteLine('finish');$child.StandardInput.Flush()
 if(!$child.WaitForExit(5000)){throw 'fixture did not exit'}
 $after=$handle.Read()
 [Console]::WriteLine((@{before=$before;after=$after}|ConvertTo-Json -Compress))
}finally{
 if($handle){$handle.Dispose()}
 if(!$child.HasExited){$child.StandardInput.WriteLine('finish');$child.StandardInput.Close();if(!$child.WaitForExit(5000)){throw 'owned fixture still running'}}
 $child.Dispose()
}
`
  // Inline read-only commands do not change Windows' script execution policy.
  const output=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command',script],{windowsHide:true,encoding:'utf8',timeout:20000})
  const state=JSON.parse(output.trim());assert.equal(state.before.exited,false);assert.equal(state.after.exited,true);assert.equal(state.after.exitCode,code);assert.equal(state.after.createdFileTime,state.before.createdFileTime)
})
