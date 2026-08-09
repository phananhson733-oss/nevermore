# app.gengrowth.ai 生产部署指南（Vercel + Supabase + Railway）

Owner 已于 **2026-07-20** 批准本次生产拓扑：

| 部件 | 平台 | 生产边界 |
|---|---|---|
| Next.js Web 与 `/api/mvp` | **Vercel** | `https://app.gengrowth.ai` 根路径 |
| 登录、PostgreSQL、私有文件存储 | **Supabase** | Web 与 Worker 共用同一个生产项目 |
| 常驻 pg-boss Worker | **Railway Hobby** | 只建一个 Worker 服务；无域名、无 HTTP 健康检查 |

Railway **不承载 Web**，Render **不承载本次生产 Worker**。冻结规格中 Railway
`web + worker` 双服务以及仓库里准备过的 Vercel + Render + `/app` 方案仅保留为历史背景；
本次上线以 `docs/DEPLOYMENT.md` 记录的 2026-07-20 Owner 决策为准。

最重要的约束只有两个：

1. Vercel Web、Railway Worker 和生产 migration 证据必须对应同一个干净、不可变的
   `<release SHA>`。
2. 顺序必须是：**Supabase 备份并迁移 → Railway Worker 拿到 lease → Vercel 唯一 URL
   部署并冒烟 → 验证 readiness → promote 到 `app.gengrowth.ai`**。

不要在文档中预填尚未形成的 SHA。完成全量验证并 push 后，再把真实 commit 记作
`<release SHA>`。所有秘密只放在密码管理器或平台环境变量中，不要贴进 git、日志、截图或群聊。

---

## 0. 冻结同一个发布版本

仓库位于：

```bash
cd /Users/wzb/Code/nevermore/signalframe-mvp-app
git status --short
git rev-parse HEAD
```

上线前应完成：

1. 检查完整 diff，运行项目的 lint、typecheck、测试、构建与部署配置检查。
2. commit 并 push 干净工作树。
3. 记录完整 40 位 commit 为 `<release SHA>`。
4. 后续在 Railway 与 Vercel 控制台逐一确认平台实际解析到这个 SHA，而不是只看分支名。

`APP_BUILD_SHA` 一般留空：Vercel 会提供 `VERCEL_GIT_COMMIT_SHA`，Railway 会提供
`RAILWAY_GIT_COMMIT_SHA`。只有确需手工覆盖时，才把它设置成完全相同的
`<release SHA>`；填错比不填更危险。

## 1. Supabase：先备份，再迁移

### 1.1 确认连接模式

Web 和 Worker 的 `DATABASE_URL` 必须使用 Supabase **Direct connection / Session
pooler**，不能使用 Transaction pooler。pg-boss、Worker readiness session advisory lease，
以及 Web readiness 的 session lock 都要求会话语义。

当前共享 Supabase session pool 的上限为 15。Worker 常驻一个 Drizzle pool 和一个
pg-boss pool；每个 Vercel warm instance 常驻一个 Drizzle pool，并可能按需启动第二个
enqueue-only pg-boss pool。因此生产基线固定为 Web `DB_POOL_MAX=1`、Worker
`DB_POOL_MAX=2`，同时持续观察连接数。不要把两端设成同一个较大值：Vercel 横向扩容会
让每个实例分别创建连接池。Worker 不允许低于 2，因为 readiness session advisory lease
会在 Worker 生命周期内占用 Drizzle pool 的一个连接，另一个连接用于正常任务查询。

### 1.2 先做可恢复的备份

在任何生产 migration 之前：

1. 对目标 Supabase PostgreSQL 做 logical dump。
2. 把备份存到仓库外、权限受限的位置，记录时间、项目 ref 与 SHA-256；不要记录连接串。
3. 恢复到一个名称明确的 disposable 本地数据库。
4. 验证 schema、表数和关键 canonical row count 后，删除这个 disposable 数据库。

Supabase 数据库备份不包含 Storage object bytes；Storage 恢复证据仍需按
`docs/RESTORE-DRILL.md` 独立完成。

### 1.3 从 `<release SHA>` 运行迁移

