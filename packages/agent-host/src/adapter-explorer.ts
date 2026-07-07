import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { HostConfig } from './config.js';
import type { PlatformAdapterConfig, PlatformId } from './domain.js';
import { QWebBridgeClient, type QWebBridgeDiscovery, type SnapshotNode } from './qwebbridge.js';

export type RecordingStage = 'entry' | 'authenticated' | 'search-hit' | 'no-result' | 'page-2' | 'detail' | 'manual-boundary';

export interface CandidateLocator {
  selector?: string;
  tag?: string;
  role?: string;
  name?: string;
  ariaLabel?: string;
  placeholder?: string;
  text?: string;
  matches?: number;
  visible?: boolean;
  confidence: number;
  reason: string;
}

export interface RecordingStageArtifact {
  stage: RecordingStage;
  capturedAt: string;
  url: string;
  title: string;
  screenshot?: string;
  snapshotPath: string;
  discoveryPath: string;
  networkPath?: string;
  manualBoundaries: string[];
}

export interface AdapterCandidateFixture {
  schemaVersion: 1;
  status: 'candidate';
  source: 'qwebbridge';
  platformId: PlatformId;
  platformName: string;
  entryUrl: string;
  recordingId: string;
  generatedAt: string;
  accessMode: PlatformAdapterConfig['accessMode'];
  selectors: {
    searchInput?: CandidateLocator;
    searchSubmit?: CandidateLocator;
    resultLink?: CandidateLocator;
    detailBody?: CandidateLocator;
  };
  pagination: CandidateLocator[];
  manualBoundaries: string[];
  requiredAcceptance: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'];
  notice: string;
}

export interface AdapterRecordingManifest {
  recordingId: string;
  platformId: PlatformId;
  platformName: string;
  driver: 'qwebbridge';
  qwebBridgeEndpoint: string;
  status: 'recording' | 'candidate' | 'blocked';
  startedAt: string;
  updatedAt: string;
  stages: RecordingStageArtifact[];
  fixturePath?: string;
  blockedReason?: string;
}

const ALL_STAGES = new Set<RecordingStage>(['entry', 'authenticated', 'search-hit', 'no-result', 'page-2', 'detail', 'manual-boundary']);
const SEARCH_WORDS = /搜索|查询|检索|查找|项目|公告|招标|编号|名称|关键字|search|query|find/i;
const SUBMIT_WORDS = /搜索|查询|检索|查找|search|query|find/i;
const DETAIL_WORDS = /公告|项目|采购|招标|中标|详情|通知|结果/i;
const BOUNDARY_BLOCKERS = new Set(['captcha', 'sms-otp', 'qr-login', 'ca-ukey', 'native-signer', 'session-expired']);

function now(): string { return new Date().toISOString(); }

function stageAssert(stage: string): asserts stage is RecordingStage {
  if (!ALL_STAGES.has(stage as RecordingStage)) throw new Error(`unsupported recording stage: ${stage}`);
}

function samePlatformDomain(entryUrl: string, actualUrl: string): boolean {
  try {
    const expected = new URL(entryUrl).hostname.toLowerCase();
    const actual = new URL(actualUrl).hostname.toLowerCase();
    return actual === expected || actual.endsWith(`.${expected}`) || expected.endsWith(`.${actual}`);
  } catch {
    return false;
  }
}

function score(candidate: Record<string, unknown>, intent: 'input' | 'submit' | 'detail' | 'pagination'): number {
  const text = [candidate.name, candidate.ariaLabel, candidate.placeholder, candidate.text].filter((item) => typeof item === 'string').join(' ');
  const matches = Number(candidate.matches ?? 99);
  const visible = candidate.visible === true;
  let value = visible ? 0.3 : 0;
  if (matches === 1) value += 0.35;
  if (candidate.selector) value += 0.15;
  if (intent === 'input' && SEARCH_WORDS.test(text)) value += 0.25;
  if (intent === 'submit' && SUBMIT_WORDS.test(text)) value += 0.25;
  if (intent === 'detail' && DETAIL_WORDS.test(text)) value += 0.2;
  if (intent === 'pagination' && /下一页|下页|next|上一页|上页|prev|page/i.test(text)) value += 0.2;
  return Math.min(1, Number(value.toFixed(2)));
}

