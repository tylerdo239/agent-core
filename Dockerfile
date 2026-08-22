# Python RLM runtime is built from this repository. A standalone checkout must
# not depend on a prebuilt sibling data-agent image.
FROM python:3.11-slim-bookworm AS rlm-python
WORKDIR /runtime
COPY python/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch
RUN pip install --no-cache-dir -r requirements.txt

# Multi-stage: stage "deps" có đủ toolchain build native module
# (better-sqlite3 cần node-gyp nếu không có prebuilt binary đúng
# platform/arch — image base "slim" không có sẵn); stage "build-web" (Phase
# 9.6) build UI React thật (apps/web) qua Vite; stage "runtime" chỉ copy kết
# quả qua (node_modules + server source + dist đã build), không mang theo
# build tool/source phía client -> image cuối nhỏ hơn.
#
# Server chạy bằng tsx (transpile lúc chạy), không build tsc -> dist/*.js
# riêng — đơn giản hơn, rủi ro thấp hơn ở quy mô demo/1-instance đã chốt. Web
# UI (apps/web) THÌ CÓ build step thật (Vite) — khác nhau có chủ đích: server
# không cần bundling, browser thì bắt buộc (không gửi TypeScript thô cho
# trình duyệt được). Xem "Rủi ro" ở Phase 7.2/9.6 trong
# docs/agent-core-cordis-build-plan.md.

FROM node:22-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
# npm workspaces (Phase 9.6): `npm ci` cần package.json của TỪNG workspace
# member khớp với package-lock.json, không chỉ package.json gốc — copy trước
# khi cài để tận dụng layer cache đúng (source đổi không làm cache miss ở
# đây, chỉ package.json đổi mới miss).
COPY package.json package-lock.json ./
COPY packages/ui-slots/package.json ./packages/ui-slots/package.json
COPY packages/ui-react/package.json ./packages/ui-react/package.json
COPY packages/ui-tool-web-search/package.json ./packages/ui-tool-web-search/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci

FROM node:22-slim AS build-web
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN npm run build:web

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Copy interpreter/site-packages được build từ python/requirements.txt của
# chính repo; không bind-mount virtualenv và không phụ thuộc sibling image.
COPY --from=rlm-python /usr/local /usr/local

# Giữ UID/GID của user trong container trùng với user sở hữu bind mount trên
# host. Có thể override qua build args nếu image được build trên máy khác.
ARG AGENT_UID=1019
ARG AGENT_GID=1020

# OpenCode VS Code extension chỉ là client: khi activate, nó gọi executable
# `opencode --port ...` bên trong container. Cài CLI vào image để extension
# không phụ thuộc vào một lần cài thủ công (vốn sẽ mất khi recreate container).
ARG OPENCODE_VERSION=1.18.20
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    sudo \
    default-jre-headless \
    libgdbm6 \
    libgomp1 \
    libncursesw6 \
    libnsl2 \
    libreadline8 \
    libsqlite3-0 \
    libssl3 \
    libtcl8.6 \
    libtirpc3 \
    libtk8.6 \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --global "opencode-ai@${OPENCODE_VERSION}" \
  && opencode --version

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY seams ./seams
COPY bundles ./bundles
COPY src ./src
COPY python ./python
# Chỉ copy dist đã build (Phase 9.6) — KHÔNG copy apps/web/src hay
# packages/*/src vào runtime, server không cần source phía client, chỉ cần
# đúng vị trí bundles/adapters/web-ui/index.ts tính DIST_DIR tới
# (../../../apps/web/dist tính từ bundle đó).
COPY --from=build-web /app/apps/web/dist ./apps/web/dist

# Mặc định vẫn chạy bằng user thường. User có thể nâng quyền bằng `sudo` khi
# chủ động cần thao tác quản trị trong development container.
RUN groupadd --gid "${AGENT_GID}" agent \
  && useradd --uid "${AGENT_UID}" --gid agent --create-home --shell /bin/bash agent \
  && printf 'agent ALL=(ALL:ALL) NOPASSWD:ALL\n' > /etc/sudoers.d/agent \
  && chmod 0440 /etc/sudoers.d/agent \
  && mkdir -p /app/data \
  && chown -R agent:agent /app
USER agent

EXPOSE 8787 8788 8790 50051
VOLUME ["/app/data"]

CMD ["npx", "tsx", "src/serve.ts"]
