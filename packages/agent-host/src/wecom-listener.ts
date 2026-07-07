import AiBot from '@wecom/aibot-node-sdk';
import { MacOSKeychainStore, WECOM_BOT_ID, WECOM_BOT_SECRET } from './keychain.js';
import { TenderStore } from './store.js';

type WsClient = {
  connect(): void;
  disconnect(): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
};

export type WeComDiscoveredTargetType = 'userid' | 'chatid';

export interface WeComDiscoveredTarget {
  id: string;
  targetId: string;
  targetType: WeComDiscoveredTargetType;
  source: 'message.text' | 'event.enter_chat';
  discoveredAt: string;
  lastSeenAt: string;
  selected: boolean;
}

export interface WeComListenerStatus {
  state: 'stopped' | 'connecting' | 'authenticated' | 'error';
  authenticatedAt?: string;
  lastError?: string;
  lastEventAt?: string;
}

const SETTING_TARGETS = 'wecom.discovered-targets';
const SETTING_LISTENER = 'wecom.listener-status';

function safeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Reads only routing identifiers. It never persists message text, attachments, headers, or user profiles. */
function extractTargets(frame: unknown): Array<{ targetId: string; targetType: WeComDiscoveredTargetType }> {
  const root = frame && typeof frame === 'object' ? frame as Record<string, unknown> : {};
  const body = root.body && typeof root.body === 'object' ? root.body as Record<string, unknown> : {};
  const from = body.from && typeof body.from === 'object' ? body.from as Record<string, unknown> : {};
  const chat = body.chat && typeof body.chat === 'object' ? body.chat as Record<string, unknown> : {};
  const candidates: Array<{ value?: string; type: WeComDiscoveredTargetType }> = [
    { value: safeString(body.chatid), type: 'chatid' },
    { value: safeString(body.chat_id), type: 'chatid' },
    { value: safeString(chat.chatid), type: 'chatid' },
    { value: safeString(chat.id), type: 'chatid' },
    { value: safeString(body.userid), type: 'userid' },
    { value: safeString(body.user_id), type: 'userid' },
    { value: safeString(from.userid), type: 'userid' },
    { value: safeString(from.user_id), type: 'userid' },
  ];
  const seen = new Set<string>();
  return candidates.flatMap(({ value, type }) => {
    if (!value || seen.has(`${type}:${value}`)) return [];
    seen.add(`${type}:${value}`);
    return [{ targetId: value, targetType: type }];
  });
}

function createClient(botId: string, botSecret: string, websocketUrl?: string): WsClient {
  return new AiBot.WSClient({
    botId,
    secret: botSecret,
    ...(websocketUrl ? { wsUrl: websocketUrl } : {}),
    logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
  }) as unknown as WsClient;
}

export class WeComInboundListener {
  private client?: WsClient;
  private status: WeComListenerStatus = { state: 'stopped' };

  constructor(private readonly store: TenderStore, private readonly keychain = new MacOSKeychainStore()) {}

  getStatus(): WeComListenerStatus {
    return this.store.getPublicSetting<WeComListenerStatus>(SETTING_LISTENER)?.value || this.status;
  }

  listTargets(): WeComDiscoveredTarget[] {
    return this.store.getPublicSetting<WeComDiscoveredTarget[]>(SETTING_TARGETS)?.value || [];
  }

  private persistStatus(next: WeComListenerStatus): void {
    this.status = next;
    this.store.setPublicSetting(SETTING_LISTENER, next);
  }

  private discover(frame: unknown, source: WeComDiscoveredTarget['source']): void {
    const now = new Date().toISOString();
    const targets = this.listTargets();
    for (const target of extractTargets(frame)) {
      const id = `${target.targetType}:${target.targetId}`;
      const index = targets.findIndex((item) => item.id === id);
      const next: WeComDiscoveredTarget = {
        id,
        targetId: target.targetId,
        targetType: target.targetType,
        source,
        discoveredAt: index >= 0 ? targets[index].discoveredAt : now,
        lastSeenAt: now,
        selected: index >= 0 ? targets[index].selected : false,
      };
      if (index >= 0) targets[index] = next;
      else targets.unshift(next);
    }
    this.store.setPublicSetting(SETTING_TARGETS, targets.slice(0, 200));
    this.persistStatus({ ...this.status, lastEventAt: now });
  }

  async start(): Promise<WeComListenerStatus> {
    if (this.client) return this.getStatus();
    const [botId, botSecret] = await Promise.all([this.keychain.get(WECOM_BOT_ID), this.keychain.get(WECOM_BOT_SECRET)]);
    const setting = this.store.getPublicSetting<{ enabled?: boolean; websocketUrl?: string }>('wecom');
    if (!botId || !botSecret || !setting?.value.enabled) {
      throw new Error('企业微信 Bot 未完成配置或当前已禁用。请先保存 Bot 凭证。');
    }
    const client = createClient(botId, botSecret, setting.value.websocketUrl);
    this.client = client;
    this.persistStatus({ state: 'connecting' });
    client.on('authenticated', () => this.persistStatus({ state: 'authenticated', authenticatedAt: new Date().toISOString() }));
    client.on('error', () => this.persistStatus({ ...this.status, state: 'error', lastError: '企业微信入站连接异常。请检查网络、Bot 配置或 WebSocket 地址。' }));
    client.on('disconnected', () => {
      if (this.client) this.persistStatus({ ...this.status, state: 'error', lastError: '企业微信入站连接已断开。' });
    });
    client.on('message.text', (frame: unknown) => this.discover(frame, 'message.text'));
    client.on('event.enter_chat', (frame: unknown) => this.discover(frame, 'event.enter_chat'));
    client.connect();
    return this.getStatus();
  }

  stop(): WeComListenerStatus {
    this.client?.disconnect();
    this.client = undefined;
    this.persistStatus({ state: 'stopped' });
    return this.getStatus();
  }

  setSelected(ids: string[]): WeComDiscoveredTarget[] {
    const selected = new Set(ids);
    const targets = this.listTargets().map((target) => ({ ...target, selected: selected.has(target.id) }));
    this.store.setPublicSetting(SETTING_TARGETS, targets);
    return targets;
  }

  remove(ids: string[]): WeComDiscoveredTarget[] {
    const removed = new Set(ids);
    const targets = this.listTargets().filter((target) => !removed.has(target.id));
    this.store.setPublicSetting(SETTING_TARGETS, targets);
    return targets;
  }

  applySelected(): string[] {
    const targetIds = this.listTargets().filter((target) => target.selected).map((target) => target.targetId);
    const setting = this.store.getPublicSetting<{ enabled: boolean; targetIds: string[]; websocketUrl?: string }>('wecom');
    if (!setting) throw new Error('企业微信 Bot 未配置。');
    this.store.setPublicSetting('wecom', { ...setting.value, targetIds: [...new Set(targetIds)] });
    return targetIds;
  }
}
