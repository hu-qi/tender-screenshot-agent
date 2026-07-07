import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { HostConfig } from './config.js';
import type { TenderTaskInput, WeComSettingsInput } from './domain.js';
import { RunEvents } from './events.js';
import { MacOSKeychainStore, WECOM_BOT_ID, WECOM_BOT_SECRET } from './keychain.js';
import { RunEngine } from './run-engine.js';
import { TenderStore } from './store.js';
import { testWeComBot, sendWeComMarkdown } from './wecom.js';

const json = (res: ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type' });
  res.end(JSON.stringify(value));
};

async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (Buffer.concat(chunks).length > 1_000_000) throw new Error('request body exceeds 1MB');
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

export function createAgentServer(input: {
  config: HostConfig;
  store: TenderStore;
  events: RunEvents;
  engine: RunEngine;
}) {
  const keychain = new MacOSKeychainStore();
  const authorize = (request: IncomingMessage): boolean => request.headers.authorization === `Bearer ${input.config.token}`;

  return createServer(async (request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, PUT, OPTIONS' });
      return response.end();
    }
    if (!authorize(request)) return json(response, 401, { error: 'unauthorized' });
    const url = new URL(request.url || '/', `http://127.0.0.1:${input.config.port}`);
    try {
      if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, { ok: true, version: '0.2.0' });
      if (request.method === 'GET' && url.pathname === '/api/tasks') return json(response, 200, input.store.listTasks());
      if (request.method === 'POST' && url.pathname === '/api/tasks') {
        const payload = await body(request) as TenderTaskInput;
        if (!payload.name?.trim() || !Array.isArray(payload.queries) || !Array.isArray(payload.platformIds)) throw new Error('invalid task input');
        return json(response, 201, input.store.createTask({ ...payload, name: payload.name.trim(), queries: [...new Set(payload.queries.map((item) => item.trim()).filter(Boolean))] }));
      }
      const start = url.pathname.match(/^\/api\/tasks\/([^/]+)\/runs$/);
      if (request.method === 'POST' && start) return json(response, 202, await input.engine.start(start[1]));
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
        const targets = [...new Set((payload.targetIds || []).map((item) => item.trim()).filter(Boolean))];
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
        await testWeComBot({ botId, botSecret, websocketUrl: setting?.value.websocketUrl });
        return json(response, 200, { authenticated: true });
      }
      if (request.method === 'POST' && url.pathname === '/api/settings/wecom/send-test') {
        const payload = await body(request) as { markdown?: string };
        const botId = await keychain.get(WECOM_BOT_ID);
        const botSecret = await keychain.get(WECOM_BOT_SECRET);
        const setting = input.store.getPublicSetting<{ targetIds: string[]; websocketUrl?: string }>('wecom');
        if (!botId || !botSecret || !setting) throw new Error('WeCom Bot is not configured');
        const result = await sendWeComMarkdown({ botId, botSecret, targetIds: setting.value.targetIds, websocketUrl: setting.value.websocketUrl, markdown: payload.markdown?.trim() || '**标讯截图助手**\n企业微信 Bot 测试消息。' });
        return json(response, 200, result);
      }
      return json(response, 404, { error: 'not found' });
    } catch (error) {
      return json(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}
