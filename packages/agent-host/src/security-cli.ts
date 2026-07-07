import { chmod, copyFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadPlatformRegistry, resolveHostConfig } from './config.js';
import { modelApiKeyAccount, WECOM_BOT_ID, WECOM_BOT_SECRET, MacOSKeychainStore } from './keychain.js';
import { ModelProfileRuntime, type ModelProfile } from './model-profile.js';
import { loadSecurityBootstrap, redactedSecuritySummary } from './security-config.js';
import { TenderStore } from './store.js';

const USAGE = `
Usage:
  npm run local:config -- init
  npm run local:config -- apply
  npm run local:config -- doctor
  npm run local:config -- test-model --confirm-model-egress
  npm run local:config -- clear-wecom --confirm-clear-wecom
  npm run local:config -- clear-model --confirm-clear-model

Commands:
  init          Create .env from .env.example when missing and set local-only permissions.
  apply         Read .env, validate settings, write credentials to Keychain, and persist non-secret settings to SQLite.
  doctor        Check .env permissions, loopback QWebBridge, Keychain and local store state without external requests.
  test-model    Send one fixed non-sensitive health request to the configured model. Requires explicit confirmation.
  clear-wecom   Remove WeCom credentials from Keychain and clear local notification settings.
  clear-model   Remove the configured model profile API key from Keychain and clear its local profile settings.
`;

function envFile(): string {
  return resolve(process.env.TENDER_ENV_FILE || join(process.cwd(), '.env'));
}

function exampleFile(): string {
  return resolve(process.cwd(), '.env.example');
}

function modeText(mode: number): string {
  return `0${(mode & 0o777).toString(8)}`;
}

async function ensureEnvPermissions(path: string, enforce: boolean): Promise<{ mode: string; changed: boolean }> {
  const before = await stat(path);
  const insecure = (before.mode & 0o077) !== 0;
  if (insecure && enforce) await chmod(path, 0o600);
  const after = await stat(path);
  return { mode: modeText(after.mode), changed: insecure && enforce };
}

async function init(): Promise<void> {
  const target = envFile();
  if (existsSync(target)) {
    const permissions = await ensureEnvPermissions(target, true);
    process.stdout.write(`${JSON.stringify({ ok: true, command: 'init', created: false, envFile: target, envMode: permissions.mode, permissionsUpdated: permissions.changed }, null, 2)}\n`);
    return;
  }
  const source = exampleFile();
  if (!existsSync(source)) throw new Error(`missing template: ${source}`);
  await copyFile(source, target);
  await chmod(target, 0o600);
  process.stdout.write(`${JSON.stringify({ ok: true, command: 'init', created: true, envFile: target, envMode: '0600' }, null, 2)}\n`);
}

function openStore() {
  // The Host config requires a token for its HTTP server. The local configuration CLI never opens that server.
  process.env.TENDER_AGENT_TOKEN ||= 'security-cli-local-only';
  const config = resolveHostConfig(process.argv.slice(3));
  const store = new TenderStore(join(config.dataDir, 'tender-agent.db'));
  return { config, store };
}

function publicModelProfile(input: ReturnType<typeof loadSecurityBootstrap>['model']): ModelProfile {
  const { apiKey: _apiKey, ...profile } = input;
  return profile;
}

async function ensureModelKeychain(input: ReturnType<typeof loadSecurityBootstrap>['model']): Promise<void> {
  if (!input.enabled || input.authMode === 'none') return;
  if (process.platform !== 'darwin') throw new Error('model Keychain configuration must run on macOS');
  const keychain = new MacOSKeychainStore();
  const account = modelApiKeyAccount(input.profile);
  if (input.apiKey) {
    await keychain.set(account, input.apiKey);
    return;
  }
  if (!await keychain.get(account)) {
    throw new Error(`TENDER_LLM_API_KEY is required for first setup of model profile ${input.profile}`);
  }
}

