param([Parameter(Mandatory=$true)][int]$OwnerProcessId,[int]$LauncherProcessId=0)
# Short-lived test RPC. Own Electron windows/dialogs only; the sole shell action
# is opening notification overflow and clicking this app's unique tray icon.
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
Add-Type -TypeDefinition @'
using System;using System.Diagnostics;using System.Runtime.InteropServices;using System.ComponentModel;
// Retain the actual Main handle before cleanup, so an already-dead process or
// PID reuse cannot hide a native crash behind the cmd.exe launcher's exit code.
public sealed class D15OwnerExit:IDisposable {
 [StructLayout(LayoutKind.Sequential)]struct FT{public uint Low,High;public long Ticks{get{return ((long)High<<32)|Low;}}}
 [DllImport("kernel32.dll",SetLastError=true)]static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
 [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr handle);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool GetProcessTimes(IntPtr handle,out FT c,out FT e,out FT k,out FT u);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool GetExitCodeProcess(IntPtr handle,out uint code);
 [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)]static extern bool QueryFullProcessImageName(IntPtr handle,uint flags,System.Text.StringBuilder name,ref int size);
 [DllImport("kernel32.dll")]static extern uint WaitForSingleObject(IntPtr handle,uint timeout);
 IntPtr handle;readonly int pid;readonly long creation;readonly string path;
 public D15OwnerExit(int owner){pid=owner;handle=OpenProcess(0x101000,false,owner);if(handle==IntPtr.Zero)throw new Win32Exception();try{FT c,e,k,u;if(!GetProcessTimes(handle,out c,out e,out k,out u))throw new Win32Exception();creation=c.Ticks;var name=new System.Text.StringBuilder(32768);int size=name.Capacity;if(!QueryFullProcessImageName(handle,0,name,ref size))throw new Win32Exception();path=name.ToString();}catch{Dispose();throw;}}
 // CIM_DATETIME has six fractional digits, FILETIME has seven. Compare the
 // exact microsecond representation, not an arbitrary tolerance/JS Number.
 public static bool MatchesCimCreation(string nativeTicks,DateTime cim){long ticks;if(!long.TryParse(nativeTicks,System.Globalization.NumberStyles.None,System.Globalization.CultureInfo.InvariantCulture,out ticks)||ticks<=0||cim.Kind==DateTimeKind.Unspecified)return false;long c=cim.ToUniversalTime().ToFileTimeUtc();return c%10==0&&ticks/10==c/10;}
 public object Read(){uint state=WaitForSingleObject(handle,0);if(state!=0&&state!=258)throw new Win32Exception();uint code=0;if(state==0&&!GetExitCodeProcess(handle,out code))throw new Win32Exception();return new{pid=pid,path=path,handle="0x"+handle.ToInt64().ToString("x"),createdFileTime=creation.ToString(),exited=state==0,exitCode=state==0?(uint?)code:null};}
 public void Dispose(){if(handle!=IntPtr.Zero){CloseHandle(handle);handle=IntPtr.Zero;}}
}
public static class D15Native {
 [StructLayout(LayoutKind.Sequential)]public struct Rect{public int Left,Top,Right,Bottom;}
 [DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr w,out uint p);
 [DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr w,out Rect r);
 [DllImport("user32.dll")]static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")]static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra);
 public static int Pid(IntPtr w){uint p;GetWindowThreadProcessId(w,out p);return (int)p;}
 public static object Foreground(){var w=GetForegroundWindow();int p=Pid(w);string n=null;try{n=Process.GetProcessById(p).ProcessName;}catch{}return new{hwnd="0x"+w.ToInt64().ToString("x"),pid=p,name=n,at=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()};}
 public static void Click(int x,int y,bool right){SetCursorPos(x,y);mouse_event(right?8u:2u,0,0,0,UIntPtr.Zero);mouse_event(right?16u:4u,0,0,0,UIntPtr.Zero);}
 public static object Drag(IntPtr w,int owner){if(Pid(w)!=owner||GetForegroundWindow()!=w)throw new Exception("Drag requires owned foreground HWND");Rect r;if(!GetWindowRect(w,out r))throw new Exception("No rectangle");int x=r.Left+25,y=r.Top+12;SetCursorPos(x,y);mouse_event(2,0,0,0,UIntPtr.Zero);try{for(int i=1;i<=8;i++){SetCursorPos(x-5*i,y+4*i);System.Threading.Thread.Sleep(20);}}finally{mouse_event(4,0,0,0,UIntPtr.Zero);}return new{x=x-40,y=y+32};}
}
'@
$owner=Get-CimInstance Win32_Process -Filter "ProcessId=$OwnerProcessId"
$expected=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../node_modules/electron/dist/electron.exe'))
if(!$owner -or $owner.ExecutablePath -ne $expected -or $owner.CommandLine -notmatch '--remote-debugging'){throw 'Owned test Main required'}
$birth=$owner.CreationDate
function ConfirmIdentity($handle,$row,$phase){
 $state=$handle.Read()
 $matches=$row -and $state.pid -eq $row.ProcessId -and !$state.exited -and [String]::Equals($state.path,$row.ExecutablePath,[StringComparison]::OrdinalIgnoreCase) -and [D15OwnerExit]::MatchesCimCreation($state.createdFileTime,$row.CreationDate)
 $cim=if($row){@{pid=$row.ProcessId;parentPid=$row.ParentProcessId;path=$row.ExecutablePath;raw=$row.CreationDate.ToString('o');kind=$row.CreationDate.Kind.ToString();utc=$row.CreationDate.ToUniversalTime().ToString('o');fileTime=$row.CreationDate.ToUniversalTime().ToFileTimeUtc().ToString()}}else{$null}
 [Console]::Error.WriteLine((@{event='identity-check';phase=$phase;at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();native=$state;cim=$cim;matches=[bool]$matches}|ConvertTo-Json -Depth 6 -Compress))
 if(!$matches){throw 'Owned native/CIM identity mismatch; raw comparison recorded'}
 # Keep the full native identity authoritative across enumeration races/reuse.
 $current=[D15OwnerExit]::new($state.pid)
 try{$fresh=$current.Read();if($fresh.exited -or $fresh.createdFileTime -cne $state.createdFileTime -or $fresh.path -cne $state.path){throw 'Native identity changed during CIM verification'}}finally{$current.Dispose()}
 $state
}
function OwnedElements($type){
 # Do not traverse unrelated application providers that may be disappearing.
 $windows=[Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children,[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty,$OwnerProcessId))
 foreach($window in $windows){$window.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty,$type))}
}
function InvokeOwned($name,$type){
 $found=@(OwnedElements $type | Where-Object {$_.Current.Name.Replace('&','') -eq $name -and !$_.Current.IsOffscreen})
 if($found.Count -ne 1){throw "Expected one owned visible control: $name (found $($found.Count))"}
 $pattern=$found[0].GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)
 $began=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
 [Console]::Error.WriteLine((@{event='invoke-start';name=$name;owner=$OwnerProcessId;at=$began}|ConvertTo-Json -Compress))
 try{$pattern.Invoke()}finally{[Console]::Error.WriteLine((@{event='invoke-return';name=$name;owner=$OwnerProcessId;at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()}|ConvertTo-Json -Compress))}
 @{clicked=$name;owner=$OwnerProcessId;invokeStartedAt=$began;invokeReturnedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()}
}
function DialogSnapshot {
 $windows=[Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children,[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty,$OwnerProcessId))
 @{at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();windows=@(foreach($window in $windows){
  $buttons=$window.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Button))
  @{name=$window.Current.Name;hwnd=$window.Current.NativeWindowHandle;buttons=@($buttons | Where-Object {!$_.Current.IsOffscreen} | ForEach-Object {$_.Current.Name.Replace('&','')})}
 })}
}
function TrayIcon {
 $roots=[Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children,[Windows.Automation.Condition]::TrueCondition)
 $buttons=@(foreach($root in $roots){if($root.Current.ClassName -match 'Shell_TrayWnd|NotifyIconOverflowWindow|TopLevelWindowForOverflowXamlIsland'){$root.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Button))}})
 $icons=@($buttons|Where-Object {$_.Current.Name -like 'Workday Escape*' -and !$_.Current.IsOffscreen})
 if($icons.Count -eq 0){
  # ASCII source also works with Windows PowerShell 5.1 -File's ANSI default.
  $overflow=@($buttons|Where-Object {$_.Current.Name -match '\u663e\u793a\u9690\u85cf\u7684\u56fe\u6807|Show hidden icons' -and !$_.Current.IsOffscreen})
  if($overflow.Count -ne 1){throw 'Own tray icon not exposed and notification overflow unavailable'}
  ($overflow[0].GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)).Invoke()
  Start-Sleep -Milliseconds 250
  $roots=[Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children,[Windows.Automation.Condition]::TrueCondition)
  $icons=@(foreach($root in $roots){if($root.Current.ClassName -match 'NotifyIconOverflowWindow|TopLevelWindowForOverflowXamlIsland'){$root.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Button))|Where-Object {$_.Current.Name -like 'Workday Escape*' -and !$_.Current.IsOffscreen}}})
 }
 if($icons.Count -ne 1){throw "Expected unique owned tray icon, found $($icons.Count)"}
 $icons[0]
}
$ownerExit=[D15OwnerExit]::new($OwnerProcessId)
$family=@{}
function TrackFamilyProcess($row){
 $pidValue=[int]$row.ProcessId
 if($family.ContainsKey($pidValue)){return}
 $handle=[D15OwnerExit]::new($pidValue)
 try{
  $state=ConfirmIdentity $handle $row 'family-capture'
  $family[$pidValue]=@{handle=$handle;birth=$row.CreationDate;parentPid=[int]$row.ParentProcessId;name=$row.Name;path=$row.ExecutablePath}
 }catch{$handle.Dispose();throw}
}
function FamilyState {
 $rows=@(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,CreationDate,ExecutablePath)
 do{
  $added=$false
  foreach($row in $rows){
   if($family.ContainsKey([int]$row.ProcessId) -or !$family.ContainsKey([int]$row.ParentProcessId)){continue}
   $parent=$family[[int]$row.ParentProcessId]
   if($row.CreationDate -lt $parent.birth){continue}
   $presentParent=@($rows | Where-Object {$_.ProcessId -eq $row.ParentProcessId})
   if($presentParent.Count -and $presentParent[0].CreationDate -ne $parent.birth){throw 'Owned parent PID reused; family capture cannot be trusted'}
   TrackFamilyProcess $row;$added=$true
  }
 }while($added)
 @{at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();processes=@(foreach($entry in $family.Values){@{state=$entry.handle.Read();parentPid=$entry.parentPid;name=$entry.name;path=$entry.path}})}
}
try{
 $identity=ConfirmIdentity $ownerExit $owner 'main-startup'
 TrackFamilyProcess $owner
 if($LauncherProcessId){
  $ancestor=$owner
  for($depth=0;$depth -lt 16 -and $ancestor.ProcessId -ne $LauncherProcessId;$depth++){$ancestor=Get-CimInstance Win32_Process -Filter "ProcessId=$($ancestor.ParentProcessId)";if(!$ancestor){break}}
  if(!$ancestor -or $ancestor.ProcessId -ne $LauncherProcessId -or $ancestor.CreationDate -gt $birth){throw 'Owned launch ancestry required'}
  TrackFamilyProcess $ancestor
 }
 [Console]::WriteLine((@{ready=$true;identity=$identity}|ConvertTo-Json -Compress))
 while($null -ne ($line=[Console]::ReadLine())){
  try{
   $request=$line|ConvertFrom-Json
   if($request.id -isnot [long] -and $request.id -isnot [int]){throw 'Integer RPC id required'}
   if($request.id -lt 1){throw 'Positive RPC id required'}
   if($request.action -notin @('ownerExit','family')){
    $current=Get-CimInstance Win32_Process -Filter "ProcessId=$OwnerProcessId"
    $null=ConfirmIdentity $ownerExit $current 'main-request'
   }
   $value=switch($request.action){
    ownerExit {$ownerExit.Read();break}
    family {FamilyState;break}
    dialogSnapshot {DialogSnapshot;break}
    foreground {[D15Native]::Foreground();break}
    drag {[D15Native]::Drag([IntPtr]([Convert]::ToInt64($request.hwnd,16)),$OwnerProcessId);break}
    dialog {InvokeOwned $request.name ([Windows.Automation.ControlType]::Button);break}
    menu {InvokeOwned $request.name ([Windows.Automation.ControlType]::MenuItem);break}
    tray {$icon=TrayIcon;$r=$icon.Current.BoundingRectangle;$at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();[D15Native]::Click([int]($r.X+$r.Width/2),[int]($r.Y+$r.Height/2),[bool]$request.right);@{clicked='owned tray';right=[bool]$request.right;at=$at};break}
    default {throw 'Unknown native test action'}
   }
   [Console]::WriteLine((@{id=$request.id;value=$value}|ConvertTo-Json -Depth 9 -Compress))
  }catch{[Console]::WriteLine((@{id=$request.id;error=$_.Exception.Message}|ConvertTo-Json -Compress))}
 }
}finally{foreach($entry in $family.Values){$entry.handle.Dispose()};$ownerExit.Dispose()}
