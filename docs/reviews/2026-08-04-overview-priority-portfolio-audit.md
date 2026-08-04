# 概览页两大模块验收评估

> 下文表格用仓库相对路径；待办章节的绝对路径是审计当时的工作树位置，按相对路径读即可。

## 落地状态（2026-08-04 收尾时补，请先读这张表）

本报告成文时 T1–T11 全部待办。其后两轮已上线，**下文各待办章节的「现状」描述停留在修复前**，作为问题成因的记录保留，不再代表当前代码。

| 待办 | 状态 | 去向 |
|---|---|---|
| T1 衰减检测缺最低样本量守卫 | **已上线** | PR #56，`CONTENT_DECAY_MIN_PREVIOUS_CLICKS = 100`，与 SEARCH-DECAY-002 对齐 |
| T2 覆盖降级不说原因 | **已上线** | PR #56，渲染 `coverage.limitations` |
| T3 读取失败被说成「没有冻结审计」 | **已上线** | PR #56，`WorkRunState` 增加 error 分支 |
| T4 「有效 Finding」标签断言了不存在的过滤 | 未做 | 会同时改增长地图的 URL 计数与深链解析，建议连同该屏单独立项 |
| T5 陈旧决策提醒 SLA 写死 | 未做 | 仅「14 天可配置」是小改；补 owner/reason/lastDecisionAt 要扩契约 |
| T6 URL 组合卡看不到 URL 身份 | 未做 | 会撞 `_overview-accessibility.test.ts` 的四格硬断言，需先定形态，建议与 T12 一起想 |
| T7 Stage 2 决策台账 | 未做（不记为缺陷） | `openapi/mvp.yaml:10434-10436` 明确把该提醒定义为只读派生 |
| T8 缺「审核竞品候选」入口 | **最小版已上线** | PR #58。完整版（竞品进决策列表）需给 `OverviewView` 加字段，合同 owner 独占 |
| T9 衰减预警占满决策名额 | **已上线** | PR #56，预警移出决策队列独立成区 |
| T10 右卡丢失机会类型构成 | **已上线** | PR #56，改为三个 frontstage lens + 全项目作用域标注 + 恢复总计 |
| T11 hero 信息密度 | **已上线** | PR #56，方案乙：hero 与队列合并为单一决策列表 |
| C2 待审核 Finding 无入口 | **已上线** | PR #56，副文案深链带 findingId |
| T12 四卡布局左右列高差 | 未做 | 本轮新暴露，见下 |

**T12（本报告成文后新增）**：左卡瘦身后左列明显短于右列。PR #56 已把 `align-items` 从 `stretch` 改为 `start`，消除了「空洞出现在卡片内部」这个更难看的问题，但 `grid-template-areas` 把「数据连接」锁死在第二行左侧、无法上浮，列高差仍在。属产品决定。

**另一项已知但未修**：`content-decay-monitor` 的 limitations 数组里有一条「流量下滑仅在上一个检查点点击数不低于 100 时判定」的门槛披露（T1 加的），概览从未渲染 `contentDecayMonitor.limitations`，因此该门槛对客户仍不可见。要渲染需先建立 limitation 原文到 i18n key 的映射（参照增长地图的 `PlatformLimitationText`），否则英文界面会出现生中文。

---

## 1. 一句话结论

- **优先处理卡（module A）**：主干按规格完成，客户可见叙事、决策入口、加载态终止、单条 Opportunity 口径全部达标；**遗留 1 项界面自相矛盾（读取失败被说成"没有冻结审计"）、1 项检测治理缺口（月度衰减预警无最低样本量/季节性/品牌词守卫，5→3 clicks 就会对客户说"建议内容复审"）、以及一整块 Stage 2 未开工的决策台账能力（defer/snooze/owner/可配置 SLA）**。
- **URL 组合卡（module B）**：结构、取数协议、冻结审计绑定、禁止项（架构图/评分矩阵/策略实验室等）全部达标；**遗留 4 项诚实性/信息完整性偏差，核心是"覆盖降级了但不说原因"——契约强制携带的 `coverage.limitations` 在这张卡上根本没有渲染点，客户只看到"部分覆盖"三个字**。

两个模块都不存在伪造指标、不存在把不可用写成 0、不存在假按钮或 toast 冒充目的地。所有遗留项都属于"信息不完整"或"能力未交付"，没有一项属于"数据造假"。

> **2026-08-04 第二轮补充（artifact 保真度复评 + codex 交叉评审）**：Owner 提供了 artifact 运行态截图与单文件版路径 `/Users/wzb/Code/nevermore/signalframe-mvp-app/docs/artifacts/GenGrowth-Interactive-Artifact.html`（与 build 14.13 的 `client-app.js` 逐字一致）。据此新增 **T8 / T9** 两条待办，并修正第 3.2 节一处表述。第一轮按 spec 验收的结论不变；第二轮补的是**按 artifact 基准验收**的维度。详见第 7 节。

---

## 2. 优先处理卡（workspace.overview.priority）

### 2.1 未完成 / 偏离

