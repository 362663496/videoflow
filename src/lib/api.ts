import type { AiProviderConfig, AiProviderInput, JobArtifacts, SessionPayload, User, VideoJob } from './types';

const TOKEN_KEY = 'videoflow_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (!(init.body instanceof FormData) && init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(path, { ...init, headers });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? ((await response.json().catch(() => ({}))) as T & { error?: string })
    : ({ error: await response.text().catch(() => '') } as T & { error?: string });
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}

export const api = {
  login(email: string, password: string) {
    return request<SessionPayload>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
  },
  register(name: string, email: string, password: string) {
    return request<SessionPayload>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password })
    });
  },
  me() {
    return request<{ user: User }>('/api/auth/me');
  },
  changePassword(currentPassword: string, newPassword: string) {
    return request<{ user: User }>('/api/auth/password', {
      method: 'PUT',
      body: JSON.stringify({ currentPassword, newPassword })
    });
  },
  listJobs(scope?: 'all') {
    return request<{ jobs: VideoJob[] }>(`/api/jobs${scope ? '?scope=all' : ''}`);
  },
  getJob(id: string) {
    return request<{ job: VideoJob }>(`/api/jobs/${id}`);
  },
  getJobArtifacts(id: string) {
    return request<{ artifacts: JobArtifacts }>(`/api/jobs/${id}/artifacts`);
  },
  createJob(title: string, file: File) {
    const form = new FormData();
    form.set('title', title);
    form.set('video', file);
    return request<{ job: VideoJob }>('/api/jobs', { method: 'POST', body: form });
  },
  deleteJob(id: string) {
    return request<{ job: VideoJob }>(`/api/jobs/${id}`, { method: 'DELETE' });
  },
  retryJob(id: string) {
    return request<{ job: VideoJob }>(`/api/jobs/${id}/retry`, { method: 'POST' });
  },
  stats() {
    return request<{ stats: { users: number; disabledUsers: number; jobs: number; completed: number; processing: number; failed: number; providerConfigured: boolean } }>('/api/admin/stats');
  },
  listUsers() {
    return request<{ users: User[] }>('/api/admin/users');
  },
  setUserDisabled(id: string, disabled: boolean) {
    return request<{ user: User }>(`/api/admin/users/${id}/disabled`, {
      method: 'PUT',
      body: JSON.stringify({ disabled })
    });
  },
  listProviders() {
    return request<{ providers: AiProviderConfig[] }>('/api/admin/providers');
  },
  saveProvider(input: AiProviderInput) {
    return request<{ provider: AiProviderConfig }>('/api/admin/providers/active', {
      method: 'PUT',
      body: JSON.stringify(input)
    });
  }
};
