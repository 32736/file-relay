# Cloudflare 私人文件中转站（Drop）Codex 实施方案

> 面向 OpenAI Codex 的仓库级实施文档  
> 目标域名：`drop.28207.cc`  
> 核验日期：2026-08-12  
> 目标：由 Codex 分阶段完成全部落地；个人长期使用；优先使用 Cloudflare 免费能力；不依赖 Cloudflare Zero Trust。

---

# 1. 方案结论

本项目采用：

```text
Vue 3
+
TypeScript
+
Vite
+
Cloudflare Workers Static Assets
+
Hono
+
Cloudflare D1
+
Cloudflare R2 (Private)
+
GitHub OAuth
```

核心原则：

```text
1. 单域名同源部署
2. R2 永远 Private
3. Worker 是唯一授权边界
4. 大文件使用 Stream + Multipart
5. D1 只存元数据与业务状态
6. Token / Session 不明文入库
7. 分享下载次数必须原子更新
8. 所有数据库修改通过 Migration
9. 所有阶段由 Codex 分阶段执行并验证
10. 不允许 Codex 自行修改基础架构
```

本方案不再包含任何 DeepSeek 相关流程。

---

# 2. 产品定位

项目名称：

```text
Drop
```

访问地址：

```text
https://drop.28207.cc
```

定位：

- 个人文件临时存储
- Windows / macOS / 手机之间文件中转
- 临时分享下载链接
- 限时分享
- 限制下载次数
- 分享密码
- 别人临时上传文件给我
- 自动清理过期文件
- 后续可扩展 PWA / Tauri 桌面客户端
- 后续可扩展端到端加密

非目标：

- 不做完整多人网盘
- 不做团队协作
- 不做复杂目录树
- 不做视频在线播放平台
- 不做在线 Office
- 第一版不做 E2EE
- 第一版不依赖 Zero Trust

---

# 3. Codex 工作模式

本项目全部交给 Codex 落地，但不使用“一次 Prompt 完整生成项目”的方式。

推荐采用：

```text
AGENTS.md
    │
    ├── docs/
    │    ├── architecture.md
    │    ├── security.md
    │    ├── cloudflare.md
    │    ├── api.md
    │    └── database.md
    │
    └── tasks/
         ├── phase-00-bootstrap.md
         ├── phase-01-auth.md
         ├── phase-02-file-upload.md
         ├── phase-03-multipart.md
         ├── phase-04-download.md
         ├── phase-05-sharing.md
         ├── phase-06-cleanup.md
         ├── phase-07-share-enhancements.md
         ├── phase-08-incoming-upload.md
         ├── phase-09-pwa.md
         ├── phase-10-tauri.md
         └── phase-11-e2ee.md
```

Codex 每次只执行一个 Phase。

每个 Phase 完成后必须：

```text
typecheck
lint
test
build
git diff review
STOP
```

在人工验收之前，不允许自动进入下一阶段。

---

# 4. 推荐仓库结构

```text
drop/
├── AGENTS.md
├── README.md
├── LICENSE
├── .gitignore
│
├── docs/
│   ├── architecture.md
│   ├── security.md
│   ├── cloudflare.md
│   ├── api.md
│   ├── database.md
│   └── implementation-plan.md
│
├── tasks/
│   ├── phase-00-bootstrap.md
│   ├── phase-01-auth.md
│   ├── phase-02-file-upload.md
│   ├── phase-03-multipart.md
│   ├── phase-04-download.md
│   ├── phase-05-sharing.md
│   ├── phase-06-cleanup.md
│   ├── phase-07-share-enhancements.md
│   ├── phase-08-incoming-upload.md
│   ├── phase-09-pwa.md
│   ├── phase-10-tauri.md
│   └── phase-11-e2ee.md
│
├── src/
│   ├── components/
│   ├── pages/
│   ├── stores/
│   ├── composables/
│   ├── lib/
│   ├── router/
│   ├── App.vue
│   └── main.ts
│
├── server/
│   ├── index.ts
│   ├── env.ts
│   ├── routes/
│   ├── middleware/
│   ├── services/
│   └── lib/
│
├── db/
│   ├── schema.ts
│   └── migrations/
│
├── tests/
├── vite.config.ts
├── wrangler.jsonc
├── package.json
└── pnpm-lock.yaml
```

---

# 5. AGENTS.md 设计

仓库根目录必须存在：

```text
AGENTS.md
```

建议内容：

