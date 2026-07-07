import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccessPolicy } from '../dist/policy.js';
import { TenderStore } from '../dist/store.js';

const manual = { id: 'cmcc', name: 'Manual', entryUrl: 'https://example.test', accessMode: 'manual-login', adapterStatus: 'unverified' };
const publicPlatform = { id: 'cebpubservice', name: 'Public', entryUrl: 'https://example.test', accessMode: 'public', adapterStatus: 'unverified' };

test('policy requires a user-confirmed profile for restricted platform automation', () => {
  const policy = new AccessPolicy();
  assert.equal(policy.canSearch(publicPlatform, { privacyMode: 'internal-enhanced', hasAuthorizedProfile: false }).allow, true);
  const denied = policy.canSearch(manual, { privacyMode: 'internal-enhanced', hasAuthorizedProfile: false });
  assert.equal(denied.allow, false);
  assert.match(denied.reason, /manual-login profile/);
  assert.equal(policy.canSearch(manual, { privacyMode: 'internal-enhanced', hasAuthorizedProfile: true }).allow, true);
  assert.equal(policy.canSendNotification('strict-local', 'status').allow, false);
});

test('store persists task, append-only events and platform profile state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tender-agent-store-'));
  try {
    const store = new TenderStore(join(dir, 'agent.db'));
    const task = store.createTask({ name: 'sample', queries: ['project'], platformIds: ['cmcc'], privacyMode: 'strict-local' });
    const run = store.createRun(task.id);
    const event = store.appendEvent(run.id, 'run.started', 'info', { source: 'test' });
    assert.equal(store.listEvents(run.id)[0].id, event.id);
    const first = store.getPlatformProfile('cmcc', join(dir, 'profiles', 'cmcc', 'default'));
    assert.equal(first.status, 'not-configured');
    const confirmed = store.setPlatformProfile({ platformId: 'cmcc', status: 'user-confirmed', profileDir: first.profileDir, message: 'test' });
    assert.equal(confirmed.status, 'user-confirmed');
    assert.equal(store.getPlatformProfile('cmcc', first.profileDir).status, 'user-confirmed');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
