import type {
  ModelAuthMode,
  ModelDataPolicy,
  ModelEgressPolicy,
  ModelMode,
  ModelProfile,
  ModelProviderKind,
} from './model-profile.js';

export interface WeComBootstrapConfig {
  enabled: boolean;
  botId?: string;
  botSecret?: string;
  targetIds: string[];
  websocketUrl?: string;
}

export interface ModelBootstrapConfig extends ModelProfile {
  apiKey?: string;
}

export interface SecurityBootstrapConfig {
  enforceEnvPermissions: boolean;
  qwebBridgeEnabled: boolean;
  qwebBridgeUrl: string;
  wecom: WeComBootstrapConfig;
  model: ModelBootstrapConfig;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const MODEL_MODES = new Set<ModelMode>(['disabled', 'orchestrate']);
const MODEL_PROVIDER_KINDS = new Set<ModelProviderKind>(['builtin', 'openai-compatible']);
const MODEL_AUTH_MODES = new Set<ModelAuthMode>(['keychain', 'none']);
const MODEL_DATA_POLICIES = new Set<ModelDataPolicy>(['metadata-only', 'redacted-text']);
const MODEL_EGRESS_POLICIES = new Set<ModelEgressPolicy>(['local-only', 'internal-only', 'external-approved']);

export function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`invalid boolean value: ${value}`);
}

export function parseLineList(value: string | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean))];
}

export function parsePositiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = Number(value || fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

export function assertLoopbackHttpUrl(value: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(`${name} must use http and a loopback host (127.0.0.1, localhost, or ::1)`);
  }
  return url;
}

function modelValue<T extends string>(value: string | undefined, fallback: T, allowed: Set<T>, name: string): T {
  const result = (value?.trim() || fallback) as T;
  if (!allowed.has(result)) throw new Error(`${name} has an unsupported value: ${result}`);
  return result;
}

function assertProfileName(value: string): string {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value)) throw new Error('TENDER_LLM_PROFILE must be 1-64 alphanumeric, underscore, or hyphen characters');
  return value;
}

function assertModelEndpoint(input: { baseUrl?: string; egressPolicy: ModelEgressPolicy; allowedHosts: string[]; providerKind: ModelProviderKind }): void {
  if (input.providerKind === 'builtin') {
    if (input.baseUrl) throw new Error('TENDER_LLM_BASE_URL is only supported when TENDER_LLM_PROVIDER_KIND=openai-compatible');
    return;
  }
  if (!input.baseUrl) throw new Error('TENDER_LLM_BASE_URL is required for openai-compatible model profiles');
  let url: URL;
  try { url = new URL(input.baseUrl); } catch { throw new Error('TENDER_LLM_BASE_URL must be a valid URL'); }
  const isLoopback = LOOPBACK_HOSTS.has(url.hostname);
  if (input.egressPolicy === 'local-only') {
    if (!isLoopback || !['http:', 'https:'].includes(url.protocol)) throw new Error('local-only model profile requires a loopback http(s) endpoint');
    return;
  }
  if (input.egressPolicy === 'internal-only') {
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('internal-only model endpoint must use http(s)');
    if (!input.allowedHosts.includes(url.hostname)) throw new Error('internal-only model endpoint host must appear in TENDER_LLM_ALLOWED_HOSTS');
    return;
  }
  if (input.egressPolicy === 'external-approved' && !isLoopback && url.protocol !== 'https:') {
    throw new Error('external-approved model endpoint must use HTTPS unless it is loopback');
  }
}