```markdown
# Drop Repository Instructions

## Project

Drop is a personal file transfer service built on Cloudflare.

Architecture:

- Vue 3
- TypeScript
- Vite
- Cloudflare Workers
- Workers Static Assets
- Hono
- D1
- Drizzle ORM
- Private R2
- pnpm

Before implementing a task:

1. Read this file.
2. Read the relevant documents under `docs/`.
3. Read the requested task under `tasks/`.
4. Inspect the existing implementation.
5. Implement only the requested phase.

## Package Manager

Use pnpm only.

Do not use npm or yarn.

## Required Validation

Before considering any task complete, run:

- pnpm typecheck
- pnpm lint
- pnpm test
- pnpm build

Do not report completion if any required command fails.

## Architecture Rules

- R2 must remain private.
- Worker is the authorization boundary.
- D1 stores metadata and application state.
- R2 stores file content.
- Browser clients must never receive infrastructure credentials.
- Do not change infrastructure architecture without explicit approval.
- Do not introduce a new persistence layer without explicit approval.

## Streaming Rules

Large uploads and downloads must use streams.

Never buffer a complete large upload or download in Worker memory.

Do not use `request.arrayBuffer()` for large upload bodies.

Do not use `object.arrayBuffer()` for large downloads.

## Security Rules

Never expose or log:

- Cloudflare API tokens
- R2 credentials
- GitHub client secret
- session secrets
- raw session tokens
- raw share tokens
- upload access tokens
- passwords

Security tokens must use Web Crypto.

Do not use `Math.random()` for security tokens.

Session tokens and share tokens must not be stored in plaintext.

Owner authentication must compare the GitHub numeric user ID.

OAuth state verification is mandatory.

State-changing browser APIs must validate Origin.

Do not inline-preview HTML or SVG uploaded by users.

Original filenames must never be used as R2 object keys.

## Database

All schema changes must use migrations.

All API inputs must be validated.

Avoid unindexed full-table scans.

## Scope

Implement only the requested phase.

Do not automatically start the next phase.

Do not refactor unrelated code.

Do not add optional features that are outside the current task.

If implementation conflicts with architecture documentation, stop and explain the conflict instead of silently changing the architecture.

## Cloudflare APIs

If a Cloudflare API, Wrangler command, or installed package API differs from repository documentation:

1. Inspect installed package versions and type definitions.
2. Inspect repository-local documentation.
3. Use official Cloudflare documentation when network access is available.
4. Do not guess API signatures.
5. Do not change architecture merely to work around an unknown API.

## Git

Keep changes scoped to the current task.

Do not commit secrets.

Do not modify lockfiles unless dependencies changed.

Before finishing, summarize:

- changed files
- key implementation decisions
- validation commands
- test results
- unresolved issues
```

---

# 6. docs/architecture.md

建议包含以下稳定架构。

```text
                    Internet
                        │
                        ▼
               drop.28207.cc
                        │
                        ▼
                 Cloudflare
                        │
             Workers Static Assets
                        │
             ┌──────────┴──────────┐
             │                     │
          Vue SPA              Worker API
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
                   D1                          R2
                    │                           │
        metadata / auth / state         private file objects
```

核心不变量：

```text
Browser
   │
   ▼
Worker
   │
   ├── D1
   └── R2
```

不允许：

```text
Browser -> Cloudflare API
Browser -> R2 API credential
Browser -> D1
```

---

# 7. 技术栈

## 前端

```text
Vue 3
Vite
TypeScript
Vue Router
Pinia
shadcn-vue
IndexedDB
```

## Worker

```text
TypeScript
Hono
Zod
Web Crypto API
```

## 数据库

```text
Cloudflare D1
Drizzle ORM
Drizzle Kit
```

## 文件存储

```text
Cloudflare R2
Private Bucket
```

## 身份认证

```text
GitHub OAuth
Owner-only
```

## 公开上传保护

```text
Cloudflare Turnstile
```

## 包管理器

```text
pnpm
```

---

# 8. Cloudflare 资源

资源名称：

```text
Worker:
drop

D1:
drop-db

R2:
drop-files

Domain:
drop.28207.cc
```

初始化：

```bash
npx wrangler login

npx wrangler d1 create drop-db

npx wrangler r2 bucket create drop-files
```

注意：

Codex 不应该把真实 Cloudflare Token、D1 ID 或 Secret 写入公共仓库。

---

# 9. Cloudflare 限制与默认参数

方案设计按以下限制处理：

```text
Workers Free request body:
100 MB

R2 Free Standard Storage:
10 GB-month / month

R2 Multipart:
最多 10,000 parts
除最后一片外，part 至少 5 MiB
```

应用默认：

```text
UPLOAD_CHUNK_SIZE = 32 MiB
MAX_FILE_SIZE = 2 GiB
UPLOAD_CONCURRENCY = 3

DEFAULT_FILE_RETENTION_DAYS = 30
SESSION_TTL_DAYS = 30
```

32 MiB 的原因：

```text
足够大：
减少 R2 Class A 操作数

足够小：
显著低于 Worker Free 单请求 100 MB 限制
```

---

# 10. wrangler.jsonc 基础配置

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",

  "name": "drop",
  "main": "server/index.ts",
  "compatibility_date": "2026-08-12",

  "assets": {
    "not_found_handling": "single-page-application"
  },

  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "drop-db",
      "database_id": "<CLOUDFLARE_D1_DATABASE_ID>"
    }
  ],

  "r2_buckets": [
    {
      "binding": "BUCKET",
      "bucket_name": "drop-files"
    }
  ],

  "triggers": {
    "crons": [
      "17 * * * *"
    ]
  },

  "vars": {
    "APP_ORIGIN": "https://drop.28207.cc",
    "OWNER_GITHUB_ID": "<YOUR_GITHUB_NUMERIC_ID>",
    "UPLOAD_CHUNK_SIZE": "33554432",
    "MAX_FILE_SIZE": "2147483648",
    "SESSION_TTL_SECONDS": "2592000",
    "DEFAULT_RETENTION_DAYS": "30"
  }
}
```

---

# 11. Secret 管理

使用 Wrangler Secret：

```bash
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
npx wrangler secret put TOKEN_HMAC_SECRET
npx wrangler secret put TURNSTILE_SECRET_KEY
```

必须加入 `.gitignore`：

```text
.dev.vars
.env
.env.*
!.env.example
```

Codex 禁止：

- 将真实 Secret 写入代码。
- 将真实 Secret 写入测试快照。
- 将真实 Secret 写入 README。
- 将真实 Secret 写入日志。

---

# 12. D1 数据模型

## sessions

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  github_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_sessions_token_hash
ON sessions(token_hash);

CREATE INDEX idx_sessions_expires_at
ON sessions(expires_at);
```

