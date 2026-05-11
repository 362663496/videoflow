import { UploadCloud } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import type { VideoJob } from '../lib/types';

export function UploadPanel({ onCreated }: { onCreated: (job: VideoJob) => void }) {
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!file) {
      setError('请选择视频文件');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { job } = await api.createJob(title || file.name.replace(/\.[^.]+$/, ''), file);
      onCreated(job);
      setTitle('');
      setFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="upload-card">
      <div className="upload-copy">
        <p className="eyebrow">创作者工作台</p>
        <h2>上传视频，生成完整剧本与分镜剧本</h2>
        <p>系统会解析素材、转写音频、分析画面，并生成可用于复盘、复刻和拍摄执行的交付文档。</p>
      </div>
      <div className="drop-zone">
        <UploadCloud size={40} />
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="视频标题" />
        <label>
          <span>{file ? file.name : '选择视频文件'}</span>
          <input type="file" accept="video/*" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button onClick={submit} disabled={busy}>{busy ? '上传中...' : '开始生成'}</button>
      </div>
    </section>
  );
}
