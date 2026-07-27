# Nevermore 关键词增长融合方案 Artifact 数据源

本目录保存 Nevermore 四个模块的产品工作区 Artifact 数据源，以及与之配套的需求审计 Evidence。Artifact 的主体验回答“Overview、Growth Map、Execution、Results 如何形成统一客户闭环”；13 条原始需求及审核结论退居二级 Evidence，用于解释方案依据。它不是客户工作台中的第五个模块，也不用场景数据代替生产能力。

## Authority 与来源

- 原始需求：`inbox-maboyang/00-inbox/2026-07-23-gengrowth工具优化需求-关键词库模块`
- 已批准设计：`docs/plans/2026-07-27-nevermore-keyword-growth-governance-design.md`
- 实施计划：`docs/plans/2026-07-27-nevermore-keyword-growth-governance-implementation.md`
- 数据真相：`audit-data.js`
- 独立输出：`docs/artifacts/Nevermore-Keyword-Growth-Audit.html`

原始需求定义待审核的产品诉求；已批准设计定义 Nevermore 的正式产品决策；`audit-data.js` 冻结完整产品蓝图和审核 Evidence 的可视化投影。Artifact 不得反向成为生产功能的 authority。

## 数据合同

`audit-data.js` 只写入 `window.NevermoreKeywordAudit`，顶层固定包含：

- `version`、`reviewedAt`、`title`、范围声明和生产声明；
- `customerVisibleConnectors`，且只能为 `GSC`、`GA4`、`GitHub`；
- `connectorPolicy`，定义三项真实客户连接、readiness、unavailable 和内部 Evidence Provider 边界；
- `integratedProduct`，作为主 Artifact 的唯一四模块融合合同；
- `requirements`，按原始编号完整包含 1–13，仅作为 secondary evidence；
- `modules`，对应概览、增长地图、执行中心、效果追踪；
- `stages`，对应 Stage 1–3；
- `acceptanceLayers`，对应 Data、Contract、Service、UI、Mutation/Audit、Tests 和 Provider 证据。

### 主产品合同

`integratedProduct` 固定包含：

- `requirementsEvidenceRole: "secondary-evidence"`；
- `lifecycle`：从产品上下文、站点证据、Topic/Keyword 治理、机会决策、执行、变更回执到结果回流；
- `modules`：严格为 Overview、Growth Map、Execution、Results 四个现有客户模块；
- `growthMapSections`：严格对应 `page-portfolio`、`keyword-library`、`topic-governance`、`competitor-corpus`、`internal-link-graph`、`keyword-history`、`external-evidence`；
- `canonicalObjects`：显式区分 `current`、`next`、`provider-dependent`；
- `capabilities`：13 项正式能力与原始需求一一映射；
- `crossModuleJourneys`：内容增长、技术修复和持续监控三类完整客户旅程；
- `connectorPolicy`：与顶层 `connectorPolicy` 使用同一个 truth。

每个模块必须有客户目标、主页面区块、跨模块入口/出口、canonical objects 和能力归属。每项 Capability 必须有：

- 唯一 `id` 与对应 `requirementId`；
- `primaryModule` 与 `supportingModules`；
- `entryPoints` 与 `exitPoints`；
- `canonicalObjects`；
- `truthStatus` 与 `implementationCondition`；
- 唯一 `primaryAction`，并指向真实 module surface、canonical command、evidence/results view 或 provider readiness。

`defer` 只描述实施时序或外部条件，不表示能力被删除。Backlink、GEO Citation、VOC 和完整竞品监控仍属于完整产品方案，但在 Provider、授权、成本、许可、频率和数据覆盖满足之前保持 `provider-dependent`。

### 二级审核 Evidence

每条 `requirements` 记录必须同时回答：

1. `sourceStatement`：原始诉求是什么；
2. `currentTruth` / `currentEvidence`：现在真正存在什么；
3. `decision` / `rationale`：直接纳入、改写后纳入或后置，以及原因；
4. `rewrittenAcceptance`：改写后的正式验收口径；
5. `modules` / `stage` / `dependencies`：影响范围与实施前置；
6. `completionEvidence`：需要什么生产证据才能宣布完成；
7. `notIncluded`：本次明确不做或不能夸大的边界。

`currentTruth` 只允许：

- `current`：当前已存在；
- `partial`：部分存在；
- `not-implemented`：尚未实现；
- `external-dependent`：依赖外部接入。

`decision` 只允许：

- `adopt`：直接纳入；
- `rewrite`：改写后纳入；
- `defer`：后置。

需求 9 必须保留两个独立 completion flag：

- `rank_history_complete`；
- `receipt_backed_results_complete`。

只有两项都拥有完整生产证据时，需求 9 才能整体标记完成。

## Current 与 Target 的显示规则

Artifact 必须把当前事实和目标方案并列呈现：

- 主体验先呈现完整四模块产品、页面区块和跨模块闭环，不使用 adopt/rewrite/defer 取舍卡作为首页；
- 逐条审核结论只在 secondary evidence 视图中出现；
- 当前证据只描述已验证的 canonical 能力；
- 目标验收使用将来态，不得显示为已完成状态；
- 静态界面、可点击按钮或场景数据不是生产完成证据；
- 缺少 Provider、权限或历史观测时，必须显示 `unavailable`、`partial` 或 `stale`，不能填零或补 mock 数据；
- 时间上的先后关系不等同于动作造成结果，尤其不能把 GEO Observation 写成因果归因。

## 构建与安全约束

生成器必须确定性读取 repository-owned source，把 CSS、数据与应用脚本内联到单一 HTML：

```text
docs/artifacts/Nevermore-Keyword-Growth-Audit.html
```

生成输出必须满足：

- 可离线打开，不请求远程字体、脚本、样式或图片；
- 不调用 `fetch`，不依赖运行时服务；
- 不包含工作站绝对路径、凭据、内部兼容包名或历史项目标识；
- 中文优先，English 只用于稳定 Product/Domain 名词；
- 所有筛选、Tab、需求选择和浏览器前进/后退都使用确定性状态；
- 重新构建相同 source 时产生相同输出。

`scripts/verify-keyword-audit-data.test.mjs` 是数据真相层的最小守门：它验证 13 条需求无遗漏、字段完整、关键审核边界、客户连接面和敏感标识。后续 Artifact DOM、浏览器、可访问性和视觉回归测试是附加证据，不能替代本数据校验。

## 完成含义

Artifact 完成只证明：

- Nevermore 四模块、统一生命周期、主页面区块、canonical objects 和跨模块入口/出口已经形成一致方案；
- 13 项能力全部拥有模块归属、受治理动作、实施条件与真实状态；
- 13 条需求已经被逐条审核；
- 产品决定、阶段、依赖和验收边界已经被冻结；
- 完整产品方案与审核 Evidence 可以被一致、离线、可访问地呈现。

它不证明任何目标功能已经上线。每条需求仍需按适用范围补齐 Data、Domain、Contract、Service、Mutation、客户 UI、自动化测试，以及真实 Provider 或诚实不可用状态后，才可标记生产完成。
