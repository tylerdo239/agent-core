# Deploy agent-core (Fox Harness) lên VPS Ubuntu — domain riêng cho app/API

## Bối cảnh

User có 1 VPS Ubuntu, muốn deploy agent-core bằng Docker, public ra 2 domain
khác nhau (đã có reverse proxy/TLS ở NƠI KHÁC — Cloudflare Tunnel hoặc 1
proxy trung tâm khác, giống cách `proxy.onebot.meobeo.ai` đang phục vụ LLM —
xác nhận với user trước khi lên plan này, KHÔNG đoán):

| Domain public (đã có TLS ở lớp ngoài) | Port VPS (HTTP thường) | Phục vụ |
| --- | --- | --- |
| `https://app-harness.onebot.meobeo.ai:4099` | `4099` | Web UI (React SPA) |
| `https://api-harness.onebot.meobeo.ai:4098` | `4098` | REST + WS (gộp 1 port) |

VPS này **không tự làm TLS** — chỉ mở HTTP thường ở 2 port trên, tầng ngoài
(nơi khác) chịu trách nhiệm domain + chứng chỉ + forward vào đúng 2 port
này.

## Nguyên tắc tách file (follow-up quan trọng, đọc trước khi làm theo dưới)

Bản đầu của plan này lỡ sửa THẲNG vào `docker-compose.yml` (file base, dùng
chung cho local/dev mặc định) để thêm mọi thứ phục vụ VPS — user yêu cầu
sửa lại: **`docker-compose.yml` phải giữ NGUYÊN như trước, không đụng vào**;
mọi thứ đặc thù cho deploy thật (build-time domain riêng, gateway gộp
REST+WS, restart policy) sống trong `docker-compose.prod.yml` — 1 file
OVERRIDE đã có sẵn từ trước trong repo (cùng convention với
`docker-compose.dev.yml`), giờ dùng đúng chỗ nó sinh ra để dùng.

- **Local/dev mặc định**: `docker compose up ...` — CHỈ đọc
  `docker-compose.yml`, y hệt hành vi trước khi có VPS deploy này (đã verify
  lại: không có `api-gateway`, không có `VITE_REST_URL`/`VITE_WS_URL`, port
  publish `0.0.0.0` như cũ).
- **Deploy VPS (production thật)**: LUÔN thêm `-f docker-compose.prod.yml`:
  ```bash
  docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d agent-core api-gateway postgres memory-core
  ```

Đã verify thật cả 2 đường: `docker compose config` (base) chỉ ra 3 service,
build args chỉ có `AGENT_UID`/`AGENT_GID`, port không giới hạn host_ip;
`docker compose -f ... -f docker-compose.prod.yml config` ra đủ 4 service
(thêm `api-gateway`), build args có thêm `VITE_REST_URL`/`VITE_WS_URL`,
`postgres`/`memory-core` có `restart: unless-stopped`. Bật thật cả 2 đường
bằng Docker thật, cả 2 đều `healthy`.

## Vấn đề thật phải sửa trước khi deploy được (đã sửa + verify thật)

1. **`restUrl`/`wsUrl` của web UI trước đây suy luận từ `location.hostname`**
   (`packages/ui-settings-general/src/settings.ts`) — đúng khi app và API
   sống CÙNG 1 hostname (chỉ khác port). Ở đây app và API là **2 subdomain
   khác nhau hoàn toàn** — `location.hostname` lúc chạy trong browser sẽ
   luôn là `app-harness...`, không thể suy ra `api-harness...` được. Đã sửa:
   thêm 2 biến build-time `VITE_REST_URL`/`VITE_WS_URL` (Vite tự inject qua
   `import.meta.env`) — có set thì DÙNG THẲNG, không set thì rơi về hành vi
   cũ (backward compatible cho deployment 1-host hiện tại). Verify: build
   thật với `--build-arg VITE_REST_URL=... VITE_WS_URL=...`, grep bundle đã
   build xác nhận đúng domain có mặt trong `dist/assets/*.js`.

