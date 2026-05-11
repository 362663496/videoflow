# VideoFlow Architecture

## Product surfaces

- **C 端工作台**：注册/登录、上传视频、任务进度、结果详情。
- **后台**：任务队列、平台统计、AI Provider 配置。
- **AI 处理器**：`server/processor.ts` 负责任务状态推进；`server/aiVideoService.ts` 负责素材准备、转写、视觉分析和结果持久化。

## Provider model

Provider 配置存储在 `server/data/db.json` 中，后台通过以下接口管理：

- `GET /api/admin/providers`
- `PUT /api/admin/providers/active`

字段：`name`、`baseUrl`、`apiKey`、`scriptModel`、`transcribeModel`、`enabled`。

后端使用 `new OpenAI({ apiKey, baseURL })` 初始化客户端，因此可接入官方 OpenAI 或第三方 OpenAI 兼容中转站。

## AI pipeline

`runVideoJob(jobId)` keeps all state transitions in `VideoJob` and calls `generateVideoScriptResult`:

1. `server/scripts/prepare_video_context.py` invokes ffprobe/ffmpeg.
2. Audio is transcribed with the active Provider transcription model.
3. Representative frames and transcript are sent to the active Provider script model through a Responses-compatible API.
4. The AI response is constrained by a JSON schema and validated with Zod.
5. Markdown artifacts and `result.json` are persisted under `server/outputs/<job-id>/`.

## Docker deployment

`Dockerfile` builds the web bundle, installs production Node dependencies, and includes `ffmpeg` plus `python3` in the runtime image. `docker-compose.yml` mounts persistent volumes for data, uploads, and generated outputs.

## Production notes

- Replace the JSON-file store with a database before multi-instance deployment.
- Move upload/output storage to object storage for horizontally scaled deployment.
- Add queue isolation for long-running jobs before high-volume use.
- Put the API behind HTTPS and enforce real password hashing/session storage before public launch.
