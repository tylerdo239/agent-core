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
COPY packages/ui-sidebar/package.json ./packages/ui-sidebar/package.json
COPY packages/ui-layout/package.json ./packages/ui-layout/package.json
COPY packages/ui-conversation/package.json ./packages/ui-conversation/package.json
COPY packages/ui-settings-general/package.json ./packages/ui-settings-general/package.json
COPY packages/ui-auth/package.json ./packages/ui-auth/package.json
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
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY seams ./seams
COPY bundles ./bundles
COPY src ./src
# Chỉ copy dist đã build (Phase 9.6) — KHÔNG copy apps/web/src hay
# packages/*/src vào runtime, server không cần source phía client, chỉ cần
# đúng vị trí bundles/adapters/web-ui/index.ts tính DIST_DIR tới
# (../../../apps/web/dist tính từ bundle đó).
COPY --from=build-web /app/apps/web/dist ./apps/web/dist

# Chạy bằng user không phải root — giảm bề mặt tấn công nếu container bị
# chiếm quyền qua 1 lỗ hổng nào đó trong dependency.
RUN useradd --system --create-home --shell /usr/sbin/nologin agent \
  && mkdir -p /app/data && chown -R agent:agent /app
USER agent

EXPOSE 8787 8788 8790 50051
VOLUME ["/app/data"]

CMD ["npx", "tsx", "src/serve.ts"]
