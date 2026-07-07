import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

export type QWebBridgeTool =
  | 'navigate'
  | 'snapshot'
  | 'screenshot'
  | 'click'
  | 'fill'
  | 'wait_for'
  | 'network'
  | 'find_tab'
  | 'list_tabs'
  | 'close_session';

export interface QWebBridgeTab {
  tabId: number;
  url: string;
  title: string;
  active: boolean;
}

export interface SnapshotNode {
  role: string;
  name?: string;
  value?: string;
  ref: string;
  truncated?: boolean;
  children?: SnapshotNode[];
}

export interface QWebBridgeStatus {
  connected: boolean;
  tabs: QWebBridgeTab[];
  error?: string;
}

export interface QWebBridgeDiscovery {
  url: string;
  title: string;
  interactive: Array<Record<string, unknown>>;
  inputs: Array<Record<string, unknown>>;
  buttons: Array<Record<string, unknown>>;
  links: Array<Record<string, unknown>>;
  pagination: Array<Record<string, unknown>>;
  manualBoundaries: string[];
}

const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function assertLocalBridge(baseUrl: string): URL {
  const url = new URL(baseUrl);
  if (url.protocol !== 'http:' || !ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error('QWebBridge endpoint must be an explicit local http://127.0.0.1, http://localhost, or http://[::1] address');
  }
  return url;
}

function unwrapResponse(value: unknown): unknown {
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.error) throw new Error(typeof record.error === 'string' ? record.error : JSON.stringify(record.error));
    if ('result' in record) return record.result;
    if ('data' in record) return record.data;
  }
  return value;
}

function redactText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value
    .replace(/(?:bearer\s+)?[A-Za-z0-9._-]{24,}/gi, '[REDACTED]')
    .replace(/\b(?:\+?86[- ]?)?1[3-9]\d{9}\b/g, '[REDACTED_PHONE]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .slice(0, 120);
}

function sanitizeSnapshot(nodes: unknown, depth = 0): SnapshotNode[] {
  if (!Array.isArray(nodes) || depth > 8) return [];
  return nodes.slice(0, 250).flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const node = value as Record<string, unknown>;
    if (typeof node.role !== 'string' || typeof node.ref !== 'string') return [];
    return [{
      role: node.role,
      ...(redactText(node.name) ? { name: redactText(node.name) } : {}),
      ...(redactText(node.value) ? { value: redactText(node.value) } : {}),
      ref: node.ref,
      ...(node.truncated === true ? { truncated: true } : {}),
      ...(Array.isArray(node.children) ? { children: sanitizeSnapshot(node.children, depth + 1) } : {}),
    }];
  });
}

/**
 * This script is deliberately static and reviewed. Callers cannot provide arbitrary page JavaScript.
 * It extracts selector candidates and state markers only; it does not read cookies, storage, form values,
 * request bodies, response bodies or full page text.
 */
const DISCOVERY_SCRIPT = String.raw`
(() => {
  const redact = (input) => String(input || '')
    .replace(/(?:bearer\s+)?[A-Za-z0-9._-]{24,}/gi, '[REDACTED]')
    .replace(/\b(?:\+?86[- ]?)?1[3-9]\d{9}\b/g, '[REDACTED_PHONE]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .slice(0, 80);
  const stable = (value) => value && value.length < 100 && !/[0-9a-f]{8,}/i.test(value) && !/^(css-|jsx-|ant-|el-)/.test(value);
  const escape = (value) => CSS.escape(String(value));
  const unique = (selector) => {
    try { return document.querySelectorAll(selector).length === 1; } catch { return false; }
  };
  const candidate = (el) => {
    const tag = el.tagName.toLowerCase();
    const dataTest = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-qa');
    const id = el.id;
    const name = el.getAttribute('name');
    const aria = el.getAttribute('aria-label');
    const placeholder = el.getAttribute('placeholder');
    const classes = [...el.classList].filter(stable).slice(0, 2);
    const options = [];
    if (dataTest) options.push('[data-testid="' + escape(dataTest) + '"]');
    if (id && stable(id)) options.push('#' + escape(id));
    if (name) options.push(tag + '[name="' + escape(name) + '"]');
    if (aria) options.push(tag + '[aria-label="' + escape(aria) + '"]');
    if (placeholder) options.push(tag + '[placeholder="' + escape(placeholder) + '"]');
    if (classes.length) options.push(tag + '.' + classes.map(escape).join('.'));
    const selector = options.find(unique) || options[0] || tag;
    const rect = el.getBoundingClientRect();
    return {
      tag,
      role: el.getAttribute('role') || undefined,
      type: el.getAttribute('type') || undefined,
      name: redact(name),
      ariaLabel: redact(aria),
      placeholder: redact(placeholder),
      testId: redact(dataTest),
      text: redact((el.innerText || el.textContent || '').trim()),
      selector,
      matches: (() => { try { return document.querySelectorAll(selector).length; } catch { return -1; } })(),
      visible: rect.width > 0 && rect.height > 0,
    };
  };
  const all = [...document.querySelectorAll('input, textarea, select, button, a[href], [role="button"], [contenteditable="true"]')]
    .filter((el) => {
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    })
    .slice(0, 300)
    .map(candidate);
  const inputs = all.filter((item) => ['input', 'textarea', 'select'].includes(item.tag) || item.role === 'textbox');
  const buttons = all.filter((item) => item.tag === 'button' || item.role === 'button' || /(?:搜索|查询|检索|search|find)/i.test(String(item.text || '') + ' ' + String(item.ariaLabel || '')));
  const links = all.filter((item) => item.tag === 'a').slice(0, 120);
  const pagination = all.filter((item) => /(?:下一页|下页|next|上一页|上页|prev|第\s*\d+\s*页|page\s*\d+)/i.test(String(item.text || '') + ' ' + String(item.ariaLabel || '')));
  const markerText = [...document.querySelectorAll('body *')]
    .filter((el) => el.children.length === 0)
    .map((el) => String(el.textContent || '').trim().slice(0, 100))
    .filter(Boolean)
    .slice(0, 2500)
    .join('\n');
  const boundaryTerms = [
    ['captcha', /验证码|captcha|滑动验证|拖动滑块/i],
    ['sms-otp', /短信验证码|手机验证码|动态口令/i],
    ['qr-login', /扫码登录|二维码登录/i],
    ['ca-ukey', /CA证书|UKey|USBKey|数字证书/i],
    ['native-signer', /签章|签名控件|电子签名/i],
    ['session-expired', /登录已失效|会话已过期|重新登录/i],
    ['rate-limit', /访问频繁|操作过于频繁|请求过多/i],
    ['maintenance', /系统维护|维护中|暂不可用/i],
  ].filter(([, pattern]) => pattern.test(markerText)).map(([name]) => name);
  return { url: location.href, title: document.title, interactive: all, inputs, buttons, links, pagination, manualBoundaries: boundaryTerms };
})()`;

