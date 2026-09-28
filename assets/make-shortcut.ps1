# 바탕화면과 시작 메뉴에 '지원일지' 바로가기를 만든다(아이콘 포함). windows-app.bat이 실행한다.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$shell = New-Object -ComObject WScript.Shell
$made = @()
foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
  $path = Join-Path $folder '지원일지.lnk'
  $link = $shell.CreateShortcut($path)
  $link.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
  $link.Arguments = '"' + (Join-Path $root 'assets\launch-windows.vbs') + '"'
  $link.WorkingDirectory = $root
  $link.IconLocation = (Join-Path $root 'assets\icon.ico') + ',0'
  $link.Description = '지원일지'
  $link.Save()
  $made += $path
}
Write-Host '바로가기를 만들었어요:'
$made | ForEach-Object { Write-Host "  $_" }
Write-Host ''
Write-Host '바탕화면의 지원일지 아이콘을 누르면 앱이 열리고, 창을 닫으면 꺼집니다.'
Write-Host '시작 메뉴에서 지원일지를 우클릭 → 작업 표시줄에 고정하면 더 편해요.'
Write-Host '이 폴더를 다른 곳으로 옮겼다면 windows-app.bat을 다시 실행해 주세요.'
