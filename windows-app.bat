@echo off
rem 바탕화면과 시작 메뉴에 지원일지 바로가기(아이콘)를 만든다. 한 번만 실행하면 된다.
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0assets\make-shortcut.ps1"
pause
