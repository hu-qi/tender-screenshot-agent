import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { ArtifactRecord, PlatformAdapterConfig, PlatformOutcome } from './domain.js';
import type { HostConfig } from './config.js';
import { TenderStore } from './store.js';

const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

export class BrowserEvidenceTool {
  constructor(
    private readonly config: HostConfig,
    private readonly store: TenderStore,
  ) {}

  private profileDir(platformId: string): string {
    return join(this.config.profilesDir, platformId, 'default');
  }

  private async writeArtifact(
    runId: string,
    platformId: PlatformOutcome['platformId'],
    kind: ArtifactRecord['kind'],
    absolutePath: string,
    content?: Buffer | string,
  ): Promise<ArtifactRecord> {
    if (content !== undefined) await writeFile(absolutePath, content);
    const buffer = content === undefined ? await import('node:fs/promises').then(({ readFile }) => readFile(absolutePath)) : Buffer.from(content);
    return this.store.addArtifact({
      runId,
      platformId,
      kind,
      relativePath: relative(this.config.dataDir, absolutePath),
      sha256: sha256(buffer),
    });
  }

  async execute(input: {
    runId: string;
    platform: PlatformAdapterConfig;
    query: string;
    correlationId: string;
    onProgress: (event: string, level: 'info' | 'warn' | 'error', payload: Record<string, unknown>) => void;
  }): Promise<PlatformOutcome> {
    const { platform, runId, query, onProgress } = input;
    const outputDir = resolve(this.config.evidenceDir, runId, platform.id);
    await mkdir(outputDir, { recursive: true });
    const profileDir = this.profileDir(platform.id);
    await mkdir(profileDir, { recursive: true });
    const hasProfile = existsSync(join(profileDir, 'Default')) || existsSync(join(profileDir, 'Local State'));
    onProgress('browser.launch.requested', 'info', { platformId: platform.id, hasProfile });

    const context = await chromium.launchPersistentContext(profileDir, {
      headless: true,
      executablePath: this.config.chromiumPath,
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
    });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    const artifacts: ArtifactRecord[] = [];
    const page = await context.newPage();

    try {
      await page.goto(platform.entryUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      const landingPath = join(outputDir, 'landing.png');
      await page.screenshot({ path: landingPath, fullPage: true });
      artifacts.push(await this.writeArtifact(runId, platform.id, 'landing-screenshot', landingPath));
      const htmlPath = join(outputDir, 'landing.html');
      artifacts.push(await this.writeArtifact(runId, platform.id, 'html', htmlPath, await page.content()));

      if (platform.adapterStatus !== 'verified') {
        const tracePath = join(outputDir, 'manual-review-trace.zip');
        await context.tracing.stop({ path: tracePath });
        artifacts.push(await this.writeArtifact(runId, platform.id, 'trace', tracePath));
        onProgress('browser.adapter.unverified', 'warn', { platformId: platform.id, query });
        return { platformId: platform.id, status: 'manual-review-required', reason: 'platform adapter selectors are not recorded and accepted yet', artifacts };
      }

      const searchInput = platform.selectors?.searchInput;
      const resultLink = platform.selectors?.resultLink;
      if (!searchInput || !resultLink) {
        return { platformId: platform.id, status: 'manual-review-required', reason: 'verified adapter is missing mandatory search/result selectors', artifacts };
      }

      await page.locator(searchInput).fill(query);
      if (platform.selectors?.searchSubmit) await page.locator(platform.selectors.searchSubmit).click();
      else await page.locator(searchInput).press('Enter');
      await page.waitForTimeout(1200);
      const resultPath = join(outputDir, 'results.png');
      await page.screenshot({ path: resultPath, fullPage: true });
      artifacts.push(await this.writeArtifact(runId, platform.id, 'result-screenshot', resultPath));
      const firstResult = page.locator(resultLink).first();
      if (await firstResult.count() === 0) return { platformId: platform.id, status: 'no-result', artifacts };
      const href = await firstResult.getAttribute('href');
      if (href) await page.goto(new URL(href, platform.entryUrl).toString(), { waitUntil: 'domcontentloaded', timeout: 45_000 });
      const detailPath = join(outputDir, 'detail.png');
      await page.screenshot({ path: detailPath, fullPage: true });
      artifacts.push(await this.writeArtifact(runId, platform.id, 'detail-screenshot', detailPath));
      const textPath = join(outputDir, 'detail.txt');
      artifacts.push(await this.writeArtifact(runId, platform.id, 'text', textPath, await page.locator(platform.selectors?.detailBody || 'body').innerText()));
      const pdfPath = join(outputDir, 'detail.pdf');
      await page.pdf({ path: pdfPath, format: 'A4', printBackground: true });
      artifacts.push(await this.writeArtifact(runId, platform.id, 'pdf', pdfPath));
      await context.tracing.stop();
      onProgress('browser.capture.completed', 'info', { platformId: platform.id, artifactCount: artifacts.length });
      return { platformId: platform.id, status: 'success', artifacts };
    } catch (error) {
      const failurePath = join(outputDir, 'failure.png');
      await page.screenshot({ path: failurePath, fullPage: true }).catch(() => undefined);
      if (existsSync(failurePath)) artifacts.push(await this.writeArtifact(runId, platform.id, 'failure-screenshot', failurePath));
      const tracePath = join(outputDir, 'failure-trace.zip');
      await context.tracing.stop({ path: tracePath }).catch(() => undefined);
      if (existsSync(tracePath)) artifacts.push(await this.writeArtifact(runId, platform.id, 'trace', tracePath));
      const reason = error instanceof Error ? error.message : String(error);
      onProgress('browser.capture.failed', 'error', { platformId: platform.id, reason });
      return { platformId: platform.id, status: 'failed', reason, artifacts };
    } finally {
      await context.close();
    }
  }
}
