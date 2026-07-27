# Slice 2 落地执行计划 · SEO/GEO Content Shadow(2026-07-25)

本文件是 Slice 1(诊断→机会→执行→复查→结果 技术闭环,已落地至 `945be02`)之后,**Slice 2 = SEO/GEO Content Shadow 内容生产影子流水线**的落地执行版。它不重复 PRD/设计的逐节细节,而是:固定真实现状、记录开工前架构裁决、明确与 Slice 3 的边界、定义执行顺序与验收门。

基线:branch `codex/unified-growth-opportunity-v03` @ `945be02`,产品 `0.3.0`,运行时契约 `2026-07-21`,authority 包 `authority/implementation-spec-v0.3/`,规则集沿用 `mvp.rules.0.2.0`。当前持久化面:**41 表 / 8 asyncOperations / 45 apiOperations / 11 rules**(`scripts/spec-v0.3-lock.json` 核实)。

上游依据:
- 实施计划:`docs/plans/2026-07-21-unified-growth-opportunity-implementation.md`(末尾 "Slice 2 re-entry brief",1438 行起)
- PRD / 设计:同目录 `-prd.md` / `-design.md`
- Slice 1 stop gate:`docs/reviews/2026-07-21-growth-opportunity-slice1-stop-gate.md`("Slice 2 re-entry brief (non-normative)" + 5 条已知简化)

目标闭环(来自 re-entry brief):
```
一个测试项目 + 一个显式竞品集 + 一个 SearchQuery cluster + 一个独立 GenerativeQuery 集 + existing-page-first 决策
→ 一个规范化 content Finding → 一个 Action → 一个 content_brief
→ pinned Flow Shadow research/draft/QA → 人工 side-by-side 评审 → 【绝不 CMS 写入】
```

---

## 1. 真实现状核实(完成度地图)

以仓库实际文件为准。**关键结论:Slice 1 已悄悄交付了 Slice 2 的大部分*输入*;真正净新的只有 Flow Shadow 流水线 + 接线 + 评审 UI。** Slice 2 在数据模型/契约轴上比 Slice 1 小得多。