| 规格要求 | 出处 | 现状 | 判定 |
|---|---|---|---|
| measured / pending / collection failed / No Data 必须可区分 | `docs/plans/2026-07-21-unified-growth-opportunity-prd.md:1682` | 队列区只有四态（`_overview.tsx:471` loading / `:476` mismatch / `:484` unavailable / `:488` empty），缺"读取失败"态。`_overview.tsx:1086-1090` 把 portfolioQuery 的**所有**错误归为 `unavailable`，于是 `GROWTH_MAP_AUDIT_NOT_FOUND`（真·无冻结审计 = No Data，判定见 `:975-977`）与 500/网络等真实读取失败（= collection failed）共用同一句文案 `packages/i18n/src/messages/zh-CN.json:831`「尚未识别到冻结审计，工作队列暂不可用。」。在读取失败分支（`_overview.tsx:1138-1142` 中 `auditUnavailable===false`）下，同一张卡（`:433`）上半部已由 ProblemState 报错（`:441-446`），下半部却断言"尚未识别到冻结审计"，两条陈述互相矛盾。audit-not-found 分支下文案正确、无矛盾。注：`portfolioRunId === null` 在成功读取下不可达，因 `packages/contracts/src/generated/openapi.ts:2499-2502` 规定 `diagnosticRunId` 必填非空 | **偏离（medium）**——错误本体仍可见并可重试，无指标伪造 |
| 低样本或季节性页面不得被简单 20% 规则误报为衰减；Policy 须含最低样本、季节性、品牌词 | `docs/plans/2026-07-27-nevermore-keyword-growth-governance-design.md:635`、`:112` | `packages/engine/src/content-decay-monitor.ts:510-521` 唯一样本守卫是 `previousFact.clicks > 0`，之后直接以 `changeRatio < -0.2`（阈值 `:13`）判 traffic_decline；无最低样本量、无季节性抑制、无品牌词豁免。仓储 `packages/db/src/repositories/content-decay-monitor.ts` 只有行数上限，服务层 `apps/web/src/lib/services/workspace-view.ts:636-640` 只排序 + `slice(0,3)`，均未补位。5 clicks → 3 clicks（-40%）会在 `_overview.tsx:493`/`:364` 生成客户可见的「建议内容复审」。**范围修正**：最低样本量并非全仓缺失——同卡另一条衰减路径 `packages/engine/src/rules/search-decay.ts:22,59`（SEARCH-DECAY-002）已实现 `MIN_PREVIOUS_CLICKS = 100`，这是"两条衰减路径守卫不一致"。季节性抑制仅存在于与产品断开的公开工具 `packages/public-tools/src/traffic-drop/findings.ts:50`。另：Alert 未渲染样本量（DTO 已有 `previousClicks/currentClicks`，`apps/web/src/lib/api/types.ts:172-176`，概览未使用），独立违反规格 `:586`「Alert 显示窗口、阈值、样本和缺数」 | **缺失（high）**——检测器已随 v0.4 上线并直接产出客户可见建议，却先于其治理 Policy 交付 |
| 14 天机会提醒须用可配置 SLA + 最后决策时间 + 负责人 + Snooze Until + 延后原因，14 天只能是默认值 | `docs/plans/2026-07-27-nevermore-keyword-growth-governance-design.md:109`、`:142` | `apps/web/src/lib/services/workspace-view.ts:196` 硬编码 `OVERVIEW_STALE_DECISION_DAYS = 14`，唯一使用点 `:273`，函数入参 `:233-239` 不接受任何项目配置。DTO（`workspace-view.ts:156-166`、`apps/web/src/lib/api/types.ts:148-158`）无 owner / snoozeUntil / reason / lastDecisionAt。全仓 `*.ts/*.tsx/*.sql/*.yaml/*.json` grep `snooze|sla` 零命中。计划中的 `packages/db/migrations/0027_opportunity_decision_ledger.sql` 从未创建（实际 0027 是 competitor_dynamic_monitor.sql） | **偏离（medium，已确认）** |
| 新增 Opportunity State Ledger（Fingerprint / First-Last Seen / Last Decision / `advance｜decline｜defer｜snooze` / Reason、Owner、Snoozed Until / Related Action） | `docs/plans/2026-07-27-nevermore-keyword-growth-governance-design.md:364-371` | **五项已实现**：Fingerprint = `authority/implementation-spec-v0.4/schema.sql:519` findings.finding_key + `:547` 唯一约束；First/Last Seen = `schema.sql:540-543`；Last Decision + Reason = `schema.sql:534-537` review_state/review_revision/review_reason；append-only 台账 = `schema.sql:571-586` app.finding_review_events；Related Action = `schema.sql:591` actions.source_finding_id；写入命令 `openapi/mvp.yaml:1503` reviewProjectFinding。这些持久状态确实驱动抑制（`workspace-view.ts:243-257`）。**缺的是延后语义**：无 `defer`/`snooze` 枚举、无 Snoozed Until、无 Owner；needs_more_data 不抑制提醒（`workspace-view.ts:220-222`），最接近"延后"的状态会持续重复冒泡；陈旧度按 firstSeenAt 而非最后决策时间算（`:270-272`）；卡内无就地"推进/延后/不做"控件（`_overview.tsx:300-307` 只有跳转链接） | **部分完成（low-medium）**——Stage 2 计划项，非 v0.4 冻结合同缺陷（`MVP-IMPLEMENTATION-SPEC.md` 与 `openapi/mvp.yaml` 中 snooze/ledger 零命中） |
| Snooze 中机会不重复冒泡，到期后再次出现 | 同上 `:634`（真正绑定概览的是 `:142`） | 全仓无任何 snooze / 延后到期语义。现状是"一次抑制即永久抑制"，且抑制路径至少两条：任意状态的 Action（`workspace-view.ts:243-253`，含 done/dismissed）或 Finding 被复审为 confirmed/ignored（`workspace-view.ts:217-224` 结合 `packages/contracts/src/zod/growth-map.ts:476-481`）。用户无法设置 Snooze Until / 延后原因 / owner | **缺失（low-medium）**——规格自身标为「当前不存在」(`design.md:67`) 并归阶段 2（`:109`、`implementation.md:1177` Task 14） |
| 陈旧机会必须增加 durable decision state，不能只改排序 | 同上 `:57` | **"不能只改排序"这半句已满足**：满 14 天才入队的独立提醒队列（`workspace-view.ts:273`、`:298`），且 advance（confirm→Action）与 decline（ignored + ≥3 字符 reason，`schema.sql:548`）两类决策已持久化并终止提醒。缺的是 defer/snooze 类持久决策与配套元数据（同上两行）。当前 v0.4 机器权威 `openapi/mvp.yaml:10434-10436` 明确把该提醒定义为「Read-only decision reminder derived from persistent Finding/Action authorities」，即现状是活动权威下的有意设计 | **部分完成（low-medium）**——Stage 2 未交付，非合同违规 |

> 上表后三条（Ledger / Snooze / durable state）是同一块 Stage 2 能力在三份规格条款下的三种表述，工程上是**一个**待办。

### 2.2 已按规格完成（简列，共 40+ 条，按类别归并）

| 类别 | 代表性证据 |
|---|---|
| 问题域边界：只回答四类客户问题，不扩第五类叙事 | `_overview.tsx:1120-1180` 恰四个 section；`e2e/overview-read-model.mock.spec.ts:943` 断言 h2 与 section 各恰好 4 个 |
| 加载态必须终止（data/no_data/unavailable/problem） | `_overview.tsx:439-461` 四支互斥；`:471-514` 队列四态；自动重取由 `:1012-1013,1026,1046-1047` 限制为每 runId 一次 |
| 只读 canonical service projection，无内置 demo/mock | `_overview.tsx:973-992` 三条服务读取；目录内 grep 无 fixture/scenario |
| 冻结审计绑定：结论绑 exact snapshot ids，不重解释为"当时最新" | `_overview-view-model.ts:80-99`（detail.diagnosticRunId 必须等于 portfolioRunId，并逐条 finding 再校验）；`_overview.tsx:998-1001,1010-1011`；测试 `_overview-view-model.test.ts:245` |
| Finding 归属来自 immutable finding_targets，不从可变 summary 猜 | `workspace-view.ts:444-472`；测试 `workspace-view-overview-pagination.test.ts:368` |
| 数据诚实：非 ready 显示「—」不显示 0；无 delta 不合成提升 | `_overview.tsx:465-469`、`:526-540`；测试 `_overview-view-model.test.ts:467` |
| 不把"已连接/有凭据"当数据可用 | `_overview.tsx:539`（文案明写「数据源快照不等于增长 Result」）；priority 卡不消费连接状态 |
| 恰好一条 top Opportunity + 明确 next action；决策/工作卡最多 3 张 | `_overview.tsx:202-236`、`:415-430`；服务端三处各自 slice(0,3)（`workspace-view.ts:298,362,639`）；测试 `_overview-view-model.test.ts:427`、`e2e/overview-read-model.mock.spec.ts:663` |
| Action 创建路径唯一（只经 Finding Review），卡内零 mutation | `_overview.tsx:432-546`；`packages/db/migrations/0001_init.sql:607` UNIQUE(source_finding_id, template_id) |
| 所有按钮通向真实路由，无 toast 代偿 | `_overview.tsx:230-235,267-272,301-308,367-372,542` 全为 next/link；唯一 `<button>` 是 `:480-482` 的真实 refetch |
| 禁止项全部不存在（架构图 / 双循环 / capability migration counts / 模块评分网格 / automation policy lab / 角色切换器 / A0-A14 / slide-phase 叙事） | `_overview.tsx:432-546` 全部 JSX 逐项核对；`packages/i18n/src/messages/zh-CN.json:808-845` 53 个 key 无相关措辞 |
| 不伪造 Ranking/Traffic/AI Citation/Revenue；不给总分 | `_overview.tsx:335-352` 衰减数值全部派生自 GSC 月度 checkpoint（`packages/engine/src/content-decay-monitor.ts:483-532`）；卡内零 score 字段 |
| 前端本地状态不承担生产决策 | `_overview.tsx:1012-1013` 两个 useRef 只抑制重复 refetch |
| 视觉基准（artifact 14.13）：一行两卡 grid、eyebrow+h2+右上小字骨架、页面级 header、队列 hover 与最简空态、响应式 1180/1050/760/640/390 节奏 | `overview.module.css:194-203,61-70,278-288,290-300,626-636,1136-1348`；`_overview.tsx:111-129,1097-1118,488-489`；测试 `e2e/overview-read-model.mock.spec.ts:1056,1086-1102,1111` |
| i18n：中文优先、标准名词保英文、客户内容不被机器翻译 | `zh-CN.json:808-845`；`_overview.tsx:299` `<strong lang={summaryLocale}>`；测试 `e2e/overview-read-model.mock.spec.ts:992` |

