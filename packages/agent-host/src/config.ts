import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { PlatformAdapterConfig, PlatformId } from './domain.js';
import { loadHostEnv, positiveInteger } from './env.js';

const defaults: PlatformAdapterConfig[] = [
  ['cmcc', '中国移动电子采购与招投标系统', 'https://es.b2b.10086.cn/newbid/', 'manual-login'],
  ['unicom', '中国联通合作方门户', 'https://www.cuecp.cn/', 'manual-login'],
  ['telecom', '中国电信电子采购平台', 'https://caigou.chinatelecom.com.cn/', 'manual-login'],
  ['tower-online-commerce', '中国铁塔在线商务平台', 'https://www.tower.com.cn/', 'manual-login'],
  ['tower-eprocurement', '中国铁塔电子采购平台', 'https://ebid.chinatowercom.cn/', 'ca-login'],
  ['cebpubservice', '中国招标投标公共服务平台', 'https://bulletin.cebpubservice.com/', 'public'],
  ['miit', '工信部通信工程建设项目招标投标管理信息平台', 'https://txzbqy.miit.gov.cn/', 'manual-login'],
  ['gd-govprocurement', '广东省政府采购网', 'https://gdgpo.czt.gd.gov.cn/', 'public'],
  ['gd-public-resources', '广东省公共资源交易平台', 'https://ygp.gdzwfw.gov.cn/', 'public'],
].map(([id, name, entryUrl, accessMode]) => ({ id: id as PlatformId, name, entryUrl, accessMode: accessMode as PlatformAdapterConfig['accessMode'], adapterStatus: 'unverified' }));

export interface HostConfig {
  port: number;
  token: string;
  dataDir: string;
  configDir: string;
  profilesDir: string;
  evidenceDir: string;
  platformConfigPath: string;
  chromiumPath?: string;
  navigationTimeoutMs: number;
  qwebBridgeEnabled: boolean;
  qwebBridgeUrl: string;
}

export function resolveHostConfig(argv: string[]): HostConfig {
  loadHostEnv();
  const option = (name: string): string | undefined => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
  const dataDir = resolve(option('--data-dir') || process.env.TENDER_DATA_DIR || resolve(process.cwd(), '.tender-agent'));
  const configDir = resolve(option('--config-dir') || process.env.TENDER_CONFIG_DIR || resolve(process.cwd(), 'config'));
  const port = positiveInteger(option('--port') || process.env.TENDER_AGENT_PORT, 39177, 'TENDER_AGENT_PORT');
  if (port > 65535) throw new Error('TENDER_AGENT_PORT must be a valid TCP port');
  const token = option('--token') || process.env.TENDER_AGENT_TOKEN || '';
  if (!token) throw new Error('TENDER_AGENT_TOKEN is required; the host refuses unauthenticated local requests');
  const platformConfigPath = resolve(process.env.TENDER_PLATFORM_CONFIG || resolve(configDir, 'platforms.json'));
  const config: HostConfig = {
    port,
    token,
    dataDir,
    configDir,
    profilesDir: resolve(dataDir, 'profiles'),
    evidenceDir: resolve(dataDir, 'evidence'),
    platformConfigPath,
    chromiumPath: process.env.TENDER_PLAYWRIGHT_CHROMIUM_PATH || undefined,
    navigationTimeoutMs: positiveInteger(process.env.TENDER_BROWSER_TIMEOUT_MS, 45_000, 'TENDER_BROWSER_TIMEOUT_MS'),
    qwebBridgeEnabled: process.env.TENDER_QWEBBRIDGE_ENABLED === 'true',
    qwebBridgeUrl: process.env.TENDER_QWEBBRIDGE_URL || 'http://127.0.0.1:10086',
  };
  for (const dir of [config.dataDir, config.configDir, config.profilesDir, config.evidenceDir]) mkdirSync(dir, { recursive: true });
  return config;
}

export function loadPlatformRegistry(config: HostConfig): PlatformAdapterConfig[] {
  if (!existsSync(config.platformConfigPath)) {
    mkdirSync(dirname(config.platformConfigPath), { recursive: true });
    writeFileSync(config.platformConfigPath, `${JSON.stringify({ version: 2, platforms: defaults }, null, 2)}\n`);
    return defaults;
  }
  const parsed = JSON.parse(readFileSync(config.platformConfigPath, 'utf8')) as { platforms?: PlatformAdapterConfig[] };
  if (!Array.isArray(parsed.platforms) || parsed.platforms.length === 0) throw new Error(`platform registry is invalid: ${config.platformConfigPath}`);
  return parsed.platforms;
}
