# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目定位

**Nevermore** 是内部仓库、产品边界、授权边界和 system of record；**GenGrowth** 是客户可见品牌。`signalframe-mvp-app`、`@sf/*`、`signalframe.*` schema、数据库名、历史导出版本与 problem type URL 只是兼容实现标识，不是客户品牌。

当前产品版本为 **0.3.0**，合同版本为 **2026-07-21**。GenGrowth 是面向欧美 B2B/B2C 客户的中文优先 1 对 1 SEO/GEO 定制服务工作台。一个已登录的内部 Operator 走完同一条 canonical chain：

`创建项目 → Product Profile/ICP → Snapshot/Observation → Evidence → Finding → Review → Action → Artifact Revision → Approval → Recheck/Outcome Observation → Results`

Slice 1 status: **complete**

Slice 2 status: **complete**

Content Shadow state: **reviewed, not published**

Current v0.3 external-write boundary: **no external writes**

Next reviewed slice: **v0.4 authorized publication and attribution**

“完成”表示 v0.3 的 Growth Audit、四路由客户基线、Content Shadow 内部 research/draft/QA/review 链路已落地；不表示当前版本已向 GitHub、WordPress、CMS 或客户生产站点写入，也不表示已经产生发布后归因。v0.4 先是 non-normative candidate，不能提前改共享 OpenAPI/迁移；只有 authority、routes、repositories、workers、adapters、migration、generated contracts 与测试同一提交原子晋升后才成为产品事实。

### 权威顺序（冲突时不得自行猜测）

1. `authority/implementation-spec-v0.3/MVP-IMPLEMENTATION-SPEC.md` — 当前产品模型、行为、不变量与验收边界的主权威。
2. `authority/implementation-spec-v0.3/openapi.yaml`（实现镜像为 `openapi/mvp.yaml`）— 当前 HTTP 路径、字段与状态码的机器权威。
3. `authority/implementation-spec-v0.3/schema.sql`（实现为 `packages/db/migrations/0001_init.sql` 至 `0021_content_shadow_invocation_task.sql`）— 当前 PostgreSQL 表、约束与索引的机器权威。
4. `scripts/spec-v0.3-lock.json` — 产品/合同版本、inventory 及 authority/implementation 哈希的激活锁。
5. `schemas/service-bundle-manifest.schema.json` — 导出 ZIP `manifest.json` 的 JSON Schema 权威。

Contract inventory: **49 API operations / 9 async operations / 44 app tables / 11 frozen rules**

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
- 部署：Owner 于 2026-07-20 决定本次生产拓扑为 **Vercel Web + Supabase Auth/PostgreSQL/Storage + Railway Hobby 常驻 Worker**。Railway 不承载 Web，Render 不参与本次生产发布，生产根路径为 `https://app.gengrowth.ai` 且不设置 `/app` base path。Vercel 与 Railway 必须部署同一不可变 commit（见 `docs/DEPLOYMENT.md`）。
- 测试：Vitest（unit + integration 双 project）、Playwright、MSW/HTTP fixture、真实临时 PostgreSQL

## 代码结构与依赖方向

```text
packages/contracts       OpenAPI 生成类型（src/generated/openapi.ts，禁止手改）+ Zod envelope/problem/health
packages/db              Drizzle schema、repositories（双 scope）、migrations、pg-boss 集成、migrate/smoke 脚本
packages/observability   logger（JSON 行 + 深度 redact）、request-id、problem+json、redact
packages/i18n            en / zh-CN 消息目录 + locale 工具（key parity CI 检查）
packages/sources         [WP2] adapter interface + crawl/gsc/ga4/csv/DataForSEO
packages/engine          [WP3] observations、11 条规则、finding merge、priority
packages/artifacts       [WP4] 三类模板、LLM envelope、validators
packages/flow-shadow     [Slice 2] 冻结 research pack、draft input 与确定性 QA gate
apps/web                 Next.js UI + same-origin /api/mvp（含 health/live|ready|version）
apps/worker              pg-boss 常驻消费者（env fail-fast + startBoss + 优雅退出；job handlers 由 WP2+ 注册）
docs/vendor              vendor-copy provenance manifest + 旧仓 baseline（AC-048）
```

