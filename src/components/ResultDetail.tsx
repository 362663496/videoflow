import { ArrowLeft, Check, Clipboard, Download, Film, Image, Mic2, ScrollText, Sparkles, Video } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { JobArtifacts, VideoJob } from '../lib/types';

type DetailTab = 'full' | 'storyboard' | 'imitation' | 'frames' | 'audio';

const scriptTabs: Array<{ id: DetailTab; label: string; fileName: string; field: 'fullScriptMarkdown' | 'storyboardMarkdown' | 'imitationMarkdown' }> = [
  { id: 'full', label: '完整剧本', fileName: '完整剧本.md', field: 'fullScriptMarkdown' },
  { id: 'storyboard', label: '分镜剧本', fileName: '分镜剧本.md', field: 'storyboardMarkdown' },
  { id: 'imitation', label: '复刻提示词', fileName: '仿写脚本.md', field: 'imitationMarkdown' }
];

export function ResultDetail({ job, onBack }: { job: VideoJob; onBack?: () => void }) {
  const result = job.result;
  const [activeTab, setActiveTab] = useState<DetailTab>('full');
  const [copiedTab, setCopiedTab] = useState<DetailTab | null>(null);
  const [artifacts, setArtifacts] = useState<JobArtifacts>({ frames: [], markdown: [] });
  useEffect(() => {
    if (!result) return;
    api.getJobArtifacts(job.id).then(({ artifacts }) => setArtifacts(artifacts)).catch(() => undefined);
  }, [job.id, result]);

  if (!result) return null;

  const activeScript = scriptTabs.find((tab) => tab.id === activeTab);
  const activeMarkdown = activeScript ? result[activeScript.field] || '' : '';

  async function copyMarkdown() {
    if (!activeScript) return;
    await navigator.clipboard.writeText(activeMarkdown);
    setCopiedTab(activeScript.id);
    window.setTimeout(() => setCopiedTab(null), 1600);
  }

  return (
    <section className="detail-grid">
      <div className="result-main card">
        {onBack && <button className="mini-button back-button" onClick={onBack}><ArrowLeft size={16} />返回</button>}
        <p className="eyebrow">生成结果</p>
        <h2>{result.title || job.title}</h2>
        {job.fileUrl && <a className="mini-button result-download" href={job.fileUrl} download><Download size={16} />下载原视频</a>}
        <p>{result.summary}</p>
        <div className="tag-row">{result.styleTags.map((tag) => <span key={tag}>{tag}</span>)}</div>

        <div className="script-tabs" role="tablist" aria-label="结果与素材">
          {scriptTabs.map((tab) => (
            <button className={activeTab === tab.id ? 'active' : ''} key={tab.id} onClick={() => setActiveTab(tab.id)} role="tab" aria-selected={activeTab === tab.id}>
              {tab.id === 'imitation' ? <Sparkles size={15} /> : <ScrollText size={15} />}{tab.label}
            </button>
          ))}
          <button className={activeTab === 'frames' ? 'active' : ''} onClick={() => setActiveTab('frames')} role="tab" aria-selected={activeTab === 'frames'}><Image size={15} />图片/分镜</button>
          <button className={activeTab === 'audio' ? 'active' : ''} onClick={() => setActiveTab('audio')} role="tab" aria-selected={activeTab === 'audio'}><Mic2 size={15} />音频</button>
        </div>

        {activeScript && <div className="markdown-box script-panel" role="tabpanel">
          <div className="markdown-head">
            <h3>{activeScript.fileName}</h3>
            <button className="copy-button" onClick={copyMarkdown} title="复制当前 Markdown">
              {copiedTab === activeScript.id ? <Check size={17} /> : <Clipboard size={17} />}
              {copiedTab === activeScript.id ? '已复制' : '复制'}
            </button>
          </div>
          <pre>{activeMarkdown || '暂无内容'}</pre>
        </div>}

        {activeTab === 'frames' && <div className="asset-panel" role="tabpanel">
          <h3><Image size={18} /> 代表帧 / 分镜图片</h3>
          {artifacts.frames.length === 0 && <p className="muted">暂无图片素材。</p>}
          <div className="frame-grid">
            {artifacts.frames.map((frame) => (
              <a className="frame-card" href={frame.url} target="_blank" rel="noreferrer" key={frame.relativePath}>
                <img src={frame.url} alt={frame.name} />
                <span>{typeof frame.timestampSeconds === 'number' ? `${frame.timestampSeconds.toFixed(2)}s` : frame.name}</span>
              </a>
            ))}
          </div>
          {artifacts.markdown.length > 0 && <div className="asset-links">
            <h4>Markdown 文件</h4>
            {artifacts.markdown.map((file) => <a className="mini-button" href={file.url} target="_blank" rel="noreferrer" key={file.relativePath}><Download size={15} />{file.name}</a>)}
          </div>}
        </div>}

        {activeTab === 'audio' && <div className="asset-panel" role="tabpanel">
          <h3><Mic2 size={18} /> 音频素材</h3>
          {artifacts.audio ? <>
            <audio controls src={artifacts.audio.url} />
            <a className="mini-button" href={artifacts.audio.url} download><Download size={15} />下载 {artifacts.audio.name}</a>
          </> : <p className="muted">暂无可播放音频素材。</p>}
        </div>}
      </div>
      <aside className="card side-panel">
        <h3><Sparkles size={18} /> 详情信息</h3>
        <div className="metric"><Film /> 分镜数量 <b>{result.shots.length}</b></div>
        <div className="metric"><Mic2 /> 字幕片段 <b>{result.transcript.length}</b></div>
        <div className="metric"><Image /> 代表帧 <b>{artifacts.frames.length}</b></div>
        <div className="metric"><Video /> 素材类型 <b>{artifacts.audio ? '含音频' : '图片/文档'}</b></div>
        <h4>字幕线索</h4>
        {result.transcript.map((line) => <p className="line" key={line.time}><b>{line.time}</b>{line.text}</p>)}
        <h4>说明</h4>
        {result.assumptions.map((item) => <p className="muted" key={item}>• {item}</p>)}
      </aside>
    </section>
  );
}
