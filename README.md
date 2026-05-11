# VideoFlow

VideoFlow 是一个面向短视频创作者的视频提词与分镜分析网站。用户上传视频后，系统会抽取视频元数据、代表帧和音频，先用服务器本地 Whisper 转写音频，再通过后台配置的 OpenAI 兼容 Provider 做语境校正、标题识别、画面分析并生成可用于 AI 复刻的 `完整剧本.md`、`分镜剧本.md` 与结构化详情。

## Requirements

- Node.js 20+
- Python 3
- `ffmpeg` / `ffprobe`
- OpenAI 兼容模型服务 API Key
- 本地 Whisper（Docker 镜像内置 Debian CPU 版 PyTorch 依赖和 `openai-whisper`；本地开发可安装 `whisper` 命令或 `python3 -m whisper`）

## Configuration

```bash
cp .env.example .env
```

可选环境变量：

```bash
VIDEOFLOW_ADMIN_EMAIL=admin@example.com
VIDEOFLOW_ADMIN_PASSWORD=your-secure-password
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_SCRIPT_MODEL=gpt-4.1
VIDEOFLOW_WHISPER_MODEL=base
VIDEOFLOW_WHISPER_LANGUAGE=zh
VIDEOFLOW_ALLOW_REGISTRATION=true
```

首次启动后，管理员也可以在后台的 **AI Provider** 面板配置：

- Provider 名称
- Base URL，例如官方地址或第三方 OpenAI 兼容中转站。第三方 New API/中转站通常要填写 OpenAI 兼容接口地址（常见为 `https://域名/v1`），不要填写控制台网页首页。
- API Key
- 脚本生成模型
- 启用状态

语音识别不再走 Provider 或大模型音频接口，固定由服务器本地 Whisper 处理。可通过 `VIDEOFLOW_WHISPER_MODEL`（默认 `base`）和 `VIDEOFLOW_WHISPER_LANGUAGE`（默认示例为 `zh`）调整本地转写参数。AI Provider 后续只负责根据画面和 Whisper 原始转写做标题识别、语境校正、结构化分析与脚本生成。

## Local run

```bash
npm install
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:8787

## Docker run

```bash
cp .env.example .env
# 编辑 .env 中的管理员账号和可选 Provider 初始配置
docker compose up -d --build
```

访问：

```text
http://localhost:8082        # 工作台
http://localhost:8082/admin  # 管理后台
```

持久化卷：

- `videoflow-data` → `/app/server/data`
- `videoflow-uploads` → `/app/server/uploads`
- `videoflow-outputs` → `/app/server/outputs`

## Processing pipeline

1. 任务受理
2. 解析素材：ffprobe / ffmpeg 提取元数据、代表帧、音频
3. 语音转写：服务器本地 Whisper 识别音频，不调用大模型转写接口
4. 画面分析：Responses 兼容多模态接口输入代表帧与 Whisper 原始转写
5. 生成提词：AI 根据视频语境校正转写、识别内容标题，并结构化输出尽可能细致的完整剧本、分镜剧本和复刻提示词
6. 结果校验：schema 校验并持久化产物
7. 完成

## Output

任务完成后，结果会写入：

```text
server/outputs/<job-id>/<video-name>/完整剧本.md
server/outputs/<job-id>/<video-name>/分镜剧本.md
server/outputs/<job-id>/<video-name>/result.json
server/outputs/<job-id>/<video-name>/仿写脚本.md（当模型返回时）
```

这些产物也会在详情页以 tab 展示；页面不再单独显示“输出文件”占位信息。

## Verification

```bash
npm run lint
npm test
npm run build
```

## 详情页素材

结果详情页包含剧本、复刻提示词、代表帧/分镜图片和音频 tab。后端通过 `/api/jobs/:id/artifacts` 扫描 `server/outputs/<job-id>/` 下的 Markdown、图片和音频文件，并通过 `/outputs` 静态路径展示。
