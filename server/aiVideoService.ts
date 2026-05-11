import OpenAI from 'openai';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { AiProviderConfig, VideoResult } from '../src/lib/types';
import { store } from './store';

const execFileAsync = promisify(execFile);

const outputRoot = path.resolve(process.cwd(), 'server/outputs');

const transcriptLineSchema = z.object({ time: z.string(), text: z.string() });
const shotSchema = z.object({
  id: z.string(),
  timeRange: z.string(),
  visual: z.string(),
  camera: z.string(),
  audio: z.string(),
  narrative: z.string()
});
const aiResultSchema = z.object({
  summary: z.string(),
  styleTags: z.array(z.string()),
  transcript: z.array(transcriptLineSchema),
  shots: z.array(shotSchema),
  fullScriptMarkdown: z.string(),
  storyboardMarkdown: z.string(),
  imitationMarkdown: z.string().optional(),
  assumptions: z.array(z.string())
});

export type PipelineStage = 'context' | 'transcribe' | 'vision' | 'write' | 'review';

export interface GenerateVideoScriptOptions {
  jobId: string;
  title: string;
  sourcePath: string;
  onStage: (stage: PipelineStage) => void;
}

interface PreparedContext {
  outputDir: string;
  manifestPath: string;
  audioPath?: string;
  frames: Array<{ timestamp_seconds: number; path: string }>;
  metadata: Record<string, unknown>;
}

function activeProvider(): Required<Pick<AiProviderConfig, 'baseUrl' | 'scriptModel' | 'transcribeModel'>> & { apiKey: string; name: string } {
  const provider = store.getActiveProvider();
  if (!provider?.apiKey) throw new Error('AI Provider 未配置');
  return {
    name: provider.name,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    scriptModel: provider.scriptModel,
    transcribeModel: provider.transcribeModel
  };
}


function errorText(error: unknown) {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    return [error.message, cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : ''].filter(Boolean).join('\n');
  }
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return '';
  }
}

function providerErrorMessage(error: unknown, provider: Pick<AiProviderConfig, 'name' | 'baseUrl'>) {
  const text = errorText(error);
  const lower = text.toLowerCase();
  const returnedHtml = lower.includes('<!doctype html') || lower.includes('<html') || lower.includes('text/html');
  const sdkHtmlParseFailure = lower.includes("cannot use 'in' operator") || lower.includes('search for') && lower.includes('<!doctype html');
  if (returnedHtml || sdkHtmlParseFailure) {
    return `AI Provider「${provider.name}」返回了 HTML 页面。请在后台检查 base_url 是否填写 OpenAI 兼容接口地址，通常应以 /v1 结尾，不要填写中转站控制台或网页首页。当前 base_url：${provider.baseUrl}`;
  }
  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('invalid api key')) {
    return `AI Provider「${provider.name}」认证失败，请检查 api_key 是否有效。`;
  }
  if (lower.includes('404') || lower.includes('not found')) {
    return `AI Provider「${provider.name}」接口或模型不存在，请检查 base_url、转写模型和脚本模型配置。`;
  }
  if (lower.includes('timeout') || lower.includes('etimedout') || lower.includes('econnreset') || lower.includes('fetch failed')) {
    return `AI Provider「${provider.name}」连接失败，请检查 base_url 网络连通性和中转站服务状态。`;
  }
  return text || 'AI Provider 调用失败';
}

async function withProviderErrors<T>(provider: Pick<AiProviderConfig, 'name' | 'baseUrl'>, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw new Error(providerErrorMessage(error, provider), { cause: error });
  }
}

async function ensureFfmpeg() {
  await execFileAsync('ffmpeg', ['-version']);
  await execFileAsync('ffprobe', ['-version']);
}

async function prepareContext(sourcePath: string, jobId: string): Promise<PreparedContext> {
  await ensureFfmpeg();
  const outDir = path.join(outputRoot, jobId);
  await mkdir(outDir, { recursive: true });
  const scriptPath = path.resolve(process.cwd(), 'server/scripts/prepare_video_context.py');
  const { stdout } = await execFileAsync('python3', [scriptPath, sourcePath, '--output-dir', outDir, '--interval', '2', '--max-frames', '12']);
  const prepared = JSON.parse(stdout) as { output_dir: string; manifest: string; audio?: string | null };
  const manifest = JSON.parse(await readFile(prepared.manifest, 'utf8')) as {
    artifacts?: { frames?: Array<{ timestamp_seconds: number; path: string }>; audio?: string | null };
  } & Record<string, unknown>;
  return {
    outputDir: prepared.output_dir,
    manifestPath: prepared.manifest,
    audioPath: manifest.artifacts?.audio ?? undefined,
    frames: manifest.artifacts?.frames ?? [],
    metadata: manifest
  };
}

