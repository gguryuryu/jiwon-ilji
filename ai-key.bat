@echo off
rem OpenAI API 키 저장(윈도우, 선택 사항). 키는 data\settings.json에만 저장된다.
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js를 찾지 못했습니다. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행해 주세요.
  pause
  exit /b 1
)
node ai-key.mjs
