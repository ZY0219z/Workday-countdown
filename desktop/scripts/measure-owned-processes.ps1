param(
  [Parameter(Mandatory=$true)][ValidateRange(1,2147483647)][int]$RootProcessId,
  [Parameter(Mandatory=$true)][ValidateRange(1,2147483647)][int]$ElectronProcessId,
  [Parameter(Mandatory=$true)][string]$OutputFile,
  [string]$MetricsFile='',
  [ValidateRange(0,30)][int]$WarmupSeconds=30,
  [ValidateRange(1,120)][int]$SampleSeconds=120,
  [ValidateSet('background','main','mini','tray')][string]$Mode='background'
)
# Read-only, owned-process observation. Never launches/kills a user application.
# GetProcessTimes: https://learn.microsoft.com/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes
$ErrorActionPreference='Stop'
$desktopRoot=Split-Path -Parent $PSScriptRoot
$evidenceRoot=[IO.Path]::GetFullPath((Join-Path $desktopRoot 'test-results'))+[IO.Path]::DirectorySeparatorChar
$target=[IO.Path]::GetFullPath($OutputFile)
if (!$target.StartsWith($evidenceRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'Evidence must stay in desktop/test-results.' }
$metricReader=$null;$metricBuffer='';$metricHints=@{}
if($MetricsFile){
  $metricTarget=[IO.Path]::GetFullPath($MetricsFile)
  if(!$metricTarget.StartsWith($evidenceRoot,[StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath $metricTarget -PathType Leaf)){throw 'Metric hints must be an existing test-results file.'}
  $metricStream=[IO.File]::Open($metricTarget,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
  $metricReader=New-Object IO.StreamReader($metricStream,(New-Object Text.UTF8Encoding($false)))
}
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
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h,uint flags,System.Text.StringBuilder name,ref int size);
  IntPtr handle; public long Creation; public double Cpu; public bool Exited; public uint ExitCode; public string Path;
  public OwnedCounter(int id){handle=OpenProcess(0x101000,false,id);if(handle==IntPtr.Zero)throw new Win32Exception();try{Read();var name=new System.Text.StringBuilder(32768);int size=name.Capacity;if(!QueryFullProcessImageName(handle,0,name,ref size))throw new Win32Exception();Path=name.ToString();}catch{Dispose();throw;}}
  public bool Matches(DateTime cim,string path){return cim.Kind!=DateTimeKind.Unspecified&&cim.ToUniversalTime().ToFileTimeUtc()%10==0&&Creation/10==cim.ToUniversalTime().ToFileTimeUtc()/10&&String.Equals(Path,path,StringComparison.OrdinalIgnoreCase);}
  public static bool MatchesMetricCreation(long creation,double epoch){long delta=creation-116444736000000000L;double native=delta/10000+(delta%10000)/10000.0;return !Double.IsNaN(epoch)&&!Double.IsInfinity(epoch)&&Math.Abs(native-epoch)<=0.001;}
  public bool MatchesMetric(double epoch){return MatchesMetricCreation(Creation,epoch);}
  public void Read(){FT c,e,k,u;if(!GetProcessTimes(handle,out c,out e,out k,out u))throw new Win32Exception();Creation=c.Ticks;Cpu=(k.Ticks+u.Ticks)/10000000.0;Exited=WaitForSingleObject(handle,0)==0;if(Exited&&!GetExitCodeProcess(handle,out ExitCode))throw new Win32Exception();}
  public void Dispose(){if(handle!=IntPtr.Zero){CloseHandle(handle);handle=IntPtr.Zero;}}
}
'@
$stream=[IO.File]::Open($target,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
$writer=New-Object IO.StreamWriter($stream,(New-Object Text.UTF8Encoding($false)));$writer.AutoFlush=$true
$records=@{};$watch=[Diagnostics.Stopwatch]::StartNew();$complete=$false
function Emit($record){$writer.WriteLine(($record|ConvertTo-Json -Depth 9 -Compress))}
function Read-MetricHints {
  if(!$metricReader){return}
  $script:metricBuffer+=$metricReader.ReadToEnd()
  while(($end=$script:metricBuffer.IndexOf("`n")) -ge 0){
    $line=$script:metricBuffer.Substring(0,$end);$script:metricBuffer=$script:metricBuffer.Substring($end+1)
    if(!$line.Trim()){continue}
    $point=$line|ConvertFrom-Json
    if(!($point.at -is [ValueType]) -or !$point.metrics.Count){throw 'Invalid or empty Electron metric observation.'}
    foreach($metric in $point.metrics){
      if(!($metric.pid -is [ValueType]) -or $metric.pid -le 0 -or [Math]::Truncate($metric.pid) -ne $metric.pid -or !($metric.creationTime -is [ValueType])){throw 'Metric PID/creation identity missing.'}
      $script:metricHints["$($metric.pid)/$($metric.creationTime)"]=@{pid=[int]$metric.pid;created=[double]$metric.creationTime;type=$metric.type;at=$point.at}
    }
    Emit @{kind='metric-observation';at=$point.at;metrics=$point.metrics}
  }
}
function Identity-Diagnostic($row,$counter,$phaseName,$queryStartedAt,$queryCompletedAt) {
  # Preserve the two original identities on rejection. Do not infer a reason
  # from a generic mismatch or relax the existing precision/path comparison.
  $date=$row.CreationDate
  $cimDate=if($date -is [DateTime]){@{raw=$date.ToString('o');kind=$date.Kind.ToString();utc=$date.ToUniversalTime().ToString('o');fileTime=$date.ToUniversalTime().ToFileTimeUtc().ToString()}}else{@{raw=[string]$date;kind='unknown';utc=$null;fileTime=$null}}
  return @{kind='identity-check';at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();phase=$phaseName;queryStartedAt=$queryStartedAt;queryCompletedAt=$queryCompletedAt;
    pid=[int]$row.ProcessId;parentPid=[int]$row.ParentProcessId;
    cim=@{pid=[int]$row.ProcessId;parentPid=[int]$row.ParentProcessId;path=$row.ExecutablePath;creation=$cimDate};
    native=@{createdFileTime=$counter.Creation.ToString();path=$counter.Path;cpuSeconds=$counter.Cpu;exited=$counter.Exited;exitCode=if($counter.Exited){$counter.ExitCode}else{$null}}}
}
function Discover-Owned($events,$errors) {
  Read-MetricHints
  # Target known parents/identities rather than enumerating all desktop apps.
  # Hints are discovery only: CIM ancestry + native creation/path still decide ownership.
  $ids=@($RootProcessId,$ElectronProcessId)+@($records.Values|Where-Object {!$_.exited}|ForEach-Object {$_.pid})
  $filters=@($ids|Select-Object -Unique|ForEach-Object {"ProcessId=$_ OR ParentProcessId=$_"})+@($metricHints.Values|ForEach-Object {"ProcessId=$($_.pid)"})
  $queryStartedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $processes=@(Get-CimInstance Win32_Process -Filter ($filters -join ' OR ') -Property ProcessId,ParentProcessId,CreationDate,Name,ExecutablePath)
  $queryCompletedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $byId=@{};foreach($processRow in $processes){$byId[[int]$processRow.ProcessId]=$processRow}
  if($byId.ContainsKey($RootProcessId) -and $byId[$RootProcessId].CreationDate.ToUniversalTime() -ne $rootBirthUtc){throw 'Root PID was recycled; observation stopped.'}
  do {
    $added=$false
    foreach($processRow in $processes){
      $processId=[int]$processRow.ProcessId;$parentId=[int]$processRow.ParentProcessId
      $existing=@($records.Values|Where-Object {$_.pid -eq $processId -and !$_.exited})
      if($existing.Count){if(!$existing[0].counter.Matches($processRow.CreationDate,$processRow.ExecutablePath)){Emit (Identity-Diagnostic $processRow $existing[0].counter 'existing' $queryStartedAt $queryCompletedAt);$errors.Add("native/CIM identity changed $processId")};continue}
      $parents=@($records.Values|Where-Object {$_.pid -eq $parentId -and $_.createdUtc -le $processRow.CreationDate.ToUniversalTime() -and (!$_.exited -or $processRow.CreationDate.ToUniversalTime() -le $_.exitedUtc)})
      if($processId -ne $RootProcessId -and !$parents.Count){continue}
      if($processId -ne $RootProcessId -and $byId.ContainsKey($parentId) -and !@($parents|Where-Object {$_.counter.Matches($byId[$parentId].CreationDate,$byId[$parentId].ExecutablePath)}).Count){continue}
      $counter=$null
      try {
        $counter=New-Object OwnedCounter($processId);$key="$processId/$($counter.Creation)"
        if(!$counter.Matches($processRow.CreationDate,$processRow.ExecutablePath)){Emit (Identity-Diagnostic $processRow $counter 'new' $queryStartedAt $queryCompletedAt);throw 'native/CIM identity mismatch'}
        if($records.ContainsKey($key)){$counter.Dispose();continue}
        $records[$key]=@{key=$key;pid=$processId;parentPid=$parentId;name=$processRow.Name;imagePath=$counter.Path;createdFileTime=[string]$counter.Creation;createdUtc=[DateTime]::FromFileTimeUtc($counter.Creation);counter=$counter;cpuSeconds=$counter.Cpu;exited=$counter.Exited;exitedUtc=$null}
        $events.Add(@{event='enter';key=$key;pid=$processId});$added=$true
      }catch{if($counter){$counter.Dispose()};$errors.Add("cannot capture owned PID ${processId}: $($_.Exception.Message)")}
    }
  }while($added)
}
function Capture($phase){
  $began=$watch.Elapsed.TotalSeconds;$events=New-Object Collections.Generic.List[object];$errors=New-Object Collections.Generic.List[string]
  Discover-Owned $events $errors
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
    if($alive.Count){$filter=($alive|ForEach-Object {"IDProcess=$($_.pid)"}) -join ' OR ';foreach($memoryRow in @(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter $filter -Property IDProcess,WorkingSetPrivate)){if($null -eq $memoryRow.WorkingSetPrivate){continue};$pwsValue=[double]$memoryRow.WorkingSetPrivate;if([double]::IsNaN($pwsValue) -or [double]::IsInfinity($pwsValue) -or $pwsValue -lt 0){continue};foreach($identity in @($alive|Where-Object {$_.pid -eq [int]$memoryRow.IDProcess})){$memory[$identity.key]=$pwsValue}}}
    # Reconcile births while the performance provider was busy, before declaring
    # this frame complete. A newly captured live process needs its own PWS read.
    Discover-Owned $events $errors
    $alive=@($records.Values|Where-Object {!$_.exited})
    $missing=@($alive|Where-Object {!$memory.ContainsKey($_.key)})
    if(!$missing.Count -or $pwsRetries -ge 3){break}
    $pwsRetries++;Start-Sleep -Milliseconds 100
  } while($true)
  # Final timing read also accounts for CPU spent while the provider was read.
  foreach($record in @($records.Values)){
    if($record.exited){continue}
    try {$record.counter.Read();$record.cpuSeconds=$record.counter.Cpu;if($record.counter.Exited){$record.exited=$true;$record.exitedUtc=[DateTime]::UtcNow;$events.Add(@{event='exit';key=$record.key;pid=$record.pid});$record.counter.Dispose()}}
    catch {$record.cpuSeconds=$null;$errors.Add("cannot read final CPU $($record.key)")}
  }
  foreach($hint in $metricHints.Values){if(!@($records.Values|Where-Object {$_.pid -eq $hint.pid -and $_.counter.MatchesMetric($hint.created)}).Count){$errors.Add("unresolved Electron metric identity $($hint.pid)/$($hint.created)")}}
  foreach($record in $records.Values){if(!$record.exited -and !$memory.ContainsKey($record.key)){$errors.Add("missing live PWS $($record.key)")}}
  $rows=@(foreach($record in $records.Values){@{key=$record.key;pid=$record.pid;parentPid=$record.parentPid;name=$record.name;imagePath=$record.imagePath;createdFileTime=$record.createdFileTime;createdUtc=$record.createdUtc.ToString('o');cpuSeconds=$record.cpuSeconds;exited=$record.exited;exitCode=if($record.exited){$record.counter.ExitCode}else{$null};pwsBytes=if($record.exited){$null}elseif($memory.ContainsKey($record.key)){$memory[$record.key]}else{$null}}})
  Emit @{kind='frame';phase=$phase;utc=[DateTime]::UtcNow.ToString('o');elapsedSeconds=$watch.Elapsed.TotalSeconds;collectionSeconds=$watch.Elapsed.TotalSeconds-$began;pwsRetries=$pwsRetries;processes=$rows;events=@($events.ToArray());errors=@($errors.ToArray())}
  if(!@($records.Values|Where-Object {$_.pid -eq $RootProcessId -and !$_.exited}).Count){throw 'Owned Electron root exited before sampling completed.'}
}
function Wait-Until([double]$seconds){while($watch.Elapsed.TotalSeconds -lt $seconds){Start-Sleep -Milliseconds ([Math]::Max(1,[Math]::Min(1000,($seconds-$watch.Elapsed.TotalSeconds)*1000)))}}
try {
  $os=Get-CimInstance Win32_OperatingSystem;$cpu=Get-CimInstance Win32_Processor;$machine=Get-CimInstance Win32_ComputerSystem
  $power=(& powercfg.exe /getactivescheme | Out-String).Trim();$batteries=@(Get-CimInstance Win32_Battery|Select-Object BatteryStatus,EstimatedChargeRemaining)
  $scope=if($Mode -eq 'background'){'owned launch wrapper + real native-hidden Main + two Renderers + GPU/utility; memory tray; NOT visible-window or real tray-only G05'}else{"owned native GUI $Mode mode + launch wrapper + hidden resident windows + GPU/utility; real native tray; no Portable launcher"}
  Emit @{kind='header';schemaVersion=1;scope=$scope;logicalCores=[Environment]::ProcessorCount;warmupSeconds=$WarmupSeconds;sampleSeconds=$SampleSeconds;rootPid=$RootProcessId;electronPid=$ElectronProcessId;metricFeedEnabled=!!$metricReader;launcher='owned Playwright wrapper included; no Portable launcher was run';completeness='bounded pre/post CIM snapshots + optional live Electron identity hints + retained native CPU/exit handles; known misses fail; unobserved sub-poll children cannot be excluded';environment=@{os=$os.Caption;build=$os.Version;arch=$os.OSArchitecture;cpu=@($cpu|Select-Object Name,NumberOfLogicalProcessors);ramBytes=[double]$machine.TotalPhysicalMemory;powerScheme=$power;batteries=$batteries}}
  Capture 'warmup'
  $warmupStart=$watch.Elapsed.TotalSeconds
  for($step=1;$step -le $WarmupSeconds;$step++){Wait-Until ($warmupStart+$step);Capture 'warmup'}
  Capture 'baseline';$baseline=$watch.Elapsed.TotalSeconds
  for($step=1;$step -le $SampleSeconds;$step++){Wait-Until ($baseline+$step);Capture 'sample'}
  if($script:metricBuffer.Trim()){throw 'Incomplete JSON line in Electron metric feed.'}
  $complete=$true
} finally {
  if($metricReader){$metricReader.Dispose()}
  Emit @{kind='footer';complete=$complete;elapsedSeconds=$watch.Elapsed.TotalSeconds}
  foreach($record in $records.Values){$record.counter.Dispose()};$writer.Dispose();$stream.Dispose()
}
