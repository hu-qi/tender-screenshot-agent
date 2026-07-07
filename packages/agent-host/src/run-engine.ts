import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Agent } from '@earendil-works/pi-agent-core';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { BrowserEvidenceTool } from './browser.js';
import type { HostConfig } from './config.js';
import type { PlatformAdapterConfig, PlatformOutcome, TenderRun, TenderTask } from './domain.js';
import { RunEvents } from './events.js';
import { MacOSKeychainStore, WECOM_BOT_ID, WECOM_BOT_SECRET } from './keychain.js';
import { AccessPolicy } from './policy.js';
import { TenderStore } from './store.js';
import { createSearchPlatformTool } from './tools.js';
import { sendWeComMarkdown } from './wecom.js';

export class RunEngine {
  private readonly policy = new AccessPolicy();
  private readonly keychain = new MacOSKeychainStore();

  constructor(
    private readonly config: HostConfig,
    private readonly store: TenderStore,
    private readonly events: RunEvents,
    private readonly browser: BrowserEvidenceTool,
    private readonly platforms: Map<string, PlatformAdapterConfig>,
  ) {}

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
    const profile = join(this.config.profilesDir, platform.id, 'default');
    return existsSync(join(profile, 'Local State')) || existsSync(join(profile, 'Default'));
  }

  private async execute(task: TenderTask, run: TenderRun): Promise<void> {
    const outcomes: PlatformOutcome[] = [];
    this.events.emit(run.id, 'run.started', 'info', { taskId: task.id, correlationId: run.correlationId });
    try {
      const tool = createSearchPlatformTool({ runId: run.id, correlationId: run.correlationId, platforms: this.platforms, browser: this.browser, events: this.events });
      const piEnabled = Boolean(process.env.TENDER_LLM_PROVIDER && process.env.TENDER_LLM_MODEL);
      outcomes.push(...(piEnabled ? await this.executeWithPi(task, run, tool) : await this.executeDeterministically(task, run, tool)));
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
    const outcomes: PlatformOutcome[] = [];
    for (const query of task.queries) {
      for (const platformId of task.platformIds) {
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
    }
    return outcomes;
  }

  private async executeWithPi(task: TenderTask, run: TenderRun, tool: AgentTool<any>): Promise<PlatformOutcome[]> {
    const provider = process.env.TENDER_LLM_PROVIDER!;
    const modelId = process.env.TENDER_LLM_MODEL!;
    const models = builtinModels();
    const model = models.getModel(provider, modelId);
    if (!model) throw new Error(`Pi model is not available: ${provider}/${modelId}`);

    const outcomes: PlatformOutcome[] = [];
    const agent = new Agent({
      initialState: {
        systemPrompt: 'You orchestrate lawful tender evidence collection. Call search_platform only for requested pairs. Never bypass login, CAPTCHA, SMS, QR, CA, or UKey controls.',
        model,
        tools: [tool],
        messages: [],
      },
      toolExecution: 'sequential',
      beforeToolCall: async ({ args }) => {
        const platform = this.platforms.get((args as { platformId?: string }).platformId || '');
        if (!platform) return { block: true, reason: 'unknown platform' };
        const allowed = this.policy.canSearch(platform, { privacyMode: task.privacyMode, hasAuthorizedProfile: this.hasAuthorizedProfile(platform) });
        return allowed.allow ? undefined : { block: true, reason: allowed.reason };
      },
      afterToolCall: async ({ result }) => {
        const outcome = result.details as PlatformOutcome | undefined;
        if (outcome?.platformId) outcomes.push(outcome);
        return undefined;
      },
    });
    agent.subscribe(async (event) => {
      this.events.emit(run.id, `pi.${event.type}`, 'info', { correlationId: run.correlationId });
    });
    const pairs = task.queries.flatMap((query) => task.platformIds.map((platformId) => ({ platformId, query })));
    await agent.prompt(`Collect evidence for exactly these pairs: ${JSON.stringify(pairs)}`);
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