async function transcribeAudio(client: OpenAI, transcribeModel: string, audioPath?: string) {
  if (!audioPath) return { text: '', segments: [] as Array<{ start?: number; end?: number; text?: string }> };
  const model = transcribeModel;
  const response = await client.audio.transcriptions.create({
    file: createReadStream(audioPath),
    model,
    response_format: 'verbose_json'
  } as never);
  const value = response as unknown as { text?: string; segments?: Array<{ start?: number; end?: number; text?: string }> };
  return { text: value.text ?? '', segments: value.segments ?? [] };
}

async function frameContentItems(frames: PreparedContext['frames']) {
  const selected = frames.slice(0, Number(process.env.VIDEOFLOW_MAX_AI_FRAMES || 8));
  return Promise.all(
    selected.map(async (frame) => {
      const image = await readFile(frame.path);
      return {
        type: 'input_image' as const,
        image_url: `data:image/jpeg;base64,${image.toString('base64')}`,
        detail: 'low' as const
      };
    })
  );
}

const responseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    styleTags: { type: 'array', items: { type: 'string' } },
    transcript: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { time: { type: 'string' }, text: { type: 'string' } },
        required: ['time', 'text']
      }
    },
    shots: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          timeRange: { type: 'string' },
          visual: { type: 'string' },
          camera: { type: 'string' },
          audio: { type: 'string' },
          narrative: { type: 'string' }
        },
        required: ['id', 'timeRange', 'visual', 'camera', 'audio', 'narrative']
      }
    },
    fullScriptMarkdown: { type: 'string' },
    storyboardMarkdown: { type: 'string' },
    imitationMarkdown: { type: 'string' },
    assumptions: { type: 'array', items: { type: 'string' } }
  },
  required: ['summary', 'styleTags', 'transcript', 'shots', 'fullScriptMarkdown', 'storyboardMarkdown', 'imitationMarkdown', 'assumptions']
};

function transcriptForPrompt(transcript: Awaited<ReturnType<typeof transcribeAudio>>) {
  const segments = transcript.segments
    .slice(0, 80)
    .map((segment) => `${Number(segment.start ?? 0).toFixed(2)}s-${Number(segment.end ?? 0).toFixed(2)}s ${segment.text ?? ''}`)
    .join('\n');
  return segments || transcript.text || '无可用转写文本。';
}

async function analyzeVideo(client: OpenAI, scriptModel: string, title: string, context: PreparedContext, transcript: Awaited<ReturnType<typeof transcribeAudio>>) {
  const model = scriptModel;
  const images = await frameContentItems(context.frames);
  const frameList = context.frames.map((frame) => `${frame.timestamp_seconds.toFixed(2)}s: ${path.basename(frame.path)}`).join('\n');
  const inputText = [
    `视频标题：${title}`,
    `视频元数据：${JSON.stringify(context.metadata)}`,
    `代表帧时间点：\n${frameList}`,
    `音频转写：\n${transcriptForPrompt(transcript)}`,
    '请基于视频证据生成生产可用的中文视频提词结果。必须区分可观察事实与不确定推断；听不清、看不清处写“听辨不确定”或“疑似”。',
    '输出必须包含完整剧本 Markdown、分镜剧本 Markdown、字幕线索、逐 Clip 信息、风格标签和必要假设。Markdown 文件结构对齐“完整剧本.md”和“分镜剧本.md”的专业交付标准。'
  ].join('\n\n');
  const response = await client.responses.create({
    model,
    input: [
      {
        role: 'system',
        content: [{ type: 'input_text', text: '你是专业中文短视频提词、分镜拆解与内容策略生成系统。只输出符合 schema 的真实分析结果，不输出调试说明。' }]
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: inputText }, ...images]
      }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'video_script_result',
        strict: true,
        schema: responseSchema
      }
    }
  } as never);
  const outputText = (response as { output_text?: string }).output_text;
  if (!outputText) throw new Error('AI 未返回可用结果');
  return aiResultSchema.parse(JSON.parse(outputText));
}

async function persistArtifacts(outputDir: string, result: VideoResult) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, '完整剧本.md'), result.fullScriptMarkdown, 'utf8');
  await writeFile(path.join(outputDir, '分镜剧本.md'), result.storyboardMarkdown, 'utf8');
  if (result.imitationMarkdown?.trim()) await writeFile(path.join(outputDir, '仿写脚本.md'), result.imitationMarkdown, 'utf8');
  await writeFile(path.join(outputDir, 'result.json'), JSON.stringify(result, null, 2), 'utf8');
}

export async function generateVideoScriptResult(options: GenerateVideoScriptOptions): Promise<VideoResult> {
  const provider = activeProvider();
  const client = new OpenAI({ apiKey: provider.apiKey, baseURL: provider.baseUrl });
  options.onStage('context');
  const context = await prepareContext(options.sourcePath, options.jobId);
  options.onStage('transcribe');
  const transcript = await withProviderErrors(provider, () => transcribeAudio(client, provider.transcribeModel, context.audioPath));
  options.onStage('vision');
  const result = await withProviderErrors(provider, () => analyzeVideo(client, provider.scriptModel, options.title, context, transcript));
  options.onStage('write');
  await persistArtifacts(context.outputDir, result);
  options.onStage('review');
  return result;
}
