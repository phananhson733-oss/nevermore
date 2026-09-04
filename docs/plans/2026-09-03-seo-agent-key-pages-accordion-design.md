# SEO Agent 结果面：关键页 + 问题手风琴 设计

Date: 2026-09-03
Authority baseline: `main@c7dc27cc6f9c1218d83e6f0131804036949ca646`
Status: Owner 已批准三块设计与方案 A（2026-09-03）；内容逻辑审计结论见 §8

## 1. 目标

把 SEO Agent 的结果面从「检查项优先 + 单选建议面板」改成「问题优先手风琴」，页面级结论从只判目标 URL 一页扩到一组关键页，并把 On-Page Checker 独有的检查并入同一张目录。三件事共用一份报告、一套词汇、一个列表。画像阶段（Stage 01）本轮不动。

## 2. 已定裁决

Owner 在 2026-09-03 逐项拍板，均取推荐项：

| 分叉 | 裁决 |
|---|---|
| 「只保留关键页面」落在哪一层 | 页面级结论扩到关键页集合；抓取仍全站，站点级 31 项要总体才真 |
| 内容逻辑审计范围 | 判定层与建议层都审 |
| On-Page Checker 如何进入 | 作为页面级来源并入同一份报告；Checker 工具页保留独立 |
| 界面保真度 | 保留 P0/P1/P2 编号；不做 mock 的 4 个快捷按钮；行级不渲染 illustrative |
| 关键页结论怎么算 | 方案 A：多目标求值。否决 B（每页重跑 Checker，会打爆每 IP 每小时 12 次的抓取闸门，`crawl-gate.ts:35` 的 `CRAWL_IP_MAX`）和 C（抓取只抓关键页） |

2026-08-21 的手风琴十项裁决（artifact `ace0ddc7`）继续有效，除 D7 被本次改写：行首允许 P0/P1/P2，且必须与 blocker/warning/tip 一比一对应，不引入第二套刻度。

## 3. 现状事实（已核实）

- Owner 给的截图是 2026-08-20 的 codex mock（`~/.codex/visualizations/2026/08/20/01a01d53…/seo-agent-issue-accordion-mock/index.html`），不是线上页面。mock 文案「展开当前筛选」「已排除的检查」在 `origin/main` 零命中。
- 手风琴的实现在分支 `feat/agent-issue-accordion`（worktree `onpage-keyword-evidence`，HEAD `8e7fd34b`），5 个提交未合并：`efc5e38e` 投影层与逐题 AI 文本、`bc30df46` 手风琴取代单选面板、`5cb7eb0c` e2e、`4c014b27` 跨模型评审 7 处修复、`8e7fd34b` 验收 5 处修复。共 15 文件 +3794/−1357，其中删除了 `agent-recommendations.tsx` 及其测试。
- 该分支落后 main 354 个提交。把 5 个提交按序 cherry-pick 到 `origin/main`：第 1 个干净落地，第 2 个在 `agent-results.test.tsx` 有 1 处冲突块。main 侧自分叉点起改了 `agent-results.tsx`（+45）、`agent-workbench.tsx`（+314，账号网站画像接入）。
- 线上结果面 = `AgentResults` 头部（四格事实卡）→ `AgentDiagnosis`（范围切换、组导航、三轴检查台账、PolicyEditor 未挂载）→ `AgentRecommendations`（单选一条建议展开一个面板）→ 排名披露。
- 抓取预算 `PUBLIC_TOOL_SYNC_CRAWL_BUDGET`：2000 URL、深度 6、240 秒、每主机 250ms 间隔（实际可达约 950 页）。页面级 49 项只判目标 URL；站点级 31 项聚合全部抓取页。
- `evaluateAgentAuditScope(scope, input)` 的 `input` 已带 `targetUrl / targetInspected / inspectedTargetUrl`，页面级记录多数是 `every_collected_page` 或 `conditional_subset` 总体、按页有观测，所以换一个 URL 再求值一次不需要每页提取物。但 `conditional_subset` 记录的「未观测即通过」判据借的是目标页的 `targetTested`，对别的页不成立，见 §5.3 的裁决。
- GEO 站点索引（`geo-tools/site-index.ts`）：`GEO_SITE_INDEX_LIMITS.pages = 24`、45 秒；首页永远第一，其余按画像 coreFeatures 对「路径分词 + 锚文本」打分排序，整词命中 1000 分、单词命中 1 分。
- On-Page Checker 与 Agent 共用 `handleAgentAuditRequest`（`ON_PAGE_CHECK_DEPENDENCIES` 只改账本身份），Checker 的 40 项检查是营销站客户端的评分层（`lib/on-page-checker/checks-*.ts`），读 `targetPageExtract.declared/response`。
- 缓存 payload 版本 `seo_audit.sitewide.v17`。Agent wire 守卫 `hasCompleteNeutralRecordLedger` 要求记录数**等于**台账长度且每个 id 恰好出现一次；新增记录而不 bump 版本，1 小时内的旧缓存行会被判 502。
- `AgentAuditResult` 不含 `pages`，客户端拿不到抓取页列表；`pages` 在缓存 payload 里（`isSeoAuditPayload` 校验 `result.pages`），字段含 `url / subjectUrl / finalUrl / depth / finalStatus / contentType / title / metaDescription / inboundLinks / sitemapMember`。
- `agent-result-helpers.ts` 已有 `AgentRecommendationPriority = "P0" | "P1" | "P2"`，手风琴分支只是没渲染。
- 画像草稿 `AgentProfileDraft` 已含 `targetQuery: string` 与 `pageType`，但 `agent-workbench.tsx:285-298` 只在从 On-Page Checker 带 handoff 进来时才上送 `targetQueries / pageRole`。直接打开 Agent 运行时，依赖目标词或页面类型的 8 项（2.3、3.2、3.4、3.5、3.6、4.2、4.3、7.2）一律 excluded，而诊断卡仍按画像页面类型渲染 H2/H3 预设区间、Stage 04 仍显示「已确认目标词」。

## 4. 呈现层

### 4.1 头部

三行：
1. 目标 URL、抓取时间、可用性与缓存芯片（沿用）。
2. 一行事实：`抓取 {pagesInspected} 页 · 关键页 {keyPageTotal} · 已评估 {evaluatedChecks}/{totalChecks}`（后两个是本次运行有结论的检查项数与目录总数，不是页数）。
3. 四个计数芯片：`P0 阻断 · n`、`P1 警告 · n`、`P2 建议 · n`、`来源受限 · n`，加「全部问题 · n」；芯片即筛选器，默认「全部问题」。

四格事实卡（页数 / 链接数 / 未采集 / 记录数）、采集边界说明、最终源站、停止原因、`evidenceRecordsBoundary` 文案全部移入一个默认折叠的 `<details>`「采集边界」。