2. **(Lúc viết mục này) REST (`agent-core:8787`) và WS (`agent-core:8788`)
   là 2 cổng RIÊNG**, nhưng chỉ có ĐÚNG 1 domain/port public cho "API"
   (`api-harness...:4098`). Service `api-gateway` (nginx,
   `deploy/api-gateway.conf`, chỉ có trong `docker-compose.prod.yml`) — gộp
   REST+WS vào 1 port bằng cách đọc header `Upgrade: websocket` để chọn đúng
   backend (pattern `map` chuẩn của nginx cho WebSocket proxying, không dùng
   `if` trong `location`). KHÔNG tự làm TLS — chỉ nghe HTTP thường ở port
   nội bộ, TLS do lớp ngoài lo. Verify thật: script Node dùng package `ws` —
   sign up thật, `GET /sessions` qua gateway (200), WS handshake qua gateway
   (101 Switching Protocols thật + nhận đúng `session_created`) — cả REST
   lẫn WS đều đi qua ĐÚNG 1 port 4098.

   **Follow-up (Phase 6.3, đã supersede mục này)**: `agent-core:8787` và
   `agent-core:8788` KHÔNG còn là 2 cổng riêng nữa — `bundles/adapters/api-ws`
   đã gộp vào `bundles/adapters/api-rest`, WS giờ là
   `GET /sessions/:id/events/stream` trên CÙNG port 8787 (downlink-only,
   không còn `create_session`/`send_message` qua WS — session tạo qua
   `POST /sessions`). `deploy/api-gateway.conf` đã đơn giản hoá theo — chỉ
   còn 1 upstream, không còn `map $http_upgrade $agent_core_backend` chọn
   giữa `rest_backend`/`ws_backend`. Phần verify "101 Switching Protocols +
   nhận đúng `session_created`" ở trên đã lỗi thời (không còn message
   `session_created` qua WS) — xem `docs/frontend-backend-handoff.md` mục 4-5
   cho protocol hiện hành.

3. **`postgres`/`memory-core` thiếu `restart:` policy** — phát hiện lúc
   audit, khác `agent-core` (đã có `unless-stopped` từ đầu), 2 service này
   không tự bật lại sau crash/reboot. Chỉ thêm ở `docker-compose.prod.yml`
   (production concern thật, không phải thứ base cần) — verify bằng
   `docker inspect ... RestartPolicy.Name` ra đúng `unless-stopped`.

Cả 3 đều nằm gọn trong `docker-compose.prod.yml` — `docker-compose.yml`
(base, dùng cho local/dev mặc định) **không đổi 1 dòng nào**, đã verify lại
bằng `npm test` (263/263 pass, không đụng code) và chạy thật base-only
(không có api-gateway, port `0.0.0.0` như cũ).

## Các file đã đổi/thêm

- `packages/ui-settings-general/src/settings.ts` — ưu tiên
  `import.meta.env.VITE_REST_URL`/`VITE_WS_URL` (fallback hành vi cũ nếu
  không set — áp dụng cho MỌI deployment, kể cả local).
- `apps/web/src/vite-env.d.ts` — ambient type cho `import.meta.env` (chuẩn
  scaffold Vite).
- `Dockerfile` — stage `build-web` nhận `ARG VITE_REST_URL`/`VITE_WS_URL`
  (rỗng mặc định — chỉ có giá trị khi `docker-compose.prod.yml` truyền vào).
- `docker-compose.yml` — **KHÔNG đổi**, y hệt trước khi có VPS deploy.
- `docker-compose.prod.yml` — MỌI thứ đặc thù VPS: `agent-core.build.args`
  (VITE_REST_URL/VITE_WS_URL), `postgres`/`memory-core.restart`, service mới
  `api-gateway` (gộp REST+WS + healthcheck).