export class QWebBridgeClient {
  readonly baseUrl: URL;

  constructor(baseUrl: string, private readonly timeoutMs = 15_000) {
    this.baseUrl = assertLocalBridge(baseUrl);
  }

  async call<T>(tool: QWebBridgeTool, params: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(new URL(`/api/tool/${tool}`, this.baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
        signal: controller.signal,
      });
      const text = await response.text();
      let payload: unknown = {};
      if (text) {
        try { payload = JSON.parse(text); } catch { throw new Error(`QWebBridge returned non-JSON for ${tool}`); }
      }
      if (!response.ok) throw new Error(`QWebBridge ${tool} failed with HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 300)}`);
      return unwrapResponse(payload) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async status(): Promise<QWebBridgeStatus> {
    try {
      const result = await this.call<{ tabs?: QWebBridgeTab[] }>('list_tabs', {});
      return { connected: true, tabs: Array.isArray(result.tabs) ? result.tabs : [] };
    } catch (error) {
      return { connected: false, tabs: [], error: error instanceof Error ? error.message : String(error) };
    }
  }

  snapshot(): Promise<SnapshotNode[]> {
    return this.call<unknown>('snapshot', { interactive_only: true, depth: 7 }).then((value) => sanitizeSnapshot(value));
  }

  discover(): Promise<QWebBridgeDiscovery> {
    return this.call<QWebBridgeDiscovery>('evaluate', { code: DISCOVERY_SCRIPT, parse_json: true, structured: true });
  }

  async screenshot(outputPath: string): Promise<string | undefined> {
    const result = await this.call<{ data?: string; filePath?: string }>('screenshot', { format: 'png', fullPage: true });
    if (!result.data) return undefined;
    const encoded = result.data.replace(/^data:image\/png;base64,/, '');
    if (!/^[A-Za-z0-9+/=\s]+$/.test(encoded)) return undefined;
    await mkdir(resolve(outputPath, '..'), { recursive: true });
    await writeFile(outputPath, Buffer.from(encoded, 'base64'));
    return outputPath;
  }

  async startNetwork(): Promise<void> { await this.call('network', { cmd: 'start' }); }
  async stopNetwork(): Promise<void> { await this.call('network', { cmd: 'stop' }); }

  async networkSummary(): Promise<Array<Record<string, unknown>>> {
    const result = await this.call<{ requests?: Array<Record<string, unknown>> }>('network', { cmd: 'list' });
    return (result.requests || []).slice(0, 500).map((request) => {
      let url: string | undefined;
      if (typeof request.url === 'string') {
        try {
          const parsed = new URL(request.url);
          url = `${parsed.origin}${parsed.pathname}`;
        } catch {
          url = '[INVALID_URL]';
        }
      }
      return { method: request.method, status: request.status, type: request.type, url };
    });
  }

  navigate(entryUrl: string, session: string): Promise<{ success: boolean; url: string; tabId: number }> {
    return this.call('navigate', { url: entryUrl, newTab: true, _session: session, group_title: 'Tender Adapter Recording' });
  }

  fill(selector: string, value: string): Promise<unknown> { return this.call('fill', { selector, value, submit: false }); }
  click(selector: string): Promise<unknown> { return this.call('click', { selector }); }
  waitFor(selector: string, state: 'visible' | 'hidden' | 'removed' = 'visible'): Promise<unknown> { return this.call('wait_for', { selector, state, timeout: this.timeoutMs }); }
  closeSession(session: string): Promise<void> { return this.call('close_session', { _session: session }).then(() => undefined); }

  static newSession(prefix = 'tender-recorder'): string { return `${prefix}-${randomUUID()}`; }
}
