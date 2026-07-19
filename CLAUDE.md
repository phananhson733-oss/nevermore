# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目定位

SignalFrame Service Delivery MVP 0.2.0——面向欧美 B2B/B2C 客户的**内部 1 对 1 SEO/GEO 定制服务工作台**（未来 Signal SaaS 的“深度服务层”）。一个已登录的内部 Operator 走完一条纵向价值链：

`创建项目 → ICP/Persona/90 天目标 → 抓取站点 + 连接 GSC/GA4 或导入 Keyword Gap CSV → 五域诊断 → 查看来源/时间/URL/限制 → 确认或忽略 Finding → 30/60/90 行动计划 → 生成并编辑 3 类执行物 → 中英文产品界面预览客户报告 → 导出版本化 JSON ZIP`

“完成”不表示自动发布网站、改 CMS、验证排名或商业化订阅。产品边界与不变量以规格三件套为准，**规格是唯一权威，本仓库不自行扩大范围**。

### 权威顺序（冲突时不得自行猜测）

1. `../signalframe-mvp/implementation-spec-v0.2/MVP-IMPLEMENTATION-SPEC.md` — 范围、行为、状态机、施工顺序与验收标准的唯一产品/工程权威。
2. `../signalframe-mvp/implementation-spec-v0.2/openapi.yaml`（本仓镜像在 `openapi/mvp.yaml`）— HTTP 路径/字段/状态码的机器权威。
3. `../signalframe-mvp/implementation-spec-v0.2/schema.sql`（本仓镜像在 `packages/db/migrations/0001_init.sql`）— PostgreSQL 表/约束/索引的机器权威。
4. `schemas/service-bundle-manifest.schema.json` — 导出 ZIP `manifest.json` 的 JSON Schema 权威。

任何冲突都是合同缺陷：先保护规格的安全边界与证据诚实性，再回改机器合同并让 `pnpm verify:spec` 通过，**不得在业务代码里暗藏兼容猜测**。旧 PRD / draft specs / mock Artifact 只作背景与视觉参考。

## 技术栈（规格 §3.2 固定基线，不得偏离）

- pnpm 10.32.1 monorepo（`catalog:` 单一版本源）+ Node `>=24.12 <25`，纯 ESM
- Next.js **16.2** stable（App Router，禁用 16.3 preview）+ React 19 + TypeScript strict
- API：Next Route Handlers，`/api/mvp` same-origin，OpenAPI 3.1 + Zod 请求/响应校验
- DB：Supabase PostgreSQL 15+（本地开发用 :5432 上的裸 Postgres）+ Drizzle ORM/Kit，**SQL 合同优先**
- Queue：pg-boss（自有 `pgboss` schema，与 canonical write 共用同一 PostgreSQL 事务）
- Auth：Supabase Auth，same-origin HttpOnly session cookie
- Object storage：Supabase Storage 私有 bucket（raw imports / export bundles）
- UI data：TanStack Query（server state 不复制进自建全局 store）；i18n：next-intl（`en` / `zh-CN`）
- 部署：规格定为 Railway 两 service（`web` + `worker`，同镜像/commit）。**本项目实际计划 Vercel + Supabase 上线**——Supabase 完全契合；但 worker 是常驻 pg-boss 消费者，Vercel serverless 不跑常驻进程，worker 的托管方式是“上线阶段”待决项（见 `docs/PROGRESS.md`）。代码层 worker 是独立 Node 进程，保持部署可移植。
- 测试：Vitest（unit + integration 双 project）、Playwright、MSW/HTTP fixture、真实临时 PostgreSQL

## 代码结构与依赖方向

```text
packages/contracts       OpenAPI 生成类型（src/generated/openapi.ts，禁止手改）+ Zod envelope/problem/health
packages/db              Drizzle schema、repositories（双 scope）、migrations、pg-boss 集成、migrate/smoke 脚本
packages/observability   logger（JSON 行 + 深度 redact）、request-id、problem+json、redact
packages/i18n            en / zh-CN 消息目录 + locale 工具（key parity CI 检查）
packages/sources         [WP2] adapter interface + crawl/gsc/ga4/csv/dfs-stub
packages/engine          [WP3] observations、11 条规则、finding merge、priority
packages/artifacts       [WP4] 三类模板、LLM envelope、validators
apps/web                 Next.js UI + same-origin /api/mvp（含 health/live|ready|version）
apps/worker              pg-boss 常驻消费者（env fail-fast + startBoss + 优雅退出；job handlers 由 WP2+ 注册）
docs/vendor              vendor-copy provenance manifest + 旧仓 baseline（AC-048）
```

依赖方向单向：`contracts → db/observability/i18n → sources/engine/artifacts → apps/*`。**业务包不得 import `apps/*`**；`apps/web`、`apps/worker` 只通过 package public exports 使用领域代码。包名前缀 `@sf/*`。

