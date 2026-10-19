param(
  [Parameter(Mandatory=$true)][ValidateRange(1,2147483647)][int]$RootProcessId,
  [Parameter(Mandatory=$true)][ValidateRange(1,2147483647)][int]$ElectronProcessId,
  [Parameter(Mandatory=$true)][string]$OutputFile,
  [ValidateRange(0,30)][int]$WarmupSeconds=30,
  [ValidateRange(1,120)][int]$SampleSeconds=120
)
# Read-only, owned-process observation. Never launches/kills a user application.
# GetProcessTimes: https://learn.microsoft.com/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes
$ErrorActionPreference='Stop'
$desktopRoot=Split-Path -Parent $PSScriptRoot
$evidenceRoot=[IO.Path]::GetFullPath((Join-Path $desktopRoot 'test-results'))+[IO.Path]::DirectorySeparatorChar
$target=[IO.Path]::GetFullPath($OutputFile)
if (!$target.StartsWith($evidenceRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'Evidence must stay in desktop/test-results.' }
$root=Get-CimInstance Win32_Process -Filter "ProcessId=$RootProcessId"
$electron=Get-CimInstance Win32_Process -Filter "ProcessId=$ElectronProcessId"
$expected=[IO.Path]::GetFullPath((Join-Path $desktopRoot 'node_modules/electron/dist/electron.exe'))
if (!$root -or !$electron -or $electron.ExecutablePath -ne $expected -or $electron.CommandLine -notmatch '--remote-debugging') { throw 'Expected an owned Playwright Electron process and live launch root.' }
# On Windows Playwright can own a cmd/Node launch wrapper, not the Main PID.
# Verify ancestry rather than dropping this wrapper from CPU/PWS accounting.
$ancestor=$electron
for($depth=0;$depth -lt 16 -and $ancestor.ProcessId -ne $RootProcessId;$depth++){$ancestor=Get-CimInstance Win32_Process -Filter "ProcessId=$($ancestor.ParentProcessId)";if(!$ancestor){break}}
if(!$ancestor -or $ancestor.ProcessId -ne $RootProcessId){throw 'Electron is not a descendant of the supplied owned launch root.'}
$rootBirthUtc=$root.CreationDate.ToUniversalTime()
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.ComponentModel;
public sealed class OwnedCounter: IDisposable {
  [StructLayout(LayoutKind.Sequential)] struct FT { public uint Low,High; public long Ticks {get{return ((long)High<<32)|Low;}} }
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,int id);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr h,out FT c,out FT e,out FT k,out FT u);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h,uint timeout);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr h,out uint code);
  IntPtr handle; public long Creation; public double Cpu; public bool Exited; public uint ExitCode;
  public OwnedCounter(int id){handle=OpenProcess(0x101000,false,id);if(handle==IntPtr.Zero)throw new Win32Exception();Read();}
  public void Read(){FT c,e,k,u;if(!GetProcessTimes(handle,out c,out e,out k,out u))throw new Win32Exception();Creation=c.Ticks;Cpu=(k.Ticks+u.Ticks)/10000000.0;Exited=WaitForSingleObject(handle,0)==0;if(Exited&&!GetExitCodeProcess(handle,out ExitCode))throw new Win32Exception();}
  public void Dispose(){if(handle!=IntPtr.Zero){CloseHandle(handle);handle=IntPtr.Zero;}}
}
'@
$stream=[IO.File]::Open($target,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
$writer=New-Object IO.StreamWriter($stream,(New-Object Text.UTF8Encoding($false)));$writer.AutoFlush=$true
$records=@{};$watch=[Diagnostics.Stopwatch]::StartNew();$complete=$false
function Emit($record){$writer.WriteLine(($record|ConvertTo-Json -Depth 9 -Compress))}
function Capture($phase){
  $began=$watch.Elapsed.TotalSeconds;$events=New-Object Collections.Generic.List[object];$errors=New-Object Collections.Generic.List[string]
  $processes=@(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate,Name)
  $byId=@{};foreach($processRow in $processes){$byId[[int]$processRow.ProcessId]=$processRow}
  if($byId.ContainsKey($RootProcessId) -and $byId[$RootProcessId].CreationDate.ToUniversalTime() -ne $rootBirthUtc){throw 'Root PID was recycled; observation stopped.'}
  do {
    $added=$false
    foreach($processRow in $processes){
      $processId=[int]$processRow.ProcessId;$parentId=[int]$processRow.ParentProcessId
      $existing=@($records.Values|Where-Object {$_.pid -eq $processId -and !$_.exited})
      if($existing.Count){continue}
      $parents=@($records.Values|Where-Object {$_.pid -eq $parentId -and $_.createdUtc -le $processRow.CreationDate.ToUniversalTime() -and (!$_.exited -or $processRow.CreationDate.ToUniversalTime() -le $_.exitedUtc)})
      if($processId -ne $RootProcessId -and !$parents.Count){continue}
      # A recycled parent PID must not pull an unrelated family into this sample.
      if($processId -ne $RootProcessId -and $byId.ContainsKey($parentId) -and !@($parents|Where-Object {[Math]::Abs(($_.createdUtc-$byId[$parentId].CreationDate.ToUniversalTime()).TotalMilliseconds) -lt 1}).Count){continue}
      try {
        $counter=New-Object OwnedCounter($processId);$key="$processId/$($counter.Creation)"
        if($records.ContainsKey($key)){$counter.Dispose();continue}
        $records[$key]=@{key=$key;pid=$processId;parentPid=$parentId;name=$processRow.Name;createdUtc=[DateTime]::FromFileTimeUtc($counter.Creation);counter=$counter;cpuSeconds=$counter.Cpu;exited=$counter.Exited;exitedUtc=$null}
        $events.Add(@{event='enter';key=$key;pid=$processId});$added=$true
      } catch {$errors.Add("cannot capture owned PID $processId")}
    }
  } while($added)
  $memory=@{};$pwsRetries=0
  # The formatted provider can lag process creation, or a process can exit
  # between enumeration and the PWS query. Keep CPU handles and check exit
  # again; never convert an unavailable LIVE process PWS to zero.
  do {
    foreach($record in @($records.Values)){
      if($record.exited){continue}
      try {$record.counter.Read();$record.cpuSeconds=$record.counter.Cpu;if($record.counter.Exited){$record.exited=$true;$record.exitedUtc=[DateTime]::UtcNow;$events.Add(@{event='exit';key=$record.key;pid=$record.pid});$record.counter.Dispose()}}
      catch {$record.cpuSeconds=$null;$errors.Add("cannot read CPU $($record.key)")}
    }
    $alive=@($records.Values|Where-Object {!$_.exited});$memory=@{}
    if($alive.Count){$filter=($alive|ForEach-Object {"IDProcess=$($_.pid)"}) -join ' OR ';foreach($memoryRow in @(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter $filter -Property IDProcess,WorkingSetPrivate)){$memory[[int]$memoryRow.IDProcess]=[double]$memoryRow.WorkingSetPrivate}}
    $missing=@($alive|Where-Object {!$memory.ContainsKey($_.pid)})
    if(!$missing.Count -or $pwsRetries -ge 3){break}
    $pwsRetries++;Start-Sleep -Milliseconds 100
  } while($true)
  # Final timing read also accounts for CPU spent while the provider was read.
  foreach($record in @($records.Values)){
    if($record.exited){continue}
    try {$record.counter.Read();$record.cpuSeconds=$record.counter.Cpu;if($record.counter.Exited){$record.exited=$true;$record.exitedUtc=[DateTime]::UtcNow;$events.Add(@{event='exit';key=$record.key;pid=$record.pid});$record.counter.Dispose()}}
    catch {$record.cpuSeconds=$null;$errors.Add("cannot read final CPU $($record.key)")}
  }
  $rows=@(foreach($record in $records.Values){@{key=$record.key;pid=$record.pid;parentPid=$record.parentPid;name=$record.name;createdUtc=$record.createdUtc.ToString('o');cpuSeconds=$record.cpuSeconds;exited=$record.exited;exitCode=if($record.exited){$record.counter.ExitCode}else{$null};pwsBytes=if($record.exited){0}elseif($memory.ContainsKey($record.pid)){$memory[$record.pid]}else{$null}}})
  Emit @{kind='frame';phase=$phase;utc=[DateTime]::UtcNow.ToString('o');elapsedSeconds=$watch.Elapsed.TotalSeconds;collectionSeconds=$watch.Elapsed.TotalSeconds-$began;pwsRetries=$pwsRetries;processes=$rows;events=@($events.ToArray());errors=@($errors.ToArray())}
  if(!@($records.Values|Where-Object {$_.pid -eq $RootProcessId -and !$_.exited}).Count){throw 'Owned Electron root exited before sampling completed.'}
}
function Wait-Until([double]$seconds){while($watch.Elapsed.TotalSeconds -lt $seconds){Start-Sleep -Milliseconds ([Math]::Max(1,[Math]::Min(1000,($seconds-$watch.Elapsed.TotalSeconds)*1000)))}}
try {
  $os=Get-CimInstance Win32_OperatingSystem;$cpu=Get-CimInstance Win32_Processor;$machine=Get-CimInstance Win32_ComputerSystem
  $power=(& powercfg.exe /getactivescheme | Out-String).Trim();$batteries=@(Get-CimInstance Win32_Battery|Select-Object BatteryStatus,EstimatedChargeRemaining)
  Emit @{kind='header';schemaVersion=1;scope='owned launch wrapper + real native-hidden Main + two Renderers + GPU/utility; memory tray; NOT visible-window or real tray-only G05';logicalCores=[Environment]::ProcessorCount;warmupSeconds=$WarmupSeconds;sampleSeconds=$SampleSeconds;rootPid=$RootProcessId;electronPid=$ElectronProcessId;launcher='owned Playwright wrapper included; no Portable launcher was run';completeness='1-second process-tree polling; retained handles read final CPU for discovered exits; sub-poll short-lived children may be missed';environment=@{os=$os.Caption;build=$os.Version;arch=$os.OSArchitecture;cpu=@($cpu|Select-Object Name,NumberOfLogicalProcessors);ramBytes=[double]$machine.TotalPhysicalMemory;powerScheme=$power;batteries=$batteries}}
  Capture 'warmup'
  $warmupStart=$watch.Elapsed.TotalSeconds
  for($step=1;$step -le $WarmupSeconds;$step++){Wait-Until ($warmupStart+$step);Capture 'warmup'}
  Capture 'baseline';$baseline=$watch.Elapsed.TotalSeconds
  for($step=1;$step -le $SampleSeconds;$step++){Wait-Until ($baseline+$step);Capture 'sample'}
  $complete=$true
} finally {
  Emit @{kind='footer';complete=$complete;elapsedSeconds=$watch.Elapsed.TotalSeconds}
  foreach($record in $records.Values){$record.counter.Dispose()};$writer.Dispose();$stream.Dispose()
}