function loadModelBootstrap(env: NodeJS.ProcessEnv): ModelBootstrapConfig {
  const enabled = parseBoolean(env.TENDER_LLM_ENABLED, false);
  const mode = modelValue(env.TENDER_LLM_MODE, enabled ? 'orchestrate' : 'disabled', MODEL_MODES, 'TENDER_LLM_MODE');
  const profile = assertProfileName(env.TENDER_LLM_PROFILE?.trim() || 'default');
  const providerKind = modelValue(env.TENDER_LLM_PROVIDER_KIND, 'builtin', MODEL_PROVIDER_KINDS, 'TENDER_LLM_PROVIDER_KIND');
  const provider = env.TENDER_LLM_PROVIDER?.trim() || '';
  const model = env.TENDER_LLM_MODEL?.trim() || '';
  const authMode = modelValue(env.TENDER_LLM_AUTH_MODE, 'keychain', MODEL_AUTH_MODES, 'TENDER_LLM_AUTH_MODE');
  const dataPolicy = modelValue(env.TENDER_LLM_DATA_POLICY, 'metadata-only', MODEL_DATA_POLICIES, 'TENDER_LLM_DATA_POLICY');
  const egressPolicy = modelValue(env.TENDER_LLM_EGRESS_POLICY, 'local-only', MODEL_EGRESS_POLICIES, 'TENDER_LLM_EGRESS_POLICY');
  const baseUrl = env.TENDER_LLM_BASE_URL?.trim() || undefined;
  const allowedHosts = parseLineList(env.TENDER_LLM_ALLOWED_HOSTS).map((item) => item.toLowerCase());
  const config: ModelBootstrapConfig = {
    enabled,
    mode,
    profile,
    providerKind,
    provider,
    model,
    baseUrl,
    authMode,
    apiKey: env.TENDER_LLM_API_KEY?.trim() || undefined,
    dataPolicy,
    egressPolicy,
    allowedHosts,
    maxRequestsPerRun: parsePositiveInteger(env.TENDER_LLM_MAX_REQUESTS_PER_RUN, 6, 'TENDER_LLM_MAX_REQUESTS_PER_RUN'),
    maxInputChars: parsePositiveInteger(env.TENDER_LLM_MAX_INPUT_CHARS, 12000, 'TENDER_LLM_MAX_INPUT_CHARS'),
    maxOutputTokens: parsePositiveInteger(env.TENDER_LLM_MAX_OUTPUT_TOKENS, 1200, 'TENDER_LLM_MAX_OUTPUT_TOKENS'),
    contextWindow: parsePositiveInteger(env.TENDER_LLM_CONTEXT_WINDOW, 32768, 'TENDER_LLM_CONTEXT_WINDOW'),
  };
  if (enabled && mode === 'disabled') throw new Error('TENDER_LLM_ENABLED=true requires TENDER_LLM_MODE=orchestrate');
  if (!enabled && mode !== 'disabled') throw new Error('TENDER_LLM_MODE=orchestrate requires TENDER_LLM_ENABLED=true');
  if (enabled && (!provider || !model)) throw new Error('TENDER_LLM_ENABLED=true requires TENDER_LLM_PROVIDER and TENDER_LLM_MODEL');
  if (enabled) assertModelEndpoint(config);
  if (authMode === 'none' && env.TENDER_LLM_API_KEY?.trim()) throw new Error('TENDER_LLM_API_KEY must be empty when TENDER_LLM_AUTH_MODE=none');
  return config;
}

export function loadSecurityBootstrap(env: NodeJS.ProcessEnv): SecurityBootstrapConfig {
  const botId = env.TENDER_WECOM_BOT_ID?.trim() || undefined;
  const botSecret = env.TENDER_WECOM_BOT_SECRET?.trim() || undefined;
  if (Boolean(botId) !== Boolean(botSecret)) {
    throw new Error('TENDER_WECOM_BOT_ID and TENDER_WECOM_BOT_SECRET must be set together');
  }

  const qwebBridgeEnabled = parseBoolean(env.TENDER_QWEBBRIDGE_ENABLED, false);
  const qwebBridgeUrl = env.TENDER_QWEBBRIDGE_URL?.trim() || 'http://127.0.0.1:10086';
  if (qwebBridgeEnabled) assertLoopbackHttpUrl(qwebBridgeUrl, 'TENDER_QWEBBRIDGE_URL');

  const websocketUrl = env.TENDER_WECOM_WEBSOCKET_URL?.trim() || undefined;
  if (websocketUrl) {
    let parsed: URL;
    try { parsed = new URL(websocketUrl); } catch { throw new Error('TENDER_WECOM_WEBSOCKET_URL must be a valid URL'); }
    if (!['wss:', 'ws:'].includes(parsed.protocol)) throw new Error('TENDER_WECOM_WEBSOCKET_URL must use ws or wss');
  }

  return {
    enforceEnvPermissions: parseBoolean(env.TENDER_SECURITY_ENFORCE_ENV_PERMISSIONS, true),
    qwebBridgeEnabled,
    qwebBridgeUrl,
    wecom: {
      enabled: parseBoolean(env.TENDER_WECOM_ENABLED, Boolean(botId)),
      botId,
      botSecret,
      targetIds: parseLineList(env.TENDER_WECOM_TARGET_IDS),
      websocketUrl,
    },
    model: loadModelBootstrap(env),
  };
}

export function redactedSecuritySummary(config: SecurityBootstrapConfig): Record<string, unknown> {
  return {
    envPermissionsEnforced: config.enforceEnvPermissions,
    qwebBridge: {
      enabled: config.qwebBridgeEnabled,
      endpoint: config.qwebBridgeEnabled ? config.qwebBridgeUrl : 'disabled',
    },
    wecom: {
      enabled: config.wecom.enabled,
      credentialsProvided: Boolean(config.wecom.botId && config.wecom.botSecret),
      targetCount: config.wecom.targetIds.length,
      customWebsocket: Boolean(config.wecom.websocketUrl),
    },
    model: {
      enabled: config.model.enabled,
      mode: config.model.mode,
      profile: config.model.profile,
      providerKind: config.model.providerKind,
      provider: config.model.provider || 'not-configured',
      model: config.model.model || 'not-configured',
      authMode: config.model.authMode,
      apiKeyProvided: Boolean(config.model.apiKey),
      dataPolicy: config.model.dataPolicy,
      egressPolicy: config.model.egressPolicy,
      allowedHostCount: config.model.allowedHosts.length,
      maxRequestsPerRun: config.model.maxRequestsPerRun,
    },
  };
}