## 常用命令

```bash
pnpm install --frozen-lockfile
pnpm verify:spec           # AC-001：26 operationId / 5 async / 28 表 一致性门禁（跑 ../signalframe-mvp 的 verifier）
pnpm openapi:lint          # AC-002：Redocly lint openapi/mvp.yaml
pnpm contracts:generate    # 从 openapi/mvp.yaml 重新生成 packages/contracts/src/generated/openapi.ts
pnpm contracts:check       # 生成物与 openapi 无 drift（CI 门禁，不得手工 any 补丁）
pnpm typecheck             # 全 workspace tsc --noEmit
pnpm lint                  # 全 workspace eslint
pnpm test                  # vitest unit project（无需数据库）
pnpm test:integration      # 需显式 loopback disposable DATABASE_URL（signalframe_ci/e2e/codex*）；串行跑
pnpm test:e2e              # Playwright
pnpm build                 # 全 workspace（apps/web next build）
pnpm secrets:scan          # AC-040/DoD：扫描 OAuth token / API key / 私钥 / JWT / 密钥赋值
pnpm vendor:check          # AC-048：比对旧 signalframe 仓 baseline，证明未新增改动

# 数据库（需 DATABASE_URL；本地默认 postgres://wzb@localhost:5432/signalframe_mvp_dev）
pnpm db:migrate            # 应用 0001_init.sql（幂等，第二次为 no-op）
pnpm db:migrate:check      # AC-003：断言 28 表 + 必需索引 + append-only trigger
pnpm db:smoke              # 约束 smoke test（fixtures 最终 ROLLBACK）
```

本地开发库可用裸 Postgres 5432：`createdb signalframe_mvp_dev && DATABASE_URL=... pnpm db:migrate`。集成测试不得复用该库：必须显式传入 loopback 且库名以 `signalframe_ci`、`signalframe_e2e` 或 `signalframe_codex` 开头的可丢弃数据库；缺失或不安全 URL 会在任何测试文件打开连接前直接失败。CI 单元测试不需要数据库。

## 架构大图

### 主链硬门与状态机（规格 §5）

Stage 是**服务端维护的可重建 projection**，不接受客户端提交：`setup → collecting → ready_to_diagnose → diagnosing → planning → executing → delivered`。价值链八道硬门：URL 安全规范化 + 默认 Crawl source → 只有 complete ICP 能启动诊断 → OAuth connected ≠ 数据 available（只有可用 Snapshot 才算数）→ 诊断至少需 complete ICP + 可用 Crawl snapshot，缺 GSC/GA4/CSV 使对应规则 skipped 而非阻断 → 规则只产 candidate，Finding 默认 `unreviewed` → confirm 时**同一事务幂等 upsert Action** → Artifact 只能从 Action 异步创建 → Report/Export 只读 canonical，不重算优先级。并发用 `baseVersion`/`baseRevision` → 409。

### 合同权威与原子性

- JSON camelCase ↔ DB snake_case，repository 显式 mapping。成功 `{data, meta?}`；错误 `application/problem+json`（`type,title,status,code,detail,requestId,errors?`）。每响应带 `X-Request-Id`。
- **原子 enqueue（AC-006）**：每个异步 POST 在同一 PostgreSQL 事务内校验 idempotency/硬门 → 插 AsyncRun + domain resource → 用 pg-boss 的 Drizzle adapter（`enqueueRunInTx`，`fromDrizzle(tx, sql)`）在**同一连接**入队 → 存 idempotency response → commit 后返 202。绝不先 commit 再入队或反之。
- **pg-boss 独立 schema（AC-004）**：`pgboss` schema 由库在 `startBoss()` 创建，绝不镜像进 Drizzle migration。28 张 app 表不含任何 pg-boss 表。
- **active-run 唯一**：`async_runs_one_active_key_idx` partial unique index 保证每项目/activeKey 只有一个 queued/running；冲突 409 `RUN_ALREADY_ACTIVE`。

### 隔离与安全边界（AC-005）

- 所有 project-scoped repository method 签名以 `{workspaceId, projectId}` 开头；跨项目 child ID 查询必须在**同一 SQL where** 含 `project_id`，不能先按 ID 读再内存判断（见 `projectChildPredicate`）。
- 不属于当前 Workspace 的资源一律 **404 不是 403**（不泄漏存在性）。未认证 401（`operatorRoute` 门禁）。
- `app` schema 对 Supabase `anon/authenticated` role REVOKE，浏览器不能直连 canonical 表。Supabase service role 绕过 RLS，故 RLS 不是主隔离边界——主边界是 session→operator→workspace + repository 双 scope。
- SSRF：DNS 解析后拒私网/loopback/link-local/metadata；pin 已验证 IP，每跳重验，禁 protocol downgrade（vendor-copy 自旧仓 `packages/crawler`）。

