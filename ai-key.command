#!/bin/zsh
# OpenAI API 키 저장(macOS, 선택 사항)
cd "$(dirname "$0")"
app_node="$(command -v node)"
[[ -z "$app_node" && -x /opt/homebrew/bin/node ]] && app_node=/opt/homebrew/bin/node
[[ -z "$app_node" && -x /usr/local/bin/node ]] && app_node=/usr/local/bin/node
if [[ -z "$app_node" ]]; then
  echo 'Node.js를 찾지 못했습니다. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행해 주세요.'
  read -r '?Enter를 누르면 닫힙니다.'
  exit 1
fi
"$app_node" ai-key.mjs