---

## 3. URL 组合卡（workspace.overview.portfolio）

### 3.1 未完成 / 偏离

| 规格要求 | 出处 | 现状 | 判定 |
|---|---|---|---|
| 每一条被展示的判断都必须链接到 source、freshness、scope 与 limitation | `docs/plans/2026-07-21-unified-growth-opportunity-design.md:1219`（§16.2，`:1206` 声明为 Slice 1 生产要求） | **限制**：coverage 徽标只渲染 availability 文案（`_overview.tsx:670-678`），契约在非 available 时强制携带的 `coverage.limitations`（`packages/contracts/src/zod/growth-map.ts:85-96`，由 `apps/web/src/lib/services/growth-map.ts:440-471` 真实填充 partialRun/missingSnapshot/staleSnapshot）虽已进入组件（`_overview-view-model.ts:300`），但卡上无渲染点、i18n 无对应 key（`zh-CN.json:864-869` 仅四条 availability 文案）。客户只能自行点「打开增长地图」（`_overview.tsx:680-686`）到增长地图页才看得到同一份 limitations（`_growth-map.tsx:2122,2133`），且该链接文案是通用的 `actions.openGrowthMap`，未标注为"查看覆盖原因"。**新鲜度**：PortfolioSection 全段（`_overview.tsx:548-691`）无任何时间戳，且该端点 meta 本身不含时间字段（`packages/contracts/src/zod/growth-map.ts:721-737`），当前无法从此端点取得快照时间。**作用域**：第 1、2、3 格都有作用域副文案（`:606-610` / `:619` / `:628`，对应 `zh-CN.json:855,856,858,860`），只有第 4 格 `oneByOne`「逐项完成客户决策」（`:637`）不是作用域声明；第 3 格更严重的是口径夸大——findingCount 实际只统计当前加载页（`_overview-view-model.ts:293-296`），文案却称「仅来自当前诊断运行」。**分布条**：`derivationVersion`（`growth-map.ts:301`）未披露；分母不缺（就是同卡第 1 格显示的 loadedUrlCount，`_overview.tsx:601-611,645`），真正未披露的是 `priority.availability !== "available"` 的 URL 被静默排除（`:565-573`），导致四条分布之和 ≠ 已加载 URL 数且卡上无说明 | **部分完成（high，偏重）** |
| 缺数据只能呈现 skipped/inconclusive/no_data/unavailable，绝不能合成 0；降级或不可用覆盖至少带一条 limitation | `authority/implementation-spec-v0.4/MVP-IMPLEMENTATION-SPEC.md:74`、`openapi/mvp.yaml:4014` | `_overview.tsx:670-678` 只渲染 availability 徽标，从不渲染 `coverage.limitations`——而同一读模型在增长地图是渲染的（`_growth-map.tsx:2133`）。`_overview-view-model.ts:290-301` 四个计数恒为整数，`_overview.tsx:623-639` 的「有效 Finding / 待审核 Finding」两格在 coverage=partial/stale（`growth-map.ts:447-467`：GSC/GA4 快照缺失、过期或 run_status=partial，对应规则被 skipped）时仍以无限定整数呈现，客户无法区分"本轮确实零 Finding"与"GSC/GA4 缺失导致规则被跳过"。**范围修正**：生产可达的降级状态只有 partial/stale，meta.coverage 永不为 unavailable（`growth-map.ts:469-471`），e2e 里的「Coverage unavailable」是 mock-only；e2e 四格为 0 是 fixture `data:[]` 所致（partial 场景实测为 1）；卡片级已有缺数据分支（`_overview.tsx:590-596` EmptyBlock）。修复方向是"渲染 limitations + 给受影响计数加覆盖限定"，不是把计数改成 null | **部分完成（medium）** |
| UI 不得加入未在权威中声明的兼容猜测 | `authority/implementation-spec-v0.4/MVP-IMPLEMENTATION-SPEC.md:21-23` | 「有效 Finding / Active Findings」标签断言了一个实现上不存在的 active 过滤：数值取 `item.findingIds`（`_overview-view-model.ts:293` → `growth-map.ts:661`），服务端只按 resolved finding_targets + `findings.last_seen_run_id = 当前 run` 取数（`packages/db/src/repositories/growth-map.ts:645-658,675-683`），**无 finding.active 过滤**；紧邻的「待审核 Finding」用的 reviewableFindingIds 显式过滤了 `finding.active`（`growth-map.ts:662-669`）。active 是权威已声明语义（`openapi.yaml:4343`、`:10394-10398`），同页 decisionReminders 已按 active 过滤（`workspace-view.ts:251`）。**不一致可达**：纯 createDiagnosticRun（`openapi.yaml:605-609`；`diagnostics.ts:414-425` 不建 audit_runs，故永不可读，见 `growth-map.ts:468-474`）完成时 `resolveByKeysExcept`（`packages/db/src/repositories/findings.ts:204-213`）只置 active=false 不改 last_seen_run_id，于是当前可读 run 的 portfolio 会把已解决 Finding 计入「有效」。**不构成缺陷、应剔除的部分**：分布条 3% 最小宽度与 `Math.max(1, loadedUrlCount)` 分母——该条 `aria-hidden`（`_overview.tsx:649`）、真实计数原样展示（`:656`）、除零保护在 count 全为 0 时宽度恒为 0（`:645,652`） | **偏离（low-medium）** |
| 卡片负责回答"当前审计中的 URL 组合、工作量与可继续步骤是什么" | `authority/implementation-spec-v0.4/MVP-IMPLEMENTATION-SPEC.md:139` | "当前审计"成立（`_overview.tsx:974` 读当前可读 generation，`:662-678` 展示 diagnosticRunId 与 coverage）；"工作量"成立（两个去重计数，`:622-639`）；"URL 组合"部分成立——已有两个 URL 计数（`:601-611`、`:613-621`）与跨 URL 四档分布条（`:641-661`），缺的是 **URL 身份**：PortfolioSection（`:548-691`）不渲染任何 normalizedUrl 或页面标签，客户看不出"哪些 URL"构成这个组合；"可继续步骤"部分成立——底部链接已深链到确定性选出的 top URL（`:682` 传 topPage.sitePageId，`:983` 选取，`growth-map/_growth-map-view-model.ts:1274-1278` 消费），但它与优先卡 `:181` 是同一目标、未带 findingId（`_overview-view-model.ts:307` 第三参默认 null），且「待审核 Finding N」没有任何指向审核队列的入口；topPage 为 null 时退化为通用链接（`:594`） | **部分完成（low-medium）** |

