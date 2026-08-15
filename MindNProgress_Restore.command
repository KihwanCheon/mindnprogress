#!/bin/zsh

set -u

if [[ $# -eq 0 ]]; then
  echo "사용법: MindNProgress_Restore.command 백업파일.zip"
  echo "Finder에서 ZIP 파일을 이 command 파일 위로 드래그해도 됩니다."
  read "?Enter 키를 누르면 종료합니다."
  exit 1
fi

PROJECT_DIR="${0:A:h}"
cd "$PROJECT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "[MindNProgress] Node.js 20.19 이상을 먼저 설치해 주세요: https://nodejs.org/"
  read "?Enter 키를 누르면 종료합니다."
  exit 1
fi

node scripts/restore-data.mjs --archive "$1"
EXIT_CODE=$?

if [[ "${MNP_BACKUP_NO_PAUSE:-0}" != "1" ]]; then
  echo
  read "?Enter 키를 누르면 종료합니다."
fi
exit $EXIT_CODE
