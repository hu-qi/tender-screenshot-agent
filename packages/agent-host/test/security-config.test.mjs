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
  assert.equal(config.model.enabled, false);
});

test('security parser accepts a local OpenAI-compatible model profile', () => {
  const config = loadSecurityBootstrap({
    TENDER_LLM_ENABLED: 'true',
    TENDER_LLM_MODE: 'orchestrate',
    TENDER_LLM_PROFILE: 'local-vllm',
    TENDER_LLM_PROVIDER_KIND: 'openai-compatible',
    TENDER_LLM_PROVIDER: 'internal-vllm',
    TENDER_LLM_MODEL: 'example-model',
    TENDER_LLM_AUTH_MODE: 'none',
    TENDER_LLM_EGRESS_POLICY: 'local-only',
    TENDER_LLM_BASE_URL: 'http://127.0.0.1:8000/v1',
  });
  assert.equal(config.model.enabled, true);
  assert.equal(config.model.profile, 'local-vllm');
  assert.equal(config.model.apiKey, undefined);
});

test('security parser rejects incomplete credentials and unsafe endpoints', () => {
  assert.throws(() => loadSecurityBootstrap({ TENDER_WECOM_BOT_ID: 'only-id' }), /set together/);
  assert.throws(() => loadSecurityBootstrap({ TENDER_QWEBBRIDGE_ENABLED: 'true', TENDER_QWEBBRIDGE_URL: 'https://bridge.example.test' }), /loopback/);
  assert.throws(() => assertLoopbackHttpUrl('http://10.0.0.8:10086', 'bridge'), /loopback/);
  assert.throws(() => loadSecurityBootstrap({
    TENDER_LLM_ENABLED: 'true',
    TENDER_LLM_MODE: 'orchestrate',
    TENDER_LLM_PROVIDER_KIND: 'builtin',
    TENDER_LLM_PROVIDER: 'deepseek',
    TENDER_LLM_MODEL: 'deepseek-chat',
    TENDER_LLM_EGRESS_POLICY: 'local-only',
  }), /external-approved/);
  assert.throws(() => loadSecurityBootstrap({
    TENDER_LLM_ENABLED: 'true',
    TENDER_LLM_MODE: 'orchestrate',
    TENDER_LLM_PROVIDER_KIND: 'openai-compatible',
    TENDER_LLM_PROVIDER: 'internal',
    TENDER_LLM_MODEL: 'm',
    TENDER_LLM_EGRESS_POLICY: 'internal-only',
    TENDER_LLM_BASE_URL: 'https://llm.internal.example/v1',
  }), /ALLOWED_HOSTS/);
});

test('boolean and target list parsing is predictable', () => {
  assert.equal(parseBoolean('yes', false), true);
  assert.equal(parseBoolean('off', true), false);
  assert.deepEqual(parseLineList('a;b\n c,a'), ['a', 'b', 'c']);
});