function locator(candidate: Record<string, unknown>, intent: 'input' | 'submit' | 'detail' | 'pagination'): CandidateLocator {
  return {
    ...(typeof candidate.selector === 'string' ? { selector: candidate.selector } : {}),
    ...(typeof candidate.tag === 'string' ? { tag: candidate.tag } : {}),
    ...(typeof candidate.role === 'string' ? { role: candidate.role } : {}),
    ...(typeof candidate.name === 'string' ? { name: candidate.name } : {}),
    ...(typeof candidate.ariaLabel === 'string' ? { ariaLabel: candidate.ariaLabel } : {}),
    ...(typeof candidate.placeholder === 'string' ? { placeholder: candidate.placeholder } : {}),
    ...(typeof candidate.text === 'string' ? { text: candidate.text } : {}),
    ...(typeof candidate.matches === 'number' ? { matches: candidate.matches } : {}),
    ...(typeof candidate.visible === 'boolean' ? { visible: candidate.visible } : {}),
    confidence: score(candidate, intent),
    reason: `qwebbridge-${intent}-heuristic`,
  };
}

function choose(values: Array<Record<string, unknown>>, intent: 'input' | 'submit' | 'detail' | 'pagination'): CandidateLocator | undefined {
  const ranked = values.map((value) => locator(value, intent)).filter((value) => value.selector && value.visible).sort((a, b) => b.confidence - a.confidence);
  return ranked[0];
}

