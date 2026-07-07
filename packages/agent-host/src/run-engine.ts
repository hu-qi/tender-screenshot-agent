import { join } from 'node:path';
import { Agent } from '@earendil-works/pi-agent-core';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { BrowserEvidenceTool } from './browser.js';
import type { HostConfig } from './config.js';
import type { PlatformAdapterConfig, PlatformOutcome, TenderRun, TenderTask } from './domain.js';
import { RunEvents } from './events.js';
import { MacOSKeychainStore, WECOM_BOT_ID, WECOM_BOT_SECRET } from './keychain.js';
import { ModelProfileRuntime, type ResolvedModelProfile } from './model-profile.js';
import { AccessPolicy } from './policy.js';
import { TenderStore } from './store.js';
import { createSearchPlatformTool } from './tools.js';
import { sendWeComMarkdown } from './wecom.js';

type RequestedPair = { platformId: string; query: string };

export class RunEngine {
  private readonly policy = new AccessPolicy();
  private readonly keychain = new MacOSKeychainStore();
  private readonly modelRuntime: ModelProfileRuntime;

  constructor(
    private readonly config: HostConfig,
    private readonly store: TenderStore,
    private readonly events: RunEvents,
    private readonly browser: BrowserEvidenceTool,
    private readonly platforms: Map<string, PlatformAdapterConfig>,
  ) {
    this.modelRuntime = new ModelProfileRuntime(store);
  }

  async start(taskId: string): Promise<TenderRun> {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error(`task not found: ${taskId}`);
    if (task.status === 'running') throw new Error(`task is already running: ${taskId}`);
    const run = this.store.createRun(task.id);
    this.store.setTaskStatus(task.id, 'running');
    void this.execute(task, run);
    return run;
  }

  private hasAuthorizedProfile(platform: PlatformAdapterConfig): boolean {
    if (platform.accessMode === 'public') return true;
    const profileDir = join(this.config.profilesDir, platform.id, 'default');
    return this.store.getPlatformProfile(platform.id, profileDir).status === 'user-confirmed';
  }

  private requestedPairs(task: TenderTask): RequestedPair[] {
    return task.queries.flatMap((query) => task.platformIds.map((platformId) => ({ platformId, query })));
  }

  private async execute(task: TenderTask, run: TenderRun): Promise<void> {
    const outcomes: PlatformOutcome[] = [];
    this.events.emit(run.id, 'run.started', 'info', { taskId: task.id, correlationId: run.correlationId });
    try {
      const tool = createSearchPlatformTool({ runId: run.id, correlationId: run.correlationId, platforms: this.platforms, browser: this.browser, events: this.events });
      const model = await this.modelRuntime.resolve();
      if (model?.config.mode === 'orchestrate') {
        this.events.emit(run.id, 'model.profile.enabled', 'info', {
          profile: model.config.profile,
          provider: model.config.provider,
          model: model.config.model,
          dataPolicy: model.config.dataPolicy,
          egressPolicy: model.config.egressPolicy,
          correlationId: run.correlationId,
        });
        outcomes.push(...await this.executeWithPi(task, run, tool, model));
      } else {
        outcomes.push(...await this.executeDeterministically(task, run, tool));
      }
      const summary = {
        successful: outcomes.filter((item) => item.status === 'success' || item.status === 'no-result').length,
        manualReview: outcomes.filter((item) => item.status === 'manual-review-required').length,
        failed: outcomes.filter((item) => item.status === 'failed').length,
        artifacts: outcomes.reduce((total, item) => total + item.artifacts.length, 0),
      };
      const status = summary.failed > 0 ? (summary.successful > 0 || summary.manualReview > 0 ? 'partial-success' : 'failed') : summary.manualReview > 0 ? 'manual-review-required' : 'completed';
      this.store.finishRun(run.id, status, summary);
      this.store.setTaskStatus(task.id, status);
      this.events.emit(run.id, 'run.completed', status === 'failed' ? 'error' : status === 'manual-review-required' ? 'warn' : 'info', { status, summary, correlationId: run.correlationId });
      await this.notifyTerminalState(task, run, status, summary);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const summary = { successful: 0, manualReview: 0, failed: 1, artifacts: this.store.listArtifacts(run.id).length };
      this.store.finishRun(run.id, 'failed', summary);
      this.store.setTaskStatus(task.id, 'failed');
      this.events.emit(run.id, 'run.failed', 'error', { reason, correlationId: run.correlationId });
    }
  }

  private async executeDeterministically(task: TenderTask, run: TenderRun, tool: AgentTool<any>): Promise<PlatformOutcome[]> {
    return this.executePairs(task, run, tool, this.requestedPairs(task));
  }

  private async executePairs(task: TenderTask, run: TenderRun, tool: AgentTool<any>, pairs: RequestedPair[]): Promise<PlatformOutcome[]> {
    const outcomes: PlatformOutcome[] = [];
    for (const { query, platformId } of pairs) {
      const platform = this.platforms.get(platformId);
      if (!platform) continue;
      const allowed = this.policy.canSearch(platform, { privacyMode: task.privacyMode, hasAuthorizedProfile: this.hasAuthorizedProfile(platform) });
      if (!allowed.allow) {
        const outcome: PlatformOutcome = { platformId, status: 'manual-review-required', reason: allowed.reason, artifacts: [] };
        outcomes.push(outcome);
        this.events.emit(run.id, 'policy.tool.blocked', 'warn', { tool: tool.name, platformId, reason: allowed.reason, correlationId: run.correlationId });
        continue;
      }
      outcomes.push((await tool.execute(`${run.id}:${platformId}:${query}`, { platformId, query })).details as PlatformOutcome);
    }
    return outcomes;
  }