### 3.2 已按规格完成（简列）

| 类别 | 代表性证据 |
|---|---|
| 加载态四支互斥终止 | `_overview.tsx:582-596`（pending→Loading / error→Problem / !summary→Empty / else 数据），整页另有 `:1059-1078` 前置门 |
| 取数走 published-generation 协议 + 双 scope | `growth-map.ts:148-179` → `growth-map-generation.ts:83-93` → `packages/db/src/repositories/growth-map.ts:297-483` publishedGrowthAuditRuns CTE；`apps/web/src/app/api/mvp/projects/[projectId]/audit/urls/route.ts:63-92` operatorRoute；SQL 同带 workspace_id + project_id |
| 只取 full-audit 投影，不被 recheck 劫持 | `packages/db/src/repositories/growth-map.ts:468-474` `projection_version = GROWTH_AUDIT_PROJECTION_VERSION`；`packages/db/src/repositories/audit-runs.ts:11` = 'growth-audit.0.3.0' |
| pin 语义：未知/跨租户/未发布不回退 latest；概览不传 pin | `route.ts:23-26` canonical 正则；`growth-map.ts:131-139,163-168`；`growth-map-generation.ts:84-93`；`_overview.tsx:974` 只传 limit |
| query 白名单：不带 view=review，无重复 scalar/未知参数 | `apps/web/src/lib/api/hooks-growth-map.ts:461-472`（URLSearchParams.set）；`route.ts:28-56` 未知参数直接 VALIDATION_ERROR；错误落 ProblemState（`_overview.tsx:584-589`） |
| URL identity 只来自同 Project/Site 的冻结 Crawl 或精确映射的 GSC/GA4 | `packages/db/src/repositories/growth-map.ts:485-489,518-573`；`growth-map.ts:198-215` 要求 canonicalizeUrl 精确等值 |
| 不把"已连接"当数据可用 | `growth-map.ts:440-471` coverage 只看 run_status 与逐 provider 实际 snapshot；测试 `e2e/overview-read-model.mock.spec.ts:934-937`（GA4 Connected 同时显示 No source snapshot） |
| pass/no_data 不生成 Opportunity、不计入机会数 | `growth-map.ts:661` 只来自 resolved targets；`_overview-view-model.ts:297-298` |
| compact program status，不铺大面板；无评分、无 phase、无内部队列 | `_overview.tsx:597-687`（4 格 + 4 条 + 1 行身份 + 1 链接）；`overview.module.css:699-717` |
| artifact 14.13 **版式**对齐：同款 panel 容器、eyebrow+h2+右上小字、三段式分布行（标签+轨道+计数，无百分比/图例/tooltip）、胶囊轨道、卡底 text-button 唯一出口、统一 currentColor 箭头 | `overview.module.css:205-224,296-305,60-70,786-812,851-855`；`_overview.tsx:641-661,680-686,685` |
| 分类归属可解释派生（带 derivationVersion，非 ruleId 正则） | `growth-map.ts:549-585` priorityForUrl 带 `basis{derivationVersion:'max_finding_severity.v1', ...}` |

> **2026-08-04 修正**：上面两行原写作「形态对齐」+「优于 artifact 的 ruleId 正则」，表述不准确。**版式确实对齐，但统计对象换了**：artifact 统计的是开放 Opportunity 的**能力构成**（SEO 内容 / 技术优化 / GEO·AI / 竞品机会 / CRO 转化，宽度按最大类别归一，见 `GenGrowth-Interactive-Artifact.html:13962,13984,13993`），产品统计的是当前加载页 **URL 的最高 Finding 严重度**（紧急 / 高 / 中 / 低，宽度按 loadedUrlCount 归一，`_overview.tsx:565-573,645`）。这是**有规格依据的重定义**（依据见第 7.1 节），不是「对齐」，也谈不上「优于」——两者回答的是不同问题。
| 响应式与可达性 | `overview.module.css:1136-1348`、`:179-190` focus-visible；测试 `e2e/overview-read-model.mock.spec.ts:943`（axe wcag2a/aa）、`:1074-1082`、`:1086-1102` |

---

## 4. 按严重度排序的待办

### T1（high）月度衰减预警缺治理守卫，会对低流量页面误报

- **问题**：`/Users/wzb/Code/nevermore/seo-audit-no-free-quota/packages/engine/src/content-decay-monitor.ts:510-521` 的唯一样本守卫是 `previousFact.clicks > 0`，随后直接以 `changeRatio < -0.2` 判定 traffic_decline；无最低样本量、无季节性抑制、无品牌词豁免。同仓另一条衰减路径 `packages/engine/src/rules/search-decay.ts:22,59` 已实现 `MIN_PREVIOUS_CLICKS = 100`，两条路径守卫不一致。
- **客户看到什么**：某页面 5 clicks 掉到 3 clicks，概览优先卡出现「2026-06 月度衰减预警 · 最近 28 天 clicks 环比下降 40%」+「建议内容复审」（`apps/web/src/app/p/[projectId]/overview/_overview.tsx:493,364`，文案 `packages/i18n/src/messages/zh-CN.json:836-838`），而 Alert 上不显示样本量，客户无从判断这条预警是否值得处理。
- **涉及文件**（绝对路径）：
  - `/Users/wzb/Code/nevermore/seo-audit-no-free-quota/packages/engine/src/content-decay-monitor.ts`
  - `/Users/wzb/Code/nevermore/seo-audit-no-free-quota/packages/engine/src/rules/search-decay.ts`（对齐参照）
  - `/Users/wzb/Code/nevermore/seo-audit-no-free-quota/packages/engine/src/content-decay-monitor.test.ts:284`（现有用例把"只有 previous clicks 为 0 才不触发"固化成契约，需改）
  - `/Users/wzb/Code/nevermore/seo-audit-no-free-quota/apps/web/src/app/p/[projectId]/overview/_overview.tsx:322-375`（补样本量展示，DTO 字段已在 `apps/web/src/lib/api/types.ts:172-176`）
- **难度**：**中**。最低样本量可直接照搬 search-decay 常量（小改）；季节性抑制与品牌词豁免需要新 Policy 配置面与数据（中～大）。若只做"最低样本量 + Alert 展示样本"，是**小**改动，能立刻消除客户可见误报。

### T2（high）URL 组合卡不说明覆盖降级原因，也无新鲜度