删除：`AgentDiagnosis` 的站点级/页面级范围切换、组导航、检查台账、`AgentRecommendations` 单选面板、排名披露块。手风琴是同一批检查唯一的呈现面（D1）。

### 4.2 手风琴行

一行 = 一个检查项（跨范围、跨关键页合并）。

- 行首徽章：`P0 · 阻断项` / `P1 · 警告` / `P2 · 建议` / `来源受限`。映射固定：blocker→P0、warning→P1、tip→P2，与 `agent-result-helpers.ts` 既有的 `AgentRecommendationPriority` 同一张表，不再第二处定义；`excluded` 且 `truth = source-gated` → 来源受限行（investigation 模式）。文字与颜色双编码。`RESULT_PRIORITY[...] ?? "P2"`（`agent-result-helpers.ts:202`）是 fail-open 兜底，所以未识别状态的隔离判定（§5.4 行 0）必须先于徽章渲染执行，未知 result 绝不能落成 P2 建议行；测试要钉这个次序。
- 标题：检查项标题；副标题：一句判定摘要（沿用分支的 `issueLabel` 语义）。
- 行内标签四个，全部来自既有字段：范围标签（`站点级` / `关键页 {keyPageHitCount}/{keyPageTotal}` / 后缀 `另有 {rest} 页`，字段名以 §5.5 为准）、真值态芯片（`observed` / `not-observed` / `partial` / `source-gated` / `unavailable`，D3：禁 illustrative）、数据来源（`check.dataSource`）、归属 Agent（SEO / Tech，D6）。
- 展开区块沿用分支 `agent-issue-detail.tsx` 的七块：判定规则、本次测量（关键页逐页一行）、受影响目标、证据链、可落地解决方案、验证步骤、影响风险限制；来源受限行改为「证据边界 / 什么能回答它 / 需要的数据来源」，不渲染修复指令。
- 每行「复制文本给 AI」，沿用 `agent-issue-prompt.ts`（repair / investigation 双模式），受影响 URL 先列关键页、上限 10、溢出计数；禁含 cookie、账号、原始 HTML、密钥、发明路径。
- 控件只保留：五个筛选芯片、「展开当前筛选」、「全部收起」。mock 的「打开站点阻断项」等 4 个快捷按钮不做（D10）。
- 排序只有一份，按代码写死：严重度 → 命中关键页数（新增，本文唯一新键）→ 有证据记录（`evidenceAvailable`）→ 归属本 Agent（`primaryForAgent`）→ 全站受影响数（`reach`）→ 目录原序。后四级就是 `analyzeAgentRecommendations` 现有的顺序，手风琴分支的 `buildAgentIssueModel` 直接吃 `analysis.ranked`，只在其前插入关键页命中数一级。

### 4.3 底部与空态

- 「已通过的检查 · n」「已排除的检查 · n · 缺少所需输入或来源」两个折叠区；排除原因逐行可见。
- 「仅观测 · n」折叠区：结果态为 `observed-only` 的检查，直接展示测得数值，不带严重度，不进筛选芯片计数，不进 AI 交接。2026-09-04 将关键词位点类 4.2/4.3 移交 On-Page SEO Checker 后，成员是 `DECLARES_NO_JUDGEMENT` 正则命中的**全部 8 项**（正则为 `Internal heuristic only|Display only|Listed for review, not judged`）：A7、B4、B5、C6、D7、E4、4.4、6.5。其中 A7、C6、D7、6.5 原为 P2 建议行，改后迁入本区并退出 AI 交接，这与它们自己写的「仅列出待复核，不作判定」一致，是有意变化。
- 「隔离」区：任一轴出现本构建不认识的枚举值时整行进隔离，带「未识别状态」芯片，不计入干净（D2、D9）。
- 干净站点（0 可行动）显式空态；零评估显式空态（分支已有 `clean` 与 `clean.notEvaluated`）。

### 4.4 不动的部分

Stage 01 画像面板、画像确认、来源发现、账号网站画像导入与回写全部保持现状。`/agents/tech` 焦点路由照旧复用同一 workbench。On-Page Checker 工具页的 IA、交互与 0–100 总分的机制与刻度不改（评分项集合按 §6 调整，个别页面的分值会因此变化）；它的评分层跟着 §6 与 §8.2 改三处：文本/代码比降为 observation（F10）、8.7/8.8/4.6 的常量、以及 8.7 的**整条判据**改为从 `@sf/public-tools` import、2.1/2.4 文案注明「Agent 侧记为提示」（F6）。

## 5. 数据层

### 5.1 关键页候选（服务端投影，每请求，不入缓存）

落点：`apps/marketing/src/lib/agents/audit-handler.ts` 的投影段，与 `keywordEvidence` 并列。输入是缓存 payload 的 `result.pages`。

规则（中性、与画像无关）：
1. 只取 `finalStatus` 2xx 且 `contentType` 为 HTML 的页；按 `subjectUrl` 去重，保留第一条。
2. 首页（`subjectUrl === subjectUrlOf(siteOrigin + "/")`，`subjectUrlOf` 在 `packages/sources/src/canonical-url.ts`，`siteOrigin` 在 `SeoAuditReport` 上）排第一；`inspectedTargetUrl` 对应页排第二（与首页相同则不重复）。
3. 其余按 `depth === 1` 的页以 `inboundLinks` 降序、再 `url` 字典序；不足再取 `depth === 2` 同序。
4. 上限 `AGENT_KEY_PAGE_CANDIDATE_LIMIT = 24`。

输出 `AgentAuditResult.keyPages?: readonly AgentKeyPageCandidate[]`，每项恰好五个字段：`url`、`title`、`metaDescription`、`depth`、`inboundLinks`。`pages` 为空时为 `[]`。字段值都是缓存 payload 里已经存在的中性事实，不新增采集。

`url` 必须取 `pages[].url`（即 `page.projection.fetchUrl`，见 `model.ts:184-196`），不能取 `subjectUrl`：记录的 observation 用的就是 `fetchUrl` 形态，而 `comparableUrl`（`evaluate.ts:18-27`）只去掉 hash、不做任何其他归一。两边形态不一致会让 `projectRecordToTarget` 对每个关键页都匹配不上，整组关键页静默变成「无观测」。这一条要有测试守住。

### 5.2 关键页排序（客户端，读画像）

新增纯模块 `apps/marketing/src/components/agents/agent-key-pages.ts`：