  private async executeWithPi(task: TenderTask, run: TenderRun, tool: AgentTool<any>, modelProfile: ResolvedModelProfile): Promise<PlatformOutcome[]> {
    const outcomes: PlatformOutcome[] = [];
    const pairs = this.requestedPairs(task);
    const serializedPairs = JSON.stringify(pairs);
    if (serializedPairs.length > modelProfile.config.maxInputChars) {
      this.events.emit(run.id, 'model.input.limit_reached', 'warn', {
        metadataChars: serializedPairs.length,
        maxInputChars: modelProfile.config.maxInputChars,
        correlationId: run.correlationId,
      });
      return this.executePairs(task, run, tool, pairs);
    }
    const allowedPairs = new Set(pairs.map((pair) => `${pair.platformId}\u0000${pair.query}`));
    const startedPairs = new Set<string>();
    const completedPairs = new Set<string>();
    let modelTurns = 0;
    const agent = new Agent({
      initialState: {
        systemPrompt: [
          'You orchestrate lawful tender evidence collection.',
          'Call search_platform only for the requested platform/query pairs.',
          'You receive metadata and tool summaries only; never request screenshots, HTML, PDFs, browser profiles, cookies, credentials, or local paths.',
          'Never bypass login, CAPTCHA, SMS, QR, CA, or UKey controls.',
        ].join(' '),
        model: modelProfile.model,
        tools: [tool],
        messages: [],
      },
      streamFn: (model, context, options) => modelProfile.models.streamSimple(model, context, options),
      toolExecution: 'sequential',
      beforeToolCall: async ({ args }) => {
        const input = args as { platformId?: string; query?: string };
        const key = `${input.platformId || ''}\u0000${input.query || ''}`;
        if (!allowedPairs.has(key)) return { block: true, reason: 'pair is outside the user-requested execution set' };
        if (startedPairs.has(key)) return { block: true, reason: 'pair was already requested in this run' };
        const platform = this.platforms.get(input.platformId || '');
        if (!platform) return { block: true, reason: 'unknown platform' };
        const allowed = this.policy.canSearch(platform, { privacyMode: task.privacyMode, hasAuthorizedProfile: this.hasAuthorizedProfile(platform) });
        if (!allowed.allow) return { block: true, reason: allowed.reason };
        startedPairs.add(key);
        return undefined;
      },
      afterToolCall: async ({ args, result }) => {
        const input = args as { platformId?: string; query?: string };
        completedPairs.add(`${input.platformId || ''}\u0000${input.query || ''}`);
        const outcome = result.details as PlatformOutcome | undefined;
        if (outcome?.platformId) outcomes.push(outcome);
        return undefined;
      },
    });
    agent.subscribe(async (event) => {
      if (event.type === 'turn_start') {
        modelTurns += 1;
        if (modelTurns > modelProfile.config.maxRequestsPerRun) {
          this.events.emit(run.id, 'model.request.limit_reached', 'warn', { maxRequestsPerRun: modelProfile.config.maxRequestsPerRun, correlationId: run.correlationId });
          agent.abort();
          return;
        }
      }
      this.events.emit(run.id, `pi.${event.type}`, 'info', { correlationId: run.correlationId });
    });

    try {
      await agent.prompt(`Collect evidence for exactly these pairs: ${serializedPairs}. Do not make any other browser request.`);
    } catch (error) {
      this.events.emit(run.id, 'model.orchestration.failed', 'warn', { reason: error instanceof Error ? error.message : String(error), correlationId: run.correlationId });
    }

    const missing = pairs.filter((pair) => !completedPairs.has(`${pair.platformId}\u0000${pair.query}`));
    if (missing.length > 0) {
      this.events.emit(run.id, 'model.deterministic.fallback', 'warn', { missingPairs: missing.length, correlationId: run.correlationId });
      outcomes.push(...await this.executePairs(task, run, tool, missing));
    }
    return outcomes;
  }

  private async notifyTerminalState(task: TenderTask, run: TenderRun, status: string, summary: Record<string, number>): Promise<void> {
    const setting = this.store.getPublicSetting<{ enabled: boolean; targetIds: string[]; websocketUrl?: string }>('wecom');
    if (!setting?.value.enabled || task.privacyMode === 'strict-local') return;
    const [botId, botSecret] = await Promise.all([this.keychain.get(WECOM_BOT_ID), this.keychain.get(WECOM_BOT_SECRET)]);
    if (!botId || !botSecret) {
      this.events.emit(run.id, 'notification.skipped', 'warn', { reason: 'wecom credential missing', correlationId: run.correlationId });
      return;
    }
    const markdown = `**标讯截图助手**\n任务：${task.name}\n状态：${status}\n成功：${summary.successful}\n人工复核：${summary.manualReview}\n失败：${summary.failed}`;
    const allowed = this.policy.canSendNotification(task.privacyMode, markdown);
    if (!allowed.allow) {
      this.events.emit(run.id, 'policy.notification.blocked', 'warn', { reason: allowed.reason, correlationId: run.correlationId });
      return;
    }
    const result = await sendWeComMarkdown({ botId, botSecret, targetIds: setting.value.targetIds, websocketUrl: setting.value.websocketUrl, markdown });
    this.events.emit(run.id, 'notification.sent', 'info', { delivered: result.delivered, rejected: result.rejected, correlationId: run.correlationId });
  }
}
