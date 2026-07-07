import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium, type BrowserContext } from 'playwright';
import type { HostConfig } from './config.js';

const require = createRequire(import.meta.url);
type PersistentContextOptions = NonNullable<Parameters<typeof chromium.launchPersistentContext>[1]>;

export type BrowserRuntimeSource = 'configured' | 'playwright' | 'system-chrome' | 'missing';

export interface BrowserRuntimeStatus {
  ready: boolean;
  source: BrowserRuntimeSource;
  executablePath?: string;
  expectedPlaywrightPath: string;
  configuredPath?: string;
  installCommand: string;
  message: string;
}

export class BrowserRuntimeError extends Error {
  readonly code = 'browser-runtime-missing';

  constructor(readonly status: BrowserRuntimeStatus) {
    super(status.message);
    this.name = 'BrowserRuntimeError';
  }
}

function macOSChromeCandidates(): string[] {
  if (process.platform !== 'darwin') return [];
  return [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ];
}

export class BrowserRuntimeManager {
  private installPromise?: Promise<BrowserRuntimeStatus>;

  constructor(private readonly config: HostConfig) {}

  status(): BrowserRuntimeStatus {
    const expectedPlaywrightPath = chromium.executablePath();
    const installCommand = 'npm run playwright:install';
    const configuredPath = this.config.chromiumPath;

    if (configuredPath) {
      if (existsSync(configuredPath)) {
        return {
          ready: true,
          source: 'configured',
          executablePath: configuredPath,
          configuredPath,
          expectedPlaywrightPath,
          installCommand,
          message: 'Using the Chromium executable configured in TENDER_PLAYWRIGHT_CHROMIUM_PATH.',
        };
      }
      return {
        ready: false,
        source: 'missing',
        configuredPath,
        expectedPlaywrightPath,
        installCommand,
        message: 'Configured TENDER_PLAYWRIGHT_CHROMIUM_PATH does not exist. Correct the path or clear it, then install Playwright Chromium.',
      };
    }

    if (existsSync(expectedPlaywrightPath)) {
      return {
        ready: true,
        source: 'playwright',
        executablePath: expectedPlaywrightPath,
        expectedPlaywrightPath,
        installCommand,
        message: 'Playwright Chromium is installed and ready.',
      };
    }

    const systemChrome = macOSChromeCandidates().find((candidate) => existsSync(candidate));
    if (systemChrome) {
      return {
        ready: true,
        source: 'system-chrome',
        executablePath: systemChrome,
        expectedPlaywrightPath,
        installCommand,
        message: 'Playwright Chromium is not installed; using a local system Chrome-compatible browser.',
      };
    }

    return {
      ready: false,
      source: 'missing',
      expectedPlaywrightPath,
      installCommand,
      message: 'Browser runtime is missing. Install Playwright Chromium from the desktop application or run `npm run playwright:install` in the project root.',
    };
  }

  requireReady(): BrowserRuntimeStatus {
    const status = this.status();
    if (!status.ready) throw new BrowserRuntimeError(status);
    return status;
  }

  async launchPersistentContext(userDataDir: string, options: Omit<PersistentContextOptions, 'executablePath'>): Promise<BrowserContext> {
    const runtime = this.requireReady();
    return chromium.launchPersistentContext(userDataDir, {
      ...options,
      ...(runtime.source === 'playwright' ? {} : { executablePath: runtime.executablePath }),
    });
  }

  async installChromium(): Promise<BrowserRuntimeStatus> {
    const current = this.status();
    if (current.ready && current.source === 'playwright') return current;
    if (this.config.chromiumPath) throw new BrowserRuntimeError(current);
    if (this.installPromise) return this.installPromise;

    const installation = new Promise<BrowserRuntimeStatus>((resolve, reject) => {
      let cliPath: string;
      try {
        cliPath = require.resolve('playwright/cli');
      } catch {
        reject(new Error('Playwright CLI is unavailable. Run `npm install` in the project root and retry.'));
        return;
      }
      const child = spawn(process.execPath, [cliPath, 'install', 'chromium'], {
        cwd: process.cwd(),
        env: { ...process.env },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
      child.once('error', () => reject(new Error('Unable to start Playwright browser installation. Check Node.js and local project dependencies.')));
      child.once('close', (code) => {
        if (code !== 0) {
          const hint = /proxy|certificate|econn|network|enotfound|timeout/i.test(stderr)
            ? ' Check network, proxy, or certificate settings and retry.'
            : '';
          reject(new Error(`Playwright Chromium installation failed.${hint} You can also run \`npm run playwright:install\` in the project root.`));
          return;
        }
        const next = this.status();
        if (!next.ready) {
          reject(new Error('Playwright reported a successful installation but no usable Chromium executable was found. Restart the desktop application and retry.'));
          return;
        }
        resolve(next);
      });
    }).finally(() => { this.installPromise = undefined; });

    this.installPromise = installation;
    return installation;
  }
}