- 输入：候选列表、已确认画像的 `coreFeatures`、首页与目标 URL。
- 打分：复用 `lib/agents/geo-alias-match.ts` 的 `normalizeAliasForMatch` 与 `containsGeoAlias`（已核实：它只 import `geo-canonical.ts`，后者零 import，可进客户端模块）。对每页构造文本 `路径分词（-、_、/ 换空格） + title + metaDescription`，对每个 coreFeature：整词命中 +1000，否则按长度 ≥3 的单词逐个 +1。打分规则与 GEO `site-index.ts:52` 同源；输入文本有意不同：GEO 用路径 + 锚文本，这里用路径 + title + description，因为抓取页没有锚文本却有这两项。
- 排序：首页第一、目标 URL 第二，其余按分数降序，同分按候选原序（深度、入链）。
- 取前 `AGENT_KEY_PAGE_LIMIT = 12`。
- `coreFeatures` 为空：不打分，按候选原序取前 12，整组标注 `basis = "structure"`；界面写「画像没有核心功能，关键页按站点结构选出」。
- 每页带 `basis`：`homepage | target | feature | structure`；`feature` 时记下命中的 feature 文本，展开区显示「因画像功能「X」入选」。

### 5.3 多目标求值

对每个关键页调一次现有 `evaluateAgentAuditScope("page", { records: recordsFor(page), availability, targetUrl: page.url, inspectedTargetUrl: page.url, targetInspected: true })`。站点级仍只调一次 `evaluateAgentAuditScope("site", …)`。

**`recordsFor(page)` 是本节的裁决点，不是既有能力。** `projectRecordToTarget`（`evaluate.ts:80-89`）对「无该页观测」的记录用 `record.targetTested === true || population === "every_collected_page"` 决定落 `not_observed`（通过）还是 `unverified`（排除）；而 `targetTested` 由 `recorderFor(targetSubjectUrl)` 在建报告时只对抓取目标页算一次并进缓存（`model.ts:105-117`）。直接换 `targetUrl` 再求值，2.1/2.2/2.4/2.5/4.5/5.4/6.5/7.3/7.4/1.7 等数组型 `tested` 的 `conditional_subset` 记录会拿目标页的成员关系去判别的关键页：目标页有 title 则无 title 的关键页在 2.1 上「通过」，目标页无 title 则所有关键页在 2.1 上「排除」。裁决取 fail-closed 的 (a)：

- 对非目标关键页，`recordsFor(page)` 做两件事。一是**按 id 剔除只属于目标页的记录集**：`keywordChecks`、`pagePerformance`、`serpShape`、`pageShapeChecks` 的全部 id，加上 `searchPerformance` 的 `target_query_ranking_band`。剔除按 id 清单执行，不按 `population` 判断：`target_query_ranking_band` 的 population 其实是 `conditional_subset`、`targetTested` 本就是 `null`（`search-performance.ts:375, 444`），只按 population 剔会漏掉它，它会改走「precondition」那句 limitation，与同组兄弟的排除理由不一致。二是把其余 `conditional_subset` 记录的 `targetTested` 置 `null`。于是这类记录只有两种结果：有该页观测 → 命中；无 → 走 `evaluate.ts:89` 既有的 `unverified` 分支，limitation 沿用既有句「This condition was only tested on pages meeting a precondition the target may not meet」，零新增词汇。`every_collected_page` 记录照旧可以通过。
- 对目标页，`recordsFor(page)` = 全部记录，行为与今天完全相同。
- **目标页未被抓到时（`targetInspected = false`）照旧求值一次**：`{ records: 全部, targetUrl, inspectedTargetUrl: null, targetInspected: false }`，与今天的调用逐字相同。`evaluate.ts:45` 对 `target_page` 总体的记录原样返回、不看 inspection，所以 2.3/3.2/3.4–3.6/4.2/4.3/7.2/8.1–8.4/9.1–9.5 在这条路径下仍能判定；已经付过费的 CrUX 与 SERP 数据不会被丢掉。这一条目进聚合时没有 basis（§5.2 的四种 basis 都不适用），范围标签只写「目标 URL」。
- 代价写明：非目标关键页在 2.1/2.2/2.4/2.5/4.5/5.4/7.3/7.4/1.7 等 `conditional_subset` 项上只能报命中、不能报通过（6.5 不在此列，它按 §8.2 F2 归入仅观测，没有命中与通过之分），§5.4 行 4 的 `keyPageEvaluatedCount` 会相应变小；这是诚实的下限。若上线后「已评估」偏低成为问题，升级路径是 (b)：在 payload 里为数组型 `tested` 记录发布可判成员关系的最小事实，需再 bump 版本并实测体积，本轮不做。
- 依赖目标页独有记录集的检查，在其他关键页上因记录被剔除而落 `excluded`，排除理由文案为「本次只对目标 URL 采集了该来源」。不为其他关键页发新的付费或配额调用。

### 5.4 跨页聚合

新增纯函数 `aggregateKeyPageEvaluations(site: AgentAuditEvaluation, pages: readonly { page: AgentKeyPage; evaluation: AgentAuditEvaluation }[]): AgentIssueSource[]`，输出喂给 `buildAgentIssueModel`。

同一 `check.id` 跨页合并规则，按行序取第一条命中的（是全集：每种分布恰好落一行）：

| 优先级 | 页面结果分布 | 合并 result | lane |
|---|---|---|---|
| 0 | 任一页任一轴出现本构建不认识的枚举值 | 原样保留 | 隔离（recognized = false） |
| 1 | 任一页 blocker | blocker | actionable（P0） |
| 2 | 任一页 warning | warning | actionable（P1） |
| 3 | 任一页 tip | tip | actionable（P2） |
| 4 | 任一页 pass（其余为 excluded 皆可；声明不作判定的检查永不产生 pass，见 §8.2 F2） | pass | passed，范围标签写「关键页 {keyPageEvaluatedCount}/{keyPageTotal} 已评估 · 通过」 |
| 5 | 任一页 observed-only（其余 excluded） | observed-only | 仅观测区（§4.3） |
| 6 | 全部 excluded，且至少一页 truth 为 `source-gated` | excluded | investigation |
| 7 | 全部 excluded，无 `source-gated` | excluded | excluded，排除原因取目标页那一页的，其余页的原因在展开区逐页列出 |

行 4 覆盖了「目标页 pass、其余关键页 excluded」这种只对提交页判定的常态；行 5 仍覆盖保留检查中「任一页 observed-only、其余 excluded」的合法分布。2026-09-04 移交 On-Page SEO Checker 的 2.10、4.2、4.3 已不再进入这些聚合行。

