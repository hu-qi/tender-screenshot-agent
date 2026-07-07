import { spawn } from 'node:child_process';

const command = process.argv[2] || 'doctor';
const passthrough = process.argv.slice(3);
const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
  '--workspace',
  '@tender/agent-host',
  'run',
  'local:config',
  '--',
  command,
  ...passthrough,
], {
  stdio: 'inherit',
  env: process.env,
});

child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
