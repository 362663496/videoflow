import { Check, Loader2, XCircle } from 'lucide-react';
import type { VideoJob } from '../lib/types';

export function StageTimeline({ job }: { job: VideoJob }) {
  return (
    <div className="timeline-card">
      <div className="progress-head">
        <div>
          <p className="eyebrow">处理进度</p>
          <h3>{job.status === 'complete' ? '结果已生成' : job.status === 'failed' ? '处理失败' : '正在处理视频'}</h3>
          {job.error && <p className="form-error">{job.error}</p>}
        </div>
        <strong>{job.progress}%</strong>
      </div>
      <div className="progress-bar">
        <span style={{ width: `${job.progress}%` }} />
      </div>
      <div className="stages">
        {job.stages.map((stage) => (
          <div className={`stage ${stage.status}`} key={stage.id}>
            <div className="stage-icon">
              {job.status === 'failed' && stage.status === 'active' ? <XCircle size={16} /> : stage.status === 'done' ? <Check size={16} /> : stage.status === 'active' ? <Loader2 size={16} className="spin" /> : stage.progress}
            </div>
            <div>
              <b>{stage.label}</b>
              <p>{stage.description}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
