# Test-only, read-only observer. Never creates or activates a window.
# Native foreground collection is explicit and bounded to 15 seconds.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
public static class D08FocusObserver {
  delegate void WinEvent(IntPtr hook,uint ev,IntPtr hwnd,int obj,int child,uint thread,uint tick);
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int x,y; }
  [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd;public uint message;public UIntPtr wParam;public IntPtr lParam;public uint time;public POINT pt;public uint reserved; }
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr w,out uint p);
  [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min,uint max,IntPtr dll,WinEvent cb,uint pid,uint thread,uint flags);
  [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
  [DllImport("user32.dll")] static extern bool PeekMessage(out MSG msg,IntPtr hwnd,uint min,uint max,uint remove);
  [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG msg);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG msg);
  [DllImport("kernel32.dll")] static extern ulong GetTickCount64();
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
  [DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr handle,out long created,out long exited,out long kernel,out long user);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr handle,out uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  public class Sample { public string kind,hwnd,name,currentHwnd;public int pid,currentPid;public long observedAt,eventAt;public uint nativeTick; }
  public class ProcessRecord { public int pid;public string name;public long createdAt;public long? exitedAt;public uint? exitCode; }
  class OwnedProcess { public IntPtr handle;public ProcessRecord record; }
  static object sync=new object();static List<Sample> samples=new List<Sample>();static Dictionary<int,OwnedProcess> processes=new Dictionary<int,OwnedProcess>();
  static Thread worker;static volatile bool stopping,running,timedOut;static bool dropped;static string failure;static WinEvent callback;
  static long Now(){return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();}
  static string Name(int pid){try{using(var p=Process.GetProcessById(pid))return p.ProcessName;}catch{return "unavailable";}}
  static string Hex(IntPtr w){return "0x"+w.ToInt64().ToString("x");}
  static int Pid(IntPtr w){uint p;GetWindowThreadProcessId(w,out p);return (int)p;}
  static void Add(string kind,IntPtr hwnd,uint tick){
    // Pair wall-clock and uptime BEFORE process-name lookup; lookup may be slow.
    var at=Now();var uptime=GetTickCount64();var current=GetForegroundWindow();var pid=Pid(hwnd);
    var item=new Sample{kind=kind,hwnd=Hex(hwnd),pid=pid,name=Name(pid),currentHwnd=Hex(current),currentPid=Pid(current),observedAt=at,nativeTick=tick,
      eventAt=tick==0?at:at-(long)unchecked((uint)uptime-tick)};
    lock(sync){if(samples.Count<512)samples.Add(item);else dropped=true;}
  }
  public static void Start(){
    if(worker!=null)throw new InvalidOperationException("One diagnostic window only");
    worker=new Thread(()=>{
      IntPtr hook=IntPtr.Zero;
      try{
        callback=(h,e,w,o,c,t,tick)=>Add("foreground-event",w,tick);
        hook=SetWinEventHook(3,3,IntPtr.Zero,callback,0,0,0); // EVENT_SYSTEM_FOREGROUND, OUTOFCONTEXT
        if(hook==IntPtr.Zero)throw new InvalidOperationException("Foreground hook unavailable");
        running=true;var clock=Stopwatch.StartNew();var previous=GetForegroundWindow();Add("initial",previous,0);
        while(!stopping&&clock.ElapsedMilliseconds<15000){
          MSG msg;while(PeekMessage(out msg,IntPtr.Zero,0,0,1)){TranslateMessage(ref msg);DispatchMessage(ref msg);}
          var current=GetForegroundWindow();if(current!=previous){Add("foreground-sample",current,0);previous=current;}
          Thread.Sleep(10);
        }
        timedOut=!stopping;
      }catch(Exception e){failure=e.Message;}finally{if(hook!=IntPtr.Zero)UnhookWinEvent(hook);running=false;}
    });worker.IsBackground=true;worker.Start();
    for(int i=0;i<200&&!running&&failure==null;i++)Thread.Sleep(5);
    if(!running)throw new InvalidOperationException(failure??"Observer initialization timeout");
  }
  public static object Foreground(){var w=GetForegroundWindow();int pid=Pid(w);return new{hwnd=Hex(w),pid=pid,name=Name(pid),at=Now()};}
  public static ProcessRecord Track(int pid){
    lock(sync){
      if(processes.ContainsKey(pid))return processes[pid].record;
      var h=OpenProcess(0x1000,false,pid); // QUERY_LIMITED_INFORMATION; no termination/control rights
      if(h==IntPtr.Zero)throw new InvalidOperationException("Cannot open diagnostic process "+pid);
      long created,exited,kernel,user;
      if(!GetProcessTimes(h,out created,out exited,out kernel,out user)){CloseHandle(h);throw new InvalidOperationException("Cannot read process times");}
      var record=new ProcessRecord{pid=pid,name=Name(pid),createdAt=new DateTimeOffset(DateTime.FromFileTimeUtc(created)).ToUnixTimeMilliseconds()};
      processes.Add(pid,new OwnedProcess{handle=h,record=record});return record;
    }
  }
  public static object Read(){
    lock(sync){
      foreach(var owned in processes.Values){uint code;long c,e,k,u;if(GetExitCodeProcess(owned.handle,out code)&&code!=259&&GetProcessTimes(owned.handle,out c,out e,out k,out u)&&e>0){owned.record.exitedAt=new DateTimeOffset(DateTime.FromFileTimeUtc(e)).ToUnixTimeMilliseconds();owned.record.exitCode=code;}}
      var records=new List<ProcessRecord>();foreach(var owned in processes.Values)records.Add(owned.record);
      return new{running=running,timedOut=timedOut,dropped=dropped,failure=failure,events=samples.ToArray(),processes=records.ToArray()};
    }
  }
  public static void Stop(){stopping=true;if(worker!=null&&!worker.Join(2000))throw new InvalidOperationException("Observer did not stop");}
  public static void Dispose(){Stop();lock(sync){foreach(var owned in processes.Values)CloseHandle(owned.handle);processes.Clear();}}
}
'@
try {
  while ($null -ne ($line = [Console]::ReadLine())) {
    try {
      $value = switch -Regex ($line) {
        '^snapshot$' {
          $front = [D08FocusObserver]::Foreground()
          ,@(Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{pid=[int]$_.ProcessId;parent=[int]$_.ParentProcessId;created=[string]$_.CreationDate;name=$_.Name;foreground=([int]$_.ProcessId -eq $front.pid)} })
          break
        }
        '^start$' { [D08FocusObserver]::Start(); [D08FocusObserver]::Read(); break }
        '^track:([0-9]+)$' { [D08FocusObserver]::Track([int]$Matches[1]); break }
        '^diagnostic$' { [D08FocusObserver]::Read(); break }
        '^stop$' { [D08FocusObserver]::Stop(); [D08FocusObserver]::Read(); break }
        default { throw 'Unknown observer command' }
      }
      [Console]::Out.WriteLine((ConvertTo-Json -InputObject $value -Depth 8 -Compress))
    } catch { [Console]::Out.WriteLine((ConvertTo-Json -InputObject @{error=$_.Exception.Message} -Compress)) }
  }
} finally { [D08FocusObserver]::Dispose() }
