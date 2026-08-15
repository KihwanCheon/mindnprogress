#!/bin/zsh

set -e

PROJECT_DIR="${0:A:h}"
cd "$PROJECT_DIR"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "[MindNProgress] Node.js 20.19 이상을 먼저 설치해 주세요: https://nodejs.org/"
  read "?Enter 키를 누르면 종료합니다."
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "[MindNProgress] 처음 실행에 필요한 패키지를 설치합니다."
  npm install
fi

echo "[MindNProgress] macOS용 웹 앱을 빌드합니다."
npm run build

(
  for attempt in {1..60}; do
    if curl --silent --fail --max-time 1 http://127.0.0.1:4176/api/health >/dev/null 2>&1; then
      open http://127.0.0.1:4176/
      exit 0
    fi
    sleep 0.5
  done
) &

echo "[MindNProgress] 종료하려면 이 창에서 Ctrl+C를 누르세요."
npm start