async function apply(): Promise<void> {
  const { config, store } = openStore();
  const security = loadSecurityBootstrap(process.env);
  const permissions = await ensureEnvPermissions(envFile(), security.enforceEnvPermissions);

  if (security.wecom.botId && security.wecom.botSecret) {
    if (process.platform !== 'darwin') throw new Error('WeCom Keychain configuration must run on macOS');
    const keychain = new MacOSKeychainStore();
    await keychain.set(WECOM_BOT_ID, security.wecom.botId);
    await keychain.set(WECOM_BOT_SECRET, security.wecom.botSecret);
  } else if (security.wecom.enabled) {
    throw new Error('TENDER_WECOM_ENABLED=true requires TENDER_WECOM_BOT_ID and TENDER_WECOM_BOT_SECRET in .env');
  }
  store.setPublicSetting('wecom', {
    enabled: security.wecom.enabled,
    targetIds: security.wecom.targetIds,
    websocketUrl: security.wecom.websocketUrl,
  });

  await ensureModelKeychain(security.model);
  // Persist enabled=false as well, so .env can disable an existing profile without deleting its Keychain key.
  store.setPublicSetting('llm', publicModelProfile(security.model));

  // Force registry creation while applying config so paths fail early, without touching adapter state.
  const platformCount = loadPlatformRegistry(config).length;
  process.stdout.write(`${JSON.stringify({
    ok: true,
    command: 'apply',
    envFile: envFile(),
    envMode: permissions.mode,
    permissionsUpdated: permissions.changed,
    platformRegistryReady: platformCount,
    ...redactedSecuritySummary(security),
  }, null, 2)}\n`);
}

