import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentHostClient, type Artifact, type BrowserRuntimeStatus, type PlatformAccess, type Run, type RunEvent, type Task, type WeComStatus } from './agent-host';
import './style.css';

const host = new AgentHostClient();
const PLATFORMS = ['cmcc', 'unicom', 'telecom', 'tower-online-commerce', 'tower-eprocurement', 'cebpubservice', 'miit', 'gd-govprocurement', 'gd-public-resources'];
const asText = (error: unknown) => error instanceof Error ? error.message : String(error);

function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [platforms, setPlatforms] = useState<PlatformAccess[]>([]);
  const [loginSessions, setLoginSessions] = useState<Record<string, string>>({});
  const [activeRun, setActiveRun] = useState<Run | null>(null);
  const [runEvents, setRunEvents] = useState<RunEvent[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [name, setName] = useState('');
  const [queries, setQueries] = useState('');
  const [privacyMode, setPrivacyMode] = useState('internal-enhanced');
  const [notice, setNotice] = useState('正在连接本机 Agent Host。');
  const [botId, setBotId] = useState('');
  const [botSecret, setBotSecret] = useState('');
  const [targetIds, setTargetIds] = useState('');
  const [wecom, setWecom] = useState<WeComStatus | null>(null);
  const [browser, setBrowser] = useState<BrowserRuntimeStatus | null>(null);
  const [browserInstalling, setBrowserInstalling] = useState(false);
  const [wecomAction, setWecomAction] = useState<'save' | 'auth' | 'send' | null>(null);
  const parsedQueries = useMemo(() => [...new Set(queries.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))], [queries]);

  const refresh = async () => {
    const [nextTasks, nextPlatforms, status, browserStatus] = await Promise.all([
      host.listTasks(),
      host.listPlatforms(),
      host.getWeCom(),
      host.getBrowserRuntime(),
    ]);
    setTasks(nextTasks);
    setPlatforms(nextPlatforms);
    setWecom(status);
    setBrowser(browserStatus);
  };

  useEffect(() => {
    void refresh().then(() => setNotice('本机 Agent Host 已就绪。')).catch((error) => setNotice(`Agent Host 不可用：${asText(error)}`));
    const timer = window.setInterval(() => { void refresh().catch(() => undefined); }, 2500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!activeRun) return;
    let available = true;
    const refreshRun = async () => {
      try {
        const [events, nextArtifacts] = await Promise.all([host.listEvents(activeRun.id), host.listArtifacts(activeRun.id)]);
        if (!available) return;
        setRunEvents(events);
        setArtifacts(nextArtifacts);
      } catch (error) {
        if (available) setNotice(`读取运行日志失败：${asText(error)}`);
      }
    };
    void refreshRun();
    const timer = window.setInterval(() => { void refreshRun(); }, 1200);
    return () => { available = false; window.clearInterval(timer); };
  }, [activeRun?.id]);

  const installBrowser = async () => {
    try {
      setBrowserInstalling(true);
      setNotice('正在下载并安装与当前 Playwright 版本匹配的 Chromium，请保持网络连接。');
      const status = await host.installBrowserRuntime();
      setBrowser(status);
      await refresh();
      setNotice(status.ready ? '浏览器运行时已就绪，可以打开平台登录或执行任务。' : status.message);
    } catch (error) {
      setNotice(`安装 Chromium 失败：${asText(error)}`);
    } finally {
      setBrowserInstalling(false);
    }
  };

  const createTask = async () => {
    if (!name.trim() || parsedQueries.length === 0) return setNotice('请填写任务名称和至少一个查询名称。');
    try {
      const task = await host.createTask({ name: name.trim(), queries: parsedQueries, platformIds: PLATFORMS, privacyMode });
      setName(''); setQueries(''); await refresh();
      setNotice(`任务已创建：${task.name}`);
    } catch (error) { setNotice(`创建任务失败：${asText(error)}`); }
  };

  const startTask = async (taskId: string) => {
    if (!browser?.ready) return setNotice('浏览器运行时未就绪。请先点击“安装 Chromium”，再执行任务。');
    try {
      const run = await host.startRun(taskId);
      setActiveRun(run);
      setRunEvents([]);
      setArtifacts([]);
      await refresh();
      setNotice(`任务已交给 Agent Host 执行，运行 ID：${run.id}`);
    } catch (error) { setNotice(`启动任务失败：${asText(error)}`); }
  };

  const showLatestRun = async (taskId: string) => {
    try {
      const runs = await host.listRuns(taskId);
      if (!runs[0]) return setNotice('该任务尚无运行记录。');
      setActiveRun(runs[0]);
      setNotice(`正在查看运行：${runs[0].id}`);
    } catch (error) { setNotice(`读取运行记录失败：${asText(error)}`); }
  };

  const openLogin = async (platformId: string) => {
    if (!browser?.ready) return setNotice('浏览器运行时未就绪。请先点击“安装 Chromium”，再打开登录。');
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
      setNotice('已关闭当前登录浏览器，已有授权状态保持不变。');
    } catch (error) { setNotice(`取消登录失败：${asText(error)}`); }
  };

  const clearProfile = async (platformId: string) => {
    try { await host.clearPlatformProfile(platformId); await refresh(); setNotice('该平台的本地浏览器 Profile 已清除。'); }
    catch (error) { setNotice(`清除 Profile 失败：${asText(error)}`); }
  };

  const saveWeCom = async () => {
    if (!botId.trim() || !botSecret.trim()) return setNotice('请填写 Bot ID 和 Bot Secret。');
    try {
      setWecomAction('save');
      const parsedTargets = [...new Set(targetIds.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean))];
      const status = await host.saveWeCom({ botId: botId.trim(), botSecret: botSecret.trim(), targetIds: parsedTargets, enabled: true });
      setBotId(''); setBotSecret(''); setWecom(status);
      await refresh();
      setNotice(`Bot 凭证已写入 macOS Keychain。已保存 ${status.targetCount} 个目标会话，可立即测试认证和发送。`);
    } catch (error) { setNotice(`保存企业微信 Bot 失败：${asText(error)}`); }
    finally { setWecomAction(null); }
  };

  const testWeCom = async () => {
    try {
      setWecomAction('auth');
      const result = await host.testWeCom();
      setNotice(`企业微信 Bot WebSocket 认证成功，耗时 ${result.latencyMs}ms。`);
    } catch (error) { setNotice(`企业微信 Bot 认证失败：${asText(error)}`); }
    finally { setWecomAction(null); }
  };

  const sendWeComTest = async () => {
    if ((wecom?.targetCount ?? 0) === 0) return setNotice('请先填写并保存至少一个 chatid 或 userid，再发送测试通知。');
    try {
      setWecomAction('send');
      const result = await host.sendWeComTest('**标讯截图助手**\nPi Agent Host 企业微信 Bot 测试消息。');
      setNotice(`企业微信测试通知已完成：成功 ${result.delivered}，拒绝 ${result.rejected}，认证耗时 ${result.latencyMs}ms。`);
    } catch (error) { setNotice(`企业微信消息发送失败：${asText(error)}`); }
    finally { setWecomAction(null); }
  };

  return <main>
    <header><h1>标讯截图助手</h1><p>Pi Agent Host · 工具化执行 · 本地证据链</p></header>
    <p className="message">{notice}</p>

    <section className="card"><h2>浏览器运行时</h2>
      <p className="hint">状态：{browser?.ready ? '已就绪' : '未就绪'}；来源：{browser?.source || '检测中'}。{browser?.message}</p>
      {!browser?.ready && <><button disabled={browserInstalling} onClick={() => void installBrowser()}>{browserInstalling ? '正在安装 Chromium…' : '安装 Chromium'}</button><p className="hint">也可以在项目根目录执行：<code>{browser?.installCommand || 'npm run playwright:install'}</code></p></>}
    </section>

    <section className="card"><h2>平台账号与访问</h2>
      <p className="hint">只通过你在本机完成的正常登录复用 Profile；不会导出 Cookie、密码、短信、二维码、CA 或 UKey。未验收 selector 的平台只做落地页取证并进入人工复核。</p>
      <table><thead><tr><th>平台</th><th>访问方式</th><th>适配器</th><th>Profile</th><th>操作</th></tr></thead><tbody>{platforms.map((platform) => {
        const sessionId = loginSessions[platform.id];
        const requiresLogin = platform.accessMode !== 'public';
        return <tr key={platform.id}><td>{platform.name}</td><td>{platform.accessMode}</td><td>{platform.adapterStatus}</td><td>{platform.profile.status}</td><td>
          {requiresLogin && !sessionId && <button disabled={!browser?.ready} onClick={() => void openLogin(platform.id)}>打开登录</button>}
          {sessionId && <><button onClick={() => void completeLogin(platform.id)}>确认登录完成</button><button className="secondary" onClick={() => void cancelLogin(platform.id)}>取消</button></>}
          {requiresLogin && platform.profile.status === 'user-confirmed' && <button className="danger" onClick={() => void clearProfile(platform.id)}>清除 Profile</button>}
        </td></tr>;
      })}</tbody></table>
    </section>

    <section className="card"><h2>企业微信 Bot</h2>
      <p className="hint">状态：{wecom?.configured ? (wecom.enabled ? '已配置' : '已禁用') : '未配置'}；目标会话：{wecom?.targetCount ?? 0} 个。Bot ID 与 Secret 仅写入 macOS Keychain。</p>
      <label>Bot ID<input value={botId} onChange={(event) => setBotId(event.target.value)} autoComplete="off" /></label>
      <label>Bot Secret<input value={botSecret} onChange={(event) => setBotSecret(event.target.value)} type="password" autoComplete="new-password" /></label>
      <label>目标会话 ID（每行一个，或用逗号/分号分隔）<textarea value={targetIds} onChange={(event) => setTargetIds(event.target.value)} placeholder="chatid 或 userid" /></label>
      <button disabled={wecomAction !== null} onClick={() => void saveWeCom()}>{wecomAction === 'save' ? '正在保存…' : '保存凭证'}</button>
      <button className="secondary" disabled={!wecom?.configured || wecomAction !== null} onClick={() => void testWeCom()}>{wecomAction === 'auth' ? '正在认证…' : '测试认证'}</button>
      <button className="secondary" disabled={!wecom?.configured || (wecom?.targetCount ?? 0) === 0 || wecomAction !== null} onClick={() => void sendWeComTest()}>{wecomAction === 'send' ? '正在发送…' : '发送测试通知'}</button>
    </section>

    <section className="card"><h2>新建任务</h2>
      <label>任务名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：广东通信项目监控" /></label>
      <label>项目名称（每行一个）<textarea value={queries} onChange={(event) => setQueries(event.target.value)} placeholder="项目名称或项目编号" /></label>
      <label>隐私模式<select value={privacyMode} onChange={(event) => setPrivacyMode(event.target.value)}><option value="strict-local">严格本地</option><option value="internal-enhanced">内网增强</option><option value="hybrid">混合模式</option></select></label>
      <p>已识别 {parsedQueries.length} 条查询，默认目标为 9 个标讯平台。</p><button onClick={() => void createTask()}>创建任务</button><button className="secondary" onClick={() => void refresh()}>刷新</button>
    </section>

    <section className="card"><h2>任务</h2><table><thead><tr><th>名称</th><th>状态</th><th>查询</th><th>更新时间</th><th>操作</th></tr></thead><tbody>{tasks.map((task) => <tr key={task.id}><td>{task.name}</td><td>{task.status}</td><td>{task.queries.length}</td><td>{task.updatedAt}</td><td><button disabled={task.status === 'running' || !browser?.ready} onClick={() => void startTask(task.id)}>执行</button><button className="secondary" onClick={() => void showLatestRun(task.id)}>日志</button></td></tr>)}</tbody></table></section>

    {activeRun && <section className="card"><h2>运行日志</h2>
      <p className="hint">Run：{activeRun.id} · 状态：{activeRun.status} · Correlation：{activeRun.correlationId} · 证据：{artifacts.length} 项</p>
      <table><thead><tr><th>时间</th><th>级别</th><th>事件</th><th>负载</th></tr></thead><tbody>{runEvents.slice(-80).map((event) => <tr key={event.id}><td>{event.timestamp}</td><td>{event.level}</td><td>{event.type}</td><td><code>{JSON.stringify(event.payload)}</code></td></tr>)}</tbody></table>
      {artifacts.length > 0 && <details><summary>证据索引（{artifacts.length}）</summary><ul>{artifacts.map((artifact) => <li key={artifact.id}>{artifact.platformId} · {artifact.kind} · <code>{artifact.relativePath}</code></li>)}</ul></details>}
    </section>}
  </main>;
}

createRoot(document.getElementById('root')!).render(<App/>);
