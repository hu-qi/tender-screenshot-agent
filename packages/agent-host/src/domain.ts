export const PLATFORM_IDS = [
  'cmcc',
  'unicom',
  'telecom',
  'tower-online-commerce',
  'tower-eprocurement',
  'cebpubservice',
  'miit',
  'gd-govprocurement',
  'gd-public-resources',
] as const;

export type PlatformId = (typeof PLATFORM_IDS)[number];
export type PrivacyMode = 'strict-local' | 'internal-enhanced' | 'hybrid';
export type TaskStatus = 'queued' | 'running' | 'completed' | 'partial-success' | 'manual-review-required' | 'failed';
export type RunStatus = 'running' | 'completed' | 'partial-success' | 'manual-review-required' | 'failed';
export type AccessMode = 'public' | 'manual-login' | 'ca-login';
export type AdapterStatus = 'verified' | 'unverified';
export type PlatformProfileStatus = 'not-configured' | 'login-open' | 'user-confirmed' | 'expired';

export interface PlatformAdapterConfig {
  id: PlatformId;
  name: string;
  entryUrl: string;
  accessMode: AccessMode;
  adapterStatus: AdapterStatus;
  selectors?: {
    searchInput?: string;
    searchSubmit?: string;
    resultLink?: string;
    detailBody?: string;
  };
}

export interface PlatformProfile {
  platformId: PlatformId;
  status: PlatformProfileStatus;
  profileDir: string;
  updatedAt: string;
  lastLoginAt?: string;
  lastValidatedAt?: string;
  message?: string;
}

export interface PlatformAccessView extends PlatformAdapterConfig {
  profile: PlatformProfile;
}

export interface LoginSession {
  id: string;
  platformId: PlatformId;
  entryUrl: string;
  startedAt: string;
}

export interface TenderTaskInput {
  name: string;
  queries: string[];
  platformIds: PlatformId[];
  privacyMode: PrivacyMode;
}

export interface TenderTask extends TenderTaskInput {
  id: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TenderRun {
  id: string;
  taskId: string;
  status: RunStatus;
  correlationId: string;
  startedAt: string;
  finishedAt?: string;
  summary?: RunSummary;
}

export interface RunSummary {
  successful: number;
  manualReview: number;
  failed: number;
  artifacts: number;
}

export interface AgentEventRecord {
  id: number;
  runId: string;
  sequence: number;
  timestamp: string;
  type: string;
  level: 'info' | 'warn' | 'error';
  payload: Record<string, unknown>;
}

export interface ArtifactRecord {
  id: string;
  runId: string;
  platformId: PlatformId;
  kind: 'landing-screenshot' | 'result-screenshot' | 'detail-screenshot' | 'html' | 'text' | 'pdf' | 'trace' | 'failure-screenshot';
  relativePath: string;
  sha256: string;
  createdAt: string;
}

export interface PlatformOutcome {
  platformId: PlatformId;
  status: 'success' | 'no-result' | 'manual-review-required' | 'failed';
  reason?: string;
  artifacts: ArtifactRecord[];
}

export interface WeComSettingsInput {
  botId: string;
  botSecret: string;
  targetIds: string[];
  enabled: boolean;
  websocketUrl?: string;
}

export interface WeComSettingsStatus {
  configured: boolean;
  enabled: boolean;
  targetCount: number;
  websocketUrl?: string;
  updatedAt?: string;
}