- `deploy/api-gateway.conf` — cấu hình nginx gộp REST+WS.
- `.env.example` — mục mới "Deploy VPS domain riêng".
- `packages/ui-settings-general/tests/settings.test.ts` — test mới (3 case).

## Bước 1 — Chuẩn bị VPS Ubuntu

```bash
# Cài Docker Engine + Compose plugin (nếu chưa có) — script chính thức Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"   # rồi logout/login lại để áp dụng group
docker --version && docker compose version
```

Clone repo lên VPS (hoặc rsync/scp từ máy dev):

```bash
git clone <url-repo-cua-ban> agent-core
cd agent-core
```

## Bước 2 — Cấu hình `.env`

```bash
cp .env.example .env
```

Điền vào `.env` (thay giá trị thật của bạn — **KHÔNG dùng lại
`OPENAI_API_KEY`/`POSTGRES_PASSWORD` của môi trường dev cũ, đặt giá trị
MỚI cho VPS này**):

```dotenv
OPENAI_API_KEY=sk-...                                   # key thật của bạn
OPENAI_BASE_URL=https://proxy.onebot.meobeo.ai/v1
OPENAI_MODEL_ID=hosted_vllm/Qwen/Qwen3.5-35B-A3B-FP8

POSTGRES_PASSWORD=<đặt-mật-khẩu-mạnh-mới-cho-VPS-này>

# Web UI public ở port 4099 (domain app-harness đã trỏ vào port này ở lớp ngoài)
PORT_WEB_UI=4099

# REST+WS gộp qua api-gateway, public ở port 4098 (domain api-harness đã trỏ vào port này)
PORT_API_PUBLIC=4098
VITE_REST_URL=https://api-harness.onebot.meobeo.ai:4098
VITE_WS_URL=wss://api-harness.onebot.meobeo.ai:4098
```

## Bước 3 — Build + chạy (LUÔN kèm `-f docker-compose.prod.yml`)

```bash
# --build bắt buộc (VITE_REST_URL/VITE_WS_URL bake lúc build, không phải runtime)
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  up --build -d agent-core api-gateway postgres memory-core

docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
# xác nhận cả agent-core, api-gateway, postgres (healthy)
```

`memory-core` là tuỳ chọn (bỏ qua nếu không dùng module memory — không set
`MEMORY_CORE_*` thì `ctx.memory` tự không mount, không lỗi gì).

**Lưu ý:** chạy thiếu `-f docker-compose.prod.yml` (bare `docker compose
up`) vẫn build/chạy được, nhưng đó là đường LOCAL — không có `api-gateway`,
không bake domain vào bundle, không có restart policy cho postgres. Deploy
thật LUÔN cần cả 2 file.

## Bước 4 — Verify NGAY TRÊN VPS (trước khi đụng tới domain/TLS ở ngoài)

```bash
# App tĩnh — phải trả về HTML thật
curl -s http://localhost:4099/ | head -5

# REST qua gateway
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4098/health   # 200

# Bundle đã build đúng domain API (KHÔNG phải localhost:8787 mặc định)
docker compose exec agent-core sh -c \
  "grep -o 'api-harness.onebot.meobeo.ai:4098' apps/web/dist/assets/*.js | sort -u"
```

Nếu dòng cuối KHÔNG in ra gì — `.env` thiếu `VITE_REST_URL`/`VITE_WS_URL`,
hoặc bạn build KHÔNG kèm `-f docker-compose.prod.yml`.

## Bước 5 — Trỏ reverse proxy/TLS (lớp ngoài, ngoài phạm vi VPS này)

Ở nơi bạn quản lý domain `onebot.meobeo.ai` (Cloudflare Tunnel / proxy
trung tâm khác):

- `app-harness.onebot.meobeo.ai` → HTTP thường tới `<IP-VPS>:4099`.
- `api-harness.onebot.meobeo.ai` → HTTP thường tới `<IP-VPS>:4098` —
  **PHẢI hỗ trợ WebSocket passthrough** (forward đúng header `Upgrade`/
  `Connection`, không buffer/đóng kết nối dài — WS giữ kết nối lâu suốt
  phiên chat).