```bash
DATABASE_URL='<生产 session-mode URL>' pnpm db:migrate
DATABASE_URL='<生产 session-mode URL>' pnpm db:migrate
DATABASE_URL='<生产 session-mode URL>' pnpm db:migrate:check
DATABASE_URL='<生产 session-mode URL>' pnpm db:smoke
```

第二次 migrate 用来证明幂等；保留脱敏后的 migration version、schema check 与 smoke
结果。不要让 URL 或密码进入终端截图。

### 1.4 Auth 与 Storage

- 在 Supabase Auth 关闭公开注册。
- 由 Owner 创建批准的 Auth 用户，并显式写入 `app.operator_profiles`；生产应用不能自动授予成员身份。
- 确认 `raw-imports`、`exports` 两个 bucket 都存在且为私有。
- Worker 使用的 service role 必须能 create/read/list/delete 两个 bucket。list/delete 是
  retention 与 orphan cleanup 必需权限。
- 上线前记录 `raw`、`raw-import`、`snapshot-raw`、`export` 每类对象聚合数，均不得超过
  100,000 的 pilot 硬边界；为
  `ORPHAN_CLEANUP_CAPACITY_EXCEEDED` 和
  `STORAGE_RETENTION_CAPACITY_EXCEEDED` 配置告警。

## 2. Google OAuth：登记生产根域回调

在获批的 Google OAuth 2.0 Client 中新增这一条精确 URI；不要删除仍需使用的 localhost
回调：

```text
https://app.gengrowth.ai/api/mvp/oauth/google/callback
```

本次生产地址没有 `/app` 前缀。确认 consent screen 包含只读的
`webmasters.readonly` 与 `analytics.readonly` scope。Google 配置可能需要几分钟生效。

## 3. Railway Hobby：只部署常驻 Worker

### 3.1 创建服务

在已开通 Hobby 的目标 Railway workspace 中：

1. 新建或选择一个 SignalFrame 项目。
2. **只创建一个 Worker 服务，不创建 Web 服务。**
3. 连接同一个 Git 仓库和 `<release SHA>`，Root Directory 使用仓库根目录。
4. 使用仓库已有 `railway.json`；它会构建 `Dockerfile.worker`，并通过
   config-as-code 固定 Worker Start Command。
5. 在 deployment details 中确认最终 Start Command 为：

   ```text
   node --enable-source-maps --import tsx apps/worker/src/index.ts
   ```

6. 不生成 domain，不暴露 public port，不设置 HTTP healthcheck。Worker 本身没有 HTTP
   路由，这是预期行为。

仓库级配置已经 fail-safe：即使 Railway 控制台没有手工覆盖命令，也只能构建并启动
Worker，不能回退到 Next.js Web CMD。

### 3.2 设置 Worker 变量

完整清单见 `deploy/worker.env.template`。关键值如下：

- `APP_ORIGIN=https://app.gengrowth.ai`
- `DATABASE_URL=<Supabase session/direct-mode URL>`
- `DB_POOL_MAX=2`
- `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`
- `CREDENTIAL_ENCRYPTION_KEY`（与 Vercel Web 完全相同）
- `GOOGLE_OAUTH_CLIENT_ID`、`GOOGLE_OAUTH_CLIENT_SECRET`（与 Web 相同）
- `DATAFORSEO_ENABLED=true`、`DATAFORSEO_MAX_KEYWORDS=200`
- `DATAFORSEO_BACKLINKS_ENABLED=false`（独立 rollout 默认关闭；获批后 Web/Worker
  必须同时改为 `true`）
- `DATAFORSEO_AI_CITATIONS_ENABLED=false`（付费 AI citation 独立 rollout 默认关闭；
  启用时 Web/Worker 必须同时为 `true`，并设置同一个非秘密、服务端固定的
  `DATAFORSEO_AI_CITATION_MODEL`，且该模型必须由 DataForSEO Models contract 标明
  支持 web search 与 country scope；关闭时保持 model 未设置）
