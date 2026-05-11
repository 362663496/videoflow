FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN npm config set registry https://registry.npmmirror.com
COPY package*.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN sed -i 's#deb.debian.org#mirrors.aliyun.com#g; s#security.debian.org#mirrors.aliyun.com#g' /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    python3-more-itertools \
    python3-numba \
    python3-numpy \
    python3-regex \
    python3-requests \
    python3-torch \
    python3-torchaudio \
    python3-tqdm \
  && PIP_BREAK_SYSTEM_PACKAGES=1 pip3 install --no-cache-dir --no-deps -i https://pypi.tuna.tsinghua.edu.cn/simple tiktoken openai-whisper \
  && rm -rf /var/lib/apt/lists/*
RUN npm config set registry https://registry.npmmirror.com
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
EXPOSE 8787
CMD ["node", "--import", "tsx", "server/index.ts"]
