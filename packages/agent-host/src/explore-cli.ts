import { join } from 'node:path';
import { QWebBridgeAdapterExplorer } from './adapter-explorer.js';
import { loadPlatformRegistry, resolveHostConfig } from './config.js';
import type { PlatformId } from './domain.js';

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function has(argv: string[], name: string): boolean { return argv.includes(name); }

function usage(): never {
  process.stderr.write(`
QWebBridge adapter exploration

Commands:
  status
  capture --platform <platformId> --stage <entry|authenticated|search-hit|no-result|page-2|detail|manual-boundary> [--recording <recordingId>]
  probe --platform <platformId> --recording <recordingId> --query <approved-test-query> --allow-search-probe [--confirm-authorized-session]

Safety:
  - TENDER_QWEBBRIDGE_ENABLED=true is required.
  - The bridge endpoint must be local loopback.
  - capture is passive: snapshot, screenshot and fixed DOM analysis only.
  - probe fills only the supplied query and clicks the candidate search button once.
  - probe refuses CA/UKey platforms and requires --confirm-authorized-session for manual-login platforms.
`);
  process.exit(2);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (!command) usage();
  process.env.TENDER_AGENT_TOKEN ||= 'explorer-cli-local-token';
  const config = resolveHostConfig(argv);
  if (!config.qwebBridgeEnabled) throw new Error('QWebBridge explorer is disabled. Set TENDER_QWEBBRIDGE_ENABLED=true in .env.');
  const platforms = new Map(loadPlatformRegistry(config).map((platform) => [platform.id, platform]));
  const explorer = new QWebBridgeAdapterExplorer(config, config.qwebBridgeUrl);

  if (command === 'status') {
    process.stdout.write(`${JSON.stringify(await explorer.status(), null, 2)}\n`);
    return;
  }

  const platformId = option(argv, '--platform') as PlatformId | undefined;
  if (!platformId) usage();
  const platform = platforms.get(platformId);
  if (!platform) throw new Error(`unknown platform: ${platformId}`);

  if (command === 'capture') {
    const stage = option(argv, '--stage') || 'entry';
    let recordingId = option(argv, '--recording');
    if (!recordingId) recordingId = (await explorer.start(platform)).recordingId;
    const manifest = await explorer.capture(platform, recordingId, stage);
    process.stdout.write(`${JSON.stringify({ recordingId: manifest.recordingId, status: manifest.status, fixturePath: manifest.fixturePath, stages: manifest.stages.map((item) => item.stage) }, null, 2)}\n`);
    return;
  }

  if (command === 'probe') {
    const recordingId = option(argv, '--recording');
    const query = option(argv, '--query');
    if (!recordingId || !query || !has(argv, '--allow-search-probe')) usage();
    if (platform.accessMode === 'manual-login' && !has(argv, '--confirm-authorized-session')) {
      throw new Error('manual-login probe requires --confirm-authorized-session after the account holder has confirmed the active real-Chrome session is lawful and ready');
    }
    const manifest = await explorer.probeSearch(platform, recordingId, query);
    process.stdout.write(`${JSON.stringify({ recordingId: manifest.recordingId, status: manifest.status, fixturePath: manifest.fixturePath, stages: manifest.stages.map((item) => item.stage), blockedReason: manifest.blockedReason }, null, 2)}\n`);
    return;
  }

  usage();
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