---

## files

```sql
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE,

  original_name TEXT NOT NULL,
  mime_type TEXT,
  size INTEGER NOT NULL,
  etag TEXT,

  source TEXT NOT NULL DEFAULT 'owner',

  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  deleted_at INTEGER
);

CREATE INDEX idx_files_created_at
ON files(created_at DESC);

CREATE INDEX idx_files_expires_at
ON files(expires_at);

CREATE INDEX idx_files_deleted_at
ON files(deleted_at);
```

---

## upload_sessions

```sql
CREATE TABLE upload_sessions (
  id TEXT PRIMARY KEY,

  file_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,

  original_name TEXT NOT NULL,
  mime_type TEXT,

  total_size INTEGER NOT NULL,
  chunk_size INTEGER NOT NULL,
  total_parts INTEGER NOT NULL,

  mode TEXT NOT NULL,
  r2_upload_id TEXT,

  auth_kind TEXT NOT NULL,
  access_token_hash TEXT,

  status TEXT NOT NULL,

  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX idx_upload_sessions_status
ON upload_sessions(status);

CREATE INDEX idx_upload_sessions_expires_at
ON upload_sessions(expires_at);
```

`mode`：

```text
single
multipart
```

`status`：

```text
created
uploading
completing
completed
aborted
failed
```

---

## upload_parts

```sql
CREATE TABLE upload_parts (
  upload_session_id TEXT NOT NULL,
  part_number INTEGER NOT NULL,
  etag TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,

  PRIMARY KEY(upload_session_id, part_number),

  FOREIGN KEY(upload_session_id)
    REFERENCES upload_sessions(id)
    ON DELETE CASCADE
);

CREATE INDEX idx_upload_parts_session
ON upload_parts(upload_session_id);
```

---

## shares

```sql
CREATE TABLE shares (
  id TEXT PRIMARY KEY,

  file_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,

  password_mac TEXT,

  expires_at INTEGER,

  max_downloads INTEGER,
  download_count INTEGER NOT NULL DEFAULT 0,
  last_download_at INTEGER,

  delete_file_after_exhausted INTEGER NOT NULL DEFAULT 0,

  created_at INTEGER NOT NULL,
  revoked_at INTEGER,

  FOREIGN KEY(file_id)
    REFERENCES files(id)
);

CREATE INDEX idx_shares_token_hash
ON shares(token_hash);

CREATE INDEX idx_shares_expires_at
ON shares(expires_at);

CREATE INDEX idx_shares_file_id
ON shares(file_id);
```

---

## incoming_requests

第三阶段后使用：

```sql
CREATE TABLE incoming_requests (
  id TEXT PRIMARY KEY,

  token_hash TEXT NOT NULL UNIQUE,
  title TEXT,

  expires_at INTEGER NOT NULL,

  max_file_size INTEGER NOT NULL,
  max_files INTEGER NOT NULL,
  uploaded_count INTEGER NOT NULL DEFAULT 0,

  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX idx_incoming_token_hash
ON incoming_requests(token_hash);

CREATE INDEX idx_incoming_expires_at
ON incoming_requests(expires_at);
```

---

# 13. ID 与安全 Token

普通数据库 ID：

```ts
crypto.randomUUID()
```

安全 Token：

```text
Session Token:
32 random bytes

Share Token:
24~32 random bytes

Upload Token:
24~32 random bytes

OAuth State:
24~32 random bytes
```

编码：

```text
base64url
```

禁止：

```text
Math.random()
Date.now() + random
短 UUID 截断
自增 ID 作为公开 Token
```

---

# 14. GitHub OAuth

GitHub OAuth App：

```text
Homepage URL:
https://drop.28207.cc

Authorization callback URL:
https://drop.28207.cc/api/auth/github/callback
```

流程：

```text
GET /api/auth/github
        │
        ├── generate state
        ├── state -> temporary HttpOnly Cookie
        └── redirect GitHub
                 │
                 ▼
GET /api/auth/github/callback
        │
        ├── validate state
        ├── exchange code
        ├── GET GitHub /user
        ├── numeric user.id == OWNER_GITHUB_ID ?
        │        │
        │       NO -> 403
        │
        ├── create session token
        ├── D1 stores token hash only
        └── set session Cookie
```

Session Cookie：

```text
Name:
__Host-drop_session

Flags:
HttpOnly
Secure
SameSite=Lax
Path=/
```

不要设置：

```text
Domain
```

Owner 判断：

```text
GitHub numeric user.id
```

禁止只使用：

```text
username
login name
email
```

---

# 15. Origin / CSRF 防护

Owner 使用 Cookie Session。

所有：

```text
POST
PUT
PATCH
DELETE
```

管理接口必须检查：

```http
Origin: https://drop.28207.cc
```

不匹配则拒绝。

公开 Token API 采用独立 Token 权限模型。

---

# 16. R2 Object Key

禁止：

```text
R2/project.zip
```

推荐：

```text
objects/2026/08/<fileId>
```

原始文件名只保存在：

```text
files.original_name
```

避免：

- 重名
- 路径穿越
- Unicode 路径异常
- 特殊字符问题
- 对象地址可预测

---

# 17. 上传协议

统一采用：

```text
Upload Session
```

创建：

```http
POST /api/uploads
```

Request：

```json
{
  "name": "project.zip",
  "size": 1073741824,
  "type": "application/zip"
}
```