- `DATAFORSEO_MAX_BACKLINKS=500`、`DATAFORSEO_MAX_REFERRING_DOMAINS=100`、
  `DATAFORSEO_MAX_BACKLINK_PAGES=500`、
  `DATAFORSEO_MAX_BACKLINK_SOURCE_VERIFICATIONS=20`（对应硬上限
  1000/1000/1000/20，source verification 也不得超过 backlink cap）
- Worker-only `DATAFORSEO_LOGIN`、`DATAFORSEO_PASSWORD`（只从 Railway secret store 设置，不复制到 Vercel）
- `RAW_IMPORT_BUCKET=raw-imports`、`EXPORT_BUCKET=exports`
- `SF_BLOB_BACKEND=supabase`
- `LOG_LEVEL=info`
- Worker-only LLM：`LLM_PROVIDER` 及对应的完整 provider 字段
- `FINDING_SUMMARIES_ENABLED=true|false`，按已经确认的成本/合规策略设置

Worker 不需要 `SUPABASE_ANON_KEY`、`NEXT_PUBLIC_BASE_PATH`，也不能设置本地专用的
`SF_DEV_AUTH` 或 `SF_BLOB_DIR`。

### 3.3 先证明 Worker lease

从 `<release SHA>` 部署后检查 Railway 日志，必须看到脱敏的：

- 实际 `buildSha` 等于 `<release SHA>`；
- startup recovery sweep 完成；
- pg-boss 启动；
- Worker 成功持有 readiness lease。

日志不能出现环境变量值、token、provider body、模型输出、object key 或客户内容。
Worker 没有可 curl 的 URL；它的在线证据是 Supabase 中的 live session advisory lease。

## 4. Vercel：先部署唯一 URL，不要直接切生产域名

### 4.1 项目配置

在目标 Vercel 项目中确认：

- Root Directory：`apps/web`
- Framework Preset：Next.js
- Node：`24.x`
- 允许构建读取 Root Directory 外的 monorepo source
- 启用 System Environment Variables
- install/build/output override 保持缺省，除非另有经过评审的发布变更

### 4.2 Web 环境变量

Production 环境至少需要：

- `APP_ORIGIN=https://app.gengrowth.ai`
- 与 Worker 相同的 session-mode `DATABASE_URL`，但 Web 使用 `DB_POOL_MAX=1`
- 与 Worker相同的 `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、
  `CREDENTIAL_ENCRYPTION_KEY`、Google OAuth 字段、bucket 字段
- Web-only `SUPABASE_ANON_KEY`
- `SF_BLOB_BACKEND=supabase`
- `DATAFORSEO_ENABLED=true`、`DATAFORSEO_MAX_KEYWORDS=200`、`LOG_LEVEL=info`
- `DATAFORSEO_BACKLINKS_ENABLED=false`，以及与 Worker 完全一致的四个 Backlinks
  非秘密 cap；只有独立 rollout 获批后才在两个服务同时开启
- `DATAFORSEO_AI_CITATIONS_ENABLED=false`，并与 Worker 保持相同的可选固定
  `DATAFORSEO_AI_CITATION_MODEL`；只有付费 rollout 获批且精确 20 条治理查询可用时
  才在两个服务同时开启

**不要设置 `NEXT_PUBLIC_BASE_PATH=/app`。** 本次应用直接服务于
`https://app.gengrowth.ai` 根路径。也不要在 Vercel 设置 Worker-only LLM 变量、
`SF_DEV_AUTH` 或 `SF_BLOB_DIR`，也不要设置 Worker-only 的
`DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD`。

### 4.3 创建 unique deployment 并冒烟

部署 `<release SHA>`，但先保持 Vercel 提供的唯一 deployment URL，**不要立即 promote
`app.gengrowth.ai`**。在唯一 URL 检查：

```bash
curl -fsS https://<unique-vercel-url>/api/mvp/health/version
curl -fsS https://<unique-vercel-url>/api/mvp/health/live
curl -fsS https://<unique-vercel-url>/api/mvp/health/ready
```

期望：

- version 中 `buildSha` 精确等于 `<release SHA>`；
- live 为 200，但它只证明 Web 进程活着；
- ready 为 200，且其中 DB、pg-boss schema、Railway Worker lease 都 ready。

