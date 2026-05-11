import { ArrowRight, Clapperboard, Download, Eye, LayoutDashboard, LogOut, PlayCircle, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ProviderSettings } from './components/ProviderSettings';
import { ResultDetail } from './components/ResultDetail';
import { StageTimeline } from './components/StageTimeline';
import { UploadPanel } from './components/UploadPanel';
import { api, clearToken, getToken, setToken } from './lib/api';
import type { SessionPayload, User, VideoJob } from './lib/types';
import './styles.css';

type View = 'app' | 'admin' | 'detail';

const initialView = (): View => (window.location.pathname.startsWith('/admin') ? 'admin' : 'app');
const pathForView = (view: View) => (view === 'admin' ? '/admin' : '/');

function safeTitle(job: VideoJob) {
  return job.title?.trim() || job.fileName?.trim() || '未命名视频';
}

function setBrowserPath(view: View) {
  const nextPath = pathForView(view);
  if (window.location.pathname !== nextPath) window.history.pushState(null, '', nextPath);
}

function AuthCard({ onSession }: { onSession: (payload: SessionPayload) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function submit() {
    setError('');
    try {
      const payload = await api.login(email, password);
      setToken(payload.token);
      onSession(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    }
  }

  return (
    <div className="auth-card card">
      <p className="eyebrow">安全访问</p>
      <h2>登录账号</h2>
      <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="邮箱" />
      <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="密码" type="password" />
      {error && <p className="form-error">{error}</p>}
      <button onClick={submit}>登录</button>
      <p className="hint">账号注册已关闭，请联系管理员开通账号。</p>
    </div>
  );
}

function EmptyWorkbench() {
  return (
    <section className="timeline-card empty-state">
      <p className="eyebrow">等待素材</p>
      <h3>上传一个视频开始生成</h3>
      <p className="muted">处理进度会同步显示：解析素材、语音转写、画面分析、生成提词与结果校验。</p>
    </section>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [view, setViewState] = useState<View>(initialView);
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [detailReturnView, setDetailReturnView] = useState<'app' | 'admin'>('app');
  const [stats, setStats] = useState<{ users: number; jobs: number; completed: number; processing: number } | null>(null);
  const [actionError, setActionError] = useState('');

  const selectedJob = useMemo(() => jobs.find((job) => job.id === selectedJobId) ?? jobs[0], [jobs, selectedJobId]);

  function setView(nextView: View) {
    setViewState(nextView);
    setBrowserPath(nextView);
  }

  async function refresh(scope?: 'all') {
    if (!getToken()) return;
    const { jobs: nextJobs } = await api.listJobs(scope);
    setJobs(nextJobs);
    if (scope === 'all') setStats((await api.stats()).stats);
  }

  useEffect(() => {
    const onPopState = () => setViewState(initialView());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    api.me()
      .then(({ user: current }) => {
        setUser(current);
        refresh(current.role === 'admin' && view === 'admin' ? 'all' : undefined).catch(() => undefined);
      })
      .catch(() => clearToken());
  }, [view]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (user) refresh(user.role === 'admin' && view === 'admin' ? 'all' : undefined).catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [user, view]);

  function logout() {
    clearToken();
    setUser(null);
    setJobs([]);
    setSelectedJobId(null);
    setStats(null);
    setView('app');
  }

  async function deleteJob(job: VideoJob) {
    const confirmed = window.confirm(`确认删除任务「${safeTitle(job)}」？删除后会同时清理上传文件与生成结果。`);
    if (!confirmed) return;
    setActionError('');
    try {
      await api.deleteJob(job.id);
      setJobs((current) => current.filter((item) => item.id !== job.id));
      setSelectedJobId((current) => (current === job.id ? null : current));
      if (view === 'admin') setStats((await api.stats()).stats);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '删除失败');
    }
  }

  function openDetail(job: VideoJob) {
    setSelectedJobId(job.id);
    setDetailReturnView(view === 'admin' ? 'admin' : 'app');
    setView('detail');
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView('app')}><Clapperboard /> VideoFlow</button>
        <nav>
          <button onClick={() => setView('app')}>工作台</button>
          {user?.role === 'admin' && <button onClick={() => setView('admin')}>后台</button>}
        </nav>
        <div className="user-box">
          {user ? <><UserRound size={18} />{user.name}<button onClick={logout}><LogOut size={16} /></button></> : <button onClick={() => setView('app')}>登录</button>}
        </div>
      </header>

      {view === 'app' && !user && <main className="center"><AuthCard onSession={(payload) => { setUser(payload.user); setView('app'); refresh().catch(() => undefined); }} /></main>}

      {view === 'app' && user && (
        <main className="workspace">
          <UploadPanel onCreated={(job) => { setJobs((current) => [job, ...current]); setSelectedJobId(job.id); }} />
          {actionError && <p className="form-error">{actionError}</p>}
          <section className="job-layout">
            <div className="job-list card">
              <h3><PlayCircle size={18} /> 我的任务</h3>
              {jobs.length === 0 && <p className="muted">上传视频后，任务会显示在这里。</p>}
              {jobs.map((job) => (
                <div className={`job-item ${selectedJob?.id === job.id ? 'active' : ''}`} key={job.id}>
                  <button className="job-select" onClick={() => setSelectedJobId(job.id)}>
                    <b>{safeTitle(job)}</b><span>{job.status} · {job.progress}%</span>
                  </button>
                  <button className="icon-button danger" aria-label="删除任务" onClick={() => deleteJob(job)}><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
            {selectedJob ? <StageTimeline job={selectedJob} /> : <EmptyWorkbench />}
          </section>
          {selectedJob?.status === 'complete' && <button className="detail-button" onClick={() => openDetail(selectedJob)}>查看结果 <ArrowRight size={18} /></button>}
        </main>
      )}

      {view === 'detail' && selectedJob && <main className="workspace"><ResultDetail job={selectedJob} onBack={() => setView(detailReturnView)} /></main>}

      {view === 'admin' && !user && <main className="center"><AuthCard onSession={(payload) => { setUser(payload.user); setView('admin'); refresh('all').catch(() => undefined); }} /></main>}
      {view === 'admin' && user && (
        <main className="workspace">
          <section className="admin-hero card">
            <div><p className="eyebrow">后台管理</p><h2>任务队列与平台概览</h2></div>
            {user.role !== 'admin' && <p className="form-error">当前账号无后台权限。</p>}
          </section>
          {user.role === 'admin' && stats && <section className="stats-grid">
            <div className="stat card"><ShieldCheck />用户<b>{stats.users}</b></div>
            <div className="stat card"><LayoutDashboard />任务<b>{stats.jobs}</b></div>
            <div className="stat card">完成<b>{stats.completed}</b></div>
            <div className="stat card">处理中<b>{stats.processing}</b></div>
          </section>}
          {user.role === 'admin' && <ProviderSettings />}
          {actionError && <p className="form-error">{actionError}</p>}
          {user.role === 'admin' && <section className="card admin-table">
            <h3>最近任务</h3>
            {jobs.length === 0 && <p className="muted">暂无任务。</p>}
            {jobs.map((job) => (
              <div className="table-row" key={job.id}>
                <div><b>{safeTitle(job)}</b><small>{new Date(job.createdAt).toLocaleString()}</small></div>
                <span className="muted">{job.status} · {job.progress}%</span>
                <div className="table-actions">
                  {job.fileUrl && <a className="mini-button" href={job.fileUrl} download><Download size={15} />视频</a>}
                  <button className="mini-button" onClick={() => openDetail(job)} disabled={!job.result}><Eye size={15} />详情</button>
                  <button className="mini-button danger" onClick={() => deleteJob(job)}><Trash2 size={15} />删除</button>
                </div>
              </div>
            ))}
          </section>}
        </main>
      )}
    </div>
  );
}
