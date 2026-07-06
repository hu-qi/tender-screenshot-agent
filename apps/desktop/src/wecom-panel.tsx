import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

type WeComBotStatus = {
  configured: boolean;
  enabled: boolean;
  targetCount: number;
  websocketUrl?: string;
  updatedAt?: string;
};

type Props = { onNotice: (message: string) => void };
const asMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export function WeComPanel({ onNotice }: Props) {
  const [botId, setBotId] = useState('');
  const [credential, setCredential] = useState('');
  const [targets, setTargets] = useState('');
  const [websocketUrl, setWebsocketUrl] = useState('');
  const [markdown, setMarkdown] = useState('**标讯截图助手**\n企业微信 Bot 主动推送测试成功。');
  const [status, setStatus] = useState<WeComBotStatus | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const next = await invoke<WeComBotStatus>('get_wecom_bot_status');
    setStatus(next);
  }

  useEffect(() => { void refresh().catch(error => onNotice(`读取企业微信 Bot 状态失败：${asMessage(error)}`)); }, []);

  async function save() {
    if (!botId.trim() || !credential.trim()) {
      onNotice('请填写 Bot ID 和 Bot Secret。');
      return;
    }
    setBusy(true);
    try {
      const targetChatIds = targets.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
      const payload = { botId, ['secret']: credential, targetChatIds, websocketUrl: websocketUrl.trim() || null, enabled: true };
      const next = await invoke<WeComBotStatus>('configure_wecom_bot', { input: payload });
      setStatus(next);
      setBotId('');
      setCredential('');
      onNotice('企业微信 Bot 已保存到系统钥匙串，凭证不会写入任务数据库或日志。');
    } catch (error) {
      onNotice(`保存企业微信 Bot 失败：${asMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    setBusy(true);
    try {
      await invoke('test_wecom_bot');
      onNotice('企业微信 Bot WebSocket 认证成功。');
      await refresh();
    } catch (error) {
      onNotice(`企业微信 Bot 认证失败：${asMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    try {
      const result = await invoke<{ status: string; deliveredChatIds: string[]; rejectedChatIds: string[] }>('send_wecom_bot_markdown', { input: { markdown } });
      onNotice(`企业微信通知${result.status === 'success' ? '发送成功' : '部分发送成功'}：成功 ${result.deliveredChatIds.length} 个，拒绝 ${result.rejectedChatIds.length} 个。`);
    } catch (error) {
      onNotice(`企业微信通知发送失败：${asMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  return <section className="card">
    <h2>企业微信 Bot</h2>
    <p className="hint">Bot ID 与 Bot Secret 通过企业微信智能机器人 WebSocket 通道认证。凭证仅保存到操作系统钥匙串；目标会话可填写群聊 chatid 或单聊 userid，每行一个。</p>
    <p className="status">状态：{status?.configured ? (status.enabled ? '已配置并启用' : '已配置但禁用') : '未配置'}；目标会话：{status?.targetCount ?? 0} 个。</p>
    <label>Bot ID<input value={botId} onChange={event => setBotId(event.target.value)} autoComplete="off" placeholder="企业微信后台创建机器人后获取" /></label>
    <label>Bot Secret<input value={credential} onChange={event => setCredential(event.target.value)} type="password" autoComplete="new-password" placeholder="仅保存到系统钥匙串" /></label>
    <label>目标会话 ID（每行一个）<textarea value={targets} onChange={event => setTargets(event.target.value)} placeholder="群聊 chatid 或单聊 userid" /></label>
    <label>WebSocket 地址（私有部署可选）<input value={websocketUrl} onChange={event => setWebsocketUrl(event.target.value)} placeholder="默认使用企业微信官方地址" /></label>
    <button disabled={busy} onClick={save}>保存 Bot 凭证</button>
    <button className="secondary" disabled={busy || !status?.configured} onClick={testConnection}>测试认证</button>
    <label>测试通知内容<textarea value={markdown} onChange={event => setMarkdown(event.target.value)} /></label>
    <button disabled={busy || !status?.configured} onClick={sendTest}>发送测试通知</button>
  </section>;
}
