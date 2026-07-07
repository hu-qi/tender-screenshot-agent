import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { Type, type Static } from 'typebox';
import type { BrowserEvidenceTool } from './browser.js';
import type { PlatformAdapterConfig, PlatformOutcome } from './domain.js';
import type { RunEvents } from './events.js';

const searchPlatformSchema = Type.Object({
  platformId: Type.String({ description: 'Configured tender platform identifier' }),
  query: Type.String({ description: 'Project name or project number to search' }),
});

type SearchPlatformInput = Static<typeof searchPlatformSchema>;

function modelSafeReason(outcome: PlatformOutcome): string | undefined {
  if (!outcome.reason) return undefined;
  if (outcome.status === 'manual-review-required') return 'manual review is required for this platform state';
  if (outcome.status !== 'failed') return undefined;
  const reason = outcome.reason.toLowerCase();
  if (reason.includes('timeout') || reason.includes('timed out')) return 'browser navigation timeout';
  if (reason.includes('selector') || reason.includes('locator')) return 'recorded page selector is unavailable';
  if (reason.includes('net::') || reason.includes('dns') || reason.includes('connection')) return 'browser network failure';
  if (reason.includes('login') || reason.includes('session')) return 'platform session requires user attention';
  return 'browser capture failed; inspect local trace during manual review';
}

export function createSearchPlatformTool(input: {
  runId: string;
  correlationId: string;
  platforms: Map<string, PlatformAdapterConfig>;
  browser: BrowserEvidenceTool;
  events: RunEvents;
}): AgentTool<typeof searchPlatformSchema, PlatformOutcome> {
  return {
    name: 'search_platform',
    label: 'Search tender platform',
    description: 'Search one configured tender platform and capture local evidence through its recorded lawful access flow.',
    parameters: searchPlatformSchema,
    executionMode: 'sequential',
    async execute(_toolCallId: string, args: SearchPlatformInput, _signal, onUpdate): Promise<AgentToolResult<PlatformOutcome>> {
      const platform = input.platforms.get(args.platformId);
      if (!platform) throw new Error(`unknown platform: ${args.platformId}`);
      input.events.emit(input.runId, 'tool.search_platform.started', 'info', { platformId: platform.id, query: args.query, correlationId: input.correlationId });
      onUpdate?.({
        content: [{ type: 'text', text: `Opening ${platform.name}` }],
        details: { platformId: platform.id, status: 'manual-review-required', artifacts: [] },
      });
      const outcome = await input.browser.execute({
        runId: input.runId,
        platform,
        query: args.query,
        correlationId: input.correlationId,
        onProgress: (type, level, payload) => input.events.emit(input.runId, type, level, { ...payload, correlationId: input.correlationId }),
      });
      input.events.emit(input.runId, 'tool.search_platform.completed', outcome.status === 'failed' ? 'error' : outcome.status === 'manual-review-required' ? 'warn' : 'info', {
        platformId: outcome.platformId,
        status: outcome.status,
        reason: outcome.reason,
        artifactCount: outcome.artifacts.length,
        correlationId: input.correlationId,
      });
      const modelSummary = {
        platformId: outcome.platformId,
        status: outcome.status,
        ...(modelSafeReason(outcome) ? { reason: modelSafeReason(outcome) } : {}),
      };
      return { content: [{ type: 'text', text: JSON.stringify(modelSummary) }], details: outcome };
    },
  };
}
