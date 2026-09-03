# SEO Agent 结果面（关键页 + 问题手风琴）实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 SEO Agent 的结果面改成问题优先手风琴，页面级结论从只判目标 URL 扩到一组关键页，并把 On-Page Checker 独有的检查并入同一张目录。

**Architecture:** 服务端在投影层从缓存 payload 的 `pages` 挑 ≤24 个中性候选关键页；客户端按画像 coreFeatures 打分取前 12，对每页复用现有 `evaluateAgentAuditScope("page")` 再按检查项聚合成一份问题列表。九条 Checker 检查进目录（八条走 `buildRecords`，一条走 handler 侧关键词证据）。

**Tech Stack:** Next.js 16 App Router、TypeScript、vitest（unit）、Playwright（e2e）、next-intl、pnpm workspace（`apps/marketing` + `packages/public-tools` + `packages/sources`）。

**权威文档：** `docs/plans/2026-09-03-seo-agent-key-pages-accordion-design.md`（下称「设计」）。本计划只写「做什么、按什么顺序、怎么验」；口径、阈值、字段语义一律以设计为准，冲突时以设计为准。

**基线：** `main@c7dc27cc`，worktree `/Users/wzb/Code/nevermore/seo-agent-results-20260903`，分支 `feat/seo-agent-key-pages-accordion-20260903`。

---

## 通用纪律（每个任务都适用）

- **测试先行**：先写会红的测试，跑一次确认它红（且红在预期的原因上），再写实现。
- **验证对象 = 发布对象**：营销站 e2e 服务的是 `.next/standalone` 已有构建，改完源码跑 e2e 前必须先 `pnpm --filter @sf/marketing build`。
- **单测命令**：`pnpm vitest run --project unit <路径>`（全量 `pnpm test`，8000+ 用例，约数分钟）。
- **不用 `git add -A`**：本 worktree 只有本任务的改动，但仍逐文件 add。
- **格式化 hook 会重排整个文件**：每次改完 `.ts/.tsx` 看一眼 `git diff --stat`，发现无关大 diff 就回退重来。
- **client 组件禁止 import `@sf/*` barrel**：只走窄子路径导出，护栏在 `apps/marketing/src/lib/agents/client-bundle-boundary.test.ts`。
- **提交信息**结尾带 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`。

---

## 批次 1：手风琴落到 main（设计 §4、§11.1）

来源分支 `feat/agent-issue-accordion`（worktree `/Users/wzb/Code/nevermore/onpage-keyword-evidence`），五个提交：
`efc5e38e`（投影层 + AI 交接文本）、`bc30df46`（手风琴取代单选面板）、`5cb7eb0c`（e2e）、`4c014b27`（跨模型评审 7 处修复）、`8e7fd34b`（验收 5 处修复）。

### Task 1.1: cherry-pick 五个提交

**Files:**
- 新增: `apps/marketing/src/components/agents/agent-issue-{model,prompt,accordion,detail}.{ts,tsx}` 及其测试
- 新增: `apps/marketing/src/lib/use-copy-to-clipboard.ts`
- 删除: `apps/marketing/src/components/agents/agent-recommendations.{tsx,test.tsx}`
- 修改: `apps/marketing/src/components/agents/agent-results.{tsx,test.tsx}`、`apps/marketing/src/i18n/messages/{en,zh}.json`、`apps/marketing/e2e/agents.spec.ts`

- [ ] **Step 1: 逐个 cherry-pick，遇冲突停下**

```bash
cd /Users/wzb/Code/nevermore/seo-agent-results-20260903
git remote add accordion /Users/wzb/Code/nevermore/onpage-keyword-evidence 2>/dev/null || true
git fetch accordion feat/agent-issue-accordion
for c in efc5e38e bc30df46 5cb7eb0c 4c014b27 8e7fd34b; do
  git cherry-pick $c || break
