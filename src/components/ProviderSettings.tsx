import { Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { AiProviderInput } from '../lib/types';

const emptyProvider: AiProviderInput = {
  name: 'OpenAI Compatible Provider',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  scriptModel: 'gpt-4.1',
  transcribeModel: '',
  enabled: true
};

export function ProviderSettings() {
  const [form, setForm] = useState<AiProviderInput>(emptyProvider);
  const [maskedKey, setMaskedKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.listProviders().then(({ providers }) => {
      const provider = providers[0];
      if (!provider) return;
      setMaskedKey(provider.apiKey || '');
      setForm({
        name: provider.name,
        baseUrl: provider.baseUrl,
        apiKey: '',
        scriptModel: provider.scriptModel,
        transcribeModel: provider.transcribeModel,
        enabled: provider.enabled
      });
    }).catch(() => undefined);
  }, []);

  function update<K extends keyof AiProviderInput>(key: K, value: AiProviderInput[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit() {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const { provider } = await api.saveProvider(form);
      setMaskedKey(provider.apiKey || '');
      setForm((current) => ({ ...current, apiKey: '' }));
      setMessage('Provider 已保存');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card provider-card">
      <div>
        <p className="eyebrow">AI Provider</p>
        <h3>模型服务配置</h3>
      </div>
      <div className="provider-grid">
        <label>名称<input value={form.name} onChange={(event) => update('name', event.target.value)} /></label>
        <label>Base URL<input value={form.baseUrl} onChange={(event) => update('baseUrl', event.target.value)} placeholder="https://api.openai.com/v1" /></label>
        <label>API Key<input value={form.apiKey} onChange={(event) => update('apiKey', event.target.value)} placeholder={maskedKey || '输入 API Key'} type="password" /></label>
        <label>脚本模型<input value={form.scriptModel} onChange={(event) => update('scriptModel', event.target.value)} /></label>
        <label>转写模型<input value={form.transcribeModel} onChange={(event) => update('transcribeModel', event.target.value)} placeholder="可留空；只有 whisper 或 *transcribe 模型才调用音频转写接口" /></label>
        <label className="check-row"><input checked={form.enabled} onChange={(event) => update('enabled', event.target.checked)} type="checkbox" />启用</label>
      </div>
      <p className="hint">如果中转站只支持 /chat/completions，可把转写模型留空，系统会跳过音频转写并使用画面帧与元数据生成结果。</p>
      {message && <p className="success-text">{message}</p>}
      {error && <p className="form-error">{error}</p>}
      <button className="detail-button" onClick={submit} disabled={saving}><Save size={18} />{saving ? '保存中...' : '保存 Provider'}</button>
    </section>
  );
}