- **问题**：`_overview.tsx:670-678` 只渲染 `coverage.availability` 徽标，契约强制携带的 `coverage.limitations`（`packages/contracts/src/zod/growth-map.ts:85-96`，服务端由 `apps/web/src/lib/services/growth-map.ts:440-471` 填 partialRun / missingSnapshot / staleSnapshot）已随 summary 进入组件（`_overview-view-model.ts:300`）却无渲染点，i18n 也无对应 key（`zh-CN.json:864-869` 仅四条 availability 文案）。同时整段无任何时间戳（`_overview.tsx:548-691`），端点 meta 也不含时间字段（`growth-map.ts:721-737`）。
- **客户看到什么**：一枚「部分覆盖」徽标，没有任何原因；四个计数与四条分布条照常以整数呈现，客户无法区分"本轮确实零 Finding"与"GSC/GA4 快照缺失导致相关规则被跳过"。要看原因必须自己点「打开增长地图」（`_overview.tsx:680-686`），而该链接文案是通用的。
- **涉及文件**：
  - `/Users/wzb/Code/nevermore/seo-audit-no-free-quota/apps/web/src/app/p/[projectId]/overview/_overview.tsx`
  - `/Users/wzb/Code/nevermore/seo-audit-no-free-quota/packages/i18n/src/messages/zh-CN.json` 与 `en.json`（新增 limitation 文案 key）
  - 参照实现：`/Users/wzb/Code/nevermore/seo-audit-no-free-quota/apps/web/src/app/p/[projectId]/growth-map/_growth-map.tsx:2122,2133`（CoveragePill + LimitationList 已存在，可复用）
- **难度**：**小**（渲染 limitations + 给受影响计数加覆盖限定，组件已存在可复用）。新鲜度是**中**——端点 meta 无时间字段，需先扩契约。

### T3（medium）读取失败被说成"尚未识别到冻结审计"

- **问题**：`_overview.tsx:1086-1090` 把 portfolioQuery 的所有错误归为 `unavailable`，队列区因此对 500/网络错误也渲染 `zh-CN.json:831`「尚未识别到冻结审计，工作队列暂不可用。」。
- **客户看到什么**：同一张卡（`_overview.tsx:433`）上半部弹出报错与重试按钮（`:441-446`），下半部却告诉他"没有冻结审计"——两条互斥陈述同屏出现。audit-not-found 时文案是对的。
- **涉及文件**：`/Users/wzb/Code/nevermore/seo-audit-no-free-quota/apps/web/src/app/p/[projectId]/overview/_overview.tsx`（`WorkRunState` 类型定义 `:377`，使用点 `:400,466,471,476,484,1086,1126`）、`/Users/wzb/Code/nevermore/seo-audit-no-free-quota/packages/i18n/src/messages/zh-CN.json` 与 `en.json`（新增与 queueUnavailable 并列的 error 文案）。
- **难度**：**小**。在 workRunState 中区分 `auditUnavailable`（`_overview.tsx:975-977` 已有判定）与其它 error，新增一个 `error` 分支即可。

### T4（medium）「有效 Finding」标签断言了不存在的 active 过滤

- **问题**：标签数值来自 `item.findingIds`（`_overview-view-model.ts:293` → `growth-map.ts:661`），无 `finding.active` 过滤；同卡紧邻的「待审核 Finding」却过滤了（`growth-map.ts:662-669`）。触发序列：增长审计 R1 出 Finding → 客户修好后跑纯 diagnostic R2 且规则全通过 → `resolveByKeysExcept`（`packages/db/src/repositories/findings.ts:204-213`）置 active=false 但不改 last_seen_run_id，而纯 diagnostic run 永不可读（`packages/db/src/repositories/growth-map.ts:468-474` 对 audit_runs 是 inner join），概览仍读 R1。
- **客户看到什么**：已经解决的 Finding 仍被计入「有效 Finding」，同时「待审核 Finding」为 0——两个数字讲不同的故事。
- **涉及文件**：`/Users/wzb/Code/nevermore/seo-audit-no-free-quota/apps/web/src/lib/services/growth-map.ts:655-670`、`/Users/wzb/Code/nevermore/seo-audit-no-free-quota/packages/i18n/src/messages/zh-CN.json:859`。
- **难度**：**小**。要么让 findingIds 侧对齐 active 过滤，要么改标签为口径准确的表述（需同步契约描述）。二选一属产品判断。

### T5（medium）陈旧决策提醒的 SLA 写死、无治理元数据

- **问题**：`/Users/wzb/Code/nevermore/seo-audit-no-free-quota/apps/web/src/lib/services/workspace-view.ts:196` 硬编码 14 天，唯一使用点 `:273`，函数入参 `:233-239` 不接受项目配置；DTO（`workspace-view.ts:156-166`、`apps/web/src/lib/api/types.ts:148-158`）无 owner / snoozeUntil / reason / lastDecisionAt。
- **客户看到什么**：只有一句「待决策 · 已搁置 {days} 天」（`zh-CN.json:832`），不能改 SLA、不能指派负责人、不能记录延后原因。
- **涉及文件**：上述两个文件 + `/Users/wzb/Code/nevermore/seo-audit-no-free-quota/openapi/mvp.yaml:10415-10436`（DTO 契约）。
- **难度**：**中**。仅把 14 天做成项目级配置是**小**；补 owner/reason/lastDecisionAt 需要扩契约与迁移。

### T6（low-medium）URL 组合卡看不到"哪些 URL"，可继续步骤未指向审核队列

- **问题**：PortfolioSection（`_overview.tsx:548-691`）不渲染任何 normalizedUrl 或页面标签（该两符号在本文件只出现在优先卡 `:218-219`、衰减告警 `:331`、结果行 `:536`）；底部链接虽已深链 top URL（`:682`、`:983`、消费方 `growth-map/_growth-map-view-model.ts:1274-1278`），但与优先卡 `:181` 是同一目标、未带 findingId（`_overview-view-model.ts:307`），且「待审核 Finding N」无任何点入审核队列的入口。
- **客户看到什么**：知道"有 12 个 URL、8 个有机会、5 条待审核"，但一个 URL 名字都看不到；点唯一出口只能落到与优先卡相同的位置。
- **涉及文件**：`/Users/wzb/Code/nevermore/seo-audit-no-free-quota/apps/web/src/app/p/[projectId]/overview/_overview.tsx`、`/Users/wzb/Code/nevermore/seo-audit-no-free-quota/apps/web/src/app/p/[projectId]/overview/_overview-view-model.ts:304-313`。
- **难度**：**中**。加 URL 身份会撞到既有断言（`_overview-accessibility.test.ts:41-45` 硬断言 portfolioMetrics 恰好 4 组 dt/dd）与 artifact 基准的分布条形态，需要产品先定形态；给「待审核 Finding」加一个带审核意图的深链是**小**。

### T7（low-medium）Stage 2 决策台账（defer / snooze / owner / 到期复现）未开工

