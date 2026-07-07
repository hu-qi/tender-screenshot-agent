import { join } from 'node:path';
import { BrowserEvidenceTool } from './browser.js';
import { loadPlatformRegistry, resolveHostConfig } from './config.js';
import { RunEvents } from './events.js';
import { createAgentServer } from './http.js';
import { RunEngine } from './run-engine.js';
import { TenderStore } from './store.js';

const config = resolveHostConfig(process.argv.slice(2));
const store = new TenderStore(join(config.dataDir, 'tender-agent.db'));
const events = new RunEvents(store);
const platforms = new Map(loadPlatformRegistry(config).map((platform) => [platform.id, platform]));
const browser = new BrowserEvidenceTool(config, store);
const engine = new RunEngine(config, store, events, browser, platforms as any);
const server = createAgentServer({ config, store, events, engine });

server.listen(config.port, '127.0.0.1', () => {
  process.stdout.write(`${JSON.stringify({ event: 'agent-host-ready', port: config.port })}\n`);
});

const shutdown = () => server.close(() => process.exit(0));
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
