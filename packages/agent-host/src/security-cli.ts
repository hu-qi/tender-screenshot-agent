import { chmod, copyFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadPlatformRegistry, resolveHostConfig } from './config.js';
import { WECOM_BOT_ID, WECOM_BOT_SECRET, MacOSKeychainStore } from './keychain.js';
import { loadSecurityBootstrap, redactedSecuritySummary } from './security-config.js';
import { TenderStore } from './store.js';

const USAGE = `
Usage:
  npm run security -- init
  npm run security -- apply
  npm run security -- doctor
  npm run security -- clear-wecom --confirm-clear-wecom

Commands:
  init          Create .env from .env.example when missing and set local-only permissions.
  apply         Read .env, validate security settings, write WeCom credentials to Keychain,
                and persist non-secret notification settings to the local SQLite store.
  doctor        Check .env permissions, loopback-only QWebBridge configuration, Keychain and local store state.
  clear-wecom   Remove WeCom credentials from Keychain and clear local notification settings.
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
  // The Host config requires a token for its HTTP server. The security CLI never opens that server.
  process.env.TENDER_AGENT_TOKEN ||= 'security-cli-local-only';
  const config = resolveHostConfig(process.argv.slice(3));
  const store = new TenderStore(join(config.dataDir, 'tender-agent.db'));
  return { config, store };
}

async function apply(): Promise<void> {
  const { config, store } = openStore();
  const security = loadSecurityBootstrap(process.env);
  const permissions = await ensureEnvPermissions(envFile(), security.enforceEnvPermissions);
  const keychain = new MacOSKeychainStore();

  if (security.wecom.botId && security.wecom.botSecret) {
    await keychain.set(WECOM_BOT_ID, security.wecom.botId);
    await keychain.set(WECOM_BOT_SECRET, security.wecom.botSecret);
    store.setPublicSetting('wecom', {
      enabled: security.wecom.enabled,
      targetIds: security.wecom.targetIds,
      websocketUrl: security.wecom.websocketUrl,
    });
  } else if (security.wecom.enabled) {
    throw new Error('TENDER_WECOM_ENABLED=true requires TENDER_WECOM_BOT_ID and TENDER_WECOM_BOT_SECRET in .env');
  }

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
  if (!existsSync(target)) {
    issues.push(`missing .env: ${target}; run npm run security -- init`);
  }

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
        issues.push(`insecure .env mode ${permissions.mode}; expected 0600; run npm run security -- apply`);
      }
    }
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }

  let botIdPresent = false;
  let botSecretPresent = false;
  let targetCount = 0;
  if (store) {
    const setting = store.getPublicSetting<{ enabled: boolean; targetIds: string[] }>('wecom');
    targetCount = setting?.value.targetIds.length ?? 0;
  }
  if (process.platform === 'darwin') {
    try {
      const keychain = new MacOSKeychainStore();
      botIdPresent = Boolean(await keychain.get(WECOM_BOT_ID));
      botSecretPresent = Boolean(await keychain.get(WECOM_BOT_SECRET));
      if (botIdPresent !== botSecretPresent) issues.push('WeCom Keychain credentials are incomplete; run npm run security -- apply');
    } catch (error) {
      issues.push(`macOS Keychain check failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    warnings.push('macOS Keychain is unavailable on this platform; apply must run on the target macOS workstation');
  }

  if (security?.wecom.enabled && !botIdPresent && process.platform === 'darwin') {
    issues.push('WeCom is enabled in .env but no Bot ID/Secret pair exists in Keychain');
  }
  if (security?.wecom.enabled && targetCount === 0) warnings.push('WeCom is enabled but TENDER_WECOM_TARGET_IDS is empty');
  if (config?.qwebBridgeEnabled && !security?.qwebBridgeEnabled) issues.push('QWebBridge runtime configuration and security bootstrap configuration disagree');

  process.stdout.write(`${JSON.stringify({
    ok: issues.length === 0,
    command: 'doctor',
    envFile: target,
    node: process.version,
    platform: process.platform,
    keychain: { botIdPresent, botSecretPresent },
    wecomTargetCount: targetCount,
    ...(security ? redactedSecuritySummary(security) : {}),
    warnings,
    issues,
  }, null, 2)}\n`);
  if (issues.length > 0) process.exitCode = 1;
}

async function clearWeCom(argv: string[]): Promise<void> {
  if (!argv.includes('--confirm-clear-wecom')) {
    throw new Error('clear-wecom requires --confirm-clear-wecom');
  }
  if (process.platform !== 'darwin') throw new Error('clear-wecom must run on macOS because credentials are stored in Keychain');
  const { store } = openStore();
  const keychain = new MacOSKeychainStore();
  await Promise.all([keychain.delete(WECOM_BOT_ID), keychain.delete(WECOM_BOT_SECRET)]);
  store.deletePublicSetting('wecom');
  process.stdout.write(`${JSON.stringify({ ok: true, command: 'clear-wecom', credentialsRemoved: true, localNotificationSettingsRemoved: true }, null, 2)}\n`);
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
  if (command === 'clear-wecom') return clearWeCom(argv.slice(1));
  throw new Error(`unknown security command: ${command}`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
