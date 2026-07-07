import AiBot from '@wecom/aibot-node-sdk';

export interface WeComDeliveryInput {
  botId: string;
  botSecret: string;
  targetIds: string[];
  markdown: string;
  websocketUrl?: string;
}

export interface WeComDeliveryResult {
  authenticated: boolean;
  delivered: number;
  rejected: number;
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

async function connect(client: Client): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const complete = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      client.off?.('authenticated', onAuthenticated);
      client.off?.('error', onError);
      callback();
    };
    const onAuthenticated = () => complete(resolve);
    const onError = (error: unknown) => complete(() => reject(error instanceof Error ? error : new Error(String(error))));
    const timeout = setTimeout(() => complete(() => reject(new Error('WeCom Bot authentication timed out after 15 seconds'))), 15_000);
    client.once('authenticated', onAuthenticated);
    client.once('error', onError);
    client.connect();
  });
}

export async function testWeComBot(input: Pick<WeComDeliveryInput, 'botId' | 'botSecret' | 'websocketUrl'>): Promise<void> {
  const client = createClient(input);
  try {
    await connect(client);
  } finally {
    client.disconnect();
  }
}

export async function sendWeComMarkdown(input: WeComDeliveryInput): Promise<WeComDeliveryResult> {
  const targetIds = [...new Set(input.targetIds.map((value) => value.trim()).filter(Boolean))];
  if (targetIds.length === 0) throw new Error('at least one target WeCom session ID is required');
  const client = createClient(input);
  let delivered = 0;
  let rejected = 0;
  try {
    await connect(client);
    for (const target of targetIds) {
      try {
        await client.sendMessage(target, { msgtype: 'markdown', markdown: { content: input.markdown } });
        delivered += 1;
      } catch {
        rejected += 1;
      }
    }
    if (delivered === 0) throw new Error('WeCom Bot rejected every configured target');
    return { authenticated: true, delivered, rejected };
  } finally {
    client.disconnect();
  }
}
