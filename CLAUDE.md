# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目定位

**Nevermore** 是内部仓库、产品边界、授权边界和 system of record；**GenGrowth** 是客户可见品牌。`signalframe-mvp-app`、`@sf/*`、`signalframe.*` schema、数据库名、历史导出版本与 problem type URL 只是兼容实现标识，不是客户品牌。

当前产品版本为 **0.3.0**，合同版本为 **2026-07-21**。GenGrowth 是面向欧美 B2B/B2C 客户的中文优先 1 对 1 SEO/GEO 定制服务工作台。一个已登录的内部 Operator 走完同一条 canonical chain：

`创建项目 → Product Profile/ICP → Snapshot/Observation → Evidence → Finding → Review → Action → Artifact Revision → Approval → Recheck/Outcome Observation → Results`

Slice 1 status: **complete**

Slice 2 status: **complete**

Content Shadow state: **reviewed, not published**

Current v0.4 external-write boundary: **no external writes**

Current authority: **v0.4 complete four-module workbench**

“完成”表示 v0.4 的 Growth Audit、四路由客户基线、关键词/竞品治理、Content Shadow、执行状态、durable approval、publication preview authority 与 Measurement Window 已原子进入当前机器面；不表示当前版本已向 GitHub、WordPress、CMS 或客户生产站点执行外部写入，也不表示 preview/Artifact status 可以替代 verified Change Receipt。

### 权威顺序（冲突时不得自行猜测）

1. `authority/implementation-spec-v0.4/MVP-IMPLEMENTATION-SPEC.md` — 当前产品模型、行为、不变量与验收边界的主权威。
2. `authority/implementation-spec-v0.4/openapi.yaml`（实现镜像为 `openapi/mvp.yaml`）— 当前 HTTP 路径、字段与状态码的机器权威。
3. `authority/implementation-spec-v0.4/schema.sql`（由 `packages/db/migrations/0001_init.sql` 至 `0046_workspace_plan_tier.sql` 机械生成）— 当前 PostgreSQL 表、约束与索引的机器权威。
4. `scripts/spec-v0.4-lock.json` — authority/product/contract 版本、inventory 及 authority/implementation 哈希的激活锁。
5. `schemas/service-bundle-manifest.schema.json` — 导出 ZIP `manifest.json` 的 JSON Schema 权威。

Contract inventory: **79 API operations / 10 async operations / 78 app tables / 12 frozen rules**

