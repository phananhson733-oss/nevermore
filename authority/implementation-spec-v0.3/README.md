# Nevermore Unified Growth Opportunity — Implementation Authority v0.3

状态：**activated**
Authority 版本：**0.3.0**
合同日期：**2026-07-21**
当前已实现机器面：**0.3.0**

本目录是 Nevermore 统一增长机会产品的 repository-owned v0.3 authority。当前 machine surface 已原子激活为 `0.3.0 / 2026-07-21`：OpenAPI 精确声明 36 个 operation 与 6 个 async operation，确定性规则为 `mvp.rules.0.2.1` 的 11 条规则；数据库包含 5 张可追溯 audit/page projection 表、`product_profile_runs` 与 `product_profile_invocation_attempts` 两张 Product Profile 冻结输入/调用预算账本，以及逐 DiagnosticRun 记录 Finding 明确目标成员的 `finding_targets` append-only 账本，总数为 36 张。

这次激活把已经实现的 URL-first Product Profile 读取、草稿编辑、证据化合成、竞品审核/补录与确认操作，以及 versioned Growth Audit / Capability contract、只读 Opportunity/Keyword Library projection 与最小 persistence 纳入事实面。Keyword Library 仅提供有界 cursor page 和稳定 ID 详情，并保留精确 source occurrence、canonical metric pointer、mapped target、coverage 与 limitation；它不声明过滤、总数或 mutation。Product Profile 合成只消费冻结的 Crawl Snapshot/PageSnapshot/Observation 引用；provider 调用先写 durable reservation，最多三次，未知结果阻止静默重试。它没有提前声明 Growth Audit create-run route、recheck operation、CMS publishing 或 content lifecycle；后续只有在实现、迁移、OpenAPI、锁文件和 verifier 同一提交更新时，才可以继续扩大 normative surface。

## 权威顺序

1. [MVP-IMPLEMENTATION-SPEC.md](MVP-IMPLEMENTATION-SPEC.md)：当前机器面、已审核产品模型、不变量、变更顺序与验收边界的主权威。
2. [openapi.yaml](openapi.yaml)：当前已实现 HTTP 路径、请求、响应和错误语义的机器权威。
3. [schema.sql](schema.sql)：当前已实现 PostgreSQL 物理表、约束和索引的机器权威。
4. [schemas/service-bundle-manifest.schema.json](schemas/service-bundle-manifest.schema.json)：当前企业/客户 ZIP 中 `manifest.json` 的 JSON Schema 权威。
5. [scripts/verify-spec.mjs](scripts/verify-spec.mjs)：authority 与应用迁移的一致性门禁。

产品方向、详细设计和施工任务由本仓以下已审核文档补充：

- [统一增长机会 PRD](../../docs/plans/2026-07-21-unified-growth-opportunity-prd.md)
- [统一增长机会设计](../../docs/plans/2026-07-21-unified-growth-opportunity-design.md)
- [统一增长机会实施计划](../../docs/plans/2026-07-21-unified-growth-opportunity-implementation.md)

发生冲突时，不得由实现者自行猜测。先保护主规格中的安全、证据诚实性和唯一 canonical lifecycle；再按同一提交原则更新机器合同、迁移、锁与 verifier。PRD 决定产品范围，设计文档决定详细技术设计，实施计划决定 Slice 1 的施工顺序；Artifact 只决定客户可见的信息层级与交互目标，不是 canonical truth，也不证明某项能力已经落地。

## 已审核产品模型

四份 Growth Framework deep dive 被吸收为同一项目上的四个 **Capability Lenses**，而不是四套产品或四条生命周期：

1. `Product / Diagnosis`
2. `WebTech`
3. `Search / GEO Acquisition`
4. `Landing / Conversion`

所有 Lens 只能解释和筛选同一条 canonical chain：

`Project → Source/Snapshot/Observation → Evidence → Finding → Finding Review → Action → Artifact Revision → Approval/Authorized Delivery → Recheck/Outcome → Results`

Growth Opportunity 是上述 canonical objects 的客户可读 projection。在 Slice 1，一项可审核 Opportunity 必须恰好锚定一个 primary canonical Finding；确认操作继续复用 Finding Review 事务，幂等创建唯一 Action。Supporting Findings 和 Observation 只能丰富解释，不能共享 Confirm，也不能创造另一条生命周期。

## 当前 normative surface

当前 activated surface 冻结以下已实现能力：

