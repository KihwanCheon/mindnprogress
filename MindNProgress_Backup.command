#!/bin/zsh

set -u

PROJECT_DIR="${0:A:h}"
cd "$PROJECT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "[MindNProgress] Node.js 20.19 이상을 먼저 설치해 주세요: https://nodejs.org/"
  read "?Enter 키를 누르면 종료합니다."
  exit 1
fi

node scripts/backup-data.mjs "$@"
EXIT_CODE=$?

if [[ "${MNP_BACKUP_NO_PAUSE:-0}" != "1" ]]; then
  echo
  read "?Enter 키를 누르면 종료합니다."
fi
exit $EXIT_CODE