- `truth` 合并：任一页 observed → observed；否则任一页 partial → partial；否则任一页 `source-gated` → `source-gated`；否则 `not-observed` 与 `unavailable` 按多数，平票取 `unavailable`（fail-closed）；未知值一律隔离。**预期后果，不是 bug**：按 §5.3 的裁决，非目标关键页上 `unverified → excluded` 的求值结果自带 truth `partial`，所以行 4 的「通过」行大多会显示 `partial` 而不是 `not-observed`。这如实反映了「只在一部分关键页上判过」，实施时不要把它当缺陷改掉。真值态在代码里是 kebab-case（`not-observed`、`source-gated`、`needs-integration`），映射表 fail-closed，字面必须照代码写。
- `measurement`：逐页保留，展开区「本次测量」按关键页排序列出 `{url} · {measurement}`。
- `evidenceRecordIds`：并集。
- `scoreValue / scoreContribution`：不再合并出总分；健康度（`health`）在头部不展示，避免用一个目标页的分数冒充关键页集合。

### 5.5 受影响目标两段式

`AgentIssueAffectedTargets` 沿用分支既有的 `totalCount`（全站 `affected` 总数）与 `enumerated`，新增四个字段：

- `keyPageTotal: number`：本次关键页集合大小（≤12）。
- `keyPageEvaluatedCount: number`：该检查项在多少个关键页上得出了结论（非 excluded）。
- `keyPageHitCount: number`：命中的关键页数，未截断。
- `keyPageUrls: readonly string[]`：`keyPageHitCount` 的截断展示，按 5.2 排序，上限 10（`AGENT_ISSUE_URL_DISPLAY_LIMIT` 不变）。
- 站点级检查保持 `mode = "site-scope"`，不列 URL，四个关键页字段为 0；来源受限保持 `mode = "unavailable"`，`totalCount` 为 null 不为 0。分支既有的 `mode = "not-captured"` 在新聚合下不应再出现于页面级检查（有记录必有可归属的关键页或全站观测）；出现即按 §5.4 行 0 隔离，并记一条测试。

范围标签由这些字段推导：命中时 `关键页 {keyPageHitCount}/{keyPageTotal} · 另有 {totalCount − keyPageHitCount} 页`（`enumerated = false` 时「另有至少」）；通过时 `关键页 {keyPageEvaluatedCount}/{keyPageTotal} 已评估 · 通过`。`keyPageHitCount > totalCount` 不可能出现（关键页是全站子集）；出现即隔离该行并记测试。

## 6. Checker 独有检查进目录

九个 catalog 条目，两个落点：
- 八条（1.9、2.7、2.8、2.9、4.6、6.6、8.7、8.8）落在 `packages/public-tools/src/seo-audit/model.ts` 的 `buildRecords`，对所有抓取页产出记录，population 为 `every_collected_page`；事实来自每页 `onPage`（`ParsedOnPageFacts` 已含 `lang / viewport / charset / faviconDeclared / externalLinks.blankWithoutNoopener / htmlBytes / visibleTextBytes / scriptBytes / textMetrics`，已核实）与 `projection`，与 `buildTargetPageExtract` 的 `declaredFactsOf` 同源。`onPage` 在原始类型里可选：缺侧车的页不计入 `tested`，population 标 `conditional_subset`，limitation 明示（同 §8.2 F4 的修法）。这八条进缓存 payload，因此触发 v18。
- 一条（2.10）落在 `keyword-evidence/records.ts`，随 `keywordChecks` 在 `audit-handler.ts` 每请求构造，不进 `buildRecords`、不进缓存、不参与 v18。

每条记录同时进：对应台账（八条进 `record-ledger.ts` 的 `SEO_AUDIT_RECORD_CATEGORIES`，2.10 进 `KEYWORD_EVIDENCE_RECORD_IDS`）、catalog 的 `EVIDENCE` 映射与 `PAGE_TITLES` 条目、`howToFix` 专属文案（en/zh）、`agent-display-contract.ts` 的派生集合（自动，不手写）。

| 新检查 | 组 | 记录 id | 判定 | 严重度 | Checker 对应 |
|---|---|---|---|---|---|
| 1.9 移动端 viewport | 1 | `viewport_missing` | `<meta name=viewport>` 缺失 | Warning | `viewport` |
| 2.7 `html lang` 属性 | 2 | `lang_missing` | 缺失或空 | Tip | `lang` |
| 2.8 字符集声明 | 2 | `charset_missing` | meta charset 与 Content-Type 都未声明 | Tip | `charset` |
| 2.9 favicon 声明 | 2 | `favicon_missing` | 无 `<link rel=icon>` 类声明 | Tip | `favicon` |
| 2.10 目标词在 description / 副标题 / 开头正文的覆盖 | 2 | `target_query_slot_coverage`（新记录，在 `keyword-evidence/records.ts` 从 `KeywordEvidence.slots` 派生，随 `keywordChecks` 每请求构造） | 三个文本位点合并为一项；仅目标页、有目标词、且至少一个位点存在时判定 | Tip | `keyword.description / subheadings / body`（**URL 位点已排除，见下**） |
| 6.6 外链 `_blank` 无 `noopener` | 6 | `external_link_blank_without_noopener` | 计数 > 0 | Tip | `links` 里的 blankWithoutNoopener |
| 8.7 静态 HTML 承载正文 | 8 | `client_rendered_content` | `visibleTextBytes < STATIC_TEXT_FLOOR_BYTES` **且** `scriptBytes > visibleTextBytes × SCRIPT_DOMINANCE`——两段式；**规则整体**（不只是常量）与 Checker 共用 `readsAsClientRendered()` | Tip | `rendering` |
| 8.8 HTML 文档体积 | 8 | `html_document_oversized` | `htmlBytes > HTML_BYTES.large`，常量与 Checker 同源导出 | Tip | `htmlSize` |
| 4.6 正文文本量绝对档 | 4 | `thin_body_text` | `onPage.textMetrics` 的 text_units 低于 `BODY_UNITS` 最低档，常量与 Checker 同源导出；CJK 页按文本单位计，不按空白分词 | Tip | `bodyLength`（审计 F11） |

