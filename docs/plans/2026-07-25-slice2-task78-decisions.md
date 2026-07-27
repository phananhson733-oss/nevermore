# Task 7 / Task 8 — 主 agent 裁决(2026-07-25)

配套规格:`2026-07-25-task78-ux-spec-v2.md`(1354 行)。
本文件是**硬约束**,与规格正文冲突时以本文件为准。规格的三条总裁决 α / β / γ **全部批准**,不再复述。

---

## N-1(新增,最高优先级)— 一致性基准与来源分工

用户明确:「**之前的 概览 和 growth 这两个模块都已经完成了,ux 和 UI 注意统一**」。
规格生成时**未吃到**这条框架(编辑发生在工作流运行中途),因此在此补齐并覆盖规格中任何相反表述。

### 双重基准分工

| 提供什么 | 来源 | 说明 |
|---|---|---|
| 信息架构、区块构成、交互模式、状态语汇、诚实性表达手法、「无抽象 gate 措辞」的具体词汇表 | **artifact(GenGrowth 14.13)** | 只借**结构与语汇** |
| 调色板 token、字体与字号阶、卡片/hero 版式、组件类名、i18n key 组织 | **app 的 overview + growth-map + globals.css** | **视觉实现的既成事实** |

**配色一律 `var(--sf-*)`,绝不硬编码 artifact 的 hex。** artifact 是 GenGrowth 品牌(深绿 `#1f4d47` + 暖纸底 `#f6efe4`),app 是 SignalFrame 品牌(`--sf-accent: var(--sf-cobalt)` = `#315efb` 唯一强调色,mint/amber/coral 为语义色调)。照搬会**破坏已验收模块的统一性**。规格 §1.3 的换算表已正确落实这条,照它执行。

### 硬性禁止:不得修改已验收模块

**Task 7/8 一行都不许改 `overview` / `growth-map` / `sources` 的现有实现。**

据此**否决规格 §16 第 4 条**(「删三份私有 eyebrow(overview/growth-map/sources),全屏统一 `.sf-eyebrow`」)。

理由:这类「重构后视觉应当完全一致」的整理,恰恰是最容易**静默回归已验收成果**的改动;而它在 Task 7/8 的验收范围里**没有任何人会去核验** overview/growth-map 的视觉是否真的没变。收益(观感拉齐)与风险(动了用户已验收的东西且无人复核)不成比例。

**允许的做法**:Task 7 可以**新增** `.sf-eyebrow` 到 `globals.css` 并**只在自己的新界面里使用**;三份既有私有 eyebrow **原样保留**。若日后确需收敛,单独立项、单独验证、单独给视觉回归证据。

---

## O-1 — 质量分组:按我方 4 个 `kind` 还是硬套 artifact 五项

**裁决:采纳推荐 —— 按我方 `kind` 分组,取 artifact 的命名*风格*而非*字面*。**

理由:硬套「研究证据 / SEO / GEO / 事实核验 / 人工审核」五项需要一张 26 条 claim → 5 项的前端映射表,而规则集在 `rule-types.ts` 里会继续演进 —— 那张表**必然漂移**,且漂移时前端不会报错,只会静默把某条 claim 归错组。按 `kind` 分组则由后端单一真相驱动。

**要求**:分组标题的措辞仍要落在 artifact 的语汇层级上(具体、面向客户、非技术词),不得出现 `kind` 的原始枚举值、`rule id`、`gate`/`check`/`rule` 这类抽象词。

---

## O-2 — 新增 `listContentShadowRuns`(完整 7 处税,47→48)

**裁决:批准。**

我独立核实过是否有更便宜的替代:`execution/page.tsx` 只是薄服务端壳(`createElement(ExecutionClient, …)`),真正取数全在**客户端组件**。因此「服务端直接调 `FlowShadowRunsRepository.listByProject` 免税」这条路**在当前架构下不成立** —— 除非把 Execution 改成服务端渲染,而那是比一个 op 大得多的架构变更,且会推翻 Slice 1 刻意复用 `StudioClient` 的决定。

不加此 op 的后果是真实的:客户端只在**创建 run 的那一次**拿得到 id,刷新即丢,research pack / QA / limitations 全部不可达 —— Task 7 只剩三分之一价值。

**要求**:
1. 沿用仓内既有 list op 的 **cursor 分页**约定与 scope 谓词,不要另发明分页形状。
2. 走完整 7 处契约税,计数 **47→48**(async 仍 9,tables 仍 44)。
3. 同步 `verify-implementation.mjs` 的 EXPECTED 数组与 authority `verify-spec.mjs` 的计数。

---

## O-3 — `ContentShadowQaClaim.severity`(4 处轻税)

**裁决:批准。**

理由:不加则前端必须硬编码一份 blocking 白名单(`rl8` / `rl12` / `sc9b`)。那是把**后端不变式复制进前端**,Task 6 刚刚把 advisory/review/blocking 确立为后端概念,前端再抄一份必然漂移 —— 而且漂移方向最危险:前端以为某条是 advisory 而实际是 blocking,就会给用户一个「可以采纳」的错觉。

**要求**:`severity` 必须由后端**同一个真相源**派生(`rule-types.ts` 的 severity 表),不得在 mapper 层写第二份字面量。加一条测试钉死「wire severity 与 rule-types 的 severity 逐条一致」。