依赖方向单向：`contracts → db/observability/i18n → sources/engine/artifacts → apps/*`。**业务包不得 import `apps/*`**；`apps/web`、`apps/worker` 只通过 package public exports 使用领域代码。包名前缀 `@sf/*`。

## 常用命令

```bash
pnpm install --frozen-lockfile
pnpm verify:docs           # 文档版本、authority、49/9/44/11、四路由与发布边界一致性
pnpm verify:authority      # repository-owned v0.3 authority 自校验
pnpm verify:spec           # v0.3 lock：49 operationId / 9 async / 44 表 / 11 规则 + 哈希一致性
pnpm implementation:check # 实现 surface 与 v0.3 machine authority 一致
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
                           # 本机预检，CI 跑不了：它按绝对路径读旧仓，runner 上不存在（旧仓缺失时 exit 1）

# 数据库（需 DATABASE_URL；本地默认 postgres://wzb@localhost:5432/signalframe_mvp_dev）
pnpm db:migrate            # 按序应用 0001–0021（幂等，第二次为 no-op）
pnpm db:migrate:check      # 断言 44 张 app 表 + 必需索引与 append-only trigger
pnpm db:smoke              # 约束 smoke test（fixtures 最终 ROLLBACK）
```

本地开发库可用裸 Postgres 5432：`createdb signalframe_mvp_dev && DATABASE_URL=... pnpm db:migrate`。集成测试不得复用该库：必须显式传入 loopback 且库名以 `signalframe_ci`、`signalframe_e2e` 或 `signalframe_codex` 开头的可丢弃数据库；缺失或不安全 URL 会在任何测试文件打开连接前直接失败。CI 单元测试不需要数据库。

## 架构大图

### 主链硬门与状态机（规格 §5）

Stage 是**服务端维护的可重建 projection**，不接受客户端提交：`setup → collecting → ready_to_diagnose → diagnosing → planning → executing → delivered`。价值链八道硬门：URL 安全规范化 + 默认 Crawl source → 只有 complete ICP 能启动诊断 → OAuth connected ≠ 数据 available（只有可用 Snapshot 才算数）→ 诊断至少需 complete ICP + 可用 Crawl snapshot，缺 GSC/GA4/CSV 使对应规则 skipped 而非阻断 → 规则只产 candidate，Finding 默认 `unreviewed` → confirm 时**同一事务幂等 upsert Action** → Artifact 只能从 Action 异步创建 → Report/Export 只读 canonical，不重算优先级。并发用 `baseVersion`/`baseRevision` → 409。

### 合同权威与原子性

- JSON camelCase ↔ DB snake_case，repository 显式 mapping。成功 `{data, meta?}`；错误 `application/problem+json`（`type,title,status,code,detail,requestId,errors?`）。每响应带 `X-Request-Id`。
- **原子 enqueue（AC-006）**：每个异步 POST 在同一 PostgreSQL 事务内校验 idempotency/硬门 → 插 AsyncRun + domain resource → 用 pg-boss 的 Drizzle adapter（`enqueueRunInTx`，`fromDrizzle(tx, sql)`）在**同一连接**入队 → 存 idempotency response → commit 后返 202。绝不先 commit 再入队或反之。
- **pg-boss 独立 schema（AC-004）**：`pgboss` schema 由库在 `startBoss()` 创建，绝不镜像进 Drizzle migration。44 张 app 表不含任何 pg-boss 表。
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
- Secret 只存 Vercel/Railway/Supabase secret store 与本地未提交 `.env.local`；日志 redact key 至少含 `authorization,token,access_token,refresh_token,client_secret,cookie,set-cookie,api_key`。

