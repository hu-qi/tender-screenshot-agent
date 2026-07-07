import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QWebBridgeAdapterExplorer } from '../dist/adapter-explorer.js';
import { QWebBridgeClient } from '../dist/qwebbridge.js';

async function listen(server) {
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

function responseFor(tool) {
  if (tool === 'list_tabs') return { tabs: [{ tabId: 1, url: 'https://example.test/search', title: 'Example', active: true }] };
  if (tool === 'snapshot') return [{ role: 'textbox', name: '项目名称', ref: '@e1' }, { role: 'button', name: '搜索', ref: '@e2' }];
  if (tool === 'screenshot') return { success: true, data: Buffer.from('fake-png').toString('base64') };
  if (tool === 'evaluate') return {
    url: 'https://example.test/search',
    title: 'Example Search',
    interactive: [
      { tag: 'input', placeholder: '项目名称', selector: 'input[placeholder="项目名称"]', matches: 1, visible: true },
      { tag: 'button', text: '搜索', selector: 'button.search', matches: 1, visible: true },
      { tag: 'a', text: '某公开采购公告', selector: 'a.notice-link', matches: 4, visible: true },
    ],
    inputs: [{ tag: 'input', placeholder: '项目名称', selector: 'input[placeholder="项目名称"]', matches: 1, visible: true }],
    buttons: [{ tag: 'button', text: '搜索', selector: 'button.search', matches: 1, visible: true }],
    links: [{ tag: 'a', text: '某公开采购公告', selector: 'a.notice-link', matches: 4, visible: true }],
    pagination: [{ tag: 'button', text: '下一页', selector: 'button.next', matches: 1, visible: true }],
    manualBoundaries: [],
  };
  if (tool === 'network') return { success: true, requests: [] };
  return { success: true };
}

test('QWebBridge explorer writes only a local candidate fixture', async () => {
  const server = createServer(async (request, response) => {
    const tool = request.url?.split('/').pop();
    for await (const _ of request) { /* consume body */ }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(responseFor(tool)));
  });
  const port = await listen(server);
  const root = await mkdtemp(join(tmpdir(), 'qwb-recording-'));
  try {
    const config = {
      evidenceDir: join(root, 'evidence'),
      qwebBridgeUrl: `http://127.0.0.1:${port}`,
    };
    const platform = { id: 'cebpubservice', name: 'Public', entryUrl: 'https://example.test/search', accessMode: 'public', adapterStatus: 'unverified' };
    const explorer = new QWebBridgeAdapterExplorer(config, config.qwebBridgeUrl);
    const started = await explorer.start(platform);
    const manifest = await explorer.capture(platform, started.recordingId, 'entry');
    assert.equal(manifest.status, 'candidate');
    assert.ok(manifest.fixturePath);
    assert.equal(existsSync(manifest.fixturePath), true);
    const fixture = JSON.parse(await readFile(manifest.fixturePath, 'utf8'));
    assert.equal(fixture.status, 'candidate');
    assert.equal(fixture.source, 'qwebbridge');
    assert.equal(fixture.selectors.searchInput.selector, 'input[placeholder="项目名称"]');
    assert.equal(fixture.selectors.searchSubmit.selector, 'button.search');
    assert.notEqual(fixture.status, 'verified');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test('QWebBridge client refuses non-loopback endpoints', () => {
  assert.throws(() => new QWebBridgeClient('https://bridge.example.com'), /local http/);
});
