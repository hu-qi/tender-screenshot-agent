export interface WeComBootstrapConfig {
  enabled: boolean;
  botId?: string;
  botSecret?: string;
  targetIds: string[];
  websocketUrl?: string;
}

export interface SecurityBootstrapConfig {
  enforceEnvPermissions: boolean;
  qwebBridgeEnabled: boolean;
  qwebBridgeUrl: string;
  wecom: WeComBootstrapConfig;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

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
  };
}