如果 ready 为 503，回 Railway 检查 Worker 和 session-mode 数据库连接，不能跳过或豁免。
在 Auth redirect allowlist 允许的情况下，再对唯一 URL 做登录和关键路由冒烟；若只能使用正式
origin，则保留唯一 URL 的所有健康与只读检查，并在 promote 后立即补做真实登录。

## 5. Promote 到 app.gengrowth.ai

只有当 Supabase backup/migration、Railway Worker lease、唯一 Vercel deployment 都指向
同一个 `<release SHA>` 并通过后，才执行：

1. 把**刚验证过的现有 Vercel deployment** promote/alias 到
   `https://app.gengrowth.ai`，不要另触发一次未验证 rebuild。
2. 在生产 origin 重跑：

   ```bash
   curl -fsS https://app.gengrowth.ai/api/mvp/health/version
   curl -fsS https://app.gengrowth.ai/api/mvp/health/live
   curl -fsS https://app.gengrowth.ai/api/mvp/health/ready
   ```

3. 再次确认 Web `buildSha` 与 Railway 日志中的 SHA 完全一致、ready 仍为 200。
4. 打开 `https://app.gengrowth.ai/login`，用已预配的 Supabase operator 完成真实登录、应用访问和登出。
5. 用一个有效但未预配的 Auth 测试用户证明访问被拒绝，而且不会创建 workspace 或
   `operator_profiles` 记录。
6. 完成关键页面、CSP、会话与移动端冒烟。

完成这一节只能说明“已部署并完成生产 origin 验证”；完整 pilot-ready 仍需下一节。

## 6. 完整 pilot 验收

- 用 Owner 批准的真实数据走通 Google OAuth → GSC property → collection。
- 走通 GA4 property 与 key-event sync。
- 用 Railway Worker 的正式 LLM 配置生成 structured Artifact。
- 验证 export signed URL 可下载、900 秒过期、bucket 保持私有。
- 验证 retention/orphan sweep 只有聚合脱敏日志：raw-family 90 天，export 需同时满足
  Storage 与 canonical run 30 天锚点。
- 按 `docs/RESTORE-DRILL.md` 完成数据库/PITR 与独立 Storage-byte 恢复证据。
- Owner 走查并签字确认 EN/zh-CN、B2B/B2C 的 evidence、priority、Action、Artifact 与两种 bundle。

## 常见问题

| 现象 | 常见原因 | 处理 |
|---|---|---|
| Railway 启动成网页或很快退出 | 没有覆盖 service Start Command | 设为 `node --enable-source-maps --import tsx apps/worker/src/index.ts` |
| `/api/mvp/health/ready` 为 503 | Worker 未持有 lease、连接了 transaction pooler 或 pg-boss schema 不完整 | 看 Railway 脱敏日志；改用 session/direct mode；重做 schema check |
| `buildSha` 不一致 | 两个平台部署了同一分支的不同 commit | 停止 promote，重新让两边都固定到同一个 `<release SHA>` |
| 页面被挂到 `/app` | Vercel 残留 `NEXT_PUBLIC_BASE_PATH=/app` | 删除该变量并从同一 SHA 重新创建、验证 unique deployment |
| Google 报 `redirect_uri_mismatch` | OAuth client 仍配置旧 `/app` URI或缺少新 URI | 新增 `https://app.gengrowth.ai/api/mvp/oauth/google/callback`，等待生效 |
| 导出生成但下载失败 | bucket 未建/不私有、service role 权限不足或 backend 不是 Supabase | 核对两个私有 bucket、create/read/list/delete 与 `SF_BLOB_BACKEND=supabase` |
| Supabase 连接耗尽 | Web 横向实例各自建池、pool 过大或误用连接模式 | 固定 Web `DB_POOL_MAX=1`、Worker `DB_POOL_MAX=2`；确认 session/direct mode 并监控 session 连接 |

配套文档：`docs/DEPLOYMENT.md`（权威拓扑与发布顺序）、
`docs/LAUNCH-CHECKLIST.md`（逐项勾选）、`docs/RUNBOOK.md`（故障与回滚）、
`deploy/worker.env.template`（Railway Worker 变量模板）。