约束：
- 2.10 必须新增记录：现有关键词记录只覆盖 title 与 H1 两个位点（`title_without_target_query` / `h1_without_target_query`），其余位点只存在于 `KeywordEvidence.slots` 证据层，没有记录可映射。合并为一条 `target_query_slot_coverage`，避免每个位点各报一次同一页。这同时回应审计 F12：目录承认这些位点是判定项（authority = judgment），4.3「首次出现位置」维持只观测。
- **URL 位点不进 2.10（实施期裁决，2026-09-03 第二轮评审）。** `urlCovered` 比的是整条绝对地址的字母数字**含主机名**——那是它能识别精确匹配域名的设计意图。折进覆盖计数后它就不再是证据：`astrologywiki.com` 上每一页都「覆盖」查询 `astrology wiki`，这条检查在「域名已经说明自己做什么」的那类站点上永远不可能出结论。它还是子串匹配（`chart` 命中 `/charter-schools`）而非词序列，与 2.3/3.2 是两套口径。URL 位点本身不动，2.3/3.2 与证据层照旧读它。
- **三个文本位点全部 `not_applicable` 时早退为不判定。** 那些缺失各自已有检查在报，2.10 再罚一次等于一个页面为一处短处付两次账——title/h1 位点早就是这么做的。
- **2.10 必须声明 limitation**：它是关键词证据里口径最杂的一条（词序列匹配 + 开头正文只采了前一段），却曾是唯一不声明口径的一条。
- 4.6 与 4.1 并存：4.1 保留为「不可测」并改写文案（见 §8.2 F5），4.6 是能测的绝对档。
- Checker 的 `demandCapture`、`images.withDimensions`、`twitterCard` 是观察不是判定，不进目录；Checker 页保留原样。Checker 的文本/代码比检查（`TEXT_RATIO_FLOOR`）改为 observation 不扣分，与目录 4.4「不当成缺陷」对齐（审计 F10）。
- 8.7、8.8、4.6 的阈值常量从 Checker 的 `checks-technical.ts` / `checks-meta.ts` 提到 `@sf/public-tools` 的一个新子路径导出。**共享常量不够，判据本身也要共享**：8.7 有两个子句，Checker 两个都用而目录只用了比例那个，同一个页面（5KB 正文 + 30KB 脚本）两边给相反答案。规则以 `readsAsClientRendered()` 的形式住在共享模块里，两侧调同一个函数，并有一条跨消费面的测试——只驱动共享函数的测试在任一侧内联回去照样绿（如 `@sf/public-tools/seo-audit/page-shape-thresholds`），并在 `packages/public-tools/package.json` 的 `exports` 登记；Checker 是客户端代码，`client-bundle-boundary.test.ts` 禁止裸 barrel import，先例见 `checks-meta.ts` 对 `@sf/public-tools/seo-audit/text-width` 的引用。两边永远一致；这是 §8 审计要检查的「同一事实两侧阈值不一致」的预防。
- 八条 Tip 级新项必须加进 `catalog.ts:1078` 那张硬编码 tip 列表，不能靠 `DECLARES_NO_JUDGEMENT` 正则，否则会被 §8.2 F2 归成 `observed-only`。1.9 落页面组 1 会因 `catalog.ts:1029` 得 `scored = false`、`primaryAgent = tech`，与不给总分的房规无冲突，表里按 Tech 归属渲染。
- 每条新记录做 `state / affected / tested` 组合的 sweep 测试，含「全站都合规」的干净分支（`not_observed`，`affected = 0`），对应 [[seo-agent-wire-invariant-refusals]] 的两次事故。

## 7. 契约与版本

- **payload**：`seo_audit.sitewide.v17 → v18`，因为记录台账变了。`model.ts`、`contract.ts`、`audit-contract.ts` 的 `AGENT_AUDIT_SOURCE_SCHEMA_VERSION` 三处同 commit 改。旧缓存行读成未命中重新抓取。已打开的旧标签页在部署后下一次运行会收到「响应无法安全展示」，刷新即恢复；写进 PR 描述。
- **wire**：新增两个可选区域。`AgentAuditResult.keyPages?`，守卫 `isAgentKeyPageCandidates`：数组、长度 ≤ 24、每项 `Object.keys` 恰好五个、`url` 为 string、`title / metaDescription` 为 string 或 null、`depth / inboundLinks` 为非负整数，缺字段或多字段整体拒绝。`AgentAuditResult.pageShapeChecks?`（§8.2 F1），有 `pageRole` 时出现、无则缺席，守卫形态同 `keywordChecks`。
- **请求**：白名单（`seo-audit-input.ts`：`url`、`targetQueries?`、`pageRole?`、`market?`、`language?`）不变；画像整体不上送，只按 §8.2 F1 上送其中的 `targetQuery` 与 `pageType` 两个既有字段。
- **台账与词汇**：新记录 id、证据标签、limitation code 全部加进 `record-ledger.ts`，`agent-display-contract.ts` 的集合从台账派生；`detector-contract.test.ts` 用真实 `buildSeoAuditReport` 双向比对台账，新增记录漏登记在生产者处就红。
- **i18n**：新增文案 en/zh 同批；保留分支的断言「渲染输出不含 `agents.workbench.issues.` 前缀」并扩到新 key 空间；2026-09-04 的目录删减后，`AGENT_AUDIT_COVERAGE` 继续由目录派生，为 31 个站点级 + 53 个页面级 = 84 项；测试从 `SITE_AUDIT_GROUPS + PAGE_AUDIT_GROUPS` 派生断言，不手写数字。
- **文案诚实性**：`agents.hub.title`「既看整站也看单页」改为「既看整站也看关键页」；`crawl-copy-honesty.test.ts` 的口径不受影响（抓取范围未变）。

## 8. 内容逻辑审计

### 8.1 范围与方法

判定层：内容组 4.1–4.5、一致性 D1–D5、TDK 2.1–2.6、标题 3.1–3.6 的 EVIDENCE 映射、阈值、`thresholdAuthority`、公开文案与 `evaluate.ts` 执行规则是否一致；与 Checker 两侧同一事实的阈值是否打架；4.1 的 SERP 中位数分母来源；4.2–4.4「不作判定」项的渲染。

建议层：`howToFix` 是否逐项专属；`agent-solution-templates.ts` 的 content 类 preview 是否把 `fillIn` 空槽或测量值当建议值渲染；`solution-draft.ts` 的 prompt 给了哪些事实、有无编造入口、输出校验；illustrative 边界句渲染位置；任何「文案替代码撒谎」或「部分测量渲染成通过」。

由一个只读子代理按上述八问通读并写出带 `文件:行号` 证据的缺陷表；本会话复核每条证据后才收入。

### 8.2 结论

审计报告全文：`docs/reviews/2026-09-03-seo-agent-content-logic-audit.md`（行号基于 `c7dc27cc`）。P1 四条的证据行已由本会话逐条复核，与报告一致。没有 P0。