---

## O-4 — `ContentShadowResearch.briefOutline`(4 处轻税)

**裁决:批准,但推到 Task 8。Task 7 用 coverage detail 兜底。**

理由:Task 7 的核心价值是正文 + QA + sources 可读;outline 覆盖清单本身是 Task 8 side-by-side 评审时才真正需要的对照物。分开落地让 Task 7 的契约面更小、更快验收。

---

## O-5 — 先修 `QA_PENDING_LIMITATION`(零税,`research-pack.ts:40`)

**裁决:批准,且必须在 Task 7 开工前修掉。**

这是 Task 4 占位期留下的字符串,现在 Task 6 已落 26 条真判定。**不修的话界面会在 26 条真实 QA 结果旁边显示「QA 还没实现」** —— 这不只是文案陈旧,它是**对用户说了假话**,与本 Slice 的诚实性主张直接冲突。零契约税,顺手修。

---

## O-6 — Publish:disabled 还是 simulated

**裁决:采纳推荐 —— `disabled`。**

这是规格裁决 β 的落点,我完全同意其论证:**artifact 的「模拟发布 + 模拟回执」是浏览器内状态机,整个页面顶部有常驻横幅声明「仅保存在当前浏览器会话,刷新页面后重置」;我方是接真实数据库的真产品,复制那套就是造假。** 同一个交互,在 demo 里是诚实的,在真产品里是伪造的 —— 差别在于有没有那层「这一切都不落地」的框架。

**要求**:
- 控件 `发布到 CMS · 本阶段不可用`,原生 `disabled` + **就地** note 说明原因(不靠 tooltip)。
- 点击**什么都不发生** —— 不弹窗、不 toast、不写任何状态。
- 规格列的六条「绝不能发生」逐条写成可 E2E 断言的形式,Task 9 纳入 vertical E2E。

**同时批准规格的巧妙转化**:回执版式不浪费,改用在**一件真事**上 —— 评审决策回执,其中「外部发布写入 → 未发生」是表格里的一个**事实陈述**,而不是伪造的成功回执。这正是 artifact 手法的正确迁移。

---

## O-7 — 品牌轴裁决时机

**裁决:采纳推荐 —— 本轮不动,作为独立「品牌轴对齐」任务。**

Task 7/8 全部走 `var(--sf-*)` 语义层,裁决后重绑 `:root` 即整屏跟随、Task 7/8 零改动。这与 N-1「不改已验收模块」一致 —— 品牌轴一旦要动,动的是 overview/growth-map 在内的**全屏**,必须独立立项、独立给视觉回归证据。

`growth-map.module.css` 的私有 `--gm-*` token 记入该任务待办,**本轮不碰**。

---

## O-8 — `ready` 文案改 `已评审 · 未发布`

**裁决:批准。新增独立 i18n key,不动旧 key。**

理由:`ready` 在 Slice 2 语境下会被读成「可以发了」,而实际是「评审完成、但本阶段不发布」。诚实性要求它说清楚。新增 key 而非改旧 key,避免影响其他复用 `ready` 的界面。

---

## O-9 — 版本历史一期只两点

**裁决:采纳推荐,可接受。`listArtifactRevisions` 留 Slice 3。**

**要求**:UI 上不得暗示"这就是完整历史"。若只展示当前与上一版,措辞要如实(例如「当前版本」「上一版本」),不要用「版本历史」这种承诺完整列表的标题。

---

## O-10 — 新增 `--sf-text-read: 17px` / `--sf-read-measure: 780px`

**裁决:批准。**

理由与规格一致:避免又一处硬编码 px。规格自己指出 `growth-map` 就是这么烂掉的 —— 那更说明新界面不该重蹈。

**注意与 N-1 的边界**:新增 token 到 `globals.css` 是**加**,不是改已验收模块;但**不得**顺手把 growth-map 的硬编码 px 换成新 token(那是改已验收模块)。留给品牌轴任务(O-7)。

---

## 跨条统一约束

- **契约税净变化**:O-2 使 apiOperations **47→48**;O-3/O-4 是字段级轻税不改计数;asyncOperations 仍 **9**,tables 仍 **44**,rules 仍 **11**。若实际计数与此不符,**停下报告**。
- **诚实性优先于美观**:规格 §12 的诚实性专章与 §9 的状态矩阵是验收硬指标。任何为了界面好看而弱化「未评估 / 未通过 / 降级 / 未连接」表达的改动,一律不接受。
- **blocked 是常见状态不是边缘情况**(Slice 2 可引用外部来源数 = 0 by construction)。规格 §9 的 blocked 专章六条硬规则逐条执行:正文照常渲染、绝不用红色/失败字样、标题写「当前不能通过评审」、逐条具名原因、明写「这不是运行失败」、必须给下一步。
- **`.qaRail` 绝不出现 UUID**。规格指出现状 `_studio.tsx:1150-1190` 直接把 `actionId`/`findingId` 给客户看 —— 这是现存最严重的内容缺陷,Task 7 范围内必须消除(它在 Task 7 要改写的区域内,不属于 N-1 禁止的已验收模块)。
