import AiBot from '@wecom/aibot-node-sdk';

export interface WeComDeliveryInput {
  botId: string;
  botSecret: string;
  targetIds: string[];
  markdown: string;
  websocketUrl?: string;
}

export interface WeComAuthenticationResult {
  authenticated: true;
  latencyMs: number;
}

export interface WeComDeliveryResult extends WeComAuthenticationResult {
  delivered: number;
  rejected: number;
}

export type WeComBotErrorCode = 'authentication-timeout' | 'authentication-failed' | 'network-failure' | 'no-targets' | 'delivery-failed';

export class WeComBotError extends Error {
  constructor(readonly code: WeComBotErrorCode, message: string) {
    super(message);
    this.name = 'WeComBotError';
  }
}

type Client = {
  connect(): void;
  disconnect(): void;
  once(event: string, listener: (...args: unknown[]) => void): void;
  off?(event: string, listener: (...args: unknown[]) => void): void;
  sendMessage(target: string, body: { msgtype: 'markdown'; markdown: { content: string } }): Promise<unknown>;
};

function createClient(input: Pick<WeComDeliveryInput, 'botId' | 'botSecret' | 'websocketUrl'>): Client {
  return new AiBot.WSClient({
    botId: input.botId,
    secret: input.botSecret,
    ...(input.websocketUrl ? { wsUrl: input.websocketUrl } : {}),
    logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
  }) as unknown as Client;
}

function authenticationError(error: unknown): WeComBotError {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes('timeout') || message.includes('timed out')) {
    return new WeComBotError('authentication-timeout', '企业微信 Bot 认证超时。请检查网络、企业微信长连接地址或代理设置。');
  }
  if (message.includes('secret') || message.includes('auth') || message.includes('credential') || message.includes('forbidden')) {
    return new WeComBotError('authentication-failed', '企业微信 Bot 认证失败。请核对 Bot ID、Bot Secret，以及机器人是否已启用。');
  }
  if (message.includes('network') || message.includes('connect') || message.includes('socket') || message.includes('dns') || message.includes('econn')) {
    return new WeComBotError('network-failure', '无法连接企业微信 Bot 长连接服务。请检查网络、代理和 WebSocket 地址。');
  }
  return new WeComBotError('authentication-failed', '企业微信 Bot 认证失败。请核对 Bot 配置并查看本机网络状态。');
}

async function connect(client: Client): Promise<WeComAuthenticationResult> {
  const startedAt = Date.now();
  return new Promise<WeComAuthenticationResult>((resolve, reject) => {
    let settled = false;
    const complete = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      client.off?.('authenticated', onAuthenticated);
      client.off?.('error', onError);
      callback();
    };
    const onAuthenticated = () => complete(() => resolve({ authenticated: true, latencyMs: Date.now() - startedAt }));
    const onError = (error: unknown) => complete(() => reject(authenticationError(error)));
    const timeout = setTimeout(() => complete(() => reject(new WeComBotError('authentication-timeout', '企业微信 Bot 认证超时。请检查网络、企业微信长连接地址或代理设置。'))), 15_000);
    client.once('authenticated', onAuthenticated);
    client.once('error', onError);
    try {
      client.connect();
    } catch (error) {
      complete(() => reject(authenticationError(error)));
    }
  });
}

export async function testWeComBot(input: Pick<WeComDeliveryInput, 'botId' | 'botSecret' | 'websocketUrl'>): Promise<WeComAuthenticationResult> {
  const client = createClient(input);
  try {
    return await connect(client);
  } finally {
    client.disconnect();
  }
}

export async function sendWeComMarkdown(input: WeComDeliveryInput): Promise<WeComDeliveryResult> {
  const targetIds = [...new Set(input.targetIds.flatMap((value) => value.split(/[\n,;]+/)).map((value) => value.trim()).filter(Boolean))];
  if (targetIds.length === 0) throw new WeComBotError('no-targets', '没有可发送的企业微信目标会话。请填写 chatid 或 userid 后重试。');
  const client = createClient(input);
  let delivered = 0;
  let rejected = 0;
  try {
    const authentication = await connect(client);
    for (const target of targetIds) {
      try {
        await client.sendMessage(target, { msgtype: 'markdown', markdown: { content: input.markdown } });
        delivered += 1;
      } catch {
        rejected += 1;
      }
    }
    if (delivered === 0) throw new WeComBotError('delivery-failed', '企业微信 Bot 已认证，但所有目标会话均拒绝了消息。请确认 chatid/userid 是否正确且机器人具备主动推送权限。');
    return { ...authentication, delivered, rejected };
  } finally {
    client.disconnect();
  }
}
