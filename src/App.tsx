import { ArrowRight, Clapperboard, LayoutDashboard, LogOut, PlayCircle, ShieldCheck, UserRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ProviderSettings } from './components/ProviderSettings';
import { ResultDetail } from './components/ResultDetail';
import { StageTimeline } from './components/StageTimeline';
import { UploadPanel } from './components/UploadPanel';
import { api, clearToken, getToken, setToken } from './lib/api';
import type { SessionPayload, User, VideoJob } from './lib/types';
import './styles.css';

type View = 'home' | 'app' | 'admin' | 'detail';

function AuthCard({ onSession }: { onSession: (payload: SessionPayload) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function submit() {
    setError('');
    try {
      const payload = mode === 'login' ? await api.login(email, password) : await api.register(name, email, password);
      setToken(payload.token);
      onSession(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  }

  return (
    <div className="auth-card card">
      <p className="eyebrow">安全访问</p>
      <h2>{mode === 'login' ? '登录账号' : '创建账号'}</h2>
      {mode === 'register' && <input value={name} onChange={(event) => setName(event.target.value)} placeholder="昵称" />}
      <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="邮箱" />
      <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="密码" type="password" />
      {error && <p className="form-error">{error}</p>}
      <button onClick={submit}>{mode === 'login' ? '登录' : '注册并登录'}</button>
      <button className="ghost" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
        {mode === 'login' ? '创建新账号' : '使用已有账号登录'}
      </button>
    </div>
  );
}

function Hero({ authed, onStart }: { authed: boolean; onStart: () => void }) {
  return (
    <section className="hero">
      <div className="hero-copy">
        <span className="pill">短视频提词 · 分镜拆解 · 内容生产</span>
        <h1>上传视频，生成可交付的完整剧本与分镜分析</h1>
        <p>系统会提取视频画面、音频与字幕线索，生成完整剧本、分镜剧本、风格总结和可复用内容结构。</p>
        <button onClick={onStart}>{authed ? '进入工作台' : '开始使用'} <ArrowRight size={18} /></button>
      </div>
      <div className="phone-preview">
        <div className="phone-top" />
        <div className="note-card hot"><b>语音转写</b><span>对白、口播、字幕线索</span></div>
        <div className="note-card"><b>画面分析</b><span>镜头、动作、叙事节奏</span></div>
        <div className="note-card pink"><b>分镜剧本.md</b><span>逐 Clip 专业拆解</span></div>
      </div>
    </section>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<View>('home');
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [stats, setStats] = useState<{ users: number; jobs: number; completed: number; processing: number } | null>(null);

  const selectedJob = useMemo(() => jobs.find((job) => job.id === selectedJobId) ?? jobs[0], [jobs, selectedJobId]);

  async function refresh(scope?: 'all') {
    if (!getToken()) return;
    const { jobs: nextJobs } = await api.listJobs(scope);
    setJobs(nextJobs);
    if (scope === 'all') setStats((await api.stats()).stats);
  }

  useEffect(() => {
    if (!getToken()) return;
    api.me().then(({ user: current }) => {
      setUser(current);
      refresh(current.role === 'admin' && view === 'admin' ? 'all' : undefined).catch(() => undefined);
    }).catch(() => clearToken());
  }, [view]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (user && view !== 'home') refresh(user.role === 'admin' && view === 'admin' ? 'all' : undefined).catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [user, view]);

  function logout() {
    clearToken();
    setUser(null);
    setJobs([]);
    setView('home');
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView('home')}><Clapperboard /> VideoFlow</button>
        <nav>
          <button onClick={() => setView('app')}>工作台</button>
          <button onClick={() => setView('admin')}>后台</button>
        </nav>
        <div className="user-box">
          {user ? <><UserRound size={18} />{user.name}<button onClick={logout}><LogOut size={16} /></button></> : <button onClick={() => setView('app')}>登录</button>}
        </div>
      </header>

      {view === 'home' && <Hero authed={Boolean(user)} onStart={() => setView('app')} />}

      {view === 'app' && !user && <main className="center"><AuthCard onSession={(payload) => { setUser(payload.user); setView('app'); refresh().catch(() => undefined); }} /></main>}

      {view === 'app' && user && (
        <main className="workspace">
          <UploadPanel onCreated={(job) => { setJobs((current) => [job, ...current]); setSelectedJobId(job.id); }} />
          <section className="job-layout">
            <div className="job-list card">
              <h3><PlayCircle size={18} /> 我的任务</h3>
              {jobs.length === 0 && <p className="muted">上传视频后，任务会显示在这里。</p>}
              {jobs.map((job) => (
                <button className={`job-item ${selectedJob?.id === job.id ? 'active' : ''}`} key={job.id} onClick={() => setSelectedJobId(job.id)}>
                  <b>{job.title}</b><span>{job.status} · {job.progress}%</span>
                </button>
              ))}
            </div>
            {selectedJob && <StageTimeline job={selectedJob} />}
          </section>
          {selectedJob?.status === 'complete' && <button className="detail-button" onClick={() => setView('detail')}>查看结果 <ArrowRight size={18} /></button>}
        </main>
      )}

      {view === 'detail' && selectedJob && <main className="workspace"><ResultDetail job={selectedJob} /></main>}

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
          <section className="card admin-table">
            <h3>最近任务</h3>
            {jobs.map((job) => <div className="table-row" key={job.id}><b>{job.title}</b><span>{job.fileName}</span><span>{job.status}</span><span>{job.progress}%</span></div>)}
          </section>
        </main>
      )}
    </div>
  );
}