| 编号 | 级 | 层 | 现象 | 关键证据 | 修法 | 处置 |
|---|---|---|---|---|---|---|
| F1 | P1 | 判定 | 普通运行不上送 `targetQueries / pageRole`，8 项永远 excluded，诊断卡却渲染预设区间与「已确认目标词」 | `agent-workbench.tsx:285-298`；`agent-audit-model.ts:268-270` | 两层都改。客户端：画像 `targetQuery` 非空时上送 `targetQueries: [targetQuery]`；`pageRole: profile.pageType` 始终上送（`seo-audit-input.ts:104-110` 独立解析 `pageRole`）。服务端：`audit-handler.ts:865-880` 把 `h2/h3_count_outside_reviewed_range`、`thin_section_under_h3`、`schema_type_unmatched_to_page_type` 四条记录全挂在 `evidence === null ? {} : { keywordChecks }` 分支里，只改客户端时无目标词的运行这 4 项仍 excluded；因此把这四条从关键词证据解耦为新区域 `pageShapeChecks?: { version, records }`，只凭 `pageRole` 即构造。台账搬迁写死：四个 id 从 `KEYWORD_EVIDENCE_RECORD_IDS` 移出（`isAgentKeywordChecks` 要求 id 集合恰等于该常量，不移出就会拒绝新响应），进新 `PAGE_SHAPE_RECORD_IDS` 连同各自的 evidence labels 与 limitation codes；`AGENT_KEYWORD_CHECKS_VERSION` 因 id 集合变化同步 bump；`allAgentAuditRecords`（`audit-contract.ts:410-419`）与 `agent-display-contract.ts` 的三个 union 各加一行；wire 守卫照 `isAgentKeywordChecks` 的 `{version, records}` 形态写 `isAgentPageShapeChecks`。`isKeywordEvidenceShape` 要求 `queries.length >= 1` 的守卫不动。未上送目标词时「已确认目标词」标签不渲染，2.3/3.2/4.2/4.3/2.10 的排除理由写「本次未提交目标词」 | 第四批修 |
| F2 | P1 | 判定+建议 | 4.2/4.3/4.4「不作判定」却渲染为 Tip，实测值写成「1 个受影响观测」，进 P2 建议并套「内容简报」模板 | `keyword-evidence/records.ts:217-223, 394-399`；`evaluate.ts:209-212`；`agent-result-helpers.ts:79-83` | 新增结果态 `observed-only`。2026-09-04 将 4.2/4.3 移交 On-Page SEO Checker 后，`DECLARES_NO_JUDGEMENT` 命中的 8 项（A7、B4、B5、C6、D7、E4、4.4、6.5）只允许 `observed-only` 或 `excluded` 两种结果，`evaluate.ts:357-363` 的 `: "pass"` 路径对这些项必须短路成 `observed-only`，否则 4.4 在缺侧车的非目标关键页上会先落 pass 再被 §5.4 行 4 合并成「通过」。短路需要 `AgentAuditCheckDefinition` 上有一个新布尔 `declaresNoJudgement`，由 catalog 从同一条正则派生（`scored === false` 不足以区分：页面组 1 的检查也是 false）；求值器读这个字段，不重跑正则。不进 actionable，手风琴归「仅观测」区；`measurement()` 对保留的观测记录直接展示数值；测试钉这 8 项「不是 Tip、不是 pass、不进建议」 | 第四批修 |
| F3 | P1 | 判定 | 3.6 文案说 CJK 页不判，代码按空白切词照判，中文页每个 H3 下约 1「词」必判 thin | `records.ts:432-449`；对照 `extract.ts:213-229` 的 CJK 置空 | `sectionSubstanceRecord` 加 CJK 门（复用 `cjkShare`），CJK 时 `unverified` + limitation | 第四批修 |
| F8 | P1 | 建议 | AI 草稿 prompt 不给 15–60 / 50–160 显示宽度区间、不要求含目标词；reader 不校验；UI 不显示宽度 | `solution-draft.ts:96-113, 124-179`；`text-width.ts` 有 `displayWidth` 未用 | prompt 注入 `SNIPPET_*_WIDTH` 与「必须以词序列包含目标词（若已确认）」；reader 复核宽度与含词，不通过标出不拒绝；草稿旁显示宽度读数 | 第四批修 |
| F4 | P2 | 判定 | 目标页无 onPage 侧车时 4.4 / 3.3 无观测 → `not_observed` → Pass | `model.ts:1366-1385, 1284-1296`；`evaluate.ts:80-89` | `tested` 只计有侧车的页并标 `conditional_subset`；无侧车 limitation 明示 | 第四批修（不需新数据） |
| F5 | P2 | 判定 UI | 4.1 与 B4/B5/C5 引擎芯片显示「本版本无法识别」；4.1 卡阈值写 Warning、依据 SOP、数据源「不可观测」、修法通用句四字段互相矛盾 | `agent-diagnosis.tsx:63-80`；`catalog.ts:618-634` | 手风琴接求值器的 `needs-integration`（kebab-case）到 i18n 键 `engines.needsIntegration`，不再经 view 层 `replaceAll("-","_")` 的 snake_case 中转；4.1 阈值改说明性、howToFix 专属句 | 第四批修 |
| F6 | P2 | 判定 | 2.1/2.4 阈值文案未写严重度，实际 Tip；Checker 同事实判 warn | `catalog.ts:79, 82, 1079`；`checks-meta.ts:92-130` | 文案补「出界为提示」；Checker 文案注明「Agent 侧记为提示」 | 第四批修 |
| F7 | P2 | 建议 | 方案预览「observed title / h1 count: [本次运行未采集]」，实际已采集 | `agent-solution-templates.ts:139-141, 260-261` | `AgentSolutionPreviewInput` 传 `targetPageExtract`，标签找不到时回退到 extract；补 2.1/2.3 测试 | 第四批修 |
| F9 | P2 | 判定 UI | `authority()` 兜底 `"industry"`，D1 2%、D2 5% 等内部数值显示「行业惯例」 | `catalog.ts:571-583` | 兜底改 `"judgment"`，真有出处的显式列 industry | 第四批修 |
| F10 | P2 | 判定 | 文本/代码比：目录「不当成缺陷」，Checker <10% warn 扣分 | `checks-meta.ts:37, 304-317` | Checker 改 observation | 并入 §6 约束，第三批 |
| F11 | P2 | 判定 | 正文长度两套标准：Checker 绝对档 + 封顶，目录 4.1 相对中位数且永不运行 | `checks-meta.ts:31, 219-232`；`catalog.ts:233-236` | 目录加 4.6 绝对档（§6） | 第三批 |
| F12 | P2 | 判定 | Checker 对 description/URL/正文/副标题命中计分并封顶，目录只判 title/H1 且 4.3 声明不判位置 | `checks-keyword.ts:34-41`；`scoring.ts:106-111` | 目录加 2.10 位点覆盖（§6），4.3 维持观测 | 第三批 |
| F13 | P2 | 建议文案 | `searchPresentation.limits` 写「字数」，实测单位是显示宽度 | i18n `seo.kinds.searchPresentation.limits` | 改「显示宽度（中日韩按 2 计）」 | 第四批修 |

