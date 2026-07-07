import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertLoopbackHttpUrl,
  loadSecurityBootstrap,
  parseBoolean,
  parseLineList,
} from '../dist/security-config.js';

test('security parser accepts explicit local bootstrap configuration', () => {
  const config = loadSecurityBootstrap({
    TENDER_SECURITY_ENFORCE_ENV_PERMISSIONS: 'true',
    TENDER_QWEBBRIDGE_ENABLED: 'true',
    TENDER_QWEBBRIDGE_URL: 'http://127.0.0.1:10086',
    TENDER_WECOM_ENABLED: 'true',
    TENDER_WECOM_BOT_ID: 'bot-id',
    TENDER_WECOM_BOT_SECRET: 'bot-secret',
    TENDER_WECOM_TARGET_IDS: 'chat-a, user-b\nchat-a',
  });
  assert.equal(config.qwebBridgeEnabled, true);
  assert.equal(config.wecom.enabled, true);
  assert.deepEqual(config.wecom.targetIds, ['chat-a', 'user-b']);
});

test('security parser rejects incomplete credentials and remote bridge endpoints', () => {
  assert.throws(() => loadSecurityBootstrap({ TENDER_WECOM_BOT_ID: 'only-id' }), /set together/);
  assert.throws(() => loadSecurityBootstrap({ TENDER_QWEBBRIDGE_ENABLED: 'true', TENDER_QWEBBRIDGE_URL: 'https://bridge.example.test' }), /loopback/);
  assert.throws(() => assertLoopbackHttpUrl('http://10.0.0.8:10086', 'bridge'), /loopback/);
});

test('boolean and target list parsing is predictable', () => {
  assert.equal(parseBoolean('yes', false), true);
  assert.equal(parseBoolean('off', true), false);
  assert.deepEqual(parseLineList('a;b\n c,a'), ['a', 'b', 'c']);
});