- **问题**：`advance`/`decline` 已由 `app.findings` + `app.finding_review_events`（`authority/implementation-spec-v0.4/schema.sql:519,534-547,571-586,591`）+ `openapi/mvp.yaml:1503` reviewProjectFinding 持久化实现并驱动抑制（`workspace-view.ts:243-257`）；缺的是 `defer`/`snooze` 枚举、Snoozed Until、Owner，以及到期重新冒泡。当前是"一次抑制即永久抑制"，且抑制路径至少两条（任意 Action `workspace-view.ts:243-253`；复审为 confirmed/ignored `:217-224` 结合 `packages/contracts/src/zod/growth-map.ts:476-481`）。needs_more_data 不抑制（`:220-222`），最接近"延后"的状态反而持续重复冒泡。计划中的 `packages/db/migrations/0027_opportunity_decision_ledger.sql` 从未创建。
- **客户看到什么**：提醒卡内没有"推进/延后/不做"控件，只能跳到 Growth Map（`_overview.tsx:300-307`）；一旦在别处产生任意 Action 或标记 confirmed/ignored，这条提醒就永远消失，无法设定"两周后再提醒我"。
- **涉及文件**：`/Users/wzb/Code/nevermore/seo-audit-no-free-quota/apps/web/src/lib/services/workspace-view.ts`、`/Users/wzb/Code/nevermore/seo-audit-no-free-quota/packages/db/migrations/`（需新建 ledger 迁移）、`/Users/wzb/Code/nevermore/seo-audit-no-free-quota/openapi/mvp.yaml`。
- **难度**：**大**（新决策类型 + 到期调度 + 契约 + UI 控件）。
- **口径说明**：这是 Stage 2 计划项（`docs/plans/2026-07-27-nevermore-keyword-growth-governance-design.md:109,575`、`...-implementation.md:1177` Task 14），当前 v0.4 机器权威 `openapi/mvp.yaml:10434-10436` 明确把该提醒定义为只读派生。**不应按 v0.4 交付缺陷记账**，但需要产品负责人显式确认它仍在 Stage 2 队列里。

### T8（medium）概览缺「审核竞品候选」入口

- **问题**：PRD `docs/plans/2026-07-21-unified-growth-opportunity-prd.md:409` 明确要求概览「有明确的 `编辑产品档案` 与 `审核竞品候选` 入口」。前者已实现（`overview.customer.actions.editProfile`），后者**全屏不存在**：`_overview.tsx` 全文零竞品链接，竞品只在已确认背景卡以计数形式出现（`:872-877`）；服务层 `apps/web/src/lib/services/workspace-view.ts` 的 projection 资源类型只有 actions / artifacts / findings / snapshots，无 competitor reader。
- **客户看到什么**：知道「已确认竞品 N 个直接 · M 个间接」，但无法从概览进入竞品审核；artifact 左卡的「确认 GuideCX 的竞品范围」这类待决策项在产品里没有任何入口。
- **涉及文件**（绝对路径）：
  - `/Users/wzb/Code/nevermore/seo-audit-no-free-quota/apps/web/src/app/p/[projectId]/overview/_overview.tsx`
  - `/Users/wzb/Code/nevermore/seo-audit-no-free-quota/packages/i18n/src/messages/zh-CN.json` 与 `en.json`（新增 action key）
- **难度**：**小**（加一条到竞品库的深链即可）。但需产品先定：走 hero 卡还是走队列项。若要做成一等队列项，需扩 workspace-view projection 读取竞品候选，难度升为**中**。

### T9（medium）衰减预警可占满全部三格，饿死待决策工作

- **问题**：`/Users/wzb/Code/nevermore/seo-audit-no-free-quota/apps/web/src/app/p/[projectId]/overview/_overview.tsx:415-425` 的名额分配是固定优先序：`contentDecayAlerts.slice(0, 3)` 先占，剩余额度才给 `decisionReminders`，再剩才给 `projectWork`。**三条衰减预警就能让任何待决策工作项都不出现。**
- **客户看到什么**：「同一次冻结审计的全项目工作」区域被三条内容复审建议填满，真正待客户决定的 Opportunity/Action 一条都看不到。
- **与 T1 的叠加风险**：衰减预警恰恰是 T1 里那个没有最低样本量守卫的检测器产出的。低流量站点会同时触发「大量误报预警」+「预警把工作项挤光」两个缺陷，放大成客户可见的严重问题。
- **难度**：**小**（给三类队列项各留配额，或让衰减预警不占决策格、单独成区）。属产品判断。

### T10（high）URL 组合卡丢失了「机会类型构成」，且与 hero 信息重复

- **问题**：右卡四条分布统计的是**当前加载页 URL 的最高 Finding 严重度**（`apps/web/src/app/p/[projectId]/overview/_overview.tsx:565-573`），回答「有多急」——而 hero 卡（`:202-236`）已经把最高严重度那一条整条端出，两者信息**部分重复**。artifact 右卡回答的「接下来的活是哪几类」（`GenGrowth-Interactive-Artifact.html:13962,13984,13993`）在产品里整个丢失。
- **合同里有现成数据，只是没接**：`GET /projects/{projectId}/audit` 返回 `lenses`（恰 3 条）与 `modules`（恰 8 条），每条带 `findingCount` / `evidenceCount` / `coverageState` / `limitations`，**全项目口径**，且强制包含 honest state 为 `no_data` 的条目（`authority/implementation-spec-v0.4/openapi.yaml:1892,1899-1900,5102-5147`）。路由已实现（`apps/web/src/app/api/mvp/projects/[projectId]/audit/route.ts`），前端 fetcher 与 query builder 已存在（`apps/web/src/lib/api/hooks-audit.ts:96,118`）。**概览从未调用它。**
- **Owner 已裁决方案（甲）**：
  1. 分布条改为 3 个 frontstage lens（`site_health` / `search_ai_visibility` / `demand_competition`），数据取 `lenses[].findingCount`；
  2. 该区块给独立小标题与**全项目**作用域标注；
  3. 恢复「共 N 条」总计，由 `lenses[].findingCount` 求和得出（合法，见 7.3 更正）；
  4. 四个统计格保持**当前加载页**口径不动，两块之间以标签明确隔开；
  5. 优先级档位分布条**移除**（信息由 hero 承担）。
- **必须处理的作用域混用**：四个统计格来自 URL portfolio（分页，limit 100），lens 分布来自 audit 投影（全项目）。同卡两种口径**必须分区标注**，否则就是本报告 T2 正在批评的那类不诚实。注意 URL 计数天然无法全项目化——合同刻意不提供项目级 URL 总数（`openapi.yaml:4430`），所以整卡统一口径不可行，只能标注。
- **待确认（文案决策，非工程）**：三个 lens 在 `packages/i18n` 中**无既有中文标签**，仅在 `docs/plans/2026-07-21-unified-growth-opportunity-design.md:556,573,588` 有英文名。建议译名（需 Owner 确认）：`site_health` → 站点健康；`search_ai_visibility` → 搜索与 AI 可见性；`demand_competition` → 需求与竞争。
- **涉及文件**：
  - `/Users/wzb/Code/nevermore/seo-audit-no-free-quota/apps/web/src/app/p/[projectId]/overview/_overview.tsx`
  - `/Users/wzb/Code/nevermore/seo-audit-no-free-quota/apps/web/src/app/p/[projectId]/overview/_overview-server.ts`（新增 audit 投影读取）
  - `/Users/wzb/Code/nevermore/seo-audit-no-free-quota/packages/i18n/src/messages/zh-CN.json` 与 `en.json`
- **难度**：**中**。端点、路由、fetcher 全部现成，主要工作是概览接入 + 新增一个加载/错误/no_data 分支 + 作用域标注 + i18n。注意新分支同样要满足「加载态必须终止为 data / no_data / unavailable / problem」。
- **不做的部分**：不复原 artifact 的 `CRO 转化` 类别——合同 8 个 module 中无同义项，`compliance_measurement` 语义不同，硬套即造假。

### T11（medium）hero 卡把 Rule 与证据细节摆在概览首屏，违反 PRD 的 Drawer 要求

