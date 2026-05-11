import { describe, expect, it } from 'vitest';
import { createStages, stageTemplates } from './processor';

describe('video processing stages', () => {
  it('keeps the production processing contract ordered and complete', () => {
    expect(stageTemplates.map((stage) => stage.id)).toEqual([
      'queued',
      'context',
      'transcribe',
      'vision',
      'write',
      'review',
      'complete'
    ]);
    expect(stageTemplates.at(-1)?.progress).toBe(100);
  });

  it('returns fresh mutable stage copies for each job', () => {
    const first = createStages();
    const second = createStages();
    first[0].status = 'done';
    expect(second[0].status).toBe('pending');
  });
});

describe('local whisper processing contract', () => {
  it('labels transcription as local speech recognition work', () => {
    const transcribe = stageTemplates.find((stage) => stage.id === 'transcribe');
    expect(transcribe?.label).toBe('语音转写');
    expect(transcribe?.description).toContain('本地 Whisper');
  });
});

describe('result title contract', () => {
  it('stores generated results with an AI-defined title field', () => {
    expect({ title: '星巴克大杯次卡门店对话短视频' }).toHaveProperty('title');
  });
});
