import type { ProcessingStage, ProcessingStageId, VideoJob } from '../src/lib/types';
import { generateVideoScriptResult, type PipelineStage } from './aiVideoService';
import { store } from './store';

export const stageTemplates: ProcessingStage[] = [
  { id: 'queued', label: '任务受理', description: '视频已进入处理队列', progress: 5, status: 'pending' },
  { id: 'context', label: '解析素材', description: '提取视频元数据、代表帧与音频轨道', progress: 18, status: 'pending' },
  { id: 'transcribe', label: '语音转写', description: '识别口播、对白与可用字幕线索', progress: 38, status: 'pending' },
  { id: 'vision', label: '画面分析', description: '分析镜头、画面信息与叙事节奏', progress: 62, status: 'pending' },
  { id: 'write', label: '生成提词', description: '生成完整剧本与分镜剧本', progress: 84, status: 'pending' },
  { id: 'review', label: '结果校验', description: '校验结构、证据边界与交付完整度', progress: 96, status: 'pending' },
  { id: 'complete', label: '完成', description: '结果已生成', progress: 100, status: 'pending' }
];

const stageIdByPipelineStage: Record<PipelineStage, ProcessingStageId> = {
  context: 'context',
  transcribe: 'transcribe',
  vision: 'vision',
  write: 'write',
  review: 'review'
};

export function createStages(): ProcessingStage[] {
  return stageTemplates.map((stage) => ({ ...stage }));
}

function setStage(job: VideoJob, activeId: ProcessingStageId, status: VideoJob['status'] = 'processing') {
  const activeIndex = stageTemplates.findIndex((stage) => stage.id === activeId);
  const template = stageTemplates[activeIndex];
  const next: VideoJob = {
    ...job,
    status,
    currentStage: activeId,
    progress: template.progress,
    updatedAt: new Date().toISOString(),
    stages: job.stages.map((stage, index) => ({
      ...stage,
      status: index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'pending'
    }))
  };
  store.saveJob(next);
  return next;
}

const running = new Set<string>();

export async function runVideoJob(jobId: string) {
  if (running.has(jobId)) return;
  running.add(jobId);
  let job = store.getJob(jobId);
  if (!job) return;
  try {
    job = setStage(job, 'queued');
    if (!job.sourcePath) throw new Error('视频源文件不存在');
    const result = await generateVideoScriptResult({
      jobId,
      title: job.title,
      sourcePath: job.sourcePath,
      onStage(stage) {
        const latest = store.getJob(jobId);
        if (latest) job = setStage(latest, stageIdByPipelineStage[stage]);
      }
    });
    job = store.getJob(jobId) ?? job;
    const complete = setStage({ ...job, result }, 'complete', 'complete');
    store.saveJob({
      ...complete,
      stages: complete.stages.map((stage) => ({ ...stage, status: 'done' })),
      progress: 100,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    job = store.getJob(jobId) ?? job;
    const message = error instanceof Error ? error.message : '处理失败';
    store.saveJob({
      ...job,
      status: 'failed',
      error: message,
      updatedAt: new Date().toISOString()
    });
  } finally {
    running.delete(jobId);
  }
}