- **问题**：PRD `docs/plans/2026-07-21-unified-growth-opportunity-prd.md:283` 逐字要求「客户侧默认展示结论、正文和下一步，**Source、Rule、Revision、Manifest 与 QA 细节放入可展开 Drawer**」。现行 hero（`apps/web/src/app/p/[projectId]/overview/_overview.tsx:202-236`）把 rule code（`SEARCH-CTR-004`）与证据数（「1 条证据」）直接渲染在概览首屏，无任何折叠或 Drawer。第三枚 chip「来自当前冻结审计」与卡头右上角的范围声明（`priority.maxItems`）语义重复。
- **第一轮为何漏判**：初版把 hero 记为「升级了证据边界」，只对照了设计文档 §8.1 的「one top Opportunity」结构要求，未对照 PRD R5.8 对**信息密度与折叠层级**的要求。
- **建议改法**：hero 保留结论（大字标题）、对象（页面名 + URL）、决策状态（严重度 + 复审状态两枚药丸）、下一步（按钮）；移除三枚 chip。Rule 与证据不是删除，而是回到规格给它们指定的位置——「查看 Opportunity」通向的详情页本就承载证据分组（PRD `:264` 「Opportunity detail 的证据分组」）。
- **边界（勿改过头）**：**hero 本身必须保留**。设计文档 `2026-07-21-unified-growth-opportunity-design.md:701-702` 把「one top Opportunity with a clear next action」与「up to three decision or work cards」**并列**为两条必需内容；artifact 把两者合并为单一三行列表，产品拆成 hero + 队列才是符合规格的。T11 改的是 hero 的密度，不是它的存在。
- **涉及文件**：`/Users/wzb/Code/nevermore/seo-audit-no-free-quota/apps/web/src/app/p/[projectId]/overview/_overview.tsx`
- **难度**：**小**（删三个 chip 及其 i18n 引用）。**无测试阻力**：`e2e/overview-read-model.mock.spec.ts:232` 的 `ruleId` 仅为 fixture 取值，全套件无任何断言要求 rule code 或证据数出现在概览 DOM 中。

---

## 5. 测试空白（可见分支无测试守护）

| 空白分支 | 证据 |
|---|---|
| 概览队列的 unavailable 与"读取失败"区分 | `e2e/overview-read-model.mock.spec.ts`、`e2e/frontend-error-states.mock.spec.ts` 均无覆盖；全仓 grep `queueUnavailable/工作队列暂不可用` 仅命中 `zh-CN.json:831`、`en.json:831`、`_overview.tsx:486` 三处 |
| 衰减检测的最低样本、季节性、品牌词 | `packages/engine/src/content-decay-monitor.test.ts` 共 16 个用例无一涉及；`:284`「does not trigger at exactly 20 percent or when the previous click denominator is zero」反而把"只有 previous clicks 为 0 才不触发"固化成契约 |
| coverage 降级时的 limitation 文本 | `e2e/overview-read-model.mock.spec.ts:201-208` 为 partial 场景提供了非空 limitations，但 `:924` 只断言 `toContainText("Partial coverage")`，从未断言限制文本；单测 `_overview-view-model.test.ts:412,423` 只断言 coverage 原样透传 |
| coverage 降级时计数不降级已被"锁死" | `_overview-view-model.test.ts:391-424` 明确断言 coverage=partial 时四个计数照常返回 2/2/1，即修复 T2 必须同步改测试 |
| active=false 但 last_seen_run_id=当前 run 的 Finding | `e2e/overview-read-model.mock.spec.ts:708,875` 只断言标签与计数，从未构造该组合 |
| Snooze 到期复现 | `apps/web/src/lib/services/__tests__/workspace-view-overview.test.ts:232-263` 只验证永久抑制，无任何到期复现用例 |
| 无治理字段的 DTO 被测试固化 | `workspace-view-overview.test.ts:218-229` 断言的正是无 owner/snoozeUntil/reason 的 DTO，并把 14 天阈值写进 fixture |
| portfolio 指标格数量被硬断言 | `_overview-accessibility.test.ts:41-45` 断言 portfolioMetrics 恰好 4 组 dt/dd——T6 增加 URL 身份或第五格会直接撞红 |

---

## 6. 不算缺陷的差异（已裁决，请勿误判）

1. **配色差异**：产品用 `--sf-surface / --sf-paper-deep / --sf-coral / --sf-cobalt / --sf-mint` 语义 token（`apps/web/src/app/p/[projectId]/overview/overview.module.css:204-256, 214-235, 242-246`），与 artifact 14.13 的具体色值不同。按 `docs/plans/2026-07-25-slice2-task78-decisions.md` 裁决，**配色差异不计缺陷**，只要求保留 warm paper / dark ink / cobalt 的编辑-运营气质，该气质已保留。
2. **字号高于 artifact 基准**：`textLink` 为 15px（`overview.module.css:116-135,166-177`），artifact 基准为 13px。这是为满足中文可读性要求的**有意上调**，不计缺陷。
3. **卡头 min-height 归零"未实现"**：artifact 在 1024 断点把卡头对齐用的额外高度归零（`styles.css:1344-1355`），产品实现从未设置卡头 min-height，因此**无需归零**，不是遗漏。
4. **优先级分布条的 3% 最小宽度与 `Math.max(1, loadedUrlCount)` 分母**：该条 `aria-hidden="true"`（`_overview.tsx:649`）为纯装饰，真实计数以 `<strong>{count}</strong>` 原样呈现（`:656`），除零保护在 count 全为 0 时宽度恒为 0（`:645,652`）。既非自造回退值也非展示未声明口径，**已从缺陷清单剔除**。
5. **分布条无百分比、无图例、无 tooltip**：这是 artifact 基准明确的三段式 DOM 形态（`client-app.js:483`），**是对齐不是缺失**。
6. **portfolio 卡不提供逐 URL 下钻**：`MVP-IMPLEMENTATION-SPEC.md:165-166` 的"选择任一行加载该 URL 详情"归属 §4.1 URL portfolio（父章节 `:144` 增长地图），已完整实现在 `apps/web/src/app/p/[projectId]/growth-map/_growth-map.tsx:419-510,1809-1847`。概览卡按 `zh-CN.json:853`「完成一次审计后，才能查看 URL 层级的机会」显式把下钻移交增长地图，**不是概览的缺陷**（T6 说的是"看不到 URL 名字"，不是"不能逐行展开"）。
7. **priority 卡的结果区只有二态**：`_overview.tsx:515-543` 只区分 verified / unavailable，而非 insufficient_data / not_observed / provider unavailable / 真实 0。四态要求归属 §7 效果追踪（`MVP-IMPLEMENTATION-SPEC.md:250-258`），且冻结合同 `packages/contracts/src/zod/growth-map.ts:336-359` 的 `GrowthMapUrlDelta` 只有 unavailable/available 两个判别值——在概览要求四态等于发明合同外状态。当前实现是诚实降级（文案明写「数据源快照不等于增长 Result」），**不计缺陷**。
8. **priority 卡不展示 click/position/conversion 的 provider/snapshot/observedAt**：该 provenance 要求归属 §4.1 增长地图（`MVP-IMPLEMENTATION-SPEC.md:169-170`），已实现于 `_growth-map.tsx:576-641,1160-1179`。概览按设计不展示 URL 级指标，条款未被触发。

