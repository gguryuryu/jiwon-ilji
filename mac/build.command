#!/bin/zsh
# 맥 네이티브 앱 '지원일지.app'을 새로 만든다(개발용). 앱은 저장소 맨 위에 만들어지고 git에 함께 올린다.
# 인텔·애플 실리콘 맥 모두에서 도는 앱(유니버설)으로 만든다. main.swift를 고쳤을 때만 다시 실행하면 된다.
set -e
cd "$(dirname "$0")"
root="$(cd .. && pwd)"
app="$root/지원일지.app"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo '앱을 컴파일하는 중(애플 실리콘 · 인텔)…'
for arch in arm64 x86_64; do
  swiftc -O -swift-version 5 -target "$arch-apple-macos13.0" -o "$work/jiwon-ilji-$arch" main.swift -framework AppKit -framework WebKit
done
lipo -create -output "$work/jiwon-ilji" "$work/jiwon-ilji-arm64" "$work/jiwon-ilji-x86_64"

echo '아이콘을 만드는 중(맥 · 윈도우)…'
# assets/icon.svg에서 맥 아이콘과 윈도우 바로가기 아이콘을 함께 만든다(둥근 판 바깥은 투명).
swift icons.swift "$root/assets/icon.svg" "$work/AppIcon.iconset" "$root/assets/icon-transparent.ico"
iconutil -c icns "$work/AppIcon.iconset" -o "$work/AppIcon.icns"

echo '앱을 묶는 중…'
osascript -e 'tell application id "local.jiwon-ilji" to quit' >/dev/null 2>&1 || true
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$work/jiwon-ilji" "$app/Contents/MacOS/jiwon-ilji"
cp "$work/AppIcon.icns" "$app/Contents/Resources/AppIcon.icns"
cp Info.plist "$app/Contents/Info.plist"
codesign --force --deep --sign - "$app"
echo "완료: $app"