已核实无问题、后人不必重查：D1/D2/D3/2.2/2.5/3.1/4.5 阈值与执行一致；Title/描述宽度两工具共用 `text-width.ts` 常量；D1 排除 canonical 收敛变体；4.5 的 P6 门已实现；2.3/3.2 词序列匹配与文案一致；`targetTested` 投影不把未测读成通过；`staticBodyWords` 对 CJK 置空；草稿 reader 拒绝半份与占位符、按键重挂载、无页面文本不受理；`illustrative` 从不由求值器产出；fillIn 与 notCaptured 是两个标记，测量值从不进「new …」槽；howToFix 内容项全部专属，仅 4.1 走通用句；内容相关证据标签 zh/en 齐全。D2 站级 Tip 与 2.5 页级 Warning 用同一记录但严重度不同，是比例与成员关系的有意区分，不算缺陷。

### 8.3 并入方式

规则：P1 全修；P2 只修不需要新数据源的；需要新采集、新付费调用或改冻结契约 `crawl.page.v1` 的一律记入「已裁决不追」。按此规则 13 条全部可修：F10/F11/F12 是目录并入的一部分，归第三批；其余 10 条归第四批，每条独立提交，不与结构改动混在一个 commit 里。F2 引入的新结果态 `observed-only` 要同时进 `AgentAuditResultState` 联合、手风琴映射表（fail-closed，D2）、display-contract 与 en/zh 文案。

## 9. 错误处理与诚实性不变量

- `keyPages` 缺失或为空：界面写「本次没有可评估的关键页，页面级结论只针对目标 URL」，页面级退化为单目标求值；不渲染空的关键页标签。
- 目标 URL 未被抓到（`targetInspected = false`）：关键页集合照常，只是目标页那一行的 basis 缺席并说明。
- 某关键页求值出现未知枚举：该检查项整行隔离，不影响其他行。
- 关键页命中数永远 ≤ 全站受影响数；违反即隔离并记测试，不静默取小。
- 来源受限行的计数为 null，永远不渲染成 0 或「通过」。
- 只有否定结论需要全集：关键页集合上的「通过」必须标注口径，格式固定为「关键页 {keyPageEvaluatedCount}/{keyPageTotal} 已评估 · 通过」，例如 2.10 只在目标页判定时显示「关键页 1/12 已评估 · 通过」；不写成「全站通过」，也不把 12/12 写成默认值。
- 缓存标签与「新抓取」标签沿用；关键页排序依赖画像，同一缓存在不同画像下关键页可以不同，界面在「采集边界」里说明这一点。

## 10. 测试

单测：
- `agent-key-pages.ts`：coreFeatures 为空、首页即目标、候选不足 12、整词与单词计分、CJK feature、同分稳定序。
- 服务端候选选择：非 2xx 与非 HTML 剔除、subjectUrl 去重、深度回退、上限 24。
- `recordsFor(page)`：非目标页按 id 清单剔除目标页专属记录（含 `target_query_ranking_band`）、`conditional_subset` 的 `targetTested` 置 null；用「目标页有 title、关键页无 title」的 fixture 断言 2.1 在该关键页不得为 pass；`targetInspected = false` 时目标条目仍产出且 8.x/9.x 可判定。
- 关键页 `url` 与记录 observation 的 URL 形态一致：用真实报告的 `pages[].url` 构造候选，断言 `projectRecordToTarget` 能匹配上；把候选 `url` 换成 `subjectUrl` 必须让该断言变红。
- `aggregateKeyPageEvaluations`：全通过、全排除、全来源受限、混合、未知枚举 fail-closed（且隔离先于 P2 兜底）、关键页命中数 > 全站受影响数触发隔离、`mode = "not-captured"` 出现即隔离、10 个 `declaresNoJudgement` 项在任何页面分布下都不得合并成 pass。变异测试：把「取最差」改成「取最好」必须至少一条红。
- 8 条 `buildRecords` 新记录 + `target_query_slot_coverage` + `pageShapeChecks` 四条的构造器 × 消费端校验器 sweep，含全站合规的干净分支与缺侧车分支；`detector-contract.test.ts` 双向台账比对；8.7/8.8/4.6 常量同源断言（Checker 与 catalog 引用同一导出）。
- wire 守卫：`keyPages` 多字段、少字段、超长、负数各一条拒绝用例；缺 `keyPages` 放行；`pageShapeChecks` 有 `pageRole` 无 `targetQueries` 时出现、两者都无时缺席。
- 契约：payload v18 三处版本一致的冻结断言；en/zh key parity；渲染输出无 key 路径前缀；2026-09-04 的目录删减后，`AGENT_AUDIT_COVERAGE.total` 从真实目录派生为 84（31 站点级 + 53 页面级），且八个仍保留的新 id 在集合内。

e2e（`apps/marketing/e2e/agents.spec.ts`，双 locale）：
- 登录态运行后手风琴渲染、筛选芯片计数与行数一致、展开一行含七个区块、来源受限行无修复指令。
- 390px 无文档级横向溢出；1440px 同。
- 干净站点 fixture 显式空态。
- 关键页行的范围标签格式 `关键页 x/y`。

验证纪律：营销站 e2e 服务的是 `.next/standalone` 已有构建，改完源码必须先 `pnpm build`；`pnpm test:e2e` 在 `apps/marketing` 里跑。所有验证对象必须是要发布的那个构建。

## 11. 实施批次

新 worktree `/Users/wzb/Code/nevermore/seo-agent-results-20260903`，分支 `feat/seo-agent-key-pages-accordion-20260903`，基于 `origin/main c7dc27cc`。每批独立提交、独立可验证。

1. **手风琴落 main（约 1.5 天）**：按序 cherry-pick `efc5e38e bc30df46 5cb7eb0c 4c014b27 8e7fd34b`，解 `agent-results.test.tsx` 冲突；加 P0/P1/P2 徽章（D7 改写）；删范围切换、组导航、台账、单选面板；头部收成三行 + 折叠采集边界；更新 e2e 与 `agents.hub.title`。
2. **关键页（约 2.5 天）**：服务端 `keyPages` 投影与守卫；客户端排序模块；多目标求值；`aggregateKeyPageEvaluations`；受影响目标两段式与范围标签；空态与退化。
3. **目录并入（约 2.5 天）**：8 条记录进 `buildRecords`，2.10 进 `keywordChecks`（§6 表，9 个 catalog 条目）；台账、EVIDENCE、catalog 条目、howToFix 双语；v18 bump 三处；8.7/8.8/4.6 常量同源；Checker 文本/代码比降为 observation；sweep 与契约测试。
4. **内容逻辑修复（约 2.5 天）**：F1 客户端上送目标词与页面类型 + 服务端 `pageShapeChecks` 解耦 + 诊断卡渲染；F2 新结果态 `observed-only` 贯通求值器、手风琴、契约、文案；F3 CJK 门；F8 草稿宽度与含词复核；F4/F5/F6/F7/F9/F13 各一个小提交。
5. **收尾（约 1.5 天）**：`pnpm build` 后跑 e2e；文案清扫（字典 + metadata + JSON-LD 硬编码源）；codex 跨模型评审并修复；PR。