以下曾被怀疑但已逐条核实无问题，不构成缺陷：REQ-N17（指标 provenance，规格归属增长地图且已在该处实现）、REQ-N27（结果四态，同上且与冻结合同冲突）、REQ-C04（隐藏分母，分母与分子两个绝对数同屏可读，页边界副文案已声明两次）、REQ-B33（no_data 渲染成 0/0%，规格归属 Growth Map view-model 且已实现，界面上不存在 0% 文本）、REQ-N15（逐行选择 URL 详情，规格归属增长地图且已完整实现）。
---

## 7. artifact 保真度复评（2026-08-04 第二轮，含 codex 交叉评审）

第 1–6 节按 **spec 文档**验收。本节按 **artifact 基准**验收，回答"这两张卡是不是把 artifact 忠实落地了"。

基准文件：`/Users/wzb/Code/nevermore/signalframe-mvp-app/docs/artifacts/GenGrowth-Interactive-Artifact.html`（单文件自包含版，`renderOverview` 在 `:14230-14265`，与 `/Users/wzb/.codex/visualizations/2026/07/20/019f7ff0-3874-7623-90f3-1ebdea7c313f/client-app.js:461-500` 逐字一致）。

**总判断（Claude 与 codex 独立得出、结论一致）**：这两张卡不是"把 artifact 原样接上真实数据"，而是被**重定义为"当前冻结审计的 URL / 工作摘要"**。方向上有 v0.4 合同依据，但按 artifact 基准验收，左右两卡都有实质走样。

### 7.1 右卡分布维度：能力分类 → 优先级档位

> **2026-08-04 更正。本节初版判定为「规格强制、照搬会同时违反 PRD 与机器合同」，该判定错误，三条依据全部站不住。**Owner 质疑后复查得到下面的正确结论，据此新增 **T10**。

**正确判定：这是一次未经规格要求的信息降级。合同里有现成的分类口径，只是概览没接。**

初版三条依据的逐条更正：

| 初版说法 | 实际情况 |
|---|---|
| PRD `:261-266` 禁止概览出现 Lens | **过度解读**。R5.7 说的「四个 Capability Lens」是 Deep Dive 能力域（Product/Diagnosis、WebTech、Search/GEO、Landing），不是 artifact 那五类；且紧随其后的「明确禁止」清单全部针对**导航 / Wizard / 流程叙事**（不在一级侧栏增加、不做成固定顺序 Wizard、不用 phase 宣告当主叙事）。一个只读分布图既非导航亦非流程，不在禁止范围内 |
| 合同里没有分类计数数据 | **有，且前后端都已实现**。`GET /projects/{projectId}/audit`（`openapi.yaml:1892`，路由 `apps/web/src/app/api/mvp/projects/[projectId]/audit/route.ts`，前端 `apps/web/src/lib/api/hooks-audit.ts:96,118`）返回 `lenses`（恰 3 条）与 `modules`（恰 8 条），每条都带 `findingCount` / `evidenceCount` / `coverageState` / `limitations`，且契约强制「including modules and lenses whose honest state is no_data」（`openapi.yaml:1899-1900`），**口径为全项目**、由该 run 的 Findings 派生 |
| 删掉「共 N 条」是合同强制 | **作用域搞错了**。`intentionally exposes no project-wide total`（`openapi.yaml:4430`）写在 **URL portfolio** 端点上。audit 投影本身即全项目口径，从它派生总数不违反任何条款。详见 7.3 更正 |

**唯一真实的限制**：artifact 五类中 `CRO 转化` 在合同里无对应项（8 个 module 中语义最近的 `compliance_measurement` 不同义，不得硬套）。其余四类均可原样还原：

| artifact | 合同对应 |
|---|---|
| 技术优化 | lens `site_health`（或 module `performance` / `accessibility` / `best_practices_security` / `technical_search`） |
| SEO 内容 | module `content_intent` |
| GEO / AI | module `ai_geo` |
| 竞品机会 | lens `demand_competition` |
| CRO 转化 | **无对应** |

**信息损失是实质的**：现行「紧急 / 高 / 中 / 低」回答「有多急」，与 hero 卡**部分重复**——hero 已把最高严重度那一条整条端出。而分类构成回答「接下来的活是哪几类」，是 hero 无法覆盖的非冗余信息。

### 7.2 左卡：artifact 三类同权待决策项 → hero + 小队列

**判定：升级了证据边界，丢了 artifact 最有价值的一点——异质决策对象在同一张卡里同等可见。**

artifact 左卡是三种对象平权入队（`GenGrowth-Interactive-Artifact.html:14222`：`reviewArtifacts` / `candidateCompetitors` / 未审核 Findings，每类先取一项再补足，上限 3）。三类在产品里的实际可达性：

| artifact 队列类型 | 现状 | 证据 |
|---|---|---|
| 交付物待审 | **不能作为一等队列项** | `topActions` 只筛 Action、按 priorityBand 取 3，全程不看 `artifact.status`（`apps/web/src/lib/services/workspace-view.ts:346-363`）；Artifact 只为首个 Action 生成 `deliveryFocus` |
| 竞品候选 | **完全进不来** | `workspace-view.ts` 零 competitor reader（projection 资源类型仅 actions/artifacts/findings/snapshots）；`_overview.tsx` 只在已确认背景卡显示计数（`:872-877`）。→ 已记为 **T8** |
| 证据审核（未审核 Finding） | 能当 hero；当队列项要**等 14 天** | hero 路径 `_overview-view-model.ts:80-99`；队列路径 `workspace-view.ts:270-272` `staleForDays < 14` 直接丢弃 |

另有一条 artifact 里不存在的新对象——`contentDecayAlerts`——反而拥有最高占位优先级，可占满全部三格。→ 已记为 **T9**。

### 7.3 两处 header/meta 改动

| 改动 | 判定 | 依据 |
|---|---|---|
| 右卡删去「共 N 条」 | **初版判「合同强制」，已更正为：仅在从 URL portfolio 取数时成立** | `openapi.yaml:4430` 的 `It intentionally exposes no project-wide total` 是 **URL portfolio 端点**的约束——从该端点算全站总数确实违规。但 audit 投影（`openapi.yaml:1892`）本身即全项目口径，从它的 `lenses[].findingCount` 求和得到的总数**完全合法**。见 T10 |
| 左卡「按客户决策顺序」→ 加载范围声明 | **变好，而且必须改** | 现在**根本没有**跨对象的统一决策排序器：是 decay 先占位、reminder 补、Action 再补的固定序（`_overview.tsx:415-425`），仅 reminder 内部排序（`workspace-view.ts:290-297`）。保留 artifact 那句文案等于撒谎 |

### 7.4 本节方法与分歧

- Claude 与 codex 独立评估，四个问题上无实质分歧。
- codex 独有贡献：`FrontstageLensId` 三类枚举、`openapi.yaml:4430` 的 no-project-wide-total 合同声明、衰减预警占满三格的名额分配风险、交付物待审无法作为一等队列项。
- Claude 独有贡献：PRD `:261-266` 的 Lens 白名单（codex 判为"未找到裁决"，实为存在否定性约束）、PRD `:409` 的「审核竞品候选」入口硬要求（T8）。
- 所有 load-bearing 引用（`openapi.yaml:4430` / `:5088`、`_overview.tsx:415-425`、`growth-map.ts:650-670`、`content-decay-monitor.ts:510-521`、`workspace-view.ts:346-363,270-272`）均已逐条打开原文复核，非转述。
