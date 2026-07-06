import AiBot from '@wecom/aibot-node-sdk';

export type WeComBotConnectionOptions = {
  botId: string;
  secret: string;
  websocketUrl?: string;
  connectTimeoutMs?: number;
};

export type WeComBotDeliveryOptions = WeComBotConnectionOptions & {
  targetChatIds: string[];
  markdown: string;
};

export type WeComBotResult = {
  authenticated: boolean;
  deliveredChatIds: string[];
  rejectedChatIds: string[];
};

type SdkClient = {
  connect(): unknown;
  disconnect(): void;
  once(event: string, listener: (...args: any[]) => void): unknown;
  off?(event: string, listener: (...args: any[]) => void): unknown;
  sendMessage(chatId: string, body: { msgtype: 'markdown'; markdown: { content: string } }): Promise<unknown>;
};

function validateConnection(options: WeComBotConnectionOptions): void {
  if (!options.botId?.trim()) throw new Error('wecom Bot ID is required');
  if (!options.secret?.trim()) throw new Error('wecom Bot Secret is required');
}

function safeId(value: string): string {
  const normalized = value.trim();
  return normalized.length <= 6 ? '***' : `***${normalized.slice(-4)}`;
}

async function authenticate(client: SdkClient, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.off?.('authenticated', onAuthenticated);
      client.off?.('error', onError);
      client.off?.('disconnected', onDisconnected);
      callback();
    };
    const onAuthenticated = () => finish(resolve);
    const onError = (error: unknown) => finish(() => reject(error instanceof Error ? error : new Error(String(error))));
    const onDisconnected = (reason: unknown) => finish(() => reject(new Error(`WeCom Bot disconnected before authentication: ${String(reason)}`)));
    const timer = setTimeout(() => finish(() => reject(new Error(`WeCom Bot authentication timed out after ${timeoutMs}ms`))), timeoutMs);

    client.once('authenticated', onAuthenticated);
    client.once('error', onError);
    client.once('disconnected', onDisconnected);
    client.connect();
  });
}

function createClient(options: WeComBotConnectionOptions): SdkClient {
  const sdkLogger = {
    debug: (_message: string) => undefined,
    info: (_message: string) => undefined,
    warn: (_message: string) => undefined,
    error: (_message: string) => undefined,
  };

  return new AiBot.WSClient({
    botId: options.botId,
    secret: options.secret,
    ...(options.websocketUrl ? { wsUrl: options.websocketUrl } : {}),
    logger: sdkLogger,
  }) as unknown as SdkClient;
}

export async function testWeComBot(options: WeComBotConnectionOptions): Promise<Pick<WeComBotResult, 'authenticated'>> {
  validateConnection(options);
  const client = createClient(options);
  try {
    await authenticate(client, options.connectTimeoutMs ?? 15_000);
    return { authenticated: true };
  } finally {
    client.disconnect();
  }
}

export async function deliverWeComMarkdown(options: WeComBotDeliveryOptions): Promise<WeComBotResult> {
  validateConnection(options);
  const targetChatIds = [...new Set(options.targetChatIds.map((id) => id.trim()).filter(Boolean))];
  if (targetChatIds.length === 0) throw new Error('at least one WeCom target chat ID is required');
  if (!options.markdown.trim()) throw new Error('WeCom markdown content is required');

  const client = createClient(options);
  const deliveredChatIds: string[] = [];
  const rejectedChatIds: string[] = [];
  try {
    await authenticate(client, options.connectTimeoutMs ?? 15_000);
    for (const chatId of targetChatIds) {
      try {
        await client.sendMessage(chatId, {
          msgtype: 'markdown',
          markdown: { content: options.markdown },
        });
        deliveredChatIds.push(safeId(chatId));
      } catch {
        rejectedChatIds.push(safeId(chatId));
      }
    }
    if (deliveredChatIds.length === 0) throw new Error('WeCom Bot rejected every target chat ID');
    return { authenticated: true, deliveredChatIds, rejectedChatIds };
  } finally {
    client.disconnect();
  }
}
