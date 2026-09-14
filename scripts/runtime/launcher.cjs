const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

module.exports = function launch(rootDirectory) {
  const projectDirectory = path.join(rootDirectory, 'MindNProgress');
  const stateDirectory = path.join(rootDirectory, '.mindnprogress');
  const pidFile = path.join(stateDirectory, 'dev.pids');
  if (!fs.existsSync(path.join(rootDirectory, 'MindNProgress_Mcp.cjs'))) throw new Error('MindNProgress MCP launcher is missing.');
  fs.mkdirSync(stateDirectory, { recursive: true });
  const output = fs.openSync(path.join(stateDirectory, 'dev.out.log'), 'a');
  const error = fs.openSync(path.join(stateDirectory, 'dev.err.log'), 'a');
  // The scheduled task owns this long-lived launcher; the supervisor pipe rejects duplicate instances.
  const child = spawn(process.execPath, [path.join(projectDirectory, 'scripts', 'dev.mjs')], {
    cwd: projectDirectory, windowsHide: true, stdio: ['ignore', output, error],
    env: { ...process.env, MNP_RUNTIME_STATE_DIR: stateDirectory },
  });
  fs.writeFileSync(pidFile, `${process.pid}\n${child.pid}\n`, 'utf8');
  const finish = (code) => {
    try {
      if (Number(fs.readFileSync(pidFile, 'utf8').split(/\s+/)[0]) === process.pid) fs.rmSync(pidFile, { force: true });
    } catch (failure) { if (failure.code !== 'ENOENT') fs.writeSync(error, `[launcher] ${failure.message}\n`); }
    process.exit(code);
  };
  child.on('error', (failure) => { fs.writeSync(error, `[launcher] ${failure.stack ?? failure.message}\n`); finish(1); });
  child.on('exit', (code) => finish(code ?? 1));
};
