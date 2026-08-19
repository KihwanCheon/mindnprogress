#!/usr/bin/env node

// Codex 전용 stdio 진입점입니다.
// 공용 MCP 구현을 그대로 사용하되 Codex가 별도 프로세스로 실행하므로
// AionUi 또는 Claude의 MCP 세션과 동시에 연결할 수 있습니다.
await import('./server.mjs')
