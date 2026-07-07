import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const hostEntrypoint = join(here, '..', 'dist', 'index.js');

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitFor(url, headers) {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(url, { headers });
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw lastError || new Error('Agent Host did not start');
}

test('Agent Host enforces its bearer token and serves local task state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tender-agent-host-'));
  const port = await availablePort();
  const token = 'test-launch-token';
  const child = spawn(process.execPath, [hostEntrypoint, '--port', String(port), '--token', token, '--data-dir', join(root, 'data'), '--config-dir', join(root, 'config')], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitFor(`http://127.0.0.1:${port}/health`, { authorization: `Bearer ${token}` });
    const denied = await fetch(`http://127.0.0.1:${port}/api/tasks`);
    assert.equal(denied.status, 401);

    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const platforms = await (await fetch(`http://127.0.0.1:${port}/api/platforms`, { headers })).json();
    assert.equal(platforms.length, 9);
    assert.equal(platforms.every((platform) => platform.adapterStatus === 'unverified'), true);

    const create = await fetch(`http://127.0.0.1:${port}/api/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'host smoke', queries: ['project-001'], platformIds: ['cmcc'], privacyMode: 'strict-local' }),
    });
    assert.equal(create.status, 201);
    const task = await create.json();
    assert.equal(task.status, 'queued');

    const tasks = await (await fetch(`http://127.0.0.1:${port}/api/tasks`, { headers })).json();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].id, task.id);
  } finally {
    child.kill('SIGTERM');
    await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 1000))]);
    await rm(root, { recursive: true, force: true });
  }
});
