import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { WeComPanel } from './wecom-panel';
import './style.css';

type Task = { id: string; name: string; status: string; created_at: string; query_count: number; platform_count: number };
const PLATFORMS = ['cmcc','unicom','telecom','tower-online-commerce','tower-eprocurement','cebpubservice','miit','gd-govprocurement','gd-public-resources'];
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

function App() {
  const [name, setName] = useState('');
  const [queries, setQueries] = useState('');
  const [privacy, setPrivacy] = useState('internal-enhanced');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [message, setMessage] = useState('本地 Agent 未启动任务。');
  const parsed = useMemo(() => [...new Set(queries.split(/\r?\n/).map(x => x.trim()).filter(Boolean))], [queries]);
  async function refresh() { setTasks(await invoke<Task[]>('list_tasks')); }
  async function submit() {
    if (!name.trim() || parsed.length === 0) { setMessage('请填写任务名称和至少一个项目名称。'); return; }
    try {
      const task = await invoke<Task>('create_task', { input: { name, queries: parsed, platformIds: PLATFORMS, privacyMode: privacy } });
      setMessage(`任务 ${task.id} 已创建；请先在“平台账号”中完成需要授权的平台人工登录。`);
      setName(''); setQueries(''); await refresh();
    } catch (error) { setMessage(`创建任务失败：${errorText(error)}`); }
  }
  async function start(id: string) {
    try { await invoke('start_task', { taskId: id }); setMessage(`已开始执行 ${id}`); await refresh(); }
    catch (error) { setMessage(`启动任务失败：${errorText(error)}`); }
  }
  return <main>
    <header><h1>标讯截图助手</h1><p>本地执行 · 证据留存 · 企业微信 Bot 通知</p></header>
    <WeComPanel onNotice={setMessage} />
    <section className="card"><h2>新建任务</h2><label>任务名称<input value={name} onChange={e=>setName(e.target.value)} placeholder="例如：广东通信项目监控" /></label>
      <label>项目名称（每行一个）<textarea value={queries} onChange={e=>setQueries(e.target.value)} placeholder="项目名称或项目编号" /></label>
      <label>隐私模式<select value={privacy} onChange={e=>setPrivacy(e.target.value)}><option value="strict-local">严格本地</option><option value="internal-enhanced">内网增强</option><option value="hybrid">混合模式</option></select></label>
      <p>已识别 {parsed.length} 条查询名称；默认选择 9 个平台。</p><button onClick={submit}>创建本地任务</button><button className="secondary" onClick={refresh}>刷新任务</button></section>
    <section className="card"><h2>任务中心</h2><p className="message">{message}</p><table><thead><tr><th>任务</th><th>状态</th><th>项目数</th><th>平台数</th><th>创建时间</th><th>操作</th></tr></thead><tbody>{tasks.map(t=><tr key={t.id}><td>{t.name}</td><td>{t.status}</td><td>{t.query_count}</td><td>{t.platform_count}</td><td>{t.created_at}</td><td><button onClick={()=>start(t.id)}>执行</button></td></tr>)}</tbody></table></section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
