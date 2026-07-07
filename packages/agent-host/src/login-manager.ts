import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { relative, resolve, join } from 'node:path';
import { chromium, type BrowserContext } from 'playwright';
import type { HostConfig } from './config.js';
import type { LoginSession, PlatformAdapterConfig, PlatformId, PlatformProfileStatus } from './domain.js';

interface ActiveLogin extends LoginSession {
  context: BrowserContext;
  previousStatus: PlatformProfileStatus;
}

export class LoginManager {
  private readonly active = new Map<string, ActiveLogin>();

  constructor(private readonly config: HostConfig) {}

  profileDir(platformId: PlatformId): string {
    return resolve(this.config.profilesDir, platformId, 'default');
  }

  private assertProfilePath(path: string): void {
    const root = resolve(this.config.profilesDir);
    const candidate = resolve(path);
    const inside = relative(root, candidate);
    if (inside.startsWith('..') || inside === '') throw new Error('refusing to operate outside an isolated platform profile directory');
  }

  async open(platform: PlatformAdapterConfig, previousStatus: PlatformProfileStatus): Promise<LoginSession> {
    if (platform.accessMode === 'public') throw new Error(`${platform.name} is public and does not require an account login profile`);
    const existing = [...this.active.values()].find((session) => session.platformId === platform.id);
    if (existing) return { id: existing.id, platformId: existing.platformId, entryUrl: existing.entryUrl, startedAt: existing.startedAt };

    const profileDir = this.profileDir(platform.id);
    this.assertProfilePath(profileDir);
    await mkdir(profileDir, { recursive: true });
    const context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      executablePath: this.config.chromiumPath,
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
    });
    const page = context.pages()[0] || await context.newPage();
    await page.goto(platform.entryUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.bringToFront();

    const session: ActiveLogin = {
      id: randomUUID(),
      platformId: platform.id,
      entryUrl: platform.entryUrl,
      startedAt: new Date().toISOString(),
      previousStatus,
      context,
    };
    this.active.set(session.id, session);
    return { id: session.id, platformId: session.platformId, entryUrl: session.entryUrl, startedAt: session.startedAt };
  }

  async complete(sessionId: string): Promise<LoginSession> {
    const active = this.active.get(sessionId);
    if (!active) throw new Error('interactive login session not found or already closed');
    await active.context.close();
    this.active.delete(sessionId);
    return { id: active.id, platformId: active.platformId, entryUrl: active.entryUrl, startedAt: active.startedAt };
  }

  async cancel(sessionId: string): Promise<{ session: LoginSession; previousStatus: PlatformProfileStatus } | undefined> {
    const active = this.active.get(sessionId);
    if (!active) return undefined;
    await active.context.close().catch(() => undefined);
    this.active.delete(sessionId);
    return {
      session: { id: active.id, platformId: active.platformId, entryUrl: active.entryUrl, startedAt: active.startedAt },
      previousStatus: active.previousStatus,
    };
  }

  async clear(platformId: PlatformId): Promise<void> {
    for (const active of this.active.values()) {
      if (active.platformId === platformId) await this.cancel(active.id);
    }
    const profileDir = this.profileDir(platformId);
    this.assertProfilePath(profileDir);
    await rm(profileDir, { recursive: true, force: true });
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.active.keys()].map((sessionId) => this.cancel(sessionId)));
  }
}