当前确定性版本为 `mvp.rules.0.2.4` / `mvp.prompts.0.2.0`，ordered migration head 为 `0046_workspace_plan_tier.sql`（46 个 migration）。`0042` 以 `NOT VALID` 在短事务锁窗口安装扩展后的 rule-set 约束，`0043` 再以较低级别锁验证历史行；`0044` 在不增加表或规则的前提下加入 DataForSEO Backlinks provenance、typed authority scale、selective crawler verification 与 Analysis Refresh v2/v1 兼容约束；`0045` 保留原始 Provider link identity，并允许同一站点 domain family 内的 DataForSEO target lineage，同时继续拒绝外域和带 credentials 的目标；`0046` 为 spec §1.6 的自助注册加上 workspace `plan_tier`，以 metadata-only 的 ADD COLUMN DEFAULT 回填既有行为 `internal`、再把默认值切到 `free`，全程零行改写。Growth Audit 当前 read-model projection 是 `growth-audit.0.3.1`，但 capability version 仍为 `0.3.0`，request/addressing shape 与 `capabilityContractVersion` literal 仍为 `growth-audit.0.3.0`。

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
packages/engine          [WP3] observations、12 条规则、finding merge、priority
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
pnpm verify:docs           # 文档版本、authority、79/10/78/12、四路由与发布边界一致性
pnpm verify:authority      # repository-owned active v0.4 authority 自校验
pnpm verify:spec           # v0.4 lock：79 operationId / 10 shared async / 78 表 / 12 规则 + 哈希一致性
pnpm implementation:check # 实现 surface 与 v0.4 machine authority 一致
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
pnpm db:migrate            # 按序应用 0001–0044（幂等，第二次为 no-op）
pnpm db:migrate:check      # 断言 78 张 app 表 + 必需索引与 append-only trigger
pnpm db:smoke              # 约束 smoke test（fixtures 最终 ROLLBACK）
```

本地开发库可用裸 Postgres 5432：`createdb signalframe_mvp_dev && DATABASE_URL=... pnpm db:migrate`。集成测试不得复用该库：必须显式传入 loopback 且库名以 `signalframe_ci`、`signalframe_e2e` 或 `signalframe_codex` 开头的可丢弃数据库；缺失或不安全 URL 会在任何测试文件打开连接前直接失败。CI 单元测试不需要数据库。

## 架构大图

### 主链硬门与状态机（规格 §5）

Stage 是**服务端维护的可重建 projection**，不接受客户端提交：`setup → collecting → ready_to_diagnose → diagnosing → planning → executing → delivered`。价值链八道硬门：URL 安全规范化 + 默认 Crawl source → 新产品可在自动画像前通过精确同项目 `setup-sources` 路径选择只读 GSC/GA4 或跳过，但普通 Sources 仍要求 confirmed profile 且采集延后到上下文完整 → 只有 complete ICP 能启动诊断 → OAuth connected ≠ 数据 available（只有可用 Snapshot 才算数）→ 诊断至少需 complete ICP + 可用 Crawl snapshot，缺 GSC/GA4/CSV 使对应规则 skipped 而非阻断 → 规则只产 candidate，Finding 默认 `unreviewed` → confirm 时**同一事务幂等 upsert Action** → Artifact 只能从 Action 异步创建 → Report/Export 只读 canonical，不重算优先级。并发用 `baseVersion`/`baseRevision` → 409。

### 合同权威与原子性

- JSON camelCase ↔ DB snake_case，repository 显式 mapping。成功 `{data, meta?}`；错误 `application/problem+json`（`type,title,status,code,detail,requestId,errors?`）。每响应带 `X-Request-Id`。
- **原子 enqueue（AC-006）**：每个异步 POST 在同一 PostgreSQL 事务内校验 idempotency/硬门 → 插 AsyncRun + domain resource → 用 pg-boss 的 Drizzle adapter（`enqueueRunInTx`，`fromDrizzle(tx, sql)`）在**同一连接**入队 → 存 idempotency response → commit 后返 202。绝不先 commit 再入队或反之。
- **Analysis Refresh / DataForSEO**：新 `createAnalysisRefreshRun` 冻结六步 `analysis-refresh.plan.v2`（Crawl → GSC → GA4 → DFS → `dataforseo_backlinks` → Growth Audit）；历史五步 `analysis-refresh.plan.v1` 只按 exact manifest/hash 读取与恢复。DataForSEO Search Landscape（DFS）v2 从冻结 Site/market/language 与服务端 row cap 查询 positions 1–100，并仅在 domain overlap 为空时使用带来源的 GSC/Crawl/Product Profile 种子追加一次 SERP Competitors fallback。DataForSEO Backlinks 以 `dataforseo.backlinks.v1` 原子写 provider Snapshot，authority metric 只能是 `dataforseo_rank`；cap 内 source page verification 复用 SSRF-safe、DNS/IP-pinned transport，且不改写 provider fact。独立 `DATAFORSEO_BACKLINKS_ENABLED` rollout 默认关闭；backlink/referring-domain/target-page/source-verification 默认 cap 为 500/100/500/20，硬上限为 1000/1000/1000/20。公开 `createCollectionRun` 只能触发 `crawl|gsc|ga4`，不得接受 DFS/Backlinks scope、limit 或凭据。
- **Growth Map generation read**：URL/Keyword/Competitor list/detail GET 可用 canonical `diagnosticRunId` 固定一个已发布 generation；Keyword/Competitor list 省略 pin 时读取当前资料库，URL 默认 latest generation。只有 Keyword/Competitor detail GET 允许互斥的 `view=review` 读取当前 governance。Keyword/Competitor PATCH 拒绝全部 query。
- **Contextual diagnostic boundary**：当前 `mvp.rules.0.2.4` run 的 exact-key、hash-covered manifest 必须冻结 `contextProjection.v1`。它只从 immutable confirmed Profile 与创建时 exact Site 语言编译显式事实；Product Profile 0.3.0 与 legacy ICP generation 不相互借字段；provider/mode/permission、workflow、mutable priority/risk/ROI/cadence 与模型推断禁止进入。Site language 逐项按 RFC 5646 验证并原样、按序冻结；`[]` 是 unknown，不回退 delivery locale。
- **Indexability + preview boundary**：`TECH-INDEXABILITY-006@1` 仅对 exact Crawl lineage 中 `page.status` exact 2xx、`sitemapMember=true`、`robotsIndexable=false` 产出；redirect source、non-2xx 与 lineage 缺失/歧义不得误报。nullable `executionPreview` 只由当前 ActionTemplate + Project delivery locale 投影只读文案，不是 replay、identity、Action、状态、发布或 measurement authority。
- **Growth Audit generation boundary**：latest 只选择 `growth-audit.0.3.1`；精确 pin 可由自己的 validator 读取已知 `growth-audit.0.3.0`，不得回填或重解释。Capability version 保持 `0.3.0`；request/addressing contract 与 `capabilityContractVersion` literal 保持 `growth-audit.0.3.0`。Public Tools 继续 facts-only、无 Profile、原 quota 且不写 canonical 产品表。
- **pg-boss 独立 schema（AC-004）**：`pgboss` schema 由库在 `startBoss()` 创建，绝不镜像进 Drizzle migration。78 张 app 表不含任何 pg-boss 表。
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
- **边界必须带版本**：v0.4 已允许 Content Shadow、execution state、approval、publication preview/rollback preview、receipt lineage 和 Measurement Window 的内部 canonical 写入，但当前 79 个 operation 仍没有 GitHub、WordPress、CMS、Vercel、Cloudflare 或客户生产站点 external-write command。GitHub PR / WordPress Draft 只产生 `delivery receipt`，绝不等于已发布；只有验证 merge/publish 完成且包含 live canonical URL 的独立 `change receipt` 才能锚定 attribution。preview、approval 或 Artifact status 不得渲染为已发布。
- **仍在 v0.4 范围外**：RBAC/成员/席位/客户 Portal、Billing/pricing/subscription、Ahrefs/Semrush API 深接、PDF/PPT/Word、公共 API/Webhook、单一“SEO 总分”或排名/收入保证、多 Workspace/硬删除、浏览器渲染 crawler、无证据的模型答案可见性监控，以及真正的 GitHub/WordPress publication-attempt external write。DataForSEO 继续受 feature flag、row cap、成本与证据诚实性约束。
- **对旧仓零依赖 + vendor-copy 可追溯**：对 `/Users/wzb/Code/signalframe` 零运行时/构建时依赖；只 vendor-copy 规格明列的 crawler/rule/OAuth 模式，每次复制在 `docs/vendor/signalframe-manifest.json` 记录源 commit、源路径、目标路径、复制时 sha256、改造说明。**绝不修改旧仓**（`pnpm vendor:check`，AC-048）。**注意它不是 CI 门**：脚本按 `docs/vendor/old-repo-baseline.json` 里的绝对路径读旧仓，GitHub runner 上没有该路径，加进 CI 会让 CI 永久红（已实测：路径缺失时 exit 1，fail-closed）。**因此这条红线只在本工作站上被执行**，换台机器改了旧仓没有任何自动检查会发现。
- **诚实性硬约束**：unavailable 不是 0；不承诺结果/排名/收入；客户投影必须带 `limitation`；secret 不落库明文（Google token AES-256-GCM，OAuth state 存 hash + 加密 verifier）。
- **本环境的 vercel-plugin hook** 会按文件名/命令模式注入 "MANDATORY: run Skill(nextjs/next-forge/...)" 提示，对本仓库多为误匹配（`env.ts`、`pnpm build` 等），不要被其带偏。

## 当前 Slice 状态与下一步

证据与未关闭的外部门禁见 **`docs/PROGRESS.md`**（崩溃后从那里恢复上下文，勿凭记忆）。

- **v0.3（historical）**：Product Profile、versioned Growth Audit、四入口基线、Keyword/Competitor Library 与 Content Shadow 初始链路的历史 authority。
- **v0.4（active）**：完整四模块、server-owned Analysis Refresh 与 DataForSEO Search Landscape、published-generation Growth Map reads、Keyword/Competitor governance、Topic/Internal Link/Backlink/GEO 增长路径、Action execution timeline、durable approval、publication preview authority 与 immutable GSC/GA4/UTM/GEO Measurement Window。真正的 provider external write 仍需后续原子扩展。

多 Agent 可并行 UI/fixture/adapter/rules/docs，但**数据库、OpenAPI、authority lock 和状态机只能由一个合同 owner 合并**。