Response：

```json
{
  "uploadId": "...",
  "mode": "multipart",
  "chunkSize": 33554432,
  "totalParts": 32
}
```

规则：

```text
<= 32 MiB:
single

> 32 MiB:
multipart
```

---

# 18. Single Upload

API：

```http
PUT /api/uploads/:uploadId/content
```

Body：

```text
raw binary stream
```

Worker：

```ts
await env.BUCKET.put(objectKey, request.body, {
  httpMetadata: {
    contentType: mimeType
  }
})
```

关键：

```text
request.body
↓
R2
```

禁止：

```ts
await request.arrayBuffer()
```

后再完整上传。

---

# 19. Multipart

创建：

```ts
const multipart = await env.BUCKET.createMultipartUpload(
  objectKey,
  {
    httpMetadata: {
      contentType: mimeType
    }
  }
)
```

保存：

```text
multipart.uploadId
```

到：

```text
upload_sessions.r2_upload_id
```

客户端：

```text
chunk size:
32 MiB

parallel uploads:
3
```

---

# 20. 上传 Part

API：

```http
PUT /api/uploads/:uploadId/parts/:partNumber
```

核心：

```ts
const multipart = env.BUCKET.resumeMultipartUpload(
  objectKey,
  r2UploadId
)

const result = await multipart.uploadPart(
  partNumber,
  request.body
)
```

写入：

```text
upload_parts
```

字段：

```text
part_number
etag
size
```

必须 UPSERT，保证重试幂等。

---

# 21. Part 校验

必须验证：

```text
partNumber >= 1
partNumber <= totalParts
```

如果 Content-Length 可用：

```text
非最后 Part：
<= chunkSize 且符合合理范围

最后 Part：
<= chunkSize
```

服务端不能完全信任浏览器声明。

---

# 22. 断点续传

查询：

```http
GET /api/uploads/:uploadId
```

返回：

```json
{
  "status": "uploading",
  "mode": "multipart",
  "chunkSize": 33554432,
  "totalParts": 32,
  "completedParts": [
    {
      "partNumber": 1,
      "etag": "..."
    }
  ]
}
```

前端 IndexedDB 保存：

```text
uploadId
file name
file size
file lastModified
chunkSize
```

刷新后：

```text
GET Upload Session
↓
跳过 completed parts
↓
继续缺失 parts
```

---

# 23. Complete

API：

```http
POST /api/uploads/:uploadId/complete
```

执行：

1. 查询 Upload Session。
2. 查询所有 Part。
3. 检查 Part 数量。
4. 按 `part_number ASC` 排序。
5. `multipart.complete(parts)`。
6. 创建 files 记录。
7. 标记 Upload Session completed。

必须实现幂等恢复。

典型故障：

```text
R2 complete 已成功
↓
D1 更新失败
```

重试时：

```text
BUCKET.head(object_key)
```

如果对象已存在且大小符合：

```text
补写 D1
↓
标记 completed
```

而不是再次 complete。

---

# 24. Abort

API：

```http
DELETE /api/uploads/:uploadId
```

Multipart：

```ts
await multipart.abort()
```

然后：

```text
status = aborted
```

Cron 负责清理超时 Session。

---

# 25. 文件列表

API：

```http
GET /api/files
```

参数：

```text
cursor
limit
q
sort
```

默认：

```text
limit = 30
created_at DESC
```

不要无限：

```sql
SELECT * FROM files
```

必须过滤：

```text
deleted_at IS NULL
```

---

# 26. 删除

API：

```http
DELETE /api/files/:id
```

使用：

```text
logical delete
+
background physical cleanup
```

流程：

```text
D1 deleted_at = now
↓
尝试 R2 delete
↓
失败由 Cron 重试
```

---

# 27. 分享

Owner：

```http
POST /api/files/:fileId/shares
```

Request：

```json
{
  "expiresIn": 86400,
  "maxDownloads": 3,
  "password": null,
  "deleteFileAfterExhausted": false
}
```

生成：

```text
24~32 bytes random token
```

URL：

```text
https://drop.28207.cc/s/<RAW_TOKEN>
```

D1：

```text
SHA-256(RAW_TOKEN)
```

RAW Token：

```text
只在创建响应中出现
```

---

# 28. 分享页面

页面：

```text
/s/:token
```

公共元数据：

```http
GET /api/public/shares/:token
```

Response：

```json
{
  "name": "project.zip",
  "size": 134217728,
  "mimeType": "application/zip",
  "expiresAt": 1780000000,
  "remainingDownloads": 2,
  "passwordRequired": false
}
```

禁止泄露：

```text
object_key
r2_upload_id
内部数据库字段
Secret
```

---

# 29. 分享密码

不保存明文。

推荐：

```text
HMAC-SHA-256(
  TOKEN_HMAC_SECRET,
  shareId + "\0" + password
)
```

使用：

```text
Web Crypto API
```

第一版 MVP 可不实现密码，放 Phase 07。

---

# 30. 下载次数原子控制

禁止：

```text
SELECT count
↓
判断
↓
UPDATE
```

使用：

```sql
UPDATE shares
SET
  download_count = download_count + 1,
  last_download_at = ?
WHERE id = ?
  AND revoked_at IS NULL
  AND (expires_at IS NULL OR expires_at > ?)
  AND (
    max_downloads IS NULL
    OR download_count < max_downloads
  )
RETURNING *;
```

返回 0 行：

```text
403 / 410
```

---

# 31. 下载