| 关注点 | 现状 | 证据 |
|---|---|---|
| SearchQuery/GenerativeQuery 身份 | **已建** | `0018_keyword_library_foundation.sql:242-244`(`query_kind CHECK IN ('search_query','generative_query')`) |
| SearchQuery cluster | **已建** | `keyword_entities.cluster_key`(`0018:249`) |
| existing-page-first 决策 | **已建** | `keyword_entities.mapping_decision CHECK IN ('unassigned','existing_page','new_asset')` + `mapped_site_page_id`(`0018:250-256`) |
| 显式竞品集 | **已建** | `competitor_entities.review_status/relationship/analysis_scope`(`0019:138-165`) |
| content-Finding → cluster 接线 | **已建** | `finding_targets.target_kind` 含 `'keyword_cluster'`(`0017:29-84`) |
| content_brief artifact 类型 | **已建** | `ArtifactType` enum 3 处:`packages/contracts/src/zod/artifacts.ts:11`、`packages/artifacts/src/types.ts:8`、`packages/engine/src/action-templates.ts:11` |
| content_brief 模板 + 校验器 + LLM envelope | **已建** | `packages/artifacts/src/templates/content-brief.ts`(确定性 markdown 9 段) |
| content 规则 → content_brief 映射 | **已建** | `action-templates.ts:110/129/148/186`(SEARCH-DECAY-002/CONTENT-COVERAGE-001/CONTENT-GAP-011/CRO-LANDING-003) |
| **Flow Shadow research/draft/QA** | **零** | `grep -riE 'flow_shadow\|research_pack\|english_blog_draft\|content-shadow'` → 0 命中 |
| CandidateOpportunity.supportingFindingIds | **空壳** | 契约存在但 `opportunities-projection.ts` 硬编码 `supportingFindingIds: []`,从不 emit Candidate 分支(stop gate 简化 #2) |
| side-by-side 人工评审 UI | **无** | 现仅有 legacy Studio 编辑 + 乐观并发(stop gate 简化 #5) |

结论:本轮落地 = 建 **Flow Shadow 流水线 + 内容 vertical 接线 + 评审 UI**,把 Slice 1 已建的 keyword/competitor/finding-target/content_brief 输入串成一条**内容闭环**,严格 no CMS write。

---

## 2. 开工前架构裁决(六项)

### 裁决 A — Flow Shadow = 新队列 + 新表(不寄生 artifact 队列)

- 决定:新增 pg-boss 队列 `content-shadow` + worker handler `apps/worker/src/handlers/content-shadow.ts` + 模块 `apps/worker/src/content-shadow/`(镜像 `apps/worker/src/audit/`);新增 asyncOperation `createContentShadowRun`(lock 8→9)。
- 理由:research→draft→QA 是多阶段长运行能力,与单发 `artifact` 模板渲染性质不同;折进 artifact 队列会违反 invariant 9("无寄生于自由 JSON 的内容生命周期",`implementation.md:219`)。新表 `flow_shadow_runs`(+阶段/产物子表)拥有 frozen inputs + `content_hash`,与 `audit_runs` 拥有 frozen inputs 同构(裁决沿用 Slice 1 路 A 的 provenance 血缘思路)。

### 裁决 B — 无第二确认路径(红线)

- 决定:content Finding → **复用现有 Finding Review 事务**(`finding-review.ts`)→ 一个 canonical Action → 模板固定的 `content_brief`,与技术 vertical 完全同构。Flow Shadow 消费已确认的 `content_brief` revision;其人工评审产出 reviewed `artifact_revisions`(现有乐观并发 409 STALE_REVISION),**绝不新建 approval-event / checkpoint / opportunity 表**。
- 理由:invariant 1-3/9(`implementation.md:211-213,219`)+ stop gate 决策 5/7。这是 Slice 2 最大设计风险 —— 建队列前必须先让"Finding-Review 复用"过 review。

### 裁决 C — pinned immutable inputs(红线,可复现)

- 决定:`flow_shadow_runs` 冻结一个 content-addressed 元组的 `content_hash`,含:确认的 Opportunity evidence snapshot + `primaryFindingId` + `content_brief` revision id + frozen 竞品集 + frozen SearchQuery cluster + frozen GenerativeQuery 集 + **pinned Flow adapter commit/version**。据此每次 shadow run 可确定性重渲染。
- 理由:沿用 Slice 1 frozen-input 模式(`audit_runs` 拥有 frozen inputs、`0015_frozen_crawl_seed.sql`、recheck `projection_version` 不可变)。复用 `packages/db/src/hash.ts`。search 与 generative 观测**分离**(invariant 8),cluster 读模型必须保留两种独立 metric 形状,绝不塌缩成伪共同 volume。

### 裁决 D — 绝不 CMS 写入 + 禁止 sibling repo 运行时导入(红线)

- 决定:任何阶段(drafted/qa_passed/reviewed)**绝不**写为 `published`,绝不做真实 CMS/Git/Webflow/WordPress 写入;Publish 控件 disabled/simulated,**绝不伪造成功 toast**(`prd.md:432`)。`gengrowth-flow-mvp` 只通过 **extraction / versioned package / pinned adapter** 复用,**禁止 runtime import 兄弟仓库**(`design.md:984`)。
- 理由:Slice 2 与 Slice 3 的定义边界;`design.md:823`、`prd.md:201-202,366`。

### 裁决 E — 无新增主导航;落地在 Growth Map + Execution

- 决定:Slice 2 **不新增主导航入口**(仍 Overview/Growth Map/Execution/Results 四入口)。Topic Cluster 详情(SearchQuery/GenerativeQuery/Existing Pages/Coverage Gap)作为 Growth Map 二级 object mode;可读的 content_brief 正文 + English draft 正文 + sources + QA + 评审决策直接渲染在 Execution(不用抽象 "artifact type/gate" 措辞)。
- 理由:stop gate 决策 1/4(四入口硬约束,`stop-gate.md:56-66`);`prd.md:169-171,414,420`。

### 裁决 F — CandidateOpportunity 最小化;TopicCluster/PageAssignment 走读模型

- 决定:仅为**这一个 content cluster** populate `supportingFindingIds`,保留 Finding-card 单一可确认对象模型,**不新增平行 Candidate 卡片 UI**。TopicCluster/PageAssignment 作为**投影读模型**(over `keyword_entities.cluster_key` + `mapped_site_page_id`),**不新建表**除非证明有真实查询/版本/去重/生命周期需求(`prd.md:136`)。
- 理由:stop gate 简化 #1/#2;避免引入与 Finding 卡竞争的第二套卡片模型。

---

## 3. 排除项(Slice 3 及以后,需 Owner 门)

Slice 2 **止于**一个 reviewed Artifact Revision,零外部写入。Slice 3 从 **authorized publish** 开始,严格不属本轮:

- 真实 CMS/Git/Tracking adapter Canary + rollback、Publish/Change Receipt、idempotency;
- 站点级 membership/permission 模型、current-Revision 审批 + preview;
- Landing/CTA/Form/Trust evidence、Landing Revision、UTM/Tracking artifact;
- 页面级 before/after、direct/assisted conversion、attribution 测量。

依据:`design.md:1071-1083`、`prd.md:369-397,1549-1562`。Slice 3 再入门槛:**Slice 2 parity accepted + rollback-capable Canary approved**。

---

## 4. 执行顺序与 Task 蓝图

串行硬链:Task 2(flow_shadow 表)→ Task 4(队列/worker)→ Task 5(Finding→brief 接线)→ Task 6(QA gate)→ Task 8(评审 UI)。契约税(7 处同步)覆盖 Task 1/2/3/4/5/8。

| # | Task | 依赖 | 迁移 | 契约税 | 粗估 |
|---|---|---|---|---|---|
| 1 | authority 叙述改版:把 v0.3 "no content lifecycle/CMS" 禁令放宽为 "Shadow-but-no-CMS";两个 verifier 保持 migration-aware | — | 否 | 叙述 + verifier COUNT | 0.5-1d |
| 2 | `flow_shadow_runs` + `flow_shadow_research_packs` + `flow_shadow_qa_gates`(append-only 子行,无可变 status;frozen inputs + `content_hash`)→ 表 41→44;`ArtifactType` **仅**扩 `english_blog_draft`(R2:research_pack 走子表不入枚举);详见 `2026-07-25-slice2-task2-flow-shadow-blueprint.md` | 1 | **是(0020)** | **全税**(表/枚举/generated) | 2-3d |
| 3 | populate `CandidateOpportunity.supportingFindingIds`(仅该 content cluster);TopicCluster/PageAssignment **读模型**投影(优先无表) | 1 | 或(0-1) | 或(opportunity 读 op) | 1.5-2d |
| 4 | 新 asyncOp + pg-boss 队列 `content-shadow` + worker handler/模块;pinned Flow adapter(extraction/versioned,无 runtime sibling import) | 2 | 否 | **+asyncOp in lock,+queue** | 3-4d |
| 5 | 接线 confirmed content Finding → 一个 Action → 一个 `content_brief`(复用现有 Finding Review 事务,红线 B) | 2,4 | 否 | 新 op:`createContentShadowRun`/`getContentShadowRun` | 2d |
| 6 | SEO/GEO QA + Factual Review gate:无支撑 claim 被 block 或标 `needs_review`;Research Pack 携带 authority 字段 | 4,5 | 否 | 或 QA schema | 2-3d |
| 7 | Execution 界面:直接渲染可读 content_brief + English draft 正文 + sources + QA(无抽象 gate 措辞) | 5,6 | 否 | 否 | 2d |
| 8 | **side-by-side 人工评审**(Growth Map cluster 详情 + Execution):评审绑定 current Revision;编辑使旧审批失效 → reviewed Revision;Publish disabled/simulated | 6,7 | 否 | `reviewContentShadowRevision` op | 2-3d |
| 9 | 内容 vertical E2E + Slice 2 stop gate(同证据链;断言 no CMS write)+ 写 `2026-XX-XX-seo-geo-content-shadow` re-entry brief | 全部 | 否 | 否 | 1.5-2d |

**粗估总量 ~17-23 人日。** 关键路径 Task 2→4→5→6→8。

契约税提醒(每个 op/表/枚举同 commit 7 处同步):`openapi/mvp.yaml` + `authority/.../openapi.yaml`(字节一致,同 sha256)+ `packages/contracts/src/generated/openapi.ts`(`pnpm contracts:generate`)+ `scripts/spec-v0.3-lock.json`(apiOperations/asyncOperations/tables + 刷新 file hash `shasum -a 256`)+ `scripts/verify-implementation.mjs`(EXPECTED 数组)+ `authority/.../scripts/verify-spec.mjs`(EXPECTED_*_COUNT)+ `authority/.../MVP-IMPLEMENTATION-SPEC.md`(其 CMS 禁令文本须在 Task 1 同步放宽)。

---

## 5. Definition of Done + 验收门

Slice 2 完成的判据:
- 内容 vertical E2E 端到端跑通:URL+ICP → 一个 content Finding → 一个 Action → 一个 content_brief → Flow Shadow research/draft/QA → side-by-side 评审 → reviewed Revision,**全程零外部写入**(E2E 断言 `exportRequests==[]` 且无 published 状态)。
- 一个 measured content Finding 只产出一个 Action 和一个 content_brief(复用 Finding Review 事务,红线 B),QA gate 对无支撑 claim block/`needs_review`。
- Flow Shadow run 由 `content_hash` 冻结、可确定性重渲染(红线 C),search/generative 观测分离(invariant 8)。
- 全库 gate 绿:`verify:spec` / `implementation:check` / `openapi:lint` / `contracts:check`(no diff)/ `lint` / `typecheck` / `pnpm test`(单测)/ `pnpm test:integration` / `pnpm build`,以及内容 vertical E2E。
- Slice 2 stop gate 文档 `accepted`。

---

## 6. 既有 e2e:mock 债(Slice 2 前置判断)

**已查明**:完整 `pnpm test:e2e:mock` 套件在本分支/本地环境**从 Slice 1 之前就广泛为红**(`context-localization-guard` 整片、`critical-flows`/`cursor-pagination`/`diagnosis-evidence` 等,多为 45s 超时)。已用 base 提交(`1979b53`)对照证明 `context-localization-guard` 错误一模一样 → **pre-existing tech debt,非 Slice 1 回归**。Slice 1 自身 vertical(`audit-technical-vertical`)通过。

对 Slice 2 的影响与决策:
- Slice 2 的内容 vertical 会新增自己的 mock E2E(Task 9),与既有红 spec 隔离,不被其阻塞。
- 但完整 e2e:mock 广泛红意味着**没有可信的完整 E2E 回归网**。建议:在 Task 9 前(或并行)用一个专门的诊断轮次**分类既有失败**(pre-existing 环境性 vs 真实 app/测试漂移),对确属测试漂移的做最小修复,恢复完整套件可信度。此为独立 tech-debt 轮,不与 Slice 2 feature 混提交。是否本轮做由 Owner 定;不做则至少在 stop gate 如实标注"完整 e2e:mock 未恢复绿"。

---

## 落地方式

沿用 Slice 1:每 Task 委托带完整蓝图的 general-purpose agent(TDD + 跑验证 + commit),主 agent review diff + 独立复跑验证后再启动下一 Task。相关记忆:`signalframe-slice1-landing-progress-2026-07`。
