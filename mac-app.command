#!/bin/zsh
# 맥에서 쓸 '지원일지.app'을 만든다(아이콘 포함). 한 번만 실행하면 되고, 만든 앱은 Dock에 끌어다 두고 쓰면 된다.
# 앱을 누르면 서버를 켜고 브라우저를 열며, Dock에서 앱을 종료하면 서버도 함께 꺼진다.
# 이 폴더를 다른 곳으로 옮겼다면 다시 실행해 앱을 새로 만들어 주세요.
set -e
cd "$(dirname "$0")"
app_dir="$(pwd)"
app_name='지원일지.app'
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo '아이콘을 만드는 중…'
qlmanage -t -s 1024 -o "$work" assets/icon.svg >/dev/null 2>&1
mkdir "$work/icon.iconset"
for size in 16 32 128 256 512; do
  sips -z $size $size "$work/icon.svg.png" --out "$work/icon.iconset/icon_${size}x${size}.png" >/dev/null
  sips -z $((size * 2)) $((size * 2)) "$work/icon.svg.png" --out "$work/icon.iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$work/icon.iconset" -o "$work/icon.icns"

echo '앱을 만드는 중…'
# AppleScript 안에 이 폴더의 위치를 넣는다. 따옴표·역슬래시는 AppleScript 문자열 규칙에 맞게 바꾼다.
escaped_dir="${app_dir//\\/\\\\}"
escaped_dir="${escaped_dir//\"/\\\"}"
cat > "$work/app.applescript" <<APPLESCRIPT
property appDir : "$escaped_dir"
property appUrl : "http://127.0.0.1:4173"
property serverPID : ""

on run
	set serverPID to ""
	try
		do shell script "test -f " & quoted form of (appDir & "/server.mjs")
	on error
		display dialog "지원일지 폴더를 찾지 못했습니다. 폴더를 옮겼다면 폴더 안의 mac-app.command를 다시 실행해 앱을 새로 만들어 주세요." buttons {"확인"} default button 1 with icon stop
		quit
		return
	end try
	set nodePath to do shell script "for p in \"\$(/bin/zsh -lc 'command -v node' 2>/dev/null)\" /opt/homebrew/bin/node /usr/local/bin/node; do [ -x \"\$p\" ] && { echo \"\$p\"; exit 0; }; done; true"
	if nodePath is "" then
		display dialog "Node.js를 찾지 못했습니다. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 열어 주세요." buttons {"확인"} default button 1 with icon stop
		quit
		return
	end if
	-- 이미 켜져 있으면 server.mjs가 브라우저만 열고 바로 끝난다.
	set serverPID to do shell script "cd " & quoted form of appDir & "; " & quoted form of nodePath & " server.mjs --open >> \"\$HOME/Library/Logs/jiwon-ilji.log\" 2>&1 & echo \$!"
end run

-- Dock 아이콘을 다시 누르면 브라우저로 앱을 연다.
on reopen
	do shell script "open " & quoted form of appUrl
end reopen

-- 앱을 종료하면 이 앱이 켠 서버도 끈다.
on quit
	if serverPID is not "" then do shell script "kill " & serverPID & " >/dev/null 2>&1 || true"
	continue quit
end quit
APPLESCRIPT

rm -rf "$app_name"
osacompile -s -o "$app_name" "$work/app.applescript"
cp "$work/icon.icns" "$app_name/Contents/Resources/applet.icns"
plutil -replace CFBundleIdentifier -string 'local.jiwon-ilji' "$app_name/Contents/Info.plist"
# 아이콘을 바꾸면 서명이 깨지므로 이 컴퓨터용 서명을 다시 한다.
codesign --force --deep --sign - "$app_name" 2>/dev/null
touch "$app_name"

echo "완료: $app_dir/$app_name"
echo 'Finder에서 이 앱을 Dock에 끌어다 두면 아이콘을 눌러 바로 열 수 있어요.'
if [[ -z "$NO_REVEAL" ]]; then open -R "$app_name"; fi
