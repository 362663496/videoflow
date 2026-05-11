# VideoFlow Architecture

## Product surfaces

- **C 端工作台**：注册/登录、上传视频、任务进度、结果详情。
- **后台**：任务队列、平台统计、AI Provider 配置。
- **AI 处理器**：`server/processor.ts` 负责任务状态推进；`server/aiVideoService.ts` 负责素材准备、转写、视觉分析和结果持久化。

## Provider model

Provider 配置存储在 `server/data/db.json` 中，后台通过以下接口管理：

- `GET /api/admin/providers`
- `PUT /api/admin/providers/active`

字段：`name`、`baseUrl`、`apiKey`、`scriptModel`、`enabled`。

后端使用 `new OpenAI({ apiKey, baseURL })` 初始化客户端，因此可接入官方 OpenAI 或第三方 OpenAI 兼容中转站。Provider 只用于脚本/视觉分析；音频转写固定走服务器本地 Whisper。

## AI pipeline

`runVideoJob(jobId)` keeps all state transitions in `VideoJob` and calls `generateVideoScriptResult`:

1. `server/scripts/prepare_video_context.py` invokes ffprobe/ffmpeg.
2. Audio is transcribed locally with Whisper (`whisper` CLI or `python3 -m whisper` fallback), without calling an AI transcription API.
3. Representative frames and the raw Whisper transcript are sent to the active Provider script model through a Responses-compatible API for context correction, AI-defined titling, detailed visual reconstruction notes, and structured analysis.
4. The AI response is constrained by a JSON schema and validated with Zod; results include an AI-defined `title` plus detailed full-script, storyboard, and imitation prompt Markdown.
5. Markdown artifacts and `result.json` are persisted under `server/outputs/<job-id>/`.

## Docker deployment

`Dockerfile` builds the web bundle, installs production Node dependencies, uses Aliyun Debian mirrors and npm mirror settings, and includes `ffmpeg`, Python, CPU PyTorch dependencies, and `openai-whisper` in the runtime image. `docker-compose.yml` exposes the app on host port `8082` and mounts persistent volumes for data, uploads, and generated outputs.

## Production notes

- Replace the JSON-file store with a database before multi-instance deployment.
- Move upload/output storage to object storage for horizontally scaled deployment.
- Add queue isolation for long-running jobs before high-volume use.
- Put the API behind HTTPS and enforce real password hashing/session storage before public launch.
