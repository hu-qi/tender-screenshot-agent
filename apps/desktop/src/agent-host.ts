import { invoke } from '@tauri-apps/api/core';

export type HostConfig = { baseUrl: string; token: string };

export type Task = {
  id: string;
  name: string;
  queries: string[];
  platformIds: string[];
  privacyMode: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type RunSummary = { successful: number; manualReview: number; failed: number; artifacts: number };
export type Run = { id: string; taskId: string; status: string; correlationId: string; startedAt: string; finishedAt?: string; summary?: RunSummary };
export type RunEvent = { id: number; runId: string; sequence: number; timestamp: string; type: string; level: 'info' | 'warn' | 'error'; payload: Record<string, unknown> };
export type Artifact = { id: string; runId: string; platformId: string; kind: string; relativePath: string; sha256: string; createdAt: string };

export type PlatformProfile = {
  platformId: string;
  status: 'not-configured' | 'login-open' | 'user-confirmed' | 'expired';
  profileDir: string;
  updatedAt: string;
  lastLoginAt?: string;
  lastValidatedAt?: string;
  message?: string;
};

export type PlatformAccess = {
  id: string;
  name: string;
  entryUrl: string;
  accessMode: 'public' | 'manual-login' | 'ca-login';
  adapterStatus: 'verified' | 'unverified';
  profile: PlatformProfile;
};

export type LoginSession = { id: string; platformId: string; entryUrl: string; startedAt: string };
export type WeComStatus = { configured: boolean; enabled: boolean; targetCount: number; websocketUrl?: string; updatedAt?: string };

export class AgentHostClient {
  private config?: HostConfig;

  private async connection(): Promise<HostConfig> {
    if (!this.config) this.config = await invoke<HostConfig>('agent_host_config');
    return this.config;
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const config = await this.connection();
    const response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json', ...(init.headers || {}) },
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) as T & { error?: string } : {} as T & { error?: string };
    if (!response.ok) throw new Error(payload.error || `Agent Host returned HTTP ${response.status}`);
    return payload;
  }

  health() { return this.request<{ ok: boolean }>('/health'); }
  listPlatforms() { return this.request<PlatformAccess[]>('/api/platforms'); }
  openPlatformLogin(platformId: string) { return this.request<LoginSession>(`/api/platforms/${encodeURIComponent(platformId)}/login`, { method: 'POST', body: '{}' }); }
  completePlatformLogin(sessionId: string) { return this.request<{ session: LoginSession; profile: PlatformProfile }>(`/api/platform-logins/${encodeURIComponent(sessionId)}/complete`, { method: 'POST', body: '{}' }); }
  cancelPlatformLogin(sessionId: string) { return this.request<{ cancelled: boolean }>(`/api/platform-logins/${encodeURIComponent(sessionId)}/cancel`, { method: 'POST', body: '{}' }); }
  clearPlatformProfile(platformId: string) { return this.request<PlatformProfile>(`/api/platforms/${encodeURIComponent(platformId)}/profile`, { method: 'POST', body: '{}' }); }
  listTasks() { return this.request<Task[]>('/api/tasks'); }
  createTask(input: { name: string; queries: string[]; platformIds: string[]; privacyMode: string }) { return this.request<Task>('/api/tasks', { method: 'POST', body: JSON.stringify(input) }); }
  listRuns(taskId: string) { return this.request<Run[]>(`/api/tasks/${encodeURIComponent(taskId)}/runs`); }
  startRun(taskId: string) { return this.request<Run>(`/api/tasks/${encodeURIComponent(taskId)}/runs`, { method: 'POST', body: '{}' }); }
  listEvents(runId: string, after = 0) { return this.request<RunEvent[]>(`/api/runs/${encodeURIComponent(runId)}/events?after=${after}`); }
  listArtifacts(runId: string) { return this.request<Artifact[]>(`/api/runs/${encodeURIComponent(runId)}/artifacts`); }
  getWeCom() { return this.request<WeComStatus>('/api/settings/wecom'); }
  saveWeCom(input: { botId: string; botSecret: string; targetIds: string[]; enabled: boolean; websocketUrl?: string }) { return this.request<WeComStatus>('/api/settings/wecom', { method: 'PUT', body: JSON.stringify(input) }); }
  testWeCom() { return this.request('/api/settings/wecom/test', { method: 'POST', body: '{}' }); }
  sendWeComTest(markdown: string) { return this.request<{ delivered: number; rejected: number }>('/api/settings/wecom/send-test', { method: 'POST', body: JSON.stringify({ markdown }) }); }
}
