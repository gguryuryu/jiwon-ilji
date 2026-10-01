# 바탕화면과 시작 메뉴에 '지원일지' 바로가기를 만든다(아이콘 포함). windows-app.bat이 실행한다.
# 옛 WScript.Shell 바로가기 기능은 한글(파일 이름, 한글 사용자 폴더 경로)을 '??'로 깨뜨리므로,
# 윈도우의 유니코드 바로가기 기능(IShellLinkW)을 직접 호출한다.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

namespace JiwonIlji {
  [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
  class ShellLink {}

  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
  interface IShellLinkW {
    void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszFile, int cch, IntPtr pfd, int fFlags);
    void GetIDList(out IntPtr ppidl);
    void SetIDList(IntPtr pidl);
    void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszName, int cch);
    void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string pszName);
    void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszDir, int cch);
    void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string pszDir);
    void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszArgs, int cch);
    void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string pszArgs);
    void GetHotkey(out short pwHotkey);
    void SetHotkey(short wHotkey);
    void GetShowCmd(out int piShowCmd);
    void SetShowCmd(int iShowCmd);
    void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszIconPath, int cch, out int piIcon);
    void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string pszIconPath, int iIcon);
    void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string pszPathRel, int dwReserved);
    void Resolve(IntPtr hwnd, int fFlags);
    void SetPath([MarshalAs(UnmanagedType.LPWStr)] string pszFile);
  }

  public static class Shortcut {
    public static void Save(string path, string target, string arguments, string directory, string icon, string description) {
      IShellLinkW link = (IShellLinkW)new ShellLink();
      link.SetPath(target);
      link.SetArguments(arguments);
      link.SetWorkingDirectory(directory);
      link.SetIconLocation(icon, 0);
      link.SetDescription(description);
      ((IPersistFile)link).Save(path, false);
    }

    public static string Arguments(string path) {
      IShellLinkW link = (IShellLinkW)new ShellLink();
      ((IPersistFile)link).Load(path, 0);
      StringBuilder text = new StringBuilder(1024);
      link.GetArguments(text, text.Capacity);
      return text.ToString();
    }

    public static string Target(string path) {
      IShellLinkW link = (IShellLinkW)new ShellLink();
      ((IPersistFile)link).Load(path, 0);
      StringBuilder text = new StringBuilder(1024);
      link.GetPath(text, text.Capacity, IntPtr.Zero, 0);
      return text.ToString();
    }
  }
}
"@

$root = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $root 'assets\launch-windows.vbs'
# 지원일지 전용 창(windows\app\jiwon-ilji.exe)이 있으면 바로가기가 그것을 바로 연다.
# 바로가기와 창이 같은 프로그램이라 작업 표시줄에 고정해도 아이콘이 하나로 합쳐진다. 없으면 예전처럼 Edge 앱 창 실행기.
$app = Join-Path $root 'windows\app\jiwon-ilji.exe'
$made = @()
foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
  $path = Join-Path $folder '지원일지.lnk'
  if (Test-Path -LiteralPath $app) {
    # 아이콘은 프로그램 안의 것을 쓴다(예전 아이콘 파일 경로는 윈도우가 흰색 아이콘으로 기억하고 있을 수 있다).
    [JiwonIlji.Shortcut]::Save($path, $app, '', $root, $app, '지원일지')
    $saved = [JiwonIlji.Shortcut]::Target($path)
  } else {
    [JiwonIlji.Shortcut]::Save($path, (Join-Path $env:SystemRoot 'System32\wscript.exe'), ('"' + $launcher + '"'), $root, (Join-Path $root 'assets\icon-transparent.ico'), '지원일지')
    $saved = [JiwonIlji.Shortcut]::Arguments($path).Trim('"')
  }
  # 저장한 바로가기를 다시 읽어 경로가 깨지지 않았는지 확인한다.
  if (-not (Test-Path -LiteralPath $saved)) { throw "바로가기 경로를 확인하지 못했습니다: $saved" }
  $made += $path
}
Write-Host '바로가기를 만들었어요:'
$made | ForEach-Object { Write-Host "  $_" }
Write-Host ''
Write-Host '바탕화면의 지원일지 아이콘을 누르면 앱이 열리고, 창을 닫으면 꺼집니다.'
Write-Host '시작 메뉴에서 지원일지를 우클릭 → 작업 표시줄에 고정하면 더 편해요.'
Write-Host '이 폴더를 다른 곳으로 옮겼다면 windows-app.bat을 다시 실행해 주세요.'
# 윈도우가 기억해 둔 아이콘 그림을 새로 그리게 한다.
try { Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\ie4uinit.exe') -ArgumentList '-show' -WindowStyle Hidden -Wait } catch {}
