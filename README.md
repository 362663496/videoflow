# VideoFlow

VideoFlow 是一个面向短视频创作者的视频提词与分镜分析网站。用户上传视频后，系统会抽取视频元数据、代表帧和音频，通过后台配置的 OpenAI 兼容 Provider 生成 `完整剧本.md`、`分镜剧本.md` 与结构化详情。

## Requirements

- Node.js 20+
- Python 3
- `ffmpeg` / `ffprobe`
- OpenAI 兼容模型服务 API Key

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
OPENAI_TRANSCRIBE_MODEL=gpt-4o-transcribe
VIDEOFLOW_ALLOW_REGISTRATION=false
```

首次启动后，管理员也可以在后台的 **AI Provider** 面板配置：

- Provider 名称
- Base URL，例如官方地址或第三方 OpenAI 兼容中转站。第三方 New API/中转站通常要填写 OpenAI 兼容接口地址（常见为 `https://域名/v1`），不要填写控制台网页首页。
- API Key
- 脚本生成模型
- 转写模型
- 启用状态

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
http://localhost:8787        # 工作台
http://localhost:8787/admin  # 管理后台
```

持久化卷：

- `videoflow-data` → `/app/server/data`
- `videoflow-uploads` → `/app/server/uploads`
- `videoflow-outputs` → `/app/server/outputs`

## Processing pipeline

1. 任务受理
2. 解析素材：ffprobe / ffmpeg 提取元数据、代表帧、音频
3. 语音转写：后台启用 Provider 的转写模型
4. 画面分析：Responses 兼容多模态接口输入代表帧与转写文本
5. 生成提词：结构化输出完整剧本与分镜剧本
6. 结果校验：schema 校验并持久化产物
7. 完成

## Output

任务完成后，结果会写入：

```text
server/outputs/<job-id>/<video-name>/完整剧本.md
server/outputs/<job-id>/<video-name>/分镜剧本.md
server/outputs/<job-id>/<video-name>/result.json
```

## Verification

```bash
npm run lint
npm test
npm run build
```
