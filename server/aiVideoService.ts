import OpenAI from 'openai';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
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
  title: z.string(),
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
  userTitle: string;
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

function activeProvider(): Required<Pick<AiProviderConfig, 'baseUrl' | 'scriptModel'>> & { apiKey: string; name: string } {
  const provider = store.getActiveProvider();
  if (!provider?.apiKey) throw new Error('AI Provider 未配置');
  return {
    name: provider.name,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    scriptModel: provider.scriptModel
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
    return `AI Provider「${provider.name}」接口或模型不存在，请检查 base_url 和脚本模型配置。`;
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


type Transcript = { text: string; segments: Array<{ start?: number; end?: number; text?: string }> };

function localWhisperModel() {
  return (process.env.VIDEOFLOW_WHISPER_MODEL || 'base').trim() || 'base';
}

function localWhisperLanguage() {
  return process.env.VIDEOFLOW_WHISPER_LANGUAGE?.trim();
}

function commandErrorText(error: unknown) {
  const value = error as { message?: string; stderr?: string; stdout?: string };
  return [value.stderr, value.stdout, value.message].filter(Boolean).join('\n');
}

async function runWhisper(args: string[]) {
  const options = { maxBuffer: 20 * 1024 * 1024 };
  try {
    return await execFileAsync('whisper', args, options);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return execFileAsync('python3', ['-m', 'whisper', ...args], options);
  }
}

async function readWhisperJson(transcriptDir: string, audioPath: string): Promise<Transcript> {
  const baseName = path.basename(audioPath, path.extname(audioPath));
  const preferredPath = path.join(transcriptDir, `${baseName}.json`);
  let jsonPath = preferredPath;
  try {
    await readFile(jsonPath, 'utf8');
  } catch {
    const candidates = (await readdir(transcriptDir)).filter((file) => file.endsWith('.json'));
    if (!candidates[0]) throw new Error('Whisper 未生成 JSON 转写结果');
    jsonPath = path.join(transcriptDir, candidates[0]);
  }
  const value = JSON.parse(await readFile(jsonPath, 'utf8')) as { text?: string; segments?: Array<{ start?: number; end?: number; text?: string }> };
  return { text: value.text ?? '', segments: value.segments ?? [] };
}

async function transcribeAudio(audioPath: string | undefined, outputDir: string): Promise<Transcript> {
  if (!audioPath) return { text: '', segments: [] };
  const transcriptDir = path.join(outputDir, 'transcript');
  await mkdir(transcriptDir, { recursive: true });
  const args = [
    audioPath,
    '--model',
    localWhisperModel(),
    '--output_format',
    'json',
    '--output_dir',
    transcriptDir,
    '--verbose',
    'False'
  ];
  const language = localWhisperLanguage();
  if (language) args.push('--language', language);
  try {
    await runWhisper(args);
    return readWhisperJson(transcriptDir, audioPath);
  } catch (error) {
    const text = commandErrorText(error);
    throw new Error(
      `本地 Whisper 转写失败。请确认已安装 whisper 命令或 Python whisper 模块，并可在当前运行环境访问。${text ? `
${text}` : ''}`,
      { cause: error }
    );
  }
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
    title: { type: 'string' },
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
  required: ['title', 'summary', 'styleTags', 'transcript', 'shots', 'fullScriptMarkdown', 'storyboardMarkdown', 'imitationMarkdown', 'assumptions']
};

function transcriptForPrompt(transcript: Transcript) {
  const segments = transcript.segments
    .slice(0, 80)
    .map((segment) => `${Number(segment.start ?? 0).toFixed(2)}s-${Number(segment.end ?? 0).toFixed(2)}s ${segment.text ?? ''}`)
    .join('\n');
  return segments || transcript.text || '无可用转写文本。';
}

async function analyzeVideo(client: OpenAI, scriptModel: string, userTitle: string, context: PreparedContext, transcript: Transcript) {
  const images = await frameContentItems(context.frames);
  const frameList = context.frames.map((frame) => `${frame.timestamp_seconds.toFixed(2)}s: ${path.basename(frame.path)}`).join('\n');
  const inputText = [
    `用户填写标题（仅作弱参考，可能是空值或文件名，不能直接照抄）：${userTitle || '未提供'}`,
    `视频元数据：${JSON.stringify(context.metadata)}`,
    `代表帧时间点：\n${frameList}`,
    `本地 Whisper 原始转写（可能存在同音字、断句、专有名词错误）：\n${transcriptForPrompt(transcript)}`,
    '你的目标：生成一份可交给文生视频/图生视频 AI 复刻原片的中文分析交付。优先忠实复原，不要泛泛总结。',
    '必须先根据画面、字幕、音频、场景上下文识别一个内容标题，写入 JSON.title；不要使用上传文件名、下载、未命名、IMG_、VID_ 这类文件名式标题。',
    '必须结合标题、画面、上下文对 Whisper 转写进行语境校正、标点整理和专有名词修正；不得凭空补充听不见的内容。必须区分可观察事实与不确定推断；听不清、看不清处写“听辨不确定”或“疑似”。',
    '完整剧本 Markdown 必须足够详细，至少包含：内容标题、时长/画幅/节奏、场景空间、主体/人物设定（不限定真人；如果是人物需写年龄感、性别呈现、发型、脸部特征、体态、服装、配饰、妆容、表情、动作；如果是物体/动画/宠物也要写可见外观、材质、颜色、状态）、道具与品牌/文字、光线与色彩、构图与景别、字幕样式、音频/口播/音效、逐句校正台词、不可确认事项。',
    '分镜剧本 Markdown 必须按时间码逐镜头/逐段描述，字段至少包含：时间码、画面主体与动作、主体外观/服饰/道具细节、场景背景、镜头景别/角度/运动、构图、光线色彩、屏幕文字/字幕、台词/声音、剪辑节奏、用于 AI 复刻的视频生成提示词。每个镜头都要尽量具体，避免“人物说话”“镜头切换”等空泛描述。',
    'imitationMarkdown 必须输出一份“复刻生成提示词”，面向视频生成 AI：包含全局风格、角色/主体一致性、场景、镜头序列、字幕、音频、负面约束和不确定信息，目标是尽可能生成一模一样的视频。',
    '输出必须包含完整剧本 Markdown、分镜剧本 Markdown、仿写/复刻提示词 Markdown、字幕线索、逐 Clip 信息、风格标签和必要假设。Markdown 文件结构对齐“完整剧本.md”和“分镜剧本.md”的专业交付标准。'
  ].join('\n\n');
  try {
    const response = await client.responses.create({
      model: scriptModel,
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: '你是专业中文短视频复刻分析、提词、分镜拆解与视频生成提示词系统。你必须基于可观察证据输出高密度细节，少用泛泛而谈。只输出符合 schema 的真实分析结果，不输出调试说明。' }]
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
  } catch (error) {
    const text = errorText(error).toLowerCase();
    if (!text.includes('404') && !text.includes('not found')) throw error;
    const fallback = await client.chat.completions.create({
      model: scriptModel,
      messages: [
        { role: 'system', content: '你是专业中文短视频复刻分析、提词、分镜拆解与视频生成提示词系统。只输出 JSON，不输出 Markdown 代码围栏。' },
        { role: 'user', content: `${inputText}\n\n请输出 JSON，字段为 title, summary, styleTags, transcript, shots, fullScriptMarkdown, storyboardMarkdown, imitationMarkdown, assumptions。代表帧时间点请作为画面证据使用：${frameList}` }
      ],
      response_format: { type: 'json_object' }
    } as never);
    const outputText = fallback.choices[0]?.message?.content;
    if (!outputText) throw new Error('AI 未返回可用结果', { cause: error });
    return aiResultSchema.parse(JSON.parse(outputText));
  }
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
  const transcript = await transcribeAudio(context.audioPath, context.outputDir);
  options.onStage('vision');
  const result = await withProviderErrors(provider, () => analyzeVideo(client, provider.scriptModel, options.userTitle, context, transcript));
  options.onStage('write');
  await persistArtifacts(context.outputDir, result);
  options.onStage('review');
  return result;
}