API：

```http
GET /api/public/shares/:token/download
```

流程：

```text
token hash
↓
share validation
↓
atomic download count claim
↓
file lookup
↓
R2 get
↓
stream Response
```

Headers：

```http
Content-Type: application/octet-stream
Content-Disposition: attachment; ...
X-Content-Type-Options: nosniff
Accept-Ranges: bytes
```

中文文件名：

```text
filename=
+
filename*=
```

---

# 32. Range 下载

必须支持：

```http
Range: bytes=104857600-
```

返回：

```http
206 Partial Content
Accept-Ranges: bytes
Content-Range: ...
Content-Length: ...
```

非法 Range：

```http
416 Range Not Satisfiable
```

禁止：

```text
R2 full object
↓
ArrayBuffer
↓
JS slice
```

必须：

```text
R2 Range
↓
Stream
↓
Response
```

---

# 33. 预览安全

默认：

```text
Content-Disposition: attachment
```

允许内联预览白名单：

```text
image/png
image/jpeg
image/webp
image/gif
application/pdf
```

第一版禁止：

```text
text/html
image/svg+xml
application/xhtml+xml
```

避免同源 XSS。

---

# 34. 阅后即焚

建议定义为：

```text
maxDownloads = 1
```

第一次下载占用成功后：

```text
分享立即失效
```

如果：

```text
deleteFileAfterExhausted = true
```

不要在流刚开始时删除 R2。

流程：

```text
first download
↓
download_count exhausted
↓
share inaccessible
↓
Cron waits safety window
↓
delete file
```

---

# 35. Cron

建议：

```text
每小时一次
```

例如：

```text
17 * * * *
```

任务：

```text
1. 删除过期 Session
2. 撤销 / 清理过期 Share
3. Abort 超时 Multipart Upload
4. 清理 upload_parts
5. 删除已逻辑删除文件的 R2 对象
6. 删除过期临时文件
7. 清理 exhausted + delete-on-download 文件
```

每次批量：

```text
50~100
```

避免单次任务扫描整个数据库。

---

# 36. Incoming Upload

Phase 08 实现。

Owner 创建：

```http
POST /api/incoming-requests
```

返回：

```text
https://drop.28207.cc/u/<TOKEN>
```

对方：

```text
无需登录
```

但创建 Upload Session 前必须：

```text
Turnstile
↓
server-side Siteverify
```

---

# 37. Incoming Upload Token

Turnstile 验证成功后生成：

```text
upload_access_token
```

D1 只保存：

```text
SHA-256(upload_access_token)
```

公开 Part API：

```http
Authorization: Bearer <upload_access_token>
```

必须验证：

```text
Upload Session
Incoming Request
Token
Expiry
Part Number
Total Size
```

---

# 38. 前端 UI

桌面：

```text
┌──────────────────────────────────────────────┐
│ Drop                              6.2 / 10 GB│
├──────────────────────────────────────────────┤
│ 文件    分享    上传请求    设置              │
├──────────────────────────────────────────────┤
│                                              │
│       ┌──────────────────────────────┐       │
│       │       拖放文件到这里         │       │
│       │        + 选择文件            │       │
│       └──────────────────────────────┘       │
│                                              │
├──────────────────────────────────────────────┤
│ project.zip        1.2 GB       24 分钟前    │
│ 上传完成           [分享] [下载] [...]       │
└──────────────────────────────────────────────┘
```

移动端：

```text
文件
上传
分享
设置
```

上传状态：

```text
总进度
速度
已上传
总大小
暂停
继续
取消
重试
```

---

# 39. 重试策略

默认 Part 重试：

```text
最多 3 次
```

退避：

```text
1s
2s
4s
```

不自动重试：

```text
400
401
403
404
413
```

可以重试：

```text
408
429
500
502
503
504
network errors
```

429 尊重：

```text
Retry-After
```

---

# 40. 文件名安全

原始文件名：

```text
不可信输入
```

禁止直接：

```text
拼 R2 Key
拼 SQL
拼 HTML
拼 HTTP Header
```

Header：

```text
移除 CR/LF
ASCII fallback
UTF-8 filename*
```

Vue：

```text
普通文本绑定
```

禁止：

```html
v-html="file.name"
```

---

# 41. API 错误格式

统一：

```json
{
  "error": {
    "code": "UPLOAD_PART_FAILED",
    "message": "上传分片失败",
    "requestId": "..."
  }
}
```

日志可记录：

```text
requestId
route
status
fileId
uploadId
```

禁止日志：

```text
Secret
Raw Token
OAuth Token
Password
file body
```

---

# 42. Worker 性能规则

不要在 Worker 中：

```text
计算完整大文件 SHA-256
视频转码
ZIP 解压
大图处理
整文件 ArrayBuffer
整表扫描
```

如未来需要完整 SHA-256：

```text
优先客户端增量计算
```

---

# 43. MIME 安全

浏览器：

```text
file.type
```

不能作为安全依据。

原则：

```text
默认 attachment
预览白名单
不执行上传内容
```

---

# 44. API 路由

## Auth

```text
GET  /api/auth/github
GET  /api/auth/github/callback
GET  /api/auth/me
POST /api/auth/logout
```

## Files

```text
GET    /api/files
GET    /api/files/:id
DELETE /api/files/:id
```

## Upload

```text
POST   /api/uploads
GET    /api/uploads/:id
PUT    /api/uploads/:id/content
PUT    /api/uploads/:id/parts/:partNumber
POST   /api/uploads/:id/complete
DELETE /api/uploads/:id
```