async function doctor(): Promise<void> {
  const issues: string[] = [];
  const warnings: string[] = [];
  const target = envFile();
  if (!existsSync(target)) issues.push(`missing .env: ${target}; run npm run local:config -- init`);

  let config: ReturnType<typeof resolveHostConfig> | undefined;
  let security: ReturnType<typeof loadSecurityBootstrap> | undefined;
  let store: TenderStore | undefined;
  try {
    const opened = openStore();
    config = opened.config;
    store = opened.store;
    security = loadSecurityBootstrap(process.env);
    if (existsSync(target)) {
      const permissions = await ensureEnvPermissions(target, false);
      if (security.enforceEnvPermissions && permissions.mode !== '0600') {
        issues.push(`insecure .env mode ${permissions.mode}; expected 0600; run npm run local:config -- apply`);
      }
    }
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }

  let botIdPresent = false;
  let botSecretPresent = false;
  let modelApiKeyPresent = false;
  let targetCount = 0;
  let persistedModel: ModelProfile | undefined;
  if (store) {
    const setting = store.getPublicSetting<{ enabled: boolean; targetIds: string[] }>('wecom');
    targetCount = setting?.value.targetIds.length ?? 0;
    persistedModel = store.getPublicSetting<ModelProfile>('llm')?.value;
  }
  if (process.platform === 'darwin') {
    try {
      const keychain = new MacOSKeychainStore();
      botIdPresent = Boolean(await keychain.get(WECOM_BOT_ID));
      botSecretPresent = Boolean(await keychain.get(WECOM_BOT_SECRET));
      if (botIdPresent !== botSecretPresent) issues.push('WeCom Keychain credentials are incomplete; run npm run local:config -- apply');
      if (security?.model.enabled && security.model.authMode === 'keychain') {
        modelApiKeyPresent = Boolean(await keychain.get(modelApiKeyAccount(security.model.profile)));
        if (!modelApiKeyPresent) issues.push(`model API key is missing for profile ${security.model.profile}; run npm run local:config -- apply`);
      }
    } catch (error) {
      issues.push(`macOS Keychain check failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    warnings.push('macOS Keychain is unavailable on this platform; apply must run on the target macOS workstation');
  }

  if (security?.wecom.enabled && !botIdPresent && process.platform === 'darwin') issues.push('WeCom is enabled in .env but no Bot ID/Secret pair exists in Keychain');
  if (security?.wecom.enabled && targetCount === 0) warnings.push('WeCom is enabled but TENDER_WECOM_TARGET_IDS is empty');
  if (config?.qwebBridgeEnabled && !security?.qwebBridgeEnabled) issues.push('QWebBridge runtime configuration and security bootstrap configuration disagree');
  if (security?.model.enabled && !persistedModel) issues.push('model is enabled in .env but no persisted model profile exists; run npm run local:config -- apply');
  if (security?.model.enabled && persistedModel && (persistedModel.profile !== security.model.profile || persistedModel.model !== security.model.model)) {
    warnings.push('persisted model profile differs from .env; run npm run local:config -- apply');
  }

  process.stdout.write(`${JSON.stringify({
    ok: issues.length === 0,
    command: 'doctor',
    envFile: target,
    node: process.version,
    platform: process.platform,
    keychain: { botIdPresent, botSecretPresent, modelApiKeyPresent },
    wecomTargetCount: targetCount,
    persistedModel: persistedModel ? { enabled: persistedModel.enabled, profile: persistedModel.profile, provider: persistedModel.provider, model: persistedModel.model } : undefined,
    ...(security ? redactedSecuritySummary(security) : {}),
    warnings,
    issues,
  }, null, 2)}\n`);
  if (issues.length > 0) process.exitCode = 1;
}

async function testModel(argv: string[]): Promise<void> {
  if (!argv.includes('--confirm-model-egress')) throw new Error('test-model requires --confirm-model-egress because it makes one model request');
  const { store } = openStore();
  const runtime = new ModelProfileRuntime(store);
  const resolved = await runtime.resolve();
  if (!resolved) throw new Error('no enabled model profile; set TENDER_LLM_ENABLED=true and run npm run local:config -- apply');
  const result = await resolved.models.completeSimple(resolved.model, {
    systemPrompt: 'Reply with exactly OK. Do not call tools and do not include any other content.',
    messages: [],
  }, { maxTokens: Math.min(resolved.config.maxOutputTokens, 16) });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    command: 'test-model',
    profile: resolved.config.profile,
    provider: resolved.config.provider,
    model: resolved.config.model,
    egressPolicy: resolved.config.egressPolicy,
    requestMade: true,
    responseReceived: Boolean(result),
  }, null, 2)}\n`);
}

async function clearWeCom(argv: string[]): Promise<void> {
  if (!argv.includes('--confirm-clear-wecom')) throw new Error('clear-wecom requires --confirm-clear-wecom');
  if (process.platform !== 'darwin') throw new Error('clear-wecom must run on macOS because credentials are stored in Keychain');
  const { store } = openStore();
  const keychain = new MacOSKeychainStore();
  await Promise.all([keychain.delete(WECOM_BOT_ID), keychain.delete(WECOM_BOT_SECRET)]);
  store.db.prepare(`DELETE FROM settings WHERE key = ?`).run('wecom');
  process.stdout.write(`${JSON.stringify({ ok: true, command: 'clear-wecom', credentialsRemoved: true, localNotificationSettingsRemoved: true }, null, 2)}\n`);
}

async function clearModel(argv: string[]): Promise<void> {
  if (!argv.includes('--confirm-clear-model')) throw new Error('clear-model requires --confirm-clear-model');
  if (process.platform !== 'darwin') throw new Error('clear-model must run on macOS because credentials are stored in Keychain');
  const { store } = openStore();
  const profile = store.getPublicSetting<ModelProfile>('llm')?.value?.profile || loadSecurityBootstrap(process.env).model.profile;
  const keychain = new MacOSKeychainStore();
  await keychain.delete(modelApiKeyAccount(profile));
  store.db.prepare(`DELETE FROM settings WHERE key = ?`).run('llm');
  process.stdout.write(`${JSON.stringify({ ok: true, command: 'clear-model', profile, credentialRemoved: true, localModelSettingsRemoved: true }, null, 2)}\n`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (!command || ['-h', '--help', 'help'].includes(command)) {
    process.stdout.write(USAGE);
    return;
  }
  if (command === 'init') return init();
  if (command === 'apply') return apply();
  if (command === 'doctor') return doctor();
  if (command === 'test-model') return testModel(argv.slice(1));
  if (command === 'clear-wecom') return clearWeCom(argv.slice(1));
  if (command === 'clear-model') return clearModel(argv.slice(1));
  throw new Error(`unknown security command: ${command}`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
