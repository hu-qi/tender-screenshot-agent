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
    const payload = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(payload.error || `Agent Host returned HTTP ${response.status}`);
    return payload;
  }

  health() { return this.request<{ ok: boolean }>('/health'); }
  listTasks() { return this.request<Task[]>('/api/tasks'); }
  createTask(input: { name: string; queries: string[]; platformIds: string[]; privacyMode: string }) { return this.request<Task>('/api/tasks', { method: 'POST', body: JSON.stringify(input) }); }
  startRun(taskId: string) { return this.request(`/api/tasks/${taskId}/runs`, { method: 'POST' }); }
  getWeCom() { return this.request<WeComStatus>('/api/settings/wecom'); }
  saveWeCom(input: { botId: string; botSecret: string; targetIds: string[]; enabled: boolean; websocketUrl?: string }) { return this.request<WeComStatus>('/api/settings/wecom', { method: 'PUT', body: JSON.stringify(input) }); }
  testWeCom() { return this.request('/api/settings/wecom/test', { method: 'POST', body: '{}' }); }
  sendWeComTest(markdown: string) { return this.request<{ delivered: number; rejected: number }>('/api/settings/wecom/send-test', { method: 'POST', body: JSON.stringify({ markdown }) }); }
}