## Shares

```text
POST   /api/files/:fileId/shares
GET    /api/shares
DELETE /api/shares/:id
```

## Public Shares

```text
GET  /api/public/shares/:token
POST /api/public/shares/:token/unlock
GET  /api/public/shares/:token/download
```

## Incoming

```text
POST   /api/incoming-requests
GET    /api/incoming-requests
DELETE /api/incoming-requests/:id

GET  /api/public/incoming/:token
POST /api/public/incoming/:token/uploads

GET    /api/public/uploads/:id
PUT    /api/public/uploads/:id/content
PUT    /api/public/uploads/:id/parts/:partNumber
POST   /api/public/uploads/:id/complete
DELETE /api/public/uploads/:id
```

---

# 45. Worker 入口

Hono + scheduled：

```ts
const app = new Hono<{ Bindings: Env }>()

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx)
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runCleanup(env))
  }
} satisfies ExportedHandler<Env>
```

生产环境：

```text
不返回 stack trace
```

---

# 46. Migration

所有数据库修改：

```text
migration
```

禁止直接 Dashboard 修改生产 schema 后不记录。

流程：

```bash
npx wrangler d1 migrations apply drop-db --local

npx wrangler d1 migrations apply drop-db --remote
```

部署原则：

```text
backward-compatible migration
↓
deploy code
↓
optional cleanup migration
```

---

# 47. 本地开发

初始化建议：

```bash
pnpm create cloudflare@latest drop --framework=vue
cd drop
pnpm install
```

依赖：

```bash
pnpm add hono drizzle-orm zod pinia vue-router
pnpm add -D drizzle-kit
```

本地：

```bash
pnpm dev
```

规则：

```text
默认使用本地 D1 / R2
不要默认连接生产资源
```

---

# 48. GitHub OAuth 本地开发

推荐创建：

```text
Production OAuth App
Development OAuth App
```

生产：

```text
https://drop.28207.cc/api/auth/github/callback
```

开发：

```text
http://localhost:<port>/api/auth/github/callback
```

避免为本地开发临时修改生产 OAuth App。

---

# 49. 部署

验证：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

部署：

```bash
pnpm deploy
```

首次先验证：

```text
workers.dev
```

再绑定：

```text
drop.28207.cc
```

Cloudflare：

```text
Workers & Pages
-> drop
-> Settings
-> Domains & Routes
-> Add Custom Domain
```

Drop 与家庭网络：

```text
direct.28207.cc
Tunnel
Mac mini
```

没有依赖关系。

---

# 50. CI/CD

MVP 初期：

```text
人工验收
+
本机 deploy
```

稳定后增加 GitHub CI。

建议：

```text
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

生产部署使用：

```text
最小权限 Cloudflare API Token
```

禁止：

```text
Global API Key
```

---

# 51. Phase 00 — Bootstrap

目标：

```text
建立可靠的工程基础
```

实现：

```text
Vue
TypeScript
Cloudflare Vite Plugin
Worker
Hono
D1 Binding
R2 Binding
Drizzle
Vitest
/api/health
```

不实现：

```text
OAuth
Upload
Download
Share
```

验收：

```text
pnpm typecheck
pnpm lint
pnpm test
pnpm build

GET /api/health
=> { "ok": true }
```

---

# 52. Phase 01 — Auth

实现：

```text
GitHub OAuth
OAuth state
Owner numeric ID
Session
Session Hash
Cookie
Origin protection
Logout
/api/auth/me
```

验收：

```text
未登录管理 API -> 401
非 Owner -> 403
Owner -> 登录成功
state 错误 -> 拒绝
logout -> session 失效
```

---

# 53. Phase 02 — Small File Upload

实现：

```text
Upload Session
<=32 MiB single upload
Private R2
Files D1
文件列表
删除
```

验收：

```text
1 KB
5 MiB
31 MiB
```

均正常。

---

# 54. Phase 03 — Multipart

实现：

```text
createMultipartUpload
uploadPart
upload_parts
resume
complete
abort
retry
idempotent complete
```

测试：

```text
33 MiB
200 MiB
>100 MB
```

以及：

```text
刷新
断网
Part 重试
Complete 重试
```

---

# 55. Phase 04 — Download

实现：

```text
Owner download
Share-ready streaming
Range
206
416
Content-Disposition
UTF-8 filename
```

测试：

```text
普通下载
断点下载
中文文件名
大文件无完整内存缓存
```

---

# 56. Phase 05 — Sharing

实现：

```text
Share Token
Token Hash
Expiry
maxDownloads
atomic counter
public page
revocation
```

测试：

```text
expired
revoked
maxDownloads=1
并发请求
```

---

# 57. Phase 06 — Cleanup

实现：

```text
Cron
expired sessions
expired uploads
abort multipart
logical delete cleanup
expired files
exhausted file cleanup
```

完成后：

```text
MVP RELEASE
```

---

# 58. Phase 07 — Share Enhancements

增加：

```text
分享密码
图片预览
PDF 预览
二维码
UX 优化
存储统计
批量删除
搜索
```

---

# 59. Phase 08 — Incoming Upload

增加：

```text
Incoming Request
Turnstile
Public Upload Token
Multipart
Expiry
File Count
File Size Limit
```

---

# 60. Phase 09 — PWA

增加：

```text
Installable PWA
mobile UX
share target（视平台支持情况）
offline shell
```

不做离线文件上传队列，除非后续明确需要。

---

# 61. Phase 10 — Tauri

增加：

```text
Windows
macOS
system tray
Explorer/Finder integration
Send to Drop
clipboard image upload
```

---

# 62. Phase 11 — E2EE

单独设计：

```text
Client-side AES-GCM
Client-side key management
Multipart encryption
Range / download implications
metadata exposure model
```

必须先形成独立设计文档。

禁止直接在现有上传代码上“顺手加密”。

---

# 63. Codex Phase Task 模板

每一个：

```text
tasks/phase-XX-*.md
```

使用以下结构：

```markdown
# Phase XX - Name

