param([switch]$CaptureWords,[switch]$SelfTest)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
Add-Type -ReferencedAssemblies System.Windows.Forms,System.Web.Extensions -TypeDefinition @'
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
public static class DeltaInput {
 delegate IntPtr Hook(int code,IntPtr w,IntPtr l);
 static Hook callback=OnKey; static IntPtr handle;
 static bool capture; static HashSet<uint> held=new HashSet<uint>();
 static BlockingCollection<Dictionary<string,object>> queue=new BlockingCollection<Dictionary<string,object>>(4096);
 [StructLayout(LayoutKind.Sequential)] struct Keyboard {public uint vk,scan,flags,time;public IntPtr extra;}
 [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetWindowsHookEx(int id,Hook proc,IntPtr module,uint thread);
 [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
 [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h,int c,IntPtr w,IntPtr l);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr w,IntPtr pid);
 [DllImport("user32.dll")] static extern IntPtr GetKeyboardLayout(uint thread);
 [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
 [DllImport("user32.dll")] static extern short GetKeyState(int key);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int ToUnicodeEx(uint key,uint scan,byte[] state,StringBuilder buffer,int size,uint flags,IntPtr layout);
 [DllImport("imm32.dll")] static extern bool ImmIsIME(IntPtr layout);
 public static string Language(IntPtr layout) {try{return CultureInfo.GetCultureInfo((int)(layout.ToInt64()&65535)).Name;}catch{return "unknown";}}
 static IntPtr OnKey(int c,IntPtr w,IntPtr l) {
  if(c<0)return CallNextHookEx(handle,c,w,l);
  try {
   int msg=w.ToInt32();bool down=msg==0x100||msg==0x104,up=msg==0x101||msg==0x105;
   if(!down&&!up)return CallNextHookEx(handle,c,w,l);
   Keyboard k=(Keyboard)Marshal.PtrToStructure(l,typeof(Keyboard));bool repeat=down&&held.Contains(k.vk);if(down)held.Add(k.vk);else held.Remove(k.vk);
   IntPtr focus=GetForegroundWindow(),layout=GetKeyboardLayout(GetWindowThreadProcessId(focus,IntPtr.Zero));
   byte[] state=new byte[256];for(int i=0;i<256;i++)if(GetAsyncKeyState(i)<0)state[i]=128;
   state[k.vk]=(byte)(down?128:0);state[0x14]|=(byte)(GetKeyState(0x14)&1);state[0x90]|=(byte)(GetKeyState(0x90)&1);
   bool command=(state[0x11]>0&&state[0xA5]==0)||state[0x5B]>0||state[0x5C]>0||(state[0x12]>0&&state[0xA5]==0);
   bool ime=ImmIsIME(layout);string text="";bool navigation=k.vk>=0x21&&k.vk<=0x2E;
   if(capture&&down&&!command&&!ime){var b=new StringBuilder(64);int n=ToUnicodeEx(k.vk,k.scan,state,b,64,4,layout);if(n>0)text=b.ToString();if(n<0)navigation=true;}
   uint code=k.scan;bool extended=(k.flags&1)!=0;if(extended){if(code==83)code=111;else if(code==29)code=97;else if(code==56)code=100;else if(code==28)code=96;else if(code==91||code==92)code=125;}
   var e=new Dictionary<string,object>{{"type",1},{"code",code},{"value",down?(repeat?2:1):0},{"time",DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()},{"language",Language(layout)},{"text",text},{"focus",focus.ToInt64().ToString()},{"command",command},{"backspace",k.vk==8},{"navigation",navigation||ime},{"provider","windows"},{"decoderState","ready"}};
   if(!queue.TryAdd(e))Environment.Exit(3);
  }catch{}return CallNextHookEx(handle,c,w,l);
 }
 public static void Run(bool words) {
  if(Process.GetCurrentProcess().SessionId==0)throw new Exception("desktop_session_required");
  capture=words;var thread=new Thread(()=>{var json=new JavaScriptSerializer();foreach(var e in queue.GetConsumingEnumerable()){Console.WriteLine(json.Serialize(e));Console.Out.Flush();}});thread.IsBackground=true;thread.Start();
  using(var p=Process.GetCurrentProcess())using(var m=p.MainModule)handle=SetWindowsHookEx(13,callback,GetModuleHandle(m.ModuleName),0);
  if(handle==IntPtr.Zero)throw new Exception("keyboard_hook_unavailable");
  try{Application.Run();}finally{UnhookWindowsHookEx(handle);queue.CompleteAdding();}
 }
}
'@
if ($SelfTest) {
 if ([DeltaInput]::Language([IntPtr]0x407) -ne 'de-DE') { throw 'Arbitrary Windows layout lookup failed' }
 if ([DeltaInput]::Language([IntPtr]0x411) -ne 'ja-JP') { throw 'Japanese layout lookup failed' }
 Write-Output 'PASS Windows native helper compilation and arbitrary layout LCIDs'
 exit 0
}
try { [DeltaInput]::Run($CaptureWords.IsPresent) }
catch { Write-Output ('{"decoderState":"unavailable","decoderReason":"windows_desktop_or_hook_unavailable"}'); exit 1 }
