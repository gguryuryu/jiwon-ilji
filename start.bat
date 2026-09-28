@echo off
rem 지원일지 실행(윈도우): 서버를 켜고 브라우저로 연다. 이 창을 닫으면 앱이 꺼진다.
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js를 찾지 못했습니다. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행해 주세요.
  pause
  exit /b 1
)
title 지원일지
node server.mjs --open
if errorlevel 1 pause