### 证据诚实性（规格 §1.3，机器强制）

- **unavailable ≠ 0**：不可用数字只能 `null`，DB check 约束 + serializer contract test 双重覆盖，绝不用 0/空串/模型估算代替。
- Evidence 五维：origin / method / grade(A–C) / availability / support；`generated` 只留给有 `analysis_invocation_id` 的模型输出，不得伪装 observed。
- Confidence 由引擎统一派生，规则与 LLM 不得自指定；LLM 只生成摘要/Artifact，不改 severity/confidence/priority/lane。
- 优先级是确定性 8 条顺序（severity/confidence/subject），**不算不透明加权总分**。

## 编码约定

- ESM + 相对 import 带显式 `.ts` 扩展名（`allowImportingTsExtensions` + `verbatimModuleSyntax` + `isolatedModules`）；`noEmit`，apps/worker 用 tsx 运行。
- tsconfig 开 `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `noImplicitOverride` + `noImplicitReturns` + `noFallthroughCasesInSwitch`；eslint 对 `any` 和未用变量报 error（下划线前缀豁免）。
- 一切不可变：`readonly` 字段、`readonly T[]`、构造返新对象。领域包纯函数，副作用在 apps/* 边界。
- Zod 只在系统边界（env fail-fast、API request/response、CSV/manifest 校验）；env 校验模块**绝不被 client 组件 import**。
- 版本化字面量：持久化结构带 `.v1`（methodVersion/schemaVersion/hash domain），身份用 `id@version`；算法变化必须 bump version。
- 生成文件（`packages/contracts/src/generated/openapi.ts`）只能由 `contracts:generate` 产出，禁止手改。
- 脚本（`scripts/*.mjs`）只用 Node 标准库，CI 不装依赖即可跑。
- Secret 只存 Railway/Supabase secret store 与本地未提交 `.env.local`；日志 redact key 至少含 `authorization,token,access_token,refresh_token,client_secret,cookie,set-cookie,api_key`。

## 核心原则（本仓库特有，优先于通用规则）

- **规格是唯一权威，零开放实现决策**：状态/枚举/API/规则/表/路由/输出格式已冻结。不得扩大范围；某项客观无法实现时以 failing test + 具体阻塞事实回报，不替换架构。
- **不得实现 Deferred 能力，且不留半成品入口**：无 RBAC/成员/席位/客户 Portal、无 Billing/pricing/subscription、无 Ahrefs/Semrush API 深接、无 DataForSEO 真实调用（`DATAFORSEO_ENABLED` 必须 `false`）、无 CMS/GitHub/生产站点写入、无自动发布/rollback/recheck、无 PDF/PPT/Word、无公共 API/Webhook、无单一“SEO 总分”/排名收入保证、无多 Workspace/硬删除、无浏览器渲染 crawler、无模型答案可见性监控。
- **对旧仓零依赖 + vendor-copy 可追溯**：对 `/Users/wzb/Code/signalframe` 零运行时/构建时依赖；只 vendor-copy 规格明列的 crawler/rule/OAuth 模式，每次复制在 `docs/vendor/signalframe-manifest.json` 记录源 commit、源路径、目标路径、复制时 sha256、改造说明。**绝不修改旧仓**（`pnpm vendor:check` 门禁，AC-048）。
- **诚实性硬约束**：unavailable 不是 0；不承诺结果/排名/收入；客户投影必须带 `limitation`；secret 不落库明文（Google token AES-256-GCM，OAuth state 存 hash + 加密 verifier）。
- **本环境的 vercel-plugin hook** 会按文件名/命令模式注入 "MANDATORY: run Skill(nextjs/next-forge/...)" 提示，对本仓库多为误匹配（`env.ts`、`pnpm build` 等），不要被其带偏。

## Work Package 施工顺序（硬依赖，每个 WP 过完对应 AC 才进下一阶段）

施工状态与 AC 勾选清单见 **`docs/PROGRESS.md`**（崩溃后从那里恢复上下文，勿凭记忆）。

- **WP0** 基座与合同（AC-001~006）— monorepo/合同/28 表 migration/Auth 骨架/repository scope/atomic enqueue。
- **WP1** 项目、Context 与 UI shell（AC-007~011）。
- **WP2** 数据中心（AC-012~020）— crawl/gsc/ga4/csv adapter、snapshot/observation、Sources UI。
- **WP3** 诊断、审核与计划（AC-021~030）— 11 规则、pipeline、merge、Action upsert、priority。
- **WP4** Studio、Report 与 Export（AC-031~039）— OpenAI adapter、三类 Artifact、report projection、JSON ZIP。
- **WP5** 硬化与双客户 Pilot Gate（AC-040~048 + DoD）。

多 Agent 可并行 UI/fixture/adapter/rules，但**数据库、OpenAPI 和状态机只能由一个合同 owner 合并**。