## Bước 6 — Firewall (Ubuntu `ufw`) — chỉ mở đúng 2 port cần public

```bash
sudo ufw allow OpenSSH
sudo ufw allow 4099/tcp
sudo ufw allow 4098/tcp
sudo ufw enable
sudo ufw status
```

**KHÔNG mở** `8787`/`8788`/`15052`/`5432` ra ngoài — đây là port nội bộ
(REST/WS trực tiếp, gRPC, Postgres), chỉ `api-gateway` cần chạm tới
`agent-core:8787`/`8788` và điều đó đã xảy ra trong mạng nội bộ
docker-compose, không cần publish ra host/internet. Compose vẫn publish các
port này ra `0.0.0.0` (giữ nguyên hành vi base cho tương thích dev/local) —
`ufw` ở bước này là lớp chặn thật sự cần thiết trên VPS, không có gì ở tầng
Compose thay thế được việc này (cân nhắc port-bind `127.0.0.1` ở
`docker-compose.prod.yml` từng được thử, nhưng bỏ vì rủi ro merge danh sách
`ports:` giữa nhiều file compose — `ufw` đơn giản và chắc chắn hơn).

## Bước 7 — Verify từ bên ngoài (sau khi DNS + reverse proxy đã trỏ xong)

```bash
curl -sI https://app-harness.onebot.meobeo.ai:4099/
curl -sI https://api-harness.onebot.meobeo.ai:4098/health
```

Mở `https://app-harness.onebot.meobeo.ai:4099` trên trình duyệt → màn hình
đăng ký/đăng nhập (user đầu tiên tự động thành `admin`, xem README) → đăng
ký → gửi 1 tin nhắn → nếu có phản hồi từ agent = REST + WS qua
`api-harness...` hoạt động đúng.

## Redeploy sau này (code mới)

```bash
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  up --build -d agent-core api-gateway
```

Chỉ cần `--build` lại `agent-core` khi đổi code HOẶC đổi
`VITE_REST_URL`/`VITE_WS_URL`. `api-gateway` (nginx thuần, không build từ
Dockerfile riêng) chỉ cần restart nếu sửa `deploy/api-gateway.conf`.

## Giới hạn/rủi ro đã biết (nói thẳng, không che)

- **CORS đang mở `*`** (`bundles/adapters/api-rest`, mặc định) — chấp nhận
  được vì API không dùng cookie/session dựa trên origin (auth là Bearer
  token trong header, không phải cookie), nhưng nếu muốn siết lại theo đúng
  `https://app-harness.onebot.meobeo.ai` sau này, `api-rest`'s `Config` đã
  có sẵn field `corsOrigin` — cần thêm 1 dòng plumbing env var ở
  `src/serve.ts` (chưa làm ở đây, ngoài phạm vi yêu cầu deploy này).
- **8787/8788/15052 vẫn publish `0.0.0.0`** — chỉ `ufw` chặn (xem Bước 6),
  không có lớp phòng thủ nào ở tầng Compose. Nếu quên bật `ufw` hoặc quên
  đúng rule, 3 port này lộ ra ngoài thật.
- **`api-gateway` không tự retry/failover** — nếu `agent-core` container
  restart, nginx sẽ trả lỗi 502 cho tới khi `agent-core` khoẻ lại (không có
  buffering/queue) — chấp nhận được cho 1-instance deployment hiện tại.
- **Chưa test qua reverse proxy/TLS thật của bạn** — mọi verify ở trên đều
  chạy trực tiếp trên VPS (`localhost:4098`/`4099`), CHƯA xác nhận qua domain
  thật + TLS layer ngoài (nằm ngoài khả năng test của tôi, cần bạn tự xác
  nhận Bước 7 sau khi trỏ domain xong).