function fixtureFrom(manifest: AdapterRecordingManifest, platform: PlatformAdapterConfig, discovery: QWebBridgeDiscovery): AdapterCandidateFixture {
  return {
    schemaVersion: 1,
    status: 'candidate',
    source: 'qwebbridge',
    platformId: platform.id,
    platformName: platform.name,
    entryUrl: platform.entryUrl,
    recordingId: manifest.recordingId,
    generatedAt: now(),
    accessMode: platform.accessMode,
    selectors: {
      searchInput: choose(discovery.inputs, 'input'),
      searchSubmit: choose(discovery.buttons, 'submit'),
      resultLink: choose(discovery.links, 'detail'),
    },
    pagination: discovery.pagination.map((item) => locator(item, 'pagination')).filter((item) => item.selector),
    manualBoundaries: [...new Set(manifest.stages.flatMap((stage) => stage.manualBoundaries))],
    requiredAcceptance: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'],
    notice: 'Candidate generated from a live QWebBridge session. It must be replayed with Playwright and explicitly approved before any production registry can become verified.',
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function manifestPath(root: string): string { return join(root, 'manifest.json'); }

export class QWebBridgeAdapterExplorer {
  private readonly client: QWebBridgeClient;

  constructor(private readonly config: HostConfig, endpoint: string) {
    this.client = new QWebBridgeClient(endpoint);
  }

  async status() { return this.client.status(); }

  private recordingRoot(recordingId: string): string {
    return join(this.config.evidenceDir, 'recordings', recordingId);
  }

  async loadManifest(recordingId: string): Promise<AdapterRecordingManifest> {
    const path = manifestPath(this.recordingRoot(recordingId));
    if (!existsSync(path)) throw new Error(`recording not found: ${recordingId}`);
    return JSON.parse(await readFile(path, 'utf8')) as AdapterRecordingManifest;
  }

  private async saveManifest(root: string, manifest: AdapterRecordingManifest): Promise<void> {
    manifest.updatedAt = now();
    await writeJson(manifestPath(root), manifest);
  }

  async start(platform: PlatformAdapterConfig): Promise<AdapterRecordingManifest> {
    const recordingId = randomUUID();
    const root = this.recordingRoot(recordingId);
    const manifest: AdapterRecordingManifest = {
      recordingId,
      platformId: platform.id,
      platformName: platform.name,
      driver: 'qwebbridge',
      qwebBridgeEndpoint: this.client.baseUrl.toString(),
      status: 'recording',
      startedAt: now(),
      updatedAt: now(),
      stages: [],
    };
    await mkdir(root, { recursive: true });
    await this.saveManifest(root, manifest);
    return manifest;
  }

  async capture(platform: PlatformAdapterConfig, recordingId: string, stageValue: string): Promise<AdapterRecordingManifest> {
    stageAssert(stageValue);
    const root = this.recordingRoot(recordingId);
    const manifest = await this.loadManifest(recordingId);
    if (manifest.platformId !== platform.id) throw new Error('recording platform does not match requested platform');
    const stageDir = join(root, 'stages');
    const capturedAt = now();
    const [snapshot, discovery] = await Promise.all([this.client.snapshot(), this.client.discover()]);
    if (!samePlatformDomain(platform.entryUrl, discovery.url)) {
      throw new Error(`active QWebBridge tab is outside the platform domain: ${discovery.url}`);
    }
    const screenshot = await this.client.screenshot(join(stageDir, `${stageValue}.png`));
    const snapshotPath = join(stageDir, `${stageValue}.snapshot.json`);
    const discoveryPath = join(stageDir, `${stageValue}.discovery.json`);
    await Promise.all([writeJson(snapshotPath, snapshot as SnapshotNode[]), writeJson(discoveryPath, discovery)]);
    const stage: RecordingStageArtifact = {
      stage: stageValue,
      capturedAt,
      url: discovery.url,
      title: discovery.title,
      ...(screenshot ? { screenshot } : {}),
      snapshotPath,
      discoveryPath,
      manualBoundaries: discovery.manualBoundaries,
    };
    manifest.stages = [...manifest.stages.filter((item) => item.stage !== stageValue), stage];
    if (discovery.manualBoundaries.some((value) => BOUNDARY_BLOCKERS.has(value))) {
      manifest.status = 'blocked';
      manifest.blockedReason = `manual boundary detected: ${discovery.manualBoundaries.join(', ')}`;
    }
    const fixture = fixtureFrom(manifest, platform, discovery);
    const fixturePath = join(root, 'candidate-fixture.json');
    await writeJson(fixturePath, fixture);
    manifest.fixturePath = fixturePath;
    if (manifest.status !== 'blocked') manifest.status = 'candidate';
    await this.saveManifest(root, manifest);
    return manifest;
  }

  async probeSearch(platform: PlatformAdapterConfig, recordingId: string, query: string): Promise<AdapterRecordingManifest> {
    if (!query.trim()) throw new Error('a user-provided probe query is required');
    if (platform.accessMode === 'ca-login') throw new Error('CA/UKey platform search probes are manual-only');
    const manifest = await this.capture(platform, recordingId, 'entry');
    if (manifest.status === 'blocked') return manifest;
    const fixture = JSON.parse(await readFile(manifest.fixturePath!, 'utf8')) as AdapterCandidateFixture;
    const input = fixture.selectors.searchInput?.selector;
    const submit = fixture.selectors.searchSubmit?.selector;
    if (!input || !submit) throw new Error('exploration could not derive a unique search input and submit candidate; capture the page manually and choose locators before probing');
    await this.client.startNetwork();
    try {
      await this.client.fill(input, query.trim());
      await this.client.click(submit);
      const before = JSON.stringify(await this.client.snapshot());
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 750));
        const after = JSON.stringify(await this.client.snapshot());
        if (after !== before) break;
      }
      const next = await this.capture(platform, recordingId, 'search-hit');
      const root = this.recordingRoot(recordingId);
      const networkPath = join(root, 'stages', 'search-hit.network.json');
      const summary = await this.client.networkSummary();
      await writeJson(networkPath, summary);
      const latest = next.stages.find((item) => item.stage === 'search-hit');
      if (latest) latest.networkPath = networkPath;
      await this.saveManifest(root, next);
      return next;
    } finally {
      await this.client.stopNetwork().catch(() => undefined);
    }
  }
}