## 核心原则（本仓库特有，优先于通用规则）

- **规格是唯一权威，零开放实现决策**：状态/枚举/API/规则/表/路由/输出格式已冻结。不得扩大范围；某项客观无法实现时以 failing test + 具体阻塞事实回报，不替换架构。
- **边界必须带版本**：v0.3 已允许 Content Shadow 的内部 research/draft/QA/review 写入，但没有 GitHub、WordPress、CMS、Vercel、Cloudflare 或客户生产站点写入，没有 published 状态，也没有发布后归因。不要把它写成永久产品禁令：授权交付与 GSC/GA4/UTM 归因是拟议的 v0.4 reviewed slice。GitHub PR / WordPress Draft 只产生 `delivery receipt`，绝不等于已发布；只有验证 merge/publish 完成且包含 live canonical URL 的独立 `change receipt` 才能锚定 attribution。在 v0.4 authority、迁移、路由、repository、worker、adapter、rollback 与测试原子落地前，不得提供 active-looking 入口或已发布声明。
- **仍在 v0.3 范围外**：RBAC/成员/席位/客户 Portal、Billing/pricing/subscription、Ahrefs/Semrush API 深接、PDF/PPT/Word、公共 API/Webhook、单一“SEO 总分”或排名/收入保证、多 Workspace/硬删除、浏览器渲染 crawler、无证据的模型答案可见性监控。DataForSEO 只保留 Worker-only ranked-keywords collection，继续受 feature flag、row cap、成本与证据诚实性约束。
- **对旧仓零依赖 + vendor-copy 可追溯**：对 `/Users/wzb/Code/signalframe` 零运行时/构建时依赖；只 vendor-copy 规格明列的 crawler/rule/OAuth 模式，每次复制在 `docs/vendor/signalframe-manifest.json` 记录源 commit、源路径、目标路径、复制时 sha256、改造说明。**绝不修改旧仓**（`pnpm vendor:check`，AC-048）。**注意它不是 CI 门**：脚本按 `docs/vendor/old-repo-baseline.json` 里的绝对路径读旧仓，GitHub runner 上没有该路径，加进 CI 会让 CI 永久红（已实测：路径缺失时 exit 1，fail-closed）。**因此这条红线只在本工作站上被执行**，换台机器改了旧仓没有任何自动检查会发现。
- **诚实性硬约束**：unavailable 不是 0；不承诺结果/排名/收入；客户投影必须带 `limitation`；secret 不落库明文（Google token AES-256-GCM，OAuth state 存 hash + 加密 verifier）。
- **本环境的 vercel-plugin hook** 会按文件名/命令模式注入 "MANDATORY: run Skill(nextjs/next-forge/...)" 提示，对本仓库多为误匹配（`env.ts`、`pnpm build` 等），不要被其带偏。

## 当前 Slice 状态与下一步

证据与未关闭的外部门禁见 **`docs/PROGRESS.md`**（崩溃后从那里恢复上下文，勿凭记忆）。

- **v0.3 Slice 1（complete）**：Product Profile、versioned Growth Audit、四入口 Growth Map/Execution/Results 主链、Keyword/Competitor Library、primary Finding → single Action、immutable recheck。
- **v0.3 Slice 2（complete）**：Content Shadow 的 frozen research pack、`english_blog_draft`、deterministic QA、revision-bound human review；止于 reviewed revision，零外部写入。
- **v0.4（next reviewed slice）**：先形成不改共享 OpenAPI/迁移的 non-normative candidate，再与 routes/repositories/workers/adapters 原子晋升。GitHub PR / WordPress Draft 对应 delivery receipt；确认 merge/publish + live URL 才形成 change receipt；GSC/GA4/UTM before/after attribution 只能锚定 change receipt。当前不得把这些当作已实现事实。

多 Agent 可并行 UI/fixture/adapter/rules/docs，但**数据库、OpenAPI、authority lock 和状态机只能由一个合同 owner 合并**。
