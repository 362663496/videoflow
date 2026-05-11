import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AiProviderConfig, AiProviderInput, User, VideoJob } from '../src/lib/types';

interface StoredUser extends User {
  password: string;
}

interface StoredAiProvider extends AiProviderConfig {
  apiKey: string;
}

interface DbShape {
  users: StoredUser[];
  sessions: Record<string, string>;
  jobs: VideoJob[];
  providers: StoredAiProvider[];
}

const dataDir = path.resolve(process.cwd(), 'server/data');
const dbPath = path.join(dataDir, 'db.json');

const now = () => new Date().toISOString();
const seed: DbShape = {
  users: [
    {
      id: 'u_admin',
      name: '管理员',
      email: process.env.VIDEOFLOW_ADMIN_EMAIL || 'admin@videoflow.local',
      password: process.env.VIDEOFLOW_ADMIN_PASSWORD || crypto.randomUUID(),
      role: 'admin',
      createdAt: now()
    }
  ],
  sessions: {},
  jobs: [],
  providers: process.env.OPENAI_API_KEY
    ? [
        {
          id: 'provider_default',
          name: 'Default Provider',
          baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
          apiKey: process.env.OPENAI_API_KEY,
          scriptModel: process.env.OPENAI_SCRIPT_MODEL || 'gpt-4.1',
          transcribeModel: process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe',
          enabled: true,
          createdAt: now(),
          updatedAt: now()
        }
      ]
    : []
};

function normalizeDb(value: Partial<DbShape>): DbShape {
  return {
    users: value.users ?? seed.users,
    sessions: value.sessions ?? {},
    jobs: value.jobs ?? [],
    providers: value.providers ?? seed.providers
  };
}

function ensureDb() {
  mkdirSync(dataDir, { recursive: true });
  try {
    const existing = normalizeDb(JSON.parse(readFileSync(dbPath, 'utf8')) as Partial<DbShape>);
    writeFileSync(dbPath, JSON.stringify(existing, null, 2));
  } catch {
    writeFileSync(dbPath, JSON.stringify(seed, null, 2));
  }
}

function readDb(): DbShape {
  ensureDb();
  return normalizeDb(JSON.parse(readFileSync(dbPath, 'utf8')) as Partial<DbShape>);
}

function writeDb(db: DbShape) {
  writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

const publicUser = (storedUser: StoredUser): User => {
  const { id, name, email, role, createdAt } = storedUser;
  return { id, name, email, role, createdAt };
};

const maskKey = (value: string) => (value ? `${value.slice(0, 4)}••••${value.slice(-4)}` : '');
const publicProvider = (provider: StoredAiProvider): AiProviderConfig => ({ ...provider, apiKey: maskKey(provider.apiKey) });

function normalizeBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('base_url 不能为空');
  return trimmed;
}

export const store = {
  findUserByEmail(email: string) {
    return readDb().users.find((user) => user.email.toLowerCase() === email.toLowerCase());
  },
  findUserById(id: string) {
    return readDb().users.find((user) => user.id === id);
  },
  createUser(input: { name: string; email: string; password: string }): User {
    const db = readDb();
    if (db.users.some((user) => user.email.toLowerCase() === input.email.toLowerCase())) {
      throw new Error('邮箱已注册');
    }
    const user: StoredUser = {
      id: crypto.randomUUID(),
      name: input.name,
      email: input.email,
      password: input.password,
      role: 'user',
      createdAt: now()
    };
    db.users.push(user);
    writeDb(db);
    return publicUser(user);
  },
  createSession(userId: string) {
    const db = readDb();
    const token = crypto.randomUUID();
    db.sessions[token] = userId;
    writeDb(db);
    const user = db.users.find((item) => item.id === userId);
    if (!user) throw new Error('用户不存在');
    return { token, user: publicUser(user) };
  },
  getUserByToken(token: string) {
    const db = readDb();
    const userId = db.sessions[token];
    const user = userId ? db.users.find((item) => item.id === userId) : undefined;
    return user ? publicUser(user) : undefined;
  },
  listJobs(userId?: string) {
    const jobs = readDb().jobs;
    return userId ? jobs.filter((job) => job.userId === userId) : jobs;
  },
  getJob(id: string) {
    return readDb().jobs.find((job) => job.id === id);
  },
  saveJob(job: VideoJob) {
    const db = readDb();
    const index = db.jobs.findIndex((item) => item.id === job.id);
    if (index >= 0) db.jobs[index] = job;
    else db.jobs.unshift(job);
    writeDb(db);
    return job;
  },
  listProviders() {
    return readDb().providers.map(publicProvider);
  },
  getActiveProvider() {
    return readDb().providers.find((provider) => provider.enabled);
  },
  upsertProvider(input: AiProviderInput) {
    const db = readDb();
    const timestamp = now();
    const existing = db.providers[0];
    const provider: StoredAiProvider = {
      id: existing?.id ?? crypto.randomUUID(),
      name: input.name.trim() || 'AI Provider',
      baseUrl: normalizeBaseUrl(input.baseUrl),
      apiKey: input.apiKey.trim() || existing?.apiKey || '',
      scriptModel: input.scriptModel.trim(),
      transcribeModel: input.transcribeModel.trim(),
      enabled: input.enabled,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    if (!provider.apiKey) throw new Error('api_key 不能为空');
    if (!provider.scriptModel) throw new Error('脚本模型不能为空');
    if (!provider.transcribeModel) throw new Error('转写模型不能为空');
    db.providers = [provider];
    writeDb(db);
    return publicProvider(provider);
  },
  stats() {
    const db = readDb();
    return {
      users: db.users.length,
      jobs: db.jobs.length,
      completed: db.jobs.filter((job) => job.status === 'complete').length,
      processing: db.jobs.filter((job) => job.status === 'processing' || job.status === 'queued').length
    };
  }
};
