import { join } from 'node:path';
import { BrowserEvidenceTool } from './browser.js';
import { BrowserRuntimeManager } from './browser-runtime.js';
import { loadPlatformRegistry, resolveHostConfig } from './config.js';
import { RunEvents } from './events.js';
import { createAgentServer } from './http.js';
import { LoginManager } from './login-manager.js';
import { RunEngine } from './run-engine.js';
import { TenderStore } from './store.js';

const config = resolveHostConfig(process.argv.slice(2));
const store = new TenderStore(join(config.dataDir, 'tender-agent.db'));
const events = new RunEvents(store);
const platforms = new Map(loadPlatformRegistry(config).map((platform) => [platform.id, platform]));
const browserRuntime = new BrowserRuntimeManager(config);
const browser = new BrowserEvidenceTool(config, store, browserRuntime);
const loginManager = new LoginManager(config, browserRuntime);
const engine = new RunEngine(config, store, events, browser, platforms);
const server = createAgentServer({ config, store, events, engine, platforms, loginManager, browserRuntime });

server.listen(config.port, '127.0.0.1', () => {
  process.stdout.write(`${JSON.stringify({ event: 'agent-host-ready', port: config.port })}\n`);
});

const shutdown = () => {
  void loginManager.closeAll().finally(() => server.close(() => process.exit(0)));
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
