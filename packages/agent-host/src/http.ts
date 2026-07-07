import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { BrowserRuntimeError, BrowserRuntimeManager } from './browser-runtime.js';
import type { HostConfig } from './config.js';
import type { PlatformAccessView, PlatformAdapterConfig, TenderTaskInput, WeComSettingsInput } from './domain.js';
import { RunEvents } from './events.js';
import { MacOSKeychainStore, WECOM_BOT_ID, WECOM_BOT_SECRET } from './keychain.js';
import { LoginManager } from './login-manager.js';
import { RunEngine } from './run-engine.js';
import { TenderStore } from './store.js';
import { testWeComBot, sendWeComMarkdown, WeComBotError } from './wecom.js';

const json = (res: ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type',
  });
  res.end(JSON.stringify(value));
};

async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new Error('request body exceeds 1MB');
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function publicError(error: unknown): { status: number; payload: Record<string, unknown> } {
  if (error instanceof BrowserRuntimeError) {
    return { status: 409, payload: { error: error.message, code: error.code, browser: error.status } };
  }
  if (error instanceof WeComBotError) {
    return { status: 400, payload: { error: error.message, code: error.code } };
  }
  return { status: 400, payload: { error: error instanceof Error ? error.message : String(error) } };
}

export function createAgentServer(input: {
  config: HostConfig;
  store: TenderStore;
  events: RunEvents;
  engine: RunEngine;
  platforms: Map<string, PlatformAdapterConfig>;
  loginManager: LoginManager;
  browserRuntime: BrowserRuntimeManager;
}) {
  const keychain = new MacOSKeychainStore();
  const authorize = (request: IncomingMessage): boolean => request.headers.authorization === `Bearer ${input.config.token}`;
  const getPlatform = (id: string) => {
    const platform = input.platforms.get(id);
    if (!platform) throw new Error(`unknown platform: ${id}`);
    return platform;
  };
  const listPlatforms = (): PlatformAccessView[] => [...input.platforms.values()].map((platform) => ({
    ...platform,
    profile: input.store.getPlatformProfile(platform.id, input.loginManager.profileDir(platform.id)),
  }));

  return createServer(async (request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'authorization, content-type',
        'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
      });
      return response.end();
    }
    if (!authorize(request)) return json(response, 401, { error: 'unauthorized' });
    const url = new URL(request.url || '/', `http://127.0.0.1:${input.config.port}`);
    try {
      if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, { ok: true, version: '0.2.1' });
      if (request.method === 'GET' && url.pathname === '/api/browser/runtime') return json(response, 200, input.browserRuntime.status());
      if (request.method === 'POST' && url.pathname === '/api/browser/install') return json(response, 200, await input.browserRuntime.installChromium());
      if (request.method === 'GET' && url.pathname === '/api/platforms') return json(response, 200, listPlatforms());

      const openLogin = url.pathname.match(/^\/api\/platforms\/([^/]+)\/login$/);
      if (request.method === 'POST' && openLogin) {
        const platform = getPlatform(openLogin[1]);
        const profile = input.store.getPlatformProfile(platform.id, input.loginManager.profileDir(platform.id));
        const session = await input.loginManager.open(platform, profile.status);
        input.store.setPlatformProfile({
          platformId: platform.id,
          status: 'login-open',
          profileDir: input.loginManager.profileDir(platform.id),
          lastLoginAt: profile.lastLoginAt,
          lastValidatedAt: profile.lastValidatedAt,
          message: 'interactive browser is open; confirm only after completing the lawful platform login',
        });
        return json(response, 202, session);
      }

      const completeLogin = url.pathname.match(/^\/api\/platform-logins\/([^/]+)\/complete$/);
      if (request.method === 'POST' && completeLogin) {
        const session = await input.loginManager.complete(completeLogin[1]);
        const now = new Date().toISOString();
        input.store.setPlatformProfile({
          platformId: session.platformId,
          status: 'user-confirmed',
          profileDir: input.loginManager.profileDir(session.platformId),
          lastLoginAt: now,
          lastValidatedAt: now,
          message: 'user confirmed interactive login completion',
        });
        return json(response, 200, { session, profile: input.store.getPlatformProfile(session.platformId, input.loginManager.profileDir(session.platformId)) });
      }

      const cancelLogin = url.pathname.match(/^\/api\/platform-logins\/([^/]+)\/cancel$/);
      if (request.method === 'POST' && cancelLogin) {
        const cancelled = await input.loginManager.cancel(cancelLogin[1]);
        if (!cancelled) return json(response, 200, { cancelled: false });
        const existing = input.store.getPlatformProfile(cancelled.session.platformId, input.loginManager.profileDir(cancelled.session.platformId));
        input.store.setPlatformProfile({
          platformId: cancelled.session.platformId,
          status: cancelled.previousStatus,
          profileDir: input.loginManager.profileDir(cancelled.session.platformId),
          lastLoginAt: existing.lastLoginAt,
          lastValidatedAt: existing.lastValidatedAt,
          message: 'interactive login was cancelled by user',
        });
        return json(response, 200, { cancelled: true });
      }

      const clearProfile = url.pathname.match(/^\/api\/platforms\/([^/]+)\/profile$/);
      if (request.method === 'POST' && clearProfile) {
        const platform = getPlatform(clearProfile[1]);
        await input.loginManager.clear(platform.id);
        input.store.setPlatformProfile({
          platformId: platform.id,
          status: 'not-configured',
          profileDir: input.loginManager.profileDir(platform.id),
          message: 'local profile cleared by user',
        });
        return json(response, 200, input.store.getPlatformProfile(platform.id, input.loginManager.profileDir(platform.id)));
      }

      if (request.method === 'GET' && url.pathname === '/api/tasks') return json(response, 200, input.store.listTasks());
      if (request.method === 'POST' && url.pathname === '/api/tasks') {
        const payload = await body(request) as TenderTaskInput;
        if (!payload.name?.trim() || !Array.isArray(payload.queries) || !Array.isArray(payload.platformIds)) throw new Error('invalid task input');
        if (payload.platformIds.some((id) => !input.platforms.has(id))) throw new Error('task contains an unknown platform ID');
        return json(response, 201, input.store.createTask({
          ...payload,
          name: payload.name.trim(),
          queries: [...new Set(payload.queries.map((item) => item.trim()).filter(Boolean))],
        }));
      }

      const taskRuns = url.pathname.match(/^\/api\/tasks\/([^/]+)\/runs$/);
      if (request.method === 'GET' && taskRuns) return json(response, 200, input.store.listRuns(taskRuns[1]));
      if (request.method === 'POST' && taskRuns) return json(response, 202, await input.engine.start(taskRuns[1]));
      const artifacts = url.pathname.match(/^\/api\/runs\/([^/]+)\/artifacts$/);
      if (request.method === 'GET' && artifacts) return json(response, 200, input.store.listArtifacts(artifacts[1]));
      const events = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
      if (request.method === 'GET' && events) return json(response, 200, input.store.listEvents(events[1], Number(url.searchParams.get('after') || '0')));

      if (request.method === 'GET' && url.pathname === '/api/settings/wecom') {
        const configured = Boolean(await keychain.get(WECOM_BOT_ID)) && Boolean(await keychain.get(WECOM_BOT_SECRET));
        return json(response, 200, input.store.getWeComStatus(configured));
      }
      if (request.method === 'PUT' && url.pathname === '/api/settings/wecom') {
        const payload = await body(request) as WeComSettingsInput;
        if (!payload.botId?.trim() || !payload.botSecret?.trim()) throw new Error('Bot ID and Bot Secret are required');
        const targets = [...new Set((payload.targetIds || []).flatMap((item) => item.split(/[\n,;]+/)).map((item) => item.trim()).filter(Boolean))];
        await keychain.set(WECOM_BOT_ID, payload.botId.trim());
        await keychain.set(WECOM_BOT_SECRET, payload.botSecret.trim());
        input.store.setPublicSetting('wecom', { enabled: payload.enabled !== false, targetIds: targets, websocketUrl: payload.websocketUrl?.trim() || undefined });
        return json(response, 200, input.store.getWeComStatus(true));
      }
      if (request.method === 'POST' && url.pathname === '/api/settings/wecom/test') {
        const botId = await keychain.get(WECOM_BOT_ID);
        const botSecret = await keychain.get(WECOM_BOT_SECRET);
        const setting = input.store.getPublicSetting<{ websocketUrl?: string }>('wecom');
        if (!botId || !botSecret) throw new Error('WeCom Bot is not configured');
        return json(response, 200, await testWeComBot({ botId, botSecret, websocketUrl: setting?.value.websocketUrl }));
      }
      if (request.method === 'POST' && url.pathname === '/api/settings/wecom/send-test') {
        const payload = await body(request) as { markdown?: string };
        const botId = await keychain.get(WECOM_BOT_ID);
        const botSecret = await keychain.get(WECOM_BOT_SECRET);
        const setting = input.store.getPublicSetting<{ targetIds: string[]; websocketUrl?: string }>('wecom');
        if (!botId || !botSecret || !setting) throw new Error('WeCom Bot is not configured');
        return json(response, 200, await sendWeComMarkdown({
          botId,
          botSecret,
          targetIds: setting.value.targetIds,
          websocketUrl: setting.value.websocketUrl,
          markdown: payload.markdown?.trim() || '**标讯截图助手**\n企业微信 Bot 测试消息。',
        }));
      }
      return json(response, 404, { error: 'not found' });
    } catch (error) {
      const publicResponse = publicError(error);
      return json(response, publicResponse.status, publicResponse.payload);
    }
  });
}
