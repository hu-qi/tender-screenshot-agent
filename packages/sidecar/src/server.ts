import { chromium } from 'playwright';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { getPlatform } from './platforms.js';

type Rpc = { id: string | number; method: string; params?: Record<string, unknown> };
type LogLevel = 'error' | 'warn' | 'info' | 'debug';

function loadDotEnv(): void {
  const file = process.env.TENDER_ENV_FILE || join(process.cwd(), '.env');
  if (!existsSync(file)) return;

  for (const sourceLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || process.env[key] !== undefined) continue;
    const raw = line.slice(separator + 1).trim();
    const value = raw.replace(/^(['"])(.*)\1$/, '$2');
    process.env[key] = value;
  }
}

loadDotEnv();

const levelOrder: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };
const configuredLevel = (process.env.TENDER_SIDECAR_LOG_LEVEL || 'info').toLowerCase() as LogLevel;
const activeLevel: LogLevel = configuredLevel in levelOrder ? configuredLevel : 'info';
const browserTimeoutMs = Number.parseInt(process.env.TENDER_BROWSER_TIMEOUT_MS || '45000', 10) || 45000;
const evidenceRoot = process.env.TENDER_DATA_DIR ? resolve(process.env.TENDER_DATA_DIR) : resolve(process.cwd(), 'evidence');

function redact(message: string): string {
  return message
    .replace(/(Bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/\b(authorization|api[_-]?key|token|cookie|webhook)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]');
}

function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  if (levelOrder[level] > levelOrder[activeLevel]) return;
  process.stderr.write(`${JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    component: 'playwright-sidecar',
    event,
    ...fields,
  })}\n`);
}

const send = (id: string | number | null, result?: unknown, error?: unknown): void => {
  process.stdout.write(`${JSON.stringify(error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result })}\n`);
};

const first = async (page: any, selectors: string[]) => {
  for (const selector of selectors) {
    const candidate = page.locator(selector).first();
    if (await candidate.count().catch(() => 0)) return candidate;
  }
  return null;
};

async function artifact(path: string, bytes: Buffer | string) {
  await writeFile(path, bytes);
  return { path, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function outputDirectory(params: Record<string, unknown>, platformId: string): string {
  const supplied = typeof params.outputDir === 'string' ? params.outputDir.trim() : '';
  return supplied ? resolve(supplied) : join(evidenceRoot, platformId, randomUUID());
}

async function runSearch(params: Record<string, unknown>) {
  const platformId = String(params.platformId || '');
  const platform = getPlatform(platformId);
  const profileDir = typeof params.profileDir === 'string' ? params.profileDir.trim() : '';
  if (!profileDir) throw new Error('profileDir is required; each authorized account must use an isolated local profile');

  const out = outputDirectory(params, platform.id);
  const interactive = params.interactive === true;
  const query = typeof params.query === 'string' ? params.query : '';
  const timeoutMs = typeof params.timeoutMs === 'number' ? params.timeoutMs : browserTimeoutMs;
  await mkdir(out, { recursive: true });

  log('info', 'browser_launch_requested', { platformId: platform.id, interactive, outputDir: out });
  const context = await chromium.launchPersistentContext(resolve(profileDir), {
    headless: !interactive,
    executablePath: process.env.TENDER_PLAYWRIGHT_CHROMIUM_PATH || undefined,
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });

  const page = await context.newPage();
  try {
    await page.goto(platform.url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    const title = await page.title();
    await page.screenshot({ path: join(out, 'landing.png'), fullPage: true });
    log('info', 'landing_page_captured', { platformId: platform.id, title });

    if (interactive) {
      return { status: 'interactive-login-opened', platform: platform.id, title, outputDir: out };
    }

    const input = await first(page, platform.selectors.search);
    if (!input) {
      return {
        status: 'manual-review-required',
        reason: 'search_selector_missing',
        platform: platform.id,
        landingScreenshot: join(out, 'landing.png'),
      };
    }

    await input.fill(query);
    await input.press('Enter');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(out, 'results.png'), fullPage: true });

    const body = await page.locator('body').innerText();
    const html = await page.content();
    const text = await artifact(join(out, 'results.txt'), body);
    const source = await artifact(join(out, 'results.html'), html);
    const result = await first(page, platform.selectors.result);
    if (!result) return { status: 'no-result', platform: platform.id, artifacts: [text, source] };

    const href = await result.getAttribute('href');
    if (href) {
      await page.goto(new URL(href, platform.url).toString(), { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    }

    await page.screenshot({ path: join(out, 'detail.png'), fullPage: true });
    await page.pdf({ path: join(out, 'detail.pdf'), format: 'A4', printBackground: true }).catch(() => undefined);
    const detail = await artifact(join(out, 'detail.txt'), await page.locator('body').innerText());
    log('info', 'search_completed', { platformId: platform.id, artifactCount: 3 });

    return {
      status: 'success',
      platform: platform.id,
      title,
      artifacts: [text, source, detail],
      screenshots: [join(out, 'landing.png'), join(out, 'results.png'), join(out, 'detail.png')],
    };
  } catch (error: unknown) {
    const reason = redact(error instanceof Error ? error.message : String(error));
    await page.screenshot({ path: join(out, 'failure.png'), fullPage: true }).catch(() => undefined);
    log('error', 'search_failed', { platformId: platform.id, reason });
    return { status: 'manual-review-required', platform: platform.id, reason, failureScreenshot: join(out, 'failure.png') };
  } finally {
    await context.close();
  }
}

async function handle(request: Rpc) {
  if (request.method === 'system.ping') {
    return { ok: true, protocol: 'ndjson-json-rpc', pid: process.pid, logLevel: activeLevel };
  }
  if (request.method === 'platform.healthCheck') {
    const platform = getPlatform(String(request.params?.platformId || ''));
    return { platform: platform.id, url: platform.url, loginMode: platform.loginMode };
  }
  if (request.method === 'platform.openLogin') return runSearch({ ...request.params, interactive: true, query: '' });
  if (request.method === 'platform.searchAndCapture') return runSearch({ ...request.params, interactive: false });
  throw new Error(`unsupported method ${request.method}`);
}

createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', async (line) => {
  try {
    const request = JSON.parse(line) as Rpc;
    send(request.id, await handle(request));
  } catch (error: unknown) {
    const message = redact(error instanceof Error ? error.message : String(error));
    log('error', 'rpc_failed', { message });
    send(null, undefined, { code: -32000, message });
  }
});
