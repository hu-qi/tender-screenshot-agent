import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentHostClient, type PlatformAccess, type Task, type WeComStatus } from './agent-host';
import './style.css';

const host = new AgentHostClient();
const PLATFORMS = ['cmcc','unicom','telecom','tower-online-commerce','tower-eprocurement','cebpubservice','miit','gd-govprocurement','gd-public-resources'];
const asText = (error: unknown) => error instanceof Error ? error.message : String(error);

function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [platforms, setPlatforms] = useState<PlatformAccess[]>([]);
  const [loginSessions, setLoginSessions] = useState<Record<string, string>>({});
  const [name, setName] = useState('');
  const [queries, setQueries] = useState('');
  const [privacyMode, setPrivacyMode] = useState('internal-enhanced');
  const [notice, setNotice] = useState('正在连接本机 Agent Host。');
  const [botId, setBotId] = useState('');
  const [botSecret, setBotSecret] = useState('');
  const [targetIds, setTargetIds] = useState('');
  const [wecom, setWecom] = useState<WeComStatus | null>(null);
  const parsedQueries = useMemo(() => [...new Set(queries.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))], [queries]);

  const refresh = async () => {
    const [nextTasks, nextPlatforms, status] = await Promise.all([host.listTasks(), host.listPlatforms(), host.getWeCom()]);
    setTasks(nextTasks);
    setPlatforms(nextPlatforms);
    setWecom(status);
  };

  useEffect(() => {
    void refresh().then(() => setNotice('本机 Agent Host 已就绪。')).catch((error) => setNotice(`Agent Host 不可用：${asText(error)}`));
    const timer = window.setInterval(() => { void refresh().catch(() => undefined); }, 2500);
    return () => window.clearInterval(timer);
  }, []);

  const createTask = async () => {
    if (!name.trim() || parsedQueries.length === 0) return setNotice('请填写任务名称和至少一个查询名称。');
    try {
      const task = await host.createTask({ name: name.trim(), queries: parsedQueries, platformIds: PLATFORMS, privacyMode });
      setName(''); setQueries(''); await refresh();
      setNotice(`任务已创建：${task.name}`);
    } catch (error) { setNotice(`创建任务失败：${asText(error)}`); }
  };

  const startTask = async (taskId: string) => {
    try { await host.startRun(taskId); await refresh(); setNotice('任务已交给 Agent Host 执行。'); }
    catch (error) { setNotice(`启动任务失败：${asText(error)}`); }
  };

  const openLogin = async (platformId: string) => {
    try {
      const session = await host.openPlatformLogin(platformId);
      setLoginSessions((current) => ({ ...current, [platformId]: session.id }));
      await refresh();
      setNotice('已打开本机浏览器。请在平台页面完成正常登录后，再点击“确认登录完成”。');
    } catch (error) { setNotice(`打开登录失败：${asText(error)}`); }
  };

  const completeLogin = async (platformId: string) => {
    const sessionId = loginSessions[platformId];
    if (!sessionId) return setNotice('未找到当前平台的登录会话。');
    try {
      await host.completePlatformLogin(sessionId);
      setLoginSessions((current) => { const next = { ...current }; delete next[platformId]; return next; });
      await refresh();
      setNotice('登录状态已由你确认，本地 Profile 可以用于后续受限平台执行。');
    } catch (error) { setNotice(`确认登录失败：${asText(error)}`); }
  };

  const cancelLogin = async (platformId: string) => {
    const sessionId = loginSessions[platformId];
    if (!sessionId) return;
    try {
      await host.cancelPlatformLogin(sessionId);
      setLoginSessions((current) => { const next = { ...current }; delete next[platformId]; return next; });
      await refresh();
      setNotice('已关闭当前登录浏览器，尚未授予自动化访问。');
    } catch (error) { setNotice(`取消登录失败：${asText(error)}`); }
  };

  const clearProfile = async (platformId: string) => {
    try { await host.clearPlatformProfile(platformId); await refresh(); setNotice('该平台的本地浏览器 Profile 已清除。'); }
    catch (error) { setNotice(`清除 Profile 失败：${asText(error)}`); }
  };

  const saveWeCom = async () => {
    if (!botId.trim() || !botSecret.trim()) return setNotice('请填写 Bot ID 和 Bot Secret。');
    try {
      const status = await host.saveWeCom({ botId: botId.trim(), botSecret: botSecret.trim(), targetIds: targetIds.split(/\r?\n/).map((item) => item.trim()).filter(Boolean), enabled: true });
      setBotId(''); setBotSecret(''); setWecom(status);
      setNotice('Bot 凭证已写入 macOS Keychain，数据库只保存启用状态和目标会话。');
    } catch (error) { setNotice(`保存企业微信 Bot 失败：${asText(error)}`); }
  };

  const testWeCom = async () => {
    try { await host.testWeCom(); setNotice('企业微信 Bot WebSocket 认证成功。'); }
    catch (error) { setNotice(`企业微信 Bot 认证失败：${asText(error)}`); }
  };

  const sendWeComTest = async () => {
    try {
      const result = await host.sendWeComTest('**标讯截图助手**\nPi Agent Host 企业微信 Bot 测试消息。');
      setNotice(`企业微信测试完成：成功 ${result.delivered}，拒绝 ${result.rejected}。`);
    } catch (error) { setNotice(`企业微信消息发送失败：${asText(error)}`); }
  };

  return <main>
    <header><h1>标讯截图助手</h1><p>Pi Agent Host · 工具化执行 · 本地证据链</p></header>
    <p className="message">{notice}</p>

    <section className="card"><h2>平台账号与访问</h2>
      <p className="hint">只通过你在本机完成的正常登录复用 Profile；不会导出 Cookie、密码、短信、二维码、CA 或 UKey。未验收 selector 的平台只做落地页取证并进入人工复核。</p>
      <table><thead><tr><th>平台</th><th>访问方式</th><th>适配器</th><th>Profile</th><th>操作</th></tr></thead><tbody>{platforms.map((platform) => {
        const sessionId = loginSessions[platform.id];
        const requiresLogin = platform.accessMode !== 'public';
        return <tr key={platform.id}><td>{platform.name}</td><td>{platform.accessMode}</td><td>{platform.adapterStatus}</td><td>{platform.profile.status}</td><td>
          {requiresLogin && !sessionId && <button onClick={() => void openLogin(platform.id)}>打开登录</button>}
          {sessionId && <><button onClick={() => void completeLogin(platform.id)}>确认登录完成</button><button className="secondary" onClick={() => void cancelLogin(platform.id)}>取消</button></>}
          {requiresLogin && platform.profile.status === 'user-confirmed' && <button className="danger" onClick={() => void clearProfile(platform.id)}>清除 Profile</button>}
        </td></tr>;
      })}</tbody></table>
    </section>

    <section className="card"><h2>企业微信 Bot</h2>
      <p className="hint">状态：{wecom?.configured ? (wecom.enabled ? '已配置' : '已禁用') : '未配置'}；目标会话：{wecom?.targetCount ?? 0} 个。Bot ID 与 Secret 仅写入 macOS Keychain。</p>
      <label>Bot ID<input value={botId} onChange={(event) => setBotId(event.target.value)} autoComplete="off" /></label>
      <label>Bot Secret<input value={botSecret} onChange={(event) => setBotSecret(event.target.value)} type="password" autoComplete="new-password" /></label>
      <label>目标会话 ID（每行一个）<textarea value={targetIds} onChange={(event) => setTargetIds(event.target.value)} placeholder="chatid 或 userid" /></label>
      <button onClick={saveWeCom}>保存凭证</button><button className="secondary" disabled={!wecom?.configured} onClick={testWeCom}>测试认证</button><button className="secondary" disabled={!wecom?.configured} onClick={sendWeComTest}>发送测试通知</button>
    </section>

    <section className="card"><h2>新建任务</h2>
      <label>任务名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：广东通信项目监控" /></label>
      <label>项目名称（每行一个）<textarea value={queries} onChange={(event) => setQueries(event.target.value)} placeholder="项目名称或项目编号" /></label>
      <label>隐私模式<select value={privacyMode} onChange={(event) => setPrivacyMode(event.target.value)}><option value="strict-local">严格本地</option><option value="internal-enhanced">内网增强</option><option value="hybrid">混合模式</option></select></label>
      <p>已识别 {parsedQueries.length} 条查询，默认目标为 9 个标讯平台。</p><button onClick={createTask}>创建任务</button><button className="secondary" onClick={() => void refresh()}>刷新</button>
    </section>

    <section className="card"><h2>任务</h2><table><thead><tr><th>名称</th><th>状态</th><th>查询</th><th>更新时间</th><th>操作</th></tr></thead><tbody>{tasks.map((task) => <tr key={task.id}><td>{task.name}</td><td>{task.status}</td><td>{task.queries.length}</td><td>{task.updatedAt}</td><td><button disabled={task.status === 'running'} onClick={() => void startTask(task.id)}>执行</button></td></tr>)}</tbody></table></section>
  </main>;
}

createRoot(document.getElementById('root')!).render(<App/>);
