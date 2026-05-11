import { Copy, Film, Mic2, Sparkles } from 'lucide-react';
import type { VideoJob } from '../lib/types';

export function ResultDetail({ job }: { job: VideoJob }) {
  const result = job.result;
  if (!result) return null;
  return (
    <section className="detail-grid">
      <div className="result-main card">
        <p className="eyebrow">生成结果</p>
        <h2>{job.title}</h2>
        <p>{result.summary}</p>
        <div className="tag-row">{result.styleTags.map((tag) => <span key={tag}>{tag}</span>)}</div>
        <div className="markdown-box">
          <h3>完整剧本.md</h3>
          <pre>{result.fullScriptMarkdown}</pre>
        </div>
        <div className="markdown-box">
          <h3>分镜剧本.md</h3>
          <pre>{result.storyboardMarkdown}</pre>
        </div>
      </div>
      <aside className="card side-panel">
        <h3><Sparkles size={18} /> 详情信息</h3>
        <div className="metric"><Film /> 分镜数量 <b>{result.shots.length}</b></div>
        <div className="metric"><Mic2 /> 字幕片段 <b>{result.transcript.length}</b></div>
        <div className="metric"><Copy /> 输出文件 <b>2-3 个</b></div>
        <h4>字幕线索</h4>
        {result.transcript.map((line) => <p className="line" key={line.time}><b>{line.time}</b>{line.text}</p>)}
        <h4>说明</h4>
        {result.assumptions.map((item) => <p className="muted" key={item}>• {item}</p>)}
      </aside>
    </section>
  );
}