- 单内部 Workspace、所有登录人员全权限；没有 RBAC、成员管理或客户 Portal。
- 没有定价、订阅、账单或 entitlement。
- 真实数据源为 Crawl、GSC、GA4、Keyword Gap CSV，以及受 feature flag 和成本上限约束的 DataForSEO ranked-keyword collection。
- URL-first Product Profile：客户可审核的产品/市场/ICP/竞品档案，AI 合成只基于冻结的 Crawl 证据，用户修改写入新的 append-only ICP 版本；确认不会隐式启动诊断。
- 11 条确定性规则，覆盖 Technical SEO、Search、Content、Conversion、GEO 五个诊断域。
- 3 类可编辑执行物：`content_brief`、`metadata_rewrite`、`technical_ticket`。
- versioned Growth Audit / Capability contract、只读 Opportunity projection，以及 `capability_runs`、`audit_runs`、`audit_module_results`、`site_pages`、`page_snapshots` 五张可追溯 persistence 表。
- `finding_targets` 逐当前 DiagnosticRun 持久化每个 Finding 的显式目标定义或成员；resolved 行绑定精确 Observation/SitePage（Crawl 还绑定 PageSnapshot），unresolved 行保留 analytics Observation 与 limitation，definition-only 行只保存稳定目标定义。历史 Finding 不回填、不从可变 projection 或 `subject_refs` 推断成员。
- 浏览器报告与版本化 JSON ZIP 导出；没有外部写入、自动发布或结果归因。
- English / 简体中文产品 chrome；客户内容语言与 UI 语言彼此独立。
- 32 个 operation、6 个 async operation、36 张应用表；清单由主规格中的 markers 与机器合同、ordered migrations 精确比对。

## Reviewed Slice 1 change sequence

以下是 **reviewed Slice 1 change sequence**。步骤 1–2 已进入当前机器面；步骤 3–5 仍是未来变更，不是当前已实现 operation、route 或 UI claim：

1. 先引入 versioned Growth Audit / Capability contract 和只读 Opportunity projection。
2. 再以受审迁移加入最小 audit/page projection persistence，同时保持 canonical run、Finding、Action 和 Artifact ownership 不变。
3. 再加入 create-run route、映射现有 11 条规则，并让一个 primary Finding 只产生一个 Action 与一个 `technical_ticket`。
4. 最后加入显式 recheck operation，以 prior/new 两个 immutable run 做 rule-level 对比并投影 Results。
5. 完成技术纵向链路后停止，经过产品评审才可编写 Slice 2 Content Shadow 的独立实施计划。

每一步都必须在同一提交更新 authority OpenAPI/SQL、应用迁移与实现、authority verifier、app spec lock、implementation verifier、生成合同及测试。未来的 operation 和 table 不得提前出现在当前机器合同中。

## 明确禁区

本 v0.3 authority 明确禁止：

- 新建 `Opportunity table`；Opportunity 继续是 canonical chain 上的 projection。
- 新建 `second Action creation path`；只有 primary Finding 的 Finding Review 可以幂等创建 Action。
- 新建 checkpoint table，包括 `performance_checkpoints`；Slice 1 recheck 比较两个 immutable run。
- `CMS publishing`、GitHub/Vercel/Cloudflare/生产站点写入或自动上线。
- 新建 `content lifecycle`、竞品历史、完整查询历史或发布生命周期；这些必须等 Slice 1 stop gate 后另行评审。
- 在 Slice 1 前加入 RBAC、Billing、客户成员系统、定时归因或并行的 Run/Finding/Action/Artifact/Result truth。

## 交给 Code Agent 的启动指令

```text
请在 Nevermore 应用仓库的独立 worktree 中严格实现：
authority/implementation-spec-v0.3/MVP-IMPLEMENTATION-SPEC.md

先运行 pnpm verify:authority、pnpm verify:spec 与 pnpm implementation:check。
当前 normative OpenAPI/SQL 是 implemented surface 0.3.0；不得因为产品方向已审核
就预先加入未来 operation 或 table。按 reviewed Slice 1 change sequence 施工，每个 task 只在
实现、合同、迁移、锁、verifier 与测试可同一提交通过时扩大 normative surface。

不得新增 Opportunity table、second Action creation path、performance_checkpoints、CMS
publishing 或 content lifecycle。不得把 target-state Artifact mock 写成 canonical 状态或生产事实。
```

## 实现前校验

从应用仓库根目录执行：

```bash
pnpm verify:authority
pnpm verify:spec
pnpm implementation:check
```

`schema.sql` 还应在临时 PostgreSQL 15+ 数据库中完整执行一次。建表后可运行约束 smoke test（测试数据最终 `ROLLBACK`）：

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f authority/implementation-spec-v0.3/scripts/schema-smoke.sql
```

## Artifact 视觉参考

当前客户可见目标态 demo 位于 `/Users/wzb/.codex/visualizations/2026/07/20/019f7ff0-3874-7623-90f3-1ebdea7c313f/index.html`。实现应复用它已经确认的信息架构、客户语言和交互故事，但不得复用 mock 状态、伪按钮、客户端计算出的权威业务状态，或把拟议的 Slice 2 内容流程宣称为当前生产能力。
