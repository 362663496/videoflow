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