合计约 10.5 人日。

## 12. 明确不做

- 抓取范围、预算、240 秒等待不变。
- 不给关键页集合或 Agent 报告任何 0–100 总分；不展示 `health`。
- 不为非目标关键页发 CrUX / SERP / GSC 调用。
- 不改请求白名单，不上送画像。
- 不改 `crawl.page.v1` 冻结契约，不动 `packages/sources/src/crawl` 的 vendor 锁目录。
- 不做 mock 的 4 个快捷按钮、行级 illustrative、虚拟滚动、逐证据时间戳、PolicyEditor 挂载。
- 不改 Stage 01 画像面板。On-Page Checker 工具页的 IA、交互、总分不改；其评分层只改 §4.4 列出的三处。
- Checker 的 `demandCapture`、图片尺寸、twitter card 观察项不进目录。

## 13. 风险与已知代价

- v18 bump 使已打开的旧标签页下一次运行报错一次；接受，写进 PR 描述。
- 每关键页一次页面级求值，12 页 × 约 50 条记录，客户端毫秒级；不做虚拟滚动。
- §5.3 取 fail-closed 后，非目标关键页在 2.1/2.2/2.4/2.5/4.5/5.4/7.3/7.4/1.7 等 `conditional_subset` 项上只能报命中不能报通过，「已评估」计数会低于直觉，且这些行的 truth 多为 `partial`；这是有意的下限，升级路径已写在 §5.3。
- F2 落地后 A7、C6、D7、6.5 四项从 P2 建议行迁入「仅观测」区并退出 AI 交接，可行动条数会明显下降。这是它们自己声明的口径，不是功能缺失；发布说明要写。
- `buildRecords` 新增 8 类记录，观测数按 `MAX_OBSERVATIONS_PER_RECORD` 上限 2000 条，极端站点每记录约 100–200KB；缓存上限 4MB、平台响应 4.5MB，需在批次 3 用 950 页 fixture 实测 payload 体积并记录到 PR。
- 手风琴分支距 main 354 个提交，cherry-pick 后必须重跑分支全部 371 个相关单测，并对新增的 `agent-workbench.tsx` 账号画像接入做一次真实点击验证。
- 内容逻辑修复的规模取决于审计结论，批次 4 的人日是区间不是承诺。

## 14. 关联

- 2026-08-21 手风琴十项裁决：artifact `ace0ddc7-26c5-4420-b084-e19c70fb7f98`
- 统一 SEO Agent + On-Page Checker 裁决：`gengrowth-tools/artifacts/designs/2026-08-17-unified-seo-agent-onpage/decisions-2026-08-17.md`
- 审计覆盖 48 项工单：`gengrowth-tools/artifacts/designs/2026-08-18-audit-coverage-48/`

---

## 15. 实施期偏离本文档的裁决（2026-09-03 回填）

设计写完之后，实施与两轮评审改写了下面这些。**冲突时以本节为准**，上文已就地订正的不再重复。

### 15.1 2.10 的位点集合从四个收到三个

URL 位点退出。理由见 §6 约束：`urlCovered` 比的是含主机名的整条地址，在域名含目标词的站点上恒为通过，而它又是子串而非词序列匹配。这让 §6 表里「四个位点合并为一项」的原始表述作废。

### 15.2 8.7 共享的是判据不是常量

设计只说「阈值常量同源导出」。实施后发现常量同源仍会分歧：Checker 的规则有两个子句，目录只抄了一个。改为共享 `readsAsClientRendered()`。

**通用教训**：两个界面判同一个事实时，只共享数字不够——**有几个子句就要共享几个子句**，否则「一处定义」是句空话。

### 15.3 `keyPagesNone` 的判据不是页数

设计 §9 写「`keyPages` 缺失或为空时」显示退化提示。实施后 `model.keyPages` 含合成目标行，长度永不为 0，按长度判会打印「关键页 1」+「没有可评估的关键页」。改用 `keyPagesWereSelected`（是否选出过候选）。

### 15.4 `AgentIssueKeyPageReach` 的字段名

设计 §5.5 列的是 `keyPageTotal / keyPageEvaluatedCount / keyPageHitCount / keyPageUrls` 四个平铺字段；实施为嵌套对象 `affected.keyPages: { total, evaluated, hits, urls } | null`，语义不变。`totalCount` / `enumerated` 按设计沿用。

### 15.5 「通过」的措辞按 lane 分三种

设计 §9 只给了通过一种格式。实施后发现同一句会被三条 lane 共用，于是拆成 `keyPagePass`（仅 passed）/ `keyPageObserved`（仅观测）/ `keyPageScope`（其余）。一个全页排除的检查曾被写成「关键页 0/12 已评估 · 通过」。

### 15.6 `TARGET_ONLY_RECORD_IDS` 由手写清单改为带派生护栏

设计 §5.3 只说「按 id 清单剔除」。第一轮评审的 P0 正是这张手写清单没跟上常量拆分，而当时的修法是往清单里再拼一个手写常量——下次照样漏。现在有一条护栏跑真实 producer 收集所有 `population === "target_page"` 记录并断言清单是超集。

**通用教训**：手写清单的修复不能是再写一条清单项，必须是让清单可被派生验证。

### 15.7 4.1 改为说明性阈值

设计 §8.2 F5 只说「阈值改说明性」。实施为：阈值原文改成「本项不在此判定」，并把读者引向 4.6；`howToFix` 写专属句说明为什么这次运行给不出结论。

### 15.8 已排除区显示引擎态

设计 §4.3 要求「排除原因逐行可见」，但没说怎么做。实施为在已排除行右侧渲染引擎态芯片（`ready` / `needsIntegration` / `needsSupplement` / `notIntegrated` / `accessRequired`），读者要决定连不连某个来源时得知道那会解锁哪些检查。

### 15.9 删诊断面板时一并清掉 185 行视图模型死码

设计 §4.1 只说删范围切换、组导航、检查台账。删完后 `agent-audit-model.ts` 的 `scopes` / `defaults` / `headingPreset` 视图与 `checkView` / `scopeView` 全部零消费者，其中的 kebab→snake 真值态转换正是 §8.2 F5 点名的命名混乱来源，一并删除（305 行 → 120 行）。
