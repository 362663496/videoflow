import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import type { JobArtifactFile, JobArtifacts, User, VideoJob } from '../src/lib/types';
import { createStages, runVideoJob } from './processor';
import { store } from './store';

const app = express();
const port = Number(process.env.PORT ?? 8787);
const uploadDir = path.resolve(process.cwd(), 'server/uploads');
const outputDir = path.resolve(process.cwd(), 'server/outputs');
mkdirSync(uploadDir, { recursive: true });
mkdirSync(outputDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => {
      const extension = path.extname(file.originalname);
      cb(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
    }
  }),
  limits: { fileSize: 500 * 1024 * 1024 }
});

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

app.use(express.json());
app.use('/uploads', express.static(uploadDir));
app.use('/outputs', express.static(outputDir));

function auth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
  const user = token ? store.getUserByToken(token) : undefined;
  if (!user) return res.status(401).json({ error: '请先登录' });
  req.user = user;
  next();
}

function adminOnly(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: '需要管理员权限' });
  next();
}

const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6)
});
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const passwordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(6) });
const disabledSchema = z.object({ disabled: z.boolean() });
const providerSchema = z.object({
  name: z.string().min(1),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  scriptModel: z.string().min(1),
  enabled: z.boolean()
});

app.get('/api/health', (_req, res) => res.json({ ok: true, name: 'videoflow-api' }));

app.post('/api/auth/register', (req, res) => {
  if (process.env.VIDEOFLOW_ALLOW_REGISTRATION !== 'true') {
    return res.status(403).json({ error: '账号注册已关闭，请联系管理员开通账号' });
  }
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: '注册信息不完整' });
  try {
    const user = store.createUser(parsed.data);
    res.json(store.createSession(user.id));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : '注册失败' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: '登录信息不完整' });
  const user = store.findUserByEmail(parsed.data.email);
  if (!user || user.password !== parsed.data.password) return res.status(401).json({ error: '邮箱或密码错误' });
  if (user.disabled) return res.status(403).json({ error: '账号已被管理员禁用' });
  res.json(store.createSession(user.id));
});

app.get('/api/auth/me', auth, (req, res) => res.json({ user: req.user }));

app.put('/api/auth/password', auth, (req, res) => {
  const parsed = passwordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: '密码信息不完整' });
  try {
    res.json({ user: store.updatePassword(req.user!.id, parsed.data.currentPassword, parsed.data.newPassword) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : '修改密码失败' });
  }
});

app.get('/api/jobs', auth, (req, res) => {
  const jobs = req.user?.role === 'admin' && req.query.scope === 'all' ? store.listJobs() : store.listJobs(req.user!.id);
  res.json({ jobs });
});

app.post('/api/jobs', auth, upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请上传视频文件' });
  const job: VideoJob = {
    id: crypto.randomUUID(),
    userId: req.user!.id,
    title: String(req.body.title || 'AI 识别中'),
    fileName: req.file.originalname,
    fileUrl: `/uploads/${req.file.filename}`,
    sourcePath: req.file.path,
    status: 'queued',
    currentStage: 'queued',
    progress: 0,
    stages: createStages(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  store.saveJob(job);
  void runVideoJob(job.id);
  res.status(201).json({ job });
});

app.get('/api/jobs/:id', auth, (req, res) => {
  const jobId = String(req.params.id);
  const job = store.getJob(jobId);
  if (!job) return res.status(404).json({ error: '任务不存在' });
  if (req.user!.role !== 'admin' && job.userId !== req.user!.id) return res.status(403).json({ error: '无权查看该任务' });
  res.json({ job });
});

function artifactUrl(jobId: string, relativePath: string) {
  return `/outputs/${encodeURIComponent(jobId)}/${relativePath.split(path.sep).map(encodeURIComponent).join('/')}`;
}

async function collectJobArtifacts(jobId: string): Promise<JobArtifacts> {
  const root = path.join(outputDir, jobId);
  const artifacts: JobArtifacts = { frames: [], markdown: [] };
  if (!existsSync(root)) return artifacts;
  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      const relativePath = path.relative(root, fullPath);
      const file: JobArtifactFile = { name: entry.name, relativePath, url: artifactUrl(jobId, relativePath) };
      if (/\.(jpe?g|png|webp)$/i.test(entry.name)) {
        const match = entry.name.match(/_(\d+(?:\.\d+)?)s\./i);
        artifacts.frames.push({ ...file, timestampSeconds: match ? Number(match[1]) : undefined });
      } else if (/\.md$/i.test(entry.name)) {
        artifacts.markdown.push(file);
      } else if (/\.(wav|mp3|m4a|aac|ogg)$/i.test(entry.name) && !artifacts.audio) {
        artifacts.audio = file;
      }
    }
  }
  await walk(root);
  artifacts.frames.sort((a, b) => (a.timestampSeconds ?? 0) - (b.timestampSeconds ?? 0));
  artifacts.markdown.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  return artifacts;
}

app.get('/api/jobs/:id/artifacts', auth, async (req, res) => {
  const jobId = String(req.params.id);
  const job = store.getJob(jobId);
  if (!job) return res.status(404).json({ error: '任务不存在' });
  if (req.user!.role !== 'admin' && job.userId !== req.user!.id) return res.status(403).json({ error: '无权查看该任务' });
  try {
    res.json({ artifacts: await collectJobArtifacts(jobId) });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : '读取素材失败' });
  }
});

app.delete('/api/jobs/:id', auth, (req, res) => {
  const jobId = String(req.params.id);
  const job = store.getJob(jobId);
  if (!job) return res.status(404).json({ error: '任务不存在' });
  if (job.userId !== req.user!.id) return res.status(403).json({ error: '只能删除自己的任务' });
  const deleted = store.deleteJob(jobId);
  res.json({ job: deleted });
});

app.post('/api/jobs/:id/retry', auth, adminOnly, (req, res) => {
  const jobId = String(req.params.id);
  const job = store.getJob(jobId);
  if (!job) return res.status(404).json({ error: '任务不存在' });
  const reset: VideoJob = {
    ...job,
    status: 'queued',
    currentStage: 'queued',
    progress: 0,
    error: undefined,
    result: undefined,
    stages: createStages(),
    updatedAt: new Date().toISOString()
  };
  store.saveJob(reset);
  void runVideoJob(reset.id);
  res.json({ job: reset });
});

app.get('/api/admin/stats', auth, adminOnly, (_req, res) => res.json({ stats: store.stats() }));

app.get('/api/admin/users', auth, adminOnly, (_req, res) => {
  res.json({ users: store.listUsers() });
});

app.put('/api/admin/users/:id/disabled', auth, adminOnly, (req, res) => {
  const parsed = disabledSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: '禁用状态不完整' });
  try {
    res.json({ user: store.setUserDisabled(String(req.params.id), parsed.data.disabled) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : '用户状态更新失败' });
  }
});

app.get('/api/admin/providers', auth, adminOnly, (_req, res) => {
  res.json({ providers: store.listProviders() });
});

app.put('/api/admin/providers/active', auth, adminOnly, (req, res) => {
  const parsed = providerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Provider 配置不完整' });
  try {
    res.json({ provider: store.upsertProvider(parsed.data) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Provider 保存失败' });
  }
});

const webDist = path.resolve(process.cwd(), 'dist/web');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.use((_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

app.listen(port, () => {
  console.log(`VideoFlow API listening on http://localhost:${port}`);
});