## Goal

本阶段最终目标。

## Read Before Work

- AGENTS.md
- docs/architecture.md
- docs/security.md
- 对应 docs/*.md

## Scope

必须实现的内容。

## Out of Scope

明确禁止本阶段实现的内容。

## Existing Constraints

当前架构约束。

## API Changes

需要增加 / 修改的 API。

## Database Changes

需要增加 / 修改的 migration。

## Tests

必须增加的测试。

## Acceptance Criteria

可直接验证的结果。

## Required Commands

pnpm typecheck
pnpm lint
pnpm test
pnpm build

## Completion

完成后必须：

1. 总结修改文件。
2. 说明关键设计。
3. 给出验证命令结果。
4. 说明未解决问题。
5. 停止。

Do not start the next phase.
```

---

# 64. Codex 第一条任务

初始化仓库后，给 Codex：

```text
Read AGENTS.md.

Then read:

- docs/architecture.md
- docs/security.md
- docs/cloudflare.md
- tasks/phase-00-bootstrap.md

Inspect the repository before making changes.

Implement Phase 00 only.

Follow all repository instructions in AGENTS.md.

Run every required validation command before finishing.

Do not implement authentication, file upload, download, sharing, Turnstile, PWA, Tauri, or E2EE.

When complete:

1. summarize changed files;
2. summarize key implementation decisions;
3. report validation commands and results;
4. report unresolved issues;
5. stop.

Do not start Phase 01.
```

---

# 65. 后续 Codex Prompt

Phase 01：

```text
Read AGENTS.md and tasks/phase-01-auth.md.

Inspect the current repository state before making changes.

Implement Phase 01 only.

Run all required validation commands.

Do not start Phase 02.
```

以后统一：

```text
Read AGENTS.md and tasks/phase-XX-*.md.

Inspect the existing implementation.

Implement this phase only.

Run all required validation commands.

Stop after reporting results.
```

---

# 66. Codex 遇到 API 差异时

如果：

```text
Cloudflare SDK
Wrangler
Hono
Drizzle
Vite Plugin
```

与文档不同：

Codex 必须：

```text
1. 查看 package.json / lockfile。
2. 查看已安装包类型定义。
3. 查看仓库内现有代码。
4. 如允许联网，只使用官方文档核对。
5. 不猜函数签名。
6. 不为了绕过未知 API 而更换架构。
```

如果仍无法确认：

```text
停止
↓
报告冲突
↓
等待人工决策
```

---

# 67. Codex 的权限建议

推荐：

```text
workspace-write
```

仅允许修改当前项目仓库。

Codex 正常可以：

```text
读写仓库文件
安装项目依赖
执行 lint/test/build
执行本地 Wrangler
```

以下操作应要求明确确认：

```text
生产 D1 Migration
生产 R2 删除
Wrangler production deploy
修改生产 Secret
修改 DNS
创建 / 删除 Cloudflare 生产资源
执行危险 Git 操作
```

不要把：

```text
生产 Deploy
数据库 Migration
删除 Cloudflare 资源
```

变成无人审查的默认步骤。

---

# 68. Codex Git 操作约束

禁止未经明确要求：

```text
git reset --hard
git clean -fd
git push --force
删除其他分支
覆盖用户未提交修改
```

Codex 每 Phase 结束时优先给出：

```text
git diff --stat
git diff
```

供人工检查。

提交可以人工执行，或者明确要求 Codex：

```text
commit this phase
```

---

# 69. 测试矩阵

## Auth

```text
未登录
非 Owner
Owner
OAuth state 错误
Session 过期
Logout
Origin 错误
```

## Upload

```text
1 KB
5 MiB
31 MiB
33 MiB
200 MiB
>100 MB
```

异常：

```text
Part 重试
断网
刷新
非法 Part
超大文件
Complete 重试
Abort
```

## Download

```text
200
206
416
中文文件名
大文件
Range resume
```

## Share

```text
错误 Token
expired
revoked
maxDownloads=1
maxDownloads=3
并发访问
```

## Security

文件名：

```text
../../test.html
foo"\r\nX-Test: 1
<script>alert(1)</script>.html
测试 文件.zip
emoji-😀.txt
```

验证：

```text
R2 Key 不受影响
Header 无注入
UI 无 XSS
HTML 不同源 inline 执行
```

---

# 70. MVP 验收清单

MVP 发布前必须全部满足：

- [ ] `drop.28207.cc` 可以加载。
- [ ] SPA 深层路由刷新正常。
- [ ] GitHub OAuth 只允许 Owner。
- [ ] OAuth state 正确校验。
- [ ] Session Token 不明文入库。
- [ ] R2 Bucket Private。
- [ ] 1 MB 文件上传下载正常。
- [ ] 31 MiB Single Upload 正常。
- [ ] >100 MB 文件 Multipart 正常。
- [ ] Upload Part 使用 Stream。
- [ ] 刷新后可恢复 Multipart。
- [ ] Complete 幂等。
- [ ] 下载使用 Stream。
- [ ] Range 返回 206。
- [ ] 无效 Range 返回 416。
- [ ] 删除后文件不可访问。
- [ ] Share Token 不明文入库。
- [ ] Share Expiry 正常。
- [ ] Download Count 原子更新。
- [ ] HTML/SVG 不会在主域名 inline 执行。
- [ ] Cron 清理正常。
- [ ] Secret 未进入 Git。
- [ ] `pnpm typecheck` 通过。
- [ ] `pnpm lint` 通过。
- [ ] `pnpm test` 通过。
- [ ] `pnpm build` 通过。

---

# 71. 明确禁止 Codex 做的事情

```text
× 把 Vue 和 API 拆成两个域名
× 自行迁移到其他云
× 自行更换 D1
× 自行更换 R2
× 开启 Public R2 Bucket
× 使用 r2.dev 作为正式下载地址
× 把 Cloudflare API Token 发给浏览器
× 把 R2 Credential 发给浏览器
× 大文件使用 request.arrayBuffer()
× 大文件下载使用 object.arrayBuffer()
× Math.random() 生成 Token
× Token 明文存 D1
× 原始文件名作为 R2 Key
× 信任浏览器 MIME
× HTML/SVG 同源内联预览
× SELECT 后 UPDATE 实现 maxDownloads
× OAuth 不验证 state
× 仅用 GitHub username 判断 Owner
× Cookie API 不做 Origin 校验
× Secret 写入仓库
× 日志打印 Raw Token
× 未经批准改架构
× 未完成当前 Phase 自动开始下一 Phase
× 未验证就报告完成
```

---

# 72. README 最终定位

README 不承担完整设计文档职责。

只放：

```text
项目介绍
Screenshot
Features
Quick Start
Local Development
Deployment
Environment
License
Docs links
```

设计细节统一放：

```text
docs/
```

Codex 任务统一放：

```text
tasks/
```

---

# 73. LICENSE

推荐：

```text
Apache-2.0
```

`package.json`：

```json
{
  "license": "Apache-2.0"
}
```

后续建议增加：

```text
CONTRIBUTING.md
SECURITY.md
CODE_OF_CONDUCT.md
```

---

# 74. 官方资料

## OpenAI Codex

Codex：

https://developers.openai.com/learn/codex

OpenAI Codex 安全运行 / Sandbox / Approvals：

https://openai.com/index/running-codex-safely/

Codex 工程化与 ExecPlan 示例：

https://developers.openai.com/cookbook/examples/codex/code_modernization

---

## Cloudflare

Workers Vue：

https://developers.cloudflare.com/workers/framework-guides/web-apps/vue/

Workers Vite Plugin：

https://developers.cloudflare.com/workers/vite-plugin/

Workers Static Assets：

https://developers.cloudflare.com/workers/static-assets/

Workers Limits：

https://developers.cloudflare.com/workers/platform/limits/

Workers Pricing：

https://developers.cloudflare.com/workers/platform/pricing/

R2 Pricing：

https://developers.cloudflare.com/r2/pricing/

R2 Limits：

https://developers.cloudflare.com/r2/platform/limits/

R2 Upload Objects：

https://developers.cloudflare.com/r2/objects/upload-objects/

R2 Multipart from Workers：

https://developers.cloudflare.com/r2/api/workers/workers-multipart-usage/

R2 Workers API：

https://developers.cloudflare.com/r2/api/workers/workers-api-reference/

R2 Lifecycle：

https://developers.cloudflare.com/r2/buckets/object-lifecycles/

D1 Pricing：

https://developers.cloudflare.com/d1/platform/pricing/

Turnstile：

https://developers.cloudflare.com/turnstile/

Turnstile Server-side Validation：

https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

---

## GitHub

GitHub OAuth Web Application Flow：

https://docs.github.com/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps

---

# 75. 最终实施策略

推荐执行流程：

```text
创建 Git 仓库
      │
      ▼
放入：
AGENTS.md
docs/
tasks/
LICENSE
      │
      ▼
Initial Commit
      │
      ▼
Codex Phase 00
      │
      ▼
typecheck / lint / test / build
      │
      ▼
git diff 人工验收
      │
      ▼
Phase 01
      │
      ▼
...
      │
      ▼
Phase 06
      │
      ▼
MVP Release
```

最重要的是：

```text
Codex 是执行者
文档是架构约束
tasks 是工作边界
测试是验收标准
Git diff 是人工检查边界
```

不要使用：

```text
“请把整个 Drop 全部实现完成”
```

这样的单次 Prompt。

使用：

```text
一个 Phase
↓
实现
↓
验证
↓
Review
↓
下一 Phase
```

整个项目的实施会更可控，也更容易在某个阶段出现问题时定位和回滚。

---

# 76. 最终结论

Drop 的最终基础架构固定为：

```text
Vue 3
+
Workers Static Assets
+
Hono
+
D1
+
Private R2
+
GitHub OAuth
```

Codex 落地方式固定为：

```text
AGENTS.md
+
docs/*
+
tasks/phase-XX-*.md
+
Phase-by-Phase implementation
+
Automated validation
+
Human git diff review
```

四条不可破坏的工程底线：

```text
1. R2 永远 Private
2. 大文件永远 Stream + Multipart
3. Token / Session 永远不明文入库
4. 分享下载限制永远使用原子更新
```

只要这四条与阶段化 Codex 工作流保持不变，后续扩展 Incoming Upload、PWA、Tauri、E2EE 都不需要推翻基础架构。