done
```

已知：`efc5e38e` 干净落地；`bc30df46` 在 `agent-results.test.tsx` 有 1 处冲突块。

- [ ] **Step 2: 解 `agent-results.test.tsx` 的冲突**

冲突来自 main 侧对该文件的 +61 行（账号网站画像接入相关断言）。规则：**两边都保留** —— main 的新断言留着，分支删掉 `AgentRecommendations` 相关断言的部分照删。删完确认文件里不再出现 `agent-recommendation-disclosure`、`selectedRecommendationId`。

- [ ] **Step 3: 跑受影响的单测，确认全绿**

```bash
pnpm vitest run --project unit apps/marketing/src/components/agents
```
Expected: PASS（agent-issue-* 四个新测试文件 + agent-results.test.tsx）

- [ ] **Step 4: typecheck**

```bash
pnpm --filter @sf/marketing typecheck
```
Expected: 0 errors。若报 `agent-recommendations` 找不到，说明还有引用没清干净。

- [ ] **Step 5: 提交（cherry-pick 已各自成提交，只需确认历史）**

```bash
git log --oneline -6
```

### Task 1.2: 行首加 P0/P1/P2 徽章（设计 §4.2）

**Files:**
- Modify: `apps/marketing/src/components/agents/agent-issue-accordion.tsx`
- Modify: `apps/marketing/src/components/agents/agent-issue-model.ts`（若徽章需要 priority 字段）
- Modify: `apps/marketing/src/i18n/messages/{en,zh}.json`
- Test: `apps/marketing/src/components/agents/agent-issue-accordion.test.tsx`

映射固定：blocker→P0、warning→P1、tip→P2，**与 `agent-result-helpers.ts` 的 `RESULT_PRIORITY` 同一张表，不第二处定义**。
⚠️ `RESULT_PRIORITY[...] ?? "P2"`（`agent-result-helpers.ts:202`）是 fail-open 兜底，所以**未识别状态的隔离判定必须先于徽章渲染**，未知 result 绝不能落成 P2。

- [ ] **Step 1: 写失败测试**：三种严重度各渲染出 `P0 · 阻断项` / `P1 · 警告` / `P2 · 建议`；一个 `result` 为未知字符串的检查**不出现任何 P 徽章**且进隔离区。
- [ ] **Step 2: 跑，确认红**
- [ ] **Step 3: 实现**：从 `agent-result-helpers.ts` 导出 `RESULT_PRIORITY`，accordion 引用它；隔离分支在徽章之前 return。
- [ ] **Step 4: 跑，确认绿**
- [ ] **Step 5: 提交**

### Task 1.3: 头部收成三行 + 折叠采集边界（设计 §4.1）

**Files:**
- Modify: `apps/marketing/src/components/agents/agent-results.tsx`
- Modify: `apps/marketing/src/i18n/messages/{en,zh}.json`
- Test: `apps/marketing/src/components/agents/agent-results.test.tsx`

三行：① 目标 URL + 抓取时间 + 可用性/缓存芯片；② 一行事实 `抓取 {pagesInspected} 页 · 关键页 {keyPageTotal} · 已评估 {evaluatedChecks}/{totalChecks}`（本批 `keyPageTotal` 先渲染 0 或缺席，批次 2 接上）；③ 四个计数芯片（复用手风琴已有的 summary 计数）。
四格事实卡、采集边界说明、最终源站、停止原因、`evidenceRecordsBoundary` 移进默认折叠的 `<details>`。

- [ ] **Step 1: 写失败测试**：默认渲染下「未采集」「最终源站」不可见（在 details 内、未展开）；一行事实文本出现；四个计数芯片可点击且是筛选器。
- [ ] **Step 2: 跑，确认红**
- [ ] **Step 3: 实现**
- [ ] **Step 4: 跑，确认绿**
- [ ] **Step 5: 提交**

### Task 1.4: 删除范围切换、组导航、检查台账（设计 §4.1）

**Files:**
- Modify: `apps/marketing/src/components/agents/agent-results.tsx`
- Delete: `apps/marketing/src/components/agents/agent-diagnosis.{tsx,test.tsx}`（若删除后零引用）
- Modify: `apps/marketing/src/components/agents/agent-audit-model.ts`（移除只服务 diagnosis 的 `replaceAll("-","_")` 转换与 headingThreshold 改写，若无其他消费者）

⚠️ 先 grep 确认 `AgentDiagnosis`、`PolicyEditor`、`AxisChip` 的引用者，只删真正零引用的。`buildAgentAuditViewModel` 仍被手风琴使用，不能删。

- [ ] **Step 1: grep 引用面**：`git grep -n "AgentDiagnosis\|agent-diagnosis"`
- [ ] **Step 2: 写失败测试**：结果面不再渲染范围切换按钮（`站级` / `页面级`）与组导航。
- [ ] **Step 3: 跑，确认红**
- [ ] **Step 4: 删除 + 改引用**
- [ ] **Step 5: 跑全量 agents 单测 + typecheck，确认绿**
- [ ] **Step 6: 提交**

### Task 1.5: 文案与 e2e 对齐

**Files:**
- Modify: `apps/marketing/src/i18n/messages/{en,zh}.json`（`agents.hub.title`：既看整站也看单页 → 既看整站也看关键页）
- Modify: `apps/marketing/e2e/agents.spec.ts`
- Modify: 任何钉住旧文案的测试

- [ ] **Step 1: grep 旧文案的所有落点**（字典 + metadata + JSON-LD 硬编码源，见设计 §7「文案诚实性」）
- [ ] **Step 2: 改文案，跑 key parity 与「渲染输出不含 key 路径前缀」断言**
- [ ] **Step 3: 构建后跑 e2e**

```bash
pnpm --filter @sf/marketing build
cd apps/marketing && pnpm test:e2e
```
Expected: agents.spec.ts 绿（两条既有失败 `networkidle` 超时与首页 tech 按钮已知与本轮无关，需用 base commit 复现确认）
- [ ] **Step 4: 提交**

---

## 批次 2：关键页（设计 §5、§11.2）

### Task 2.1: 服务端 keyPages 候选投影

**Files:**
- Modify: `apps/marketing/src/lib/agents/audit-handler.ts`（投影段，与 `keywordEvidence` 并列）
- Modify: `apps/marketing/src/lib/agents/audit-contract.ts`（类型 + wire 守卫 `isAgentKeyPageCandidates`）
- Test: `apps/marketing/src/lib/agents/audit-handler.test.ts`、`audit-contract.test.ts`

规则见设计 §5.1。**`url` 必须取 `pages[].url`（`page.projection.fetchUrl`），不能取 `subjectUrl`** —— `comparableUrl` 只去 hash，形态不一致会让整组关键页静默匹配不上。

- [ ] **Step 1: 写失败测试**（候选选择）：非 2xx / 非 HTML 剔除；`subjectUrl` 去重保留第一条；首页第一、目标 URL 第二；深度 1 按 `inboundLinks` 降序、不足取深度 2；上限 24；`pages` 为空 → `[]`。
- [ ] **Step 2: 写失败测试**（URL 形态）：用真实报告的 `pages[].url` 构造候选，断言 `projectRecordToTarget` 能匹配上；把候选换成 `subjectUrl` 必须让该断言变红。
- [ ] **Step 3: 写失败测试**（wire 守卫）：多字段 / 少字段 / 超长 / 负数各一条拒绝；缺 `keyPages` 放行。
- [ ] **Step 4: 跑，确认红**
- [ ] **Step 5: 实现**
- [ ] **Step 6: 跑，确认绿**
- [ ] **Step 7: 提交**

### Task 2.2: 客户端关键页排序模块

**Files:**
- Create: `apps/marketing/src/components/agents/agent-key-pages.ts`
- Test: `apps/marketing/src/components/agents/agent-key-pages.test.ts`

规则见设计 §5.2。复用 `lib/agents/geo-alias-match.ts` 的 `normalizeAliasForMatch` / `containsGeoAlias`（已核实只 import `geo-canonical.ts`，后者零 import，可进客户端）。

- [ ] **Step 1: 写失败测试**：coreFeatures 为空 → 按候选原序、整组 `basis = "structure"`；首页即目标不重复；候选不足 12；整词命中 +1000、单词 +1；CJK feature；同分稳定序；`basis` 四种取值正确。
- [ ] **Step 2: 跑，确认红**
- [ ] **Step 3: 实现**
- [ ] **Step 4: 跑，确认绿**
- [ ] **Step 5: 提交**

### Task 2.3: recordsFor(page) —— 本批最关键的裁决（设计 §5.3）

**Files:**
- Create: `apps/marketing/src/components/agents/agent-key-page-records.ts`
- Test: `apps/marketing/src/components/agents/agent-key-page-records.test.ts`

三条分支：
1. **目标页**：全部记录，行为与今天完全相同。
2. **非目标关键页**：① 按 **id 清单**剔除目标页专属记录（`keywordChecks` / `pagePerformance` / `serpShape` / `pageShapeChecks` 的全部 id + `searchPerformance` 的 `target_query_ranking_band`）—— **不能按 population 判断**，`target_query_ranking_band` 的 population 其实是 `conditional_subset`；② 其余 `conditional_subset` 记录的 `targetTested` 置 `null`。
3. **目标页未被抓到（`targetInspected = false`）**：照旧 `{ records: 全部, targetUrl, inspectedTargetUrl: null, targetInspected: false }` 求值一次，作为无 basis 的目标条目进聚合。

- [ ] **Step 1: 写失败测试**：「目标页有 title、关键页无 title」的 fixture 下，2.1 在该关键页**不得为 pass**（必须 excluded）；`target_query_ranking_band` 在非目标页被剔除（不走 precondition limitation）；`every_collected_page` 记录在非目标页仍可 pass；`targetInspected = false` 时 8.x/9.x 仍可判定。
- [ ] **Step 2: 跑，确认红**
- [ ] **Step 3: 实现**
- [ ] **Step 4: 跑，确认绿**
- [ ] **Step 5: 提交**

### Task 2.4: aggregateKeyPageEvaluations

**Files:**
- Create: `apps/marketing/src/components/agents/agent-key-page-aggregate.ts`
- Test: `apps/marketing/src/components/agents/agent-key-page-aggregate.test.ts`

优先级表见设计 §5.4（行 0–7，是全集）。`truth` 合并规则含「平票取 `unavailable`」。
⚠️ 非目标页的 `unverified → excluded` 自带 truth `partial`，所以行 4 的「通过」行大多显示 `partial` —— **预期，不是 bug**。

- [ ] **Step 1: 写失败测试**：全通过 / 全排除 / 全来源受限 / 混合 / 未知枚举 fail-closed（且隔离先于 P2 兜底）/ 关键页命中数 > 全站受影响数触发隔离 / `mode = "not-captured"` 出现即隔离 / `declaresNoJudgement` 项在任何分布下都不得合并成 pass。
- [ ] **Step 2: 变异测试**：把「取最差」改成「取最好」必须至少一条红（写在测试注释里，人工验一次）。
- [ ] **Step 3: 跑，确认红**
- [ ] **Step 4: 实现**
- [ ] **Step 5: 跑，确认绿**
- [ ] **Step 6: 提交**

### Task 2.5: 受影响目标两段式 + 范围标签接线

**Files:**
- Modify: `apps/marketing/src/components/agents/agent-issue-model.ts`（`AgentIssueAffectedTargets` 加四个字段）
- Modify: `apps/marketing/src/components/agents/agent-issue-accordion.tsx`、`agent-issue-detail.tsx`
- Modify: `apps/marketing/src/components/agents/agent-results.tsx`（接 keyPages、多目标求值、聚合）
- Modify: `apps/marketing/src/i18n/messages/{en,zh}.json`

字段：沿用 `totalCount` / `enumerated`，新增 `keyPageTotal` / `keyPageEvaluatedCount` / `keyPageHitCount` / `keyPageUrls`（截断展示，上限 10）。
标签：命中 `关键页 {keyPageHitCount}/{keyPageTotal} · 另有 {totalCount − keyPageHitCount} 页`；通过 `关键页 {keyPageEvaluatedCount}/{keyPageTotal} 已评估 · 通过`。

- [ ] **Step 1: 写失败测试**：两种标签格式；`enumerated = false` 时写「另有至少」；站点级四字段为 0 且不列 URL；来源受限 `totalCount` 为 null 不为 0；`keyPageHitCount > totalCount` 触发隔离。
- [ ] **Step 2: 跑，确认红**
- [ ] **Step 3: 实现**
- [ ] **Step 4: 跑，确认绿**
- [ ] **Step 5: 空态与退化**：`keyPages` 缺失/为空时写「本次没有可评估的关键页，页面级结论只针对目标 URL」并退化为单目标。
- [ ] **Step 6: 提交**

---

## 批次 3：目录并入（设计 §6、§7、§11.3）

### Task 3.1: 八条记录进 buildRecords

**Files:**
- Modify: `packages/public-tools/src/seo-audit/model.ts`
- Modify: `packages/public-tools/src/seo-audit/record-ledger.ts`
- Create: `packages/public-tools/src/seo-audit/page-shape-thresholds.ts`（8.7/8.8/4.6 常量）
- Modify: `packages/public-tools/package.json`（`exports` 登记新子路径）
- Test: `packages/public-tools/src/seo-audit/*.test.ts`

八条：1.9 viewport / 2.7 lang / 2.8 charset / 2.9 favicon / 4.6 正文文本量绝对档 / 6.6 外链 blank 无 noopener / 8.7 客户端渲染 / 8.8 HTML 体积。population `every_collected_page`；**缺 `onPage` 侧车的页不计入 `tested`，population 标 `conditional_subset`，limitation 明示**。

- [ ] **Step 1: 写失败测试**：每条记录的构造器 × `isSeoAuditRecord` sweep；含「全站合规」干净分支（→ `not_observed`，`affected = 0`，绝不 `observed + affected 0`）与「缺侧车」分支。
- [ ] **Step 2: 跑，确认红**
- [ ] **Step 3: 实现 + 登记台账**
- [ ] **Step 4: 跑，确认绿；`detector-contract.test.ts` 双向台账比对通过**
- [ ] **Step 5: 提交**

### Task 3.2: catalog 九个条目 + 2.10 handler 侧记录

**Files:**
- Modify: `packages/public-tools/src/agent-audit/catalog.ts`（`PAGE_TITLES` 九条 + `EVIDENCE` 映射 + `HOW_TO_FIX` 专属文案 + 硬编码 tip 列表）
- Modify: `packages/public-tools/src/seo-audit/keyword-evidence/records.ts`（新记录 `target_query_slot_coverage`）
- Test: `packages/public-tools/src/agent-audit/catalog.test.ts`

⚠️ 八条 Tip 级新项必须加进 `catalog.ts:1078` 那张**硬编码 tip 列表**，不能靠 `DECLARES_NO_JUDGEMENT` 正则（否则会被批次 4 的 F2 归成 `observed-only`）。
⚠️ 1.9 落页面组 1 会得 `scored = false`、`primaryAgent = tech`，表里按 Tech 归属渲染。

- [ ] **Step 1: 写失败测试**：`AGENT_AUDIT_COVERAGE.total` 从 ids 派生为 **89**（不手写数字，从 `SITE_CHECK_IDS + PAGE_CHECK_IDS` 推）；九个新 id 在集合内；每条有专属 `howToFix`（不与同组兄弟共用）。
- [ ] **Step 2: 跑，确认红**
- [ ] **Step 3: 实现**
- [ ] **Step 4: 跑，确认绿**
- [ ] **Step 5: 提交**

### Task 3.3: v18 bump + Checker 三处改动

**Files:**
- Modify: `packages/public-tools/src/seo-audit/model.ts:1680`、`packages/public-tools/src/seo-audit/contract.ts:843`、`apps/marketing/src/lib/agents/audit-contract.ts:112`（三处 `seo_audit.sitewide.v17` → `v18`）
- Modify: `apps/marketing/src/lib/on-page-checker/checks-meta.ts`（文本/代码比降为 observation；常量改从 `@sf/public-tools/seo-audit/page-shape-thresholds` import）
- Modify: `apps/marketing/src/lib/on-page-checker/checks-technical.ts`（同上）

- [ ] **Step 1: 写失败测试**：三处版本字面一致的冻结断言；Checker 与 catalog 引用同一常量导出（改一处必须让两边都变）；文本/代码比不再扣分。
- [ ] **Step 2: 跑，确认红**
- [ ] **Step 3: 实现**
- [ ] **Step 4: 跑，确认绿；`client-bundle-boundary.test.ts` 仍绿（新子路径不是 barrel）**
- [ ] **Step 5: 950 页 fixture 实测 payload 体积，记录到 PR 描述（设计 §13）**
- [ ] **Step 6: 提交**

---

## 批次 4：内容逻辑修复（设计 §8.2、§11.4）

按 §8.2 表逐条修，每条一个小提交。顺序：F1 → F2 → F3 → F8 → F4/F5/F6/F7/F9/F13。

### Task 4.1: F1 —— 目标词与页面类型送达

**两层都改**：
- 客户端 `agent-workbench.tsx:285-298`：`targetQuery` 非空时上送 `targetQueries: [targetQuery]`；`pageRole: profile.pageType` **始终**上送。
- 服务端 `audit-handler.ts:865-880`：把 `h2/h3_count_outside_reviewed_range`、`thin_section_under_h3`、`schema_type_unmatched_to_page_type` 从关键词证据解耦为新区域 `pageShapeChecks?: { version, records }`，只凭 `pageRole` 即构造。
- **台账搬迁**：四个 id 从 `KEYWORD_EVIDENCE_RECORD_IDS` 移出（`isAgentKeywordChecks` 要求 id 集合恰等，不移出会拒绝新响应），进新 `PAGE_SHAPE_RECORD_IDS`；`AGENT_KEYWORD_CHECKS_VERSION` 同步 bump；`allAgentAuditRecords` 与 `agent-display-contract.ts` 三个 union 各加一行。

- [ ] **Step 1: 写失败测试**：有 `pageRole` 无 `targetQueries` 时 `pageShapeChecks` 出现且 3.4/3.5/3.6/7.2 可判定；两者都无时缺席；`isAgentKeywordChecks` 对搬迁后的 id 集合仍通过。
- [ ] **Step 2: 跑，确认红** → **Step 3: 实现** → **Step 4: 跑，确认绿** → **Step 5: 提交**

### Task 4.2: F2 —— observed-only 结果态

新增 `AgentAuditCheckDefinition.declaresNoJudgement: boolean`，由 catalog 从正则 `/Internal heuristic only|Display only|Listed for review, not judged/` 派生；求值器读字段不重跑正则。命中的 **10 项**：A7、B4、B5、C6、D7、E4、4.2、4.3、4.4、6.5。
`evaluate.ts:357-363` 的 `: "pass"` 对这些项短路成 `observed-only`。新结果态贯通 `AgentAuditResultState` 联合、手风琴映射表（fail-closed）、display-contract、en/zh 文案。

- [ ] **Step 1: 写失败测试**：10 项在任何分布下都不是 Tip、不是 pass、不进建议；`measurement()` 对观测记录展示数值。
- [ ] **Step 2: 跑，确认红** → **Step 3: 实现** → **Step 4: 跑，确认绿** → **Step 5: 提交**

### Task 4.3: F3 —— 3.6 的 CJK 门

`sectionSubstanceRecord`（`keyword-evidence/records.ts:432-449`）加 CJK 门（复用 `cjkShare`），CJK 时 `unverified` + limitation。

- [ ] **Step 1: 写失败测试**：纯中文页在 3.6 上不判 thin。
- [ ] **Step 2–5: 红 → 实现 → 绿 → 提交**

### Task 4.4: F8 —— AI 草稿注入宽度与含词

`solution-draft.ts:96-113` prompt 注入 `SNIPPET_*_WIDTH` 与「必须以词序列包含目标词（若已确认）」；reader（:124-179）用 `displayWidth` / `countOccurrencesInText` 复核，**不通过标出不拒绝**；草稿旁显示宽度读数。

- [ ] **Step 1: 写失败测试**：超宽草稿被标出而不被拒绝；含词复核生效。
- [ ] **Step 2–5: 红 → 实现 → 绿 → 提交**

### Task 4.5: F4/F5/F6/F7/F9/F13 各一个小提交

- **F4**：4.4/3.3 的 `tested` 只计有侧车的页并标 `conditional_subset`。
- **F5**：手风琴接求值器的 `needs-integration`（kebab-case）到 i18n `engines.needsIntegration`，不经 view 层 snake_case 中转；4.1 阈值改说明性、howToFix 专属句。
- **F6**：2.1/2.4 阈值文案补「出界为提示」；Checker 文案注明「Agent 侧记为提示」。
- **F7**：`AgentSolutionPreviewInput` 传 `targetPageExtract`，`observedValue` 找不到标签时回退到 extract；补 2.1/2.3 测试。
- **F9**：`authority()` 兜底 `"industry"` → `"judgment"`，真有出处的显式列 industry。
- **F13**：`searchPresentation.limits` 「字数」→「显示宽度（中日韩按 2 计）」。

每条：写失败测试 → 红 → 实现 → 绿 → 提交。

---

## 批次 5：收尾（设计 §11.5）

- [ ] **Task 5.1: 全量单测 + typecheck + lint + secrets 扫描**
- [ ] **Task 5.2: `pnpm --filter @sf/marketing build` 后跑 e2e（双 locale、390px、干净站点空态、关键页行）**
- [ ] **Task 5.3: 文案清扫** —— 字典 + metadata + JSON-LD 硬编码源三处都要扫（教训：只扫字典会漏掉搜索结果里显示的那段）
- [ ] **Task 5.4: codex 跨模型评审并修复**（额度恢复后；提示词模板见 `/Users/wzb/Code/nevermore/reports/2026-09-03-codex-design-audit-prompt.txt`）
- [ ] **Task 5.5: 开 PR**，描述里写明 v18 bump 会让已打开的旧标签页下一次运行报错一次（刷新即恢复）、A7/C6/D7/6.5 迁入仅观测区、payload 体积实测值

---

## 验收标准（全部批次完成时）

- 结果面只有一份问题列表，无范围切换、无组导航、无单选建议面板。
- 页面级结论覆盖 ≤12 个关键页，范围标签如实显示命中数与已评估数。
- 目录 89 项，九条新检查有专属 howToFix 与双语文案。
- 10 个「声明不作判定」项在仅观测区，不进 AI 交接。
- 单测全绿、typecheck/lint 0、e2e 双 locale 绿、生产构建通过。
