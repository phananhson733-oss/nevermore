---
authority_version: 0.4.0
authority_status: active
normative: true
product_version: 0.3.0
contract_version: 2026-07-21
rule_set_version: mvp.rules.0.2.4
prompt_set_version: mvp.prompts.0.2.0
---

# Nevermore / GenGrowth v0.4 完整增长工作台可执行权威

## 0. 规范范围

本文件冻结当前完整四模块产品面。OpenAPI 精确声明 **80 个 operation 与 10 个
shared async operation**，**47 个 ordered migrations** 精确声明 **80 张应用表**，引擎
精确注册 **12 条规则**。`createProjectMeasurementWindow` 是额外的 typed
measurement `202`，使用 `MeasurementWindowAcceptedHttpResponse`，不计入十个
共享 `AsyncAccepted` operation。

冲突顺序为本文件 → 同目录 OpenAPI → 由 ordered migrations 生成的 schema →
active lock → 运行时实现。任何冲突必须显式修复并让所有 verifier 同时通过，
不得在 UI、repository 或 worker 中加入未声明的兼容猜测。

四模块是同一条 canonical chain 的客户投影：

```text
概览
→ 增长地图（URL / Keyword / Competitor / Topic / Link / Finding）
→ 执行中心（Action / State / Artifact / Revision / Approval）
→ 效果追踪（Change Receipt / Measurement Window / Observation）
```

关键词库、竞品库、Technical SEO、GEO、Content、CRO、内链、外链与 Topic
Model 均属于增长地图的增长路径与判断依据。它们不创建额外顶层工作台，也不
使用离线 mock Artifact 代替生产数据。

## 1. 产品画像与项目上下文

1. 客户输入核心 URL 与能可靠回答的基础业务信息；URL-first 创建可声明产品名、
   B2B/B2C/混合客户模式、单一主要市场和有限集合的增长目标。这些值只作为
   可追溯、可编辑的 declared facts，不得冒充 Crawl、DFS 或 AI 观察结果。
2. Crawl 生成 immutable Snapshot、PageSnapshot 与 Observation。
3. Product Profile synthesis 只可引用冻结证据，输出可审核的产品类别、商业
   模式、目标市场、ICP/JTBD、价值主张、转化目标和直接/间接竞品集合。关系与
   analysis scope 完整的可追溯竞品默认纳入后续分析；客户可以修改关系或明确排除，
   不要求逐项从 candidate 手工批准。
4. AI 草稿是 draft；每个推断字段必须携带 provenance/limitation，用户可以
   修改后生成新的 append-only ICP version。历史 0.3.0 画像中已经具备关系与
   analysis scope 的 candidate 按同一 opt-out 规则读取，但不得改写冻结画像 JSON；
   竞品库只可回填从未发生客户治理的 revision-zero entity。
5. 只有 complete profile 可成为诊断的冻结输入；确认画像不隐式启动分析。
6. Production operator 必须来自 Supabase Auth。首次登录的账号自助注册：为其
   创建**新建**的 workspace 与对应 `operator_profiles`。供给必须新建 workspace，
   不得让新账号落入任何既有 workspace——隔离全靠应用层的 workspace 作用域，
   没有 RLS 兜底，所以「登录不授予对既有 workspace 的访问」仍是硬边界，只是
   membership 的来源从「事先预置」扩展为「本人注册」。加入他人 workspace 只能
   通过显式邀请，登录本身永不构成加入。新注册 workspace 为 `free` 档，受
   `plan_tier` 对应的项目数上限约束。
7. 客户可在项目设置中删除产品；该命令必须以 workspace 与 project
   双重作用域将 Project 软删除为 archived。已归档产品立即从 active list
   消失，且后续 collection、diagnosis 与 delivery 写入继续受 archive fence
   拦截；历史 Snapshot、Evidence、Finding、Action 与 Artifact 不级联硬删除，
   并保留只读审计谱系。客户界面必须二次确认并告知该保留边界。
8. 当前 `mvp.rules.0.2.4` 诊断必须在 hash-covered、exact-key
   `DiagnosticRun.input_manifest` 中冻结 `contextProjection.v1`。它只从该 run
   选定的 immutable confirmed Profile 与创建时 exact Site 语言编译产品路由、
   转化/重点 URL/执行约束的显式声明状态；provider availability、权限或 mode、
   workflow state、实时优先级/风险/ROI/cadence 以及模型推断都不得进入该投影。
9. Profile 解析必须 generation-aware：`product-profile.0.3.0` 只读取该 generation
   自己声明的字段，不借用 legacy 转化、重点 URL 或约束；`legacy-icp.v1` 只读取
   legacy 中显式存在的值。缺少声明必须冻结为 typed missing state，不能从当前
   Project、provider 或历史 generation 补值。
10. `contextProjection.v1.siteLanguage.languageCodes` 对每项做 RFC 5646/BCP 47
    验证，并按 Site 的原始值与顺序逐字冻结，不进行大小写 canonicalization 或
    delivery-locale 回填。非空数组参与语言路由；空数组表示 unknown，使依赖语言
    的当前规则 inconclusive，而不是假定英语或项目交付语言。

## 2. 数据来源

分析事实只来自以下真实路径：

- Crawl：站点 URL inventory、HTTP、canonical、页面抽取、链接结构与技术事实。
- GSC：query/page clicks、impressions、CTR、position 与时间窗口。
- GA4：landing page、session、conversion 与 UTM/campaign 观察。
- DataForSEO：关键词 demand/rank/competitor SERP observations，以及受限的
  Backlinks provider index/明细 observations。
- 客户明确上传的 CSV 或 manual entry：必须保留 origin、actor、时间和限制。

OAuth connected、credential present 或 provider enabled 都不等于数据 available。
添加产品可以在持久化 Product Profile draft 后、自动画像 synthesis 启动前进入
一个明确可跳过的 GSC/GA4 只读授权步骤。该例外只允许同 project 的精确
`/p/{projectId}/setup-sources` return path；普通 Sources 页面、完整来源读模型和
未带该 intent 的连接仍要求 confirmed Product Profile。onboarding 中完成连接时
不以不完整 market/language 上下文提前采集；画像确认后的 Analysis Refresh 再
自动采集。用户未选择、取消或拒绝授权都不得阻断产品创建与公开证据生成。
规则只能消费已完成、未过期、scope 一致并且写入 canonical Snapshot /
Observation 的数据。缺数据必须成为 skipped/inconclusive/no_data/unavailable，
绝不能合成 0、虚构关键词、虚构竞品或虚构 before/after lift。
来源读模型必须把原始 provider/API 行数留在不可变快照详情中；GSC/GA4 卡片的
主指标只可聚合同一个最新 Snapshot 的 canonical Observation。成功请求但没有
规范化 Observation 时，必须显示“已连接但未检测到数据”，且不得计入可用覆盖。

GitHub 预留为未来代码交付连接；它不是当前分析数据来源。Sitemap、内部 Crawl、
keyword relation、topic model、competitor monitor、GEO citation 和 backlink
projection 是内置能力，不要求客户另行连接。

上述 authenticated workbench 的上下文投影与规则升级不改变 Public Tools。
公开工具继续是无 Profile 依赖、facts-only、匿名且受原有 quota/无 canonical
产品或报告持久化边界约束的独立 surface；不得复用 `contextProjection.v1` 推断
业务或执行上下文。

`createCollectionRun` 只允许客户触发 Crawl、已连接 GSC 或已连接 GA4；
CSV 继续使用专用 import command。DataForSEO Search Landscape 与 Backlinks 都是
Analysis Refresh worker 的内置 provider 步骤，客户不能通过 collection request
选择、配置或提供 target、limit、凭据/API key。
该写边界不移除 DataForSEO 的 canonical Source/Snapshot/Observation/Evidence
lineage，也不阻止 server-owned Analysis Refresh 运行其成本受限的可选步骤。

DataForSEO Search Landscape（DFS）当前 server-owned 身份为
`dataforseo.search_landscape.v3`；v1/v2 Snapshot 继续只读兼容。服务端从冻结
primary Site 的 host、单一 market、canonical language、服务端 row cap 与有真实
来源的种子生成固定请求。
ranked-keywords 查询 positions 1–100，competitors-domain 查询 max rank group 100；
当且仅当规范化后的 domain overlap 为空且存在冻结种子时，最多追加一次
SERP Competitors paid fallback。种子只可来自 GSC top query、Crawl 页面文本或
confirmed/current Product Profile，并在 scope 中保存 `sourceKind/sourceRef`；种子
不会被重标为 DataForSEO Observation。所有实际发起的请求共享同一
target/market/language 作用域，并原子形成一个 v3 Snapshot；任何 required Labs
call 失败都不能发布半个 Search Landscape。

v3 把自然搜索重叠度写成新的 canonical
`dataforseo.competitor_domain.v2` Observation，而不是重新解释旧的 intersection
count。其分子是该 competitor-domain 行的正整数 `intersections`；分母只能是同一
Snapshot、同一 target/market/language、同一 organic positions 1–100 policy 的
ranked-keywords `total_count`。不得使用返回行数、ranked-keywords `items_count`、
competitors-domain `total_count` 或 SERP Competitors `keywordsCount` 作为分母。
Observation 同时持久化分子、分母与 `serpOverlap = intersections / total_count`，并
要求 `0 < intersections <= total_count`、`0 < serpOverlap <= 1`。为使 JavaScript 与
PostgreSQL 对循环小数保持同一 wire value，ratio 必须使用正数 half-up 规则规范到小数
点后 12 位；不得依赖任一运行时的默认浮点/`numeric` 除法精度。旧 v1 metric 或缺少
任一 canonical operand 时 overlap 仍为 unavailable；`intersections` 继续独立公开为
共同关键词数，不能被重标为比例或相似度。

v3 还可在独立 `DATAFORSEO_AI_CITATIONS_ENABLED` rollout gate 下执行 bounded AI
citation 子能力。Analysis Refresh command 必须在同一 admission transaction 从当前
Keyword Library 选择与 Site exact market/language 一致、`query_kind =
'generative_query'`、approved 且 mapping-confirmed 的记录，按
`normalized_keyword, id` 确定性排序。eligible 总数必须恰好为 20（不足或多于 20 都
不得擅自选取子集），并冻结这 20 条的 entity id、revision、原文、market、language、
平台和 server-pinned model 后才允许付费请求；开关关闭或数量不等于 20 必须把子能力
冻结为 typed skipped state，不发起调用、不补写合成问题。query-set hash 必须覆盖这
20 条 exact identity/text、平台、model、market 与 language；客户端不能提交或改写
其中任何字段。

AI citation 使用 DataForSEO ChatGPT LLM Responses 的 server-owned live policy，固定
`web_search=true` 与 `max_output_tokens=1024`（同时满足 provider 当前 reasoning /
non-reasoning model 的边界），market 只映射到 provider 的 country scope；部署时固定
的 model 必须由 provider Models contract 证明支持 web search 与 country scope。一个 query 只有在
provider 成功返回可观察回答时才进入 observed denominator；provider 的 no-result
成为该 query 的 unavailable state。20 个 paid live request 必须以固定最大并发 1
顺序执行，不能用整批 fan-out 试探账户的 simultaneous-query quota；provider
`40202` / `40209` 只把对应 query 记为 typed unavailable 并保留脱敏 status，不能
重放已经完成的 sibling requests。AI 子能力的 partial/unavailable 只影响它自己的
raw evidence、aggregate 与 limitation；不得把完整的 ranked-keyword 或 organic
competitor-domain Observation、Snapshot coverage、limitation 降级为 partial。
competitor citation 只由响应
`items[].sections[].annotations[].url` 的 canonical HTTP(S) hostname 与 competitor
domain（自身或其 subdomain）匹配得出；答案文本中的名称或域名提及绝不能计为
citation。每个 competitor aggregate 必须持久化 `attemptedQueries=20`、
`observedQueries`、`citedQueries`、`unavailableQueries`、`querySetHash`、平台、请求
model、market、language 与 20 条 bounded query outcome lineage。`observedQueries=0`
时不得写 available aggregate 或 origin；完整 cohort 显示 `citedQueries/20`，partial
cohort 显示 `citedQueries/observedQueries` 并同时披露 20 次尝试和 unavailable 数。
只有至少一个 query 被真实观察时，显式 `citedQueries=0` 才是可公开的 measured zero。

DFS 自动把 ranked Keyword occurrence 与两类有区别的 competitor origin
（domain overlap / seed SERP）投影进当前资料库，不创建第五模块，也不接受客户
提交 target、location、language、limit、GenerativeQuery cohort、model 或 provider
credential。v3 同一 Snapshot 中通过上述校验的 AI aggregate 以独立 `ai_citation`
origin 追加；后续代码版本不得在读取旧 published generation 时重新计算这两个
metric，读模型只可投影冻结 origin 指向的 exact versioned Observation。

DataForSEO Backlinks 的 server-owned identity 为 `dataforseo.backlinks.v1`。服务端
只从冻结 primary Site host 与部署策略形成 exact scope，并分别冻结 live backlink、
referring-domain、target-page 与 source-page verification cap。该能力有独立的
`DATAFORSEO_BACKLINKS_ENABLED` rollout gate；它与全局 `DATAFORSEO_ENABLED` 默认都为
`false`，只有两者显式开启时才可运行。默认 cap 为 500 条 backlink、100 个
referring domain、500 个 target page 与 20 个 source-page verification；硬上限分别
为 1000、1000、1000 与 20，且 verification cap 不得超过 backlink cap。缺少开关、
凭据或 exact frozen scope 时该 optional step 必须明确 skipped/fail closed，不得改为
无界请求或由客户端覆盖。

同一个 collection 原子形成 `dataforseo.backlinks.v1` Snapshot 与规范化 summary、
backlink、referring-domain、target-page observations。provider summary 的 authority
scale 只能公开为 `dataforseo_rank`，绝不能重标为 Ahrefs DR 或 Moz DA；provider
index totals 与明细抽样的数量语义必须保留。系统只对 cap 内选中的 provider-discovered
source page 使用复用 SSRF 防护、DNS/IP pin、逐跳重验、timeout、redirect 与 body-size
上限的公共 HTML fetch 做二次验链。`verified/absent/blocked/inconclusive` 是独立的
crawler verification evidence；它不能改写 provider fact、把不完整 body 当作 absent，
也不能把未验证或不可用值合成为 0。

### 2.1 Durable Analysis Refresh

`createAnalysisRefreshRun` 是唯一 server-owned 的完整分析刷新 command。客户端
只能提交空 strict object，不能选择 provider、改变顺序、注入 Snapshot 或跳过
required step。command transaction 创建 `analysis_refresh` async run，并以
`analysis_refresh_run` resource identity 冻结 primary Site、confirmed ICP、
完整 plan manifest 与 plan hash；queue 名为 `refresh.analysis`。

新建父 run 固定冻结 `analysis-refresh.plan.v3` 七步，并持久化全部七行：

1. Crawl（required）；
2. connected GSC（optional；未连接时明确 skipped）；
3. connected GA4（optional；未连接时明确 skipped）；
4. built-in DataForSEO Search Landscape（DFS，optional；
   disabled/unavailable 时明确 skipped）；
5. built-in DataForSEO Backlinks（`dataforseo_backlinks`，optional；独立 rollout
   disabled/unavailable 时明确 skipped）；
6. Topic Model generation（`topic_model`，optional internal child）；
7. Growth Audit（required）。

Topic step 只在 confirmed Topic Model 与 draft 都不存在且有 eligible Keyword evidence
时创建一个 `kind=topic_model_generation`、
`result_type=topic_model_generation_run` 的 internal child；existing confirmed、existing
draft 或 insufficient evidence 必须以 typed skip reason 结束，不调用模型，也不创建
空 confirmed model。该 child 没有浏览器 create endpoint、provider option 或 reservation
API；客户仍只提交 Analysis Refresh 的空 strict object。

Topic generation 使用两个职责分离的 durable ledger：
`topic_model_generation_runs` 以 child `async_runs.id` 为主键，冻结 workspace、project、
parent refresh、bounded `topic-model-generation-input.v1` manifest、generation/prompt
version 与 hash；`topic_model_generation_invocation_attempts` 冻结每次实际 delivery 的
ordinal、`async_runs.attempt_count`、provider/model/config/hash、预算与一次性 terminal
outcome。两表及 immutable `AnalysisInvocation(task=topic_model_generation)` 只保存 bounded
metadata、hash、token/cost/latency 与 error code，绝不保存 raw prompt、raw provider
response、model output text 或客户秘密。

每次模型调用严格分为短事务内 freeze/reserve → 释放事务 → outside-transaction
structured provider call → 短事务内 persist immutable AnalysisInvocation/finalize → 原子
materialize。reservation 必须与 exact run attempt、provider、model、prompt set 与 input
hash 匹配；旧 attempt 的 `reserved` 或 `outcome_unknown` 会阻断静默重试，最多三次的
budget 由 ledger 分配。provider 已返回但结果是否被可靠持久化不明时只能一次性进入
`outcome_unknown`，不得把可能已计费的调用当作从未发生。

只有 revision 1 的 exact 九键 `llm_auto_confirmed` generation basis、同 scope 的
successful Topic `AnalysisInvocation`、matching successful reservation 与同一个 running
child 全部成立时，Topic Model 才允许 `confirmed_by=null` 的 `system_auto` confirmation；
其他 confirmed revision 仍要求 human actor，且任何 malformed/unknown lineage 都 fail
closed。generated Keyword fallback 只能是 canonical approved `system_suggestion`，必须
指向该 successful invocation、exact confirmed Topic revision 与非空 Topic node；
provider-observed、deterministic suggestion、migration baseline 与 user decision 必须保持
`analysis_invocation_id=null`，不得伪造模型 lineage。

历史兼容性按完整形状而不是 version 字符串猜测：

- `analysis-refresh.plan.v1` exact 五步 hash 为
  `d725c90b76edf0bd7747a8d3dcf18754dfa9c5356f66ca765acbaa4145e405af`；
- `analysis-refresh.plan.v2` exact 六步 hash 为
  `3049a718f77263f766e47d0d7318a9414520d07c8ab92960f50c85b864977c65`；
- `analysis-refresh.plan.v3` exact 七步 hash 为
  `fc527bb7203d61ce126625a0b2bb4bffb59fe5999d9f6b78e5aa05409918368b`。

v1 只能按原有 Crawl/GSC/GA4/DFS/Growth Audit ordinals 恢复；v2 只能按
Crawl/GSC/GA4/DFS/Backlinks/Growth Audit ordinals 恢复；v3 的 Topic/Growth Audit
必须分别保持 ordinal 6/7。published-generation reader 只接受上述 exact
manifest/hash/ordinal，保留 v1/v2/v3 readability；未知版本、已知版本的 shape drift、
错误 hash 或缺失 canonical child lineage 一律不可发布。历史 parent 不重写、不重分类，
新 run 不得再创建 v1/v2 manifest。

父 lifecycle 只来自 `async_runs`。step execution state 只能是
pending/running/completed/skipped/failed；optional failure/skip 不得伪装成功，
required failure 必须使父 run failed。父行与 step identity append-only，worker
只可推进 step execution state，并保留 child async run、result Snapshot、
skip reason 或 bounded error。最终 Growth Audit 必须消费本次 refresh 的
Crawl/GSC/GA4/DFS steps 产生并冻结的 exact Snapshot ids，不得在末步重新选择
“当时最新”数据。Backlinks Snapshot 独立投影进 Growth Map，不进入当前 12-rule
Growth Audit input，也不改变 operation/async/table/rule inventory。

详细 step read model 后续另行加入；当前客户端只通过既有
`getProjectRun` 的 progress/status 轮询，不新增 GET operation。

## 3. 概览

概览只回答四类客户问题：

1. 当前已确认的产品、市场与 ICP 是什么；
2. 哪些真实数据连接可用、最后观测时间和覆盖范围是什么；
3. 当前最优先的 Opportunity/Action/Artifact 是什么；
4. 当前审计中的 URL 组合、工作量与可继续步骤是什么。

加载态必须终止为 data、no_data、unavailable 或 problem；不得无限 loading。
四个概览卡都读取 canonical service projection，不读取浏览器内置 demo 数据。

## 4. 增长地图

URL 与所有显式 `diagnosticRunId` 的 list/detail GET 属于 published-generation
读取协议；Keyword/Competitor 当前资料库与已发布诊断快照必须明确分开：

- 可选 `diagnosticRunId` 必须是 canonical lowercase UUID，并且只能固定当前
  project 中一个已发布、可读的 DiagnosticRun generation。未知、跨租户、未发布
  或不可读的 pin 不得回退到 latest。
- Keyword/Competitor list 省略 `diagnosticRunId` 时读取当前 mutable 资料库，立即
  展示已经自动投影的 candidate，不以人工 review、cluster 或 publication 作为
  可见性前置条件；显式 pin 仍只读对应冻结 generation。URL 默认读取最新可读
  generation。
- `view=review` 只存在于 Keyword/Competitor detail GET，用于读取当前 mutable
  governance projection；URL read 与所有 list read 都不接受该参数。
- `view=review` 与 `diagnosticRunId` 互斥，重复 scalar 或未知 query 参数均返回
  validation problem，不能任选一个继续。
- Keyword/Competitor PATCH 是 mutation command，拒绝全部 query 参数；review
  语义只来自 strict governed request body。
- 当前 Growth Audit read-model projection 是 `growth-audit.0.3.1`；未指定 pin 的
  latest 读取只选择 `0.3.1`。显式 `diagnosticRunId` 可以读取已知
  `growth-audit.0.3.0` 历史 generation，但必须用其自身 validator，不得回填
  `contextProjection.v1` 或按当前规则重新解释。Growth Audit capability version
  保持 `0.3.0`；request/addressing shape 及其 `capabilityContractVersion` literal
  保持 `growth-audit.0.3.0`。

### 4.1 URL portfolio

- 列表支持多个 URL，选择任一行必须加载该 URL 的独立指标、Finding、Action 和
  Artifact refs。
- URL identity 来自同一 Project/Site 的冻结 Crawl 或已精确映射的 GSC/GA4
  Observation；不得 union 任意历史 URL。
- Click、position、conversion 与 opportunity signal 公开 provider、snapshot、
  observedAt、freshness 和 limitation。
- URL detail 的 Finding membership 来自当前 DiagnosticRun 的 immutable
  `finding_targets`，不从可变 summary 猜测。

### 4.2 Keyword Library

Current Keyword review detail may expose one nullable, server-owned pending
governance suggestion. A pinned published-generation detail always exposes
`pendingSuggestion: null`. The only one-click approval command is scoped to
the Keyword and suggestion identity and carries exactly
`expectedGovernanceRevision` plus the immutable `suggestionVersion`; the
client cannot submit suggested governance fields, actor identity, provider
facts, model configuration, or lineage.

`keyword_governance_suggestion_generation` is an internal async operation,
not a public selector: model, provider, prompt, and runtime configuration stay
server-owned. Its frozen manifest contains `workspaceId` and `projectId` and is
the canonical SHA-256 preimage; it contains no self-referential `inputHash`.
The generation-run envelope/row stores `sha256(canonicalJson(manifest))`
separately.

- 来源包括 GSC top query、DataForSEO Search Landscape ranked observation、
  competitor/content gap、VOC/manual/CSV；每条 occurrence 保留来源、scope
  和时间。
- GSC 与 DataForSEO 采集完成后必须在同一 canonical completion flow 自动 upsert
  occurrence/entity/source membership；当前资料库不得要求用户先建立空壳记录。
- keyword identity、review decision、cluster/topic mapping、existing/new target、
  relation candidate/decision 与 rank history 都是稳定、可追溯的治理面。
- volume、KD、current rank、competitor rank 等各自保留 Observation pointer；
  缺失字段独立 unavailable。
- 现有 `intent` 继续表示可治理的分类值并保持向后兼容；客户展示使用独立、必填的
  `searchIntent` 投影，明确携带 `value`、`authority`、Snapshot/Observation、
  AnalysisInvocation、`observedAt` 与 limitation。其解析优先级固定为：非空的
  user-confirmed 值 > exact provider-observed 值 > 带非空 AnalysisInvocation 的
  LLM-generated 值 > legacy governed 值 > unavailable。契约可以保留
  `llm_generated` wire literal，但只能输出带 exact successful
  `topic_model_generation` AnalysisInvocation lineage 的 generated decision。
- `provider_observed` 必须同时带 exact Snapshot、Observation 与 `observedAt`，且
  不得伪造 AnalysisInvocation；`llm_generated` 只能带 AnalysisInvocation；
  `user_confirmed`、`governed_legacy` 与 `unavailable` 不得携带 provider/model
  lineage，`observedAt` 也只能用于 provider observation。unavailable 必须保持
  `value=null` 并解释 limitation。
- `searchIntent.value` 与任何非空 limitation 必须是原样的 bounded string；首尾
  空白直接验证失败，不得通过 trim 或其他 coercion 改写后接受。该 exact 规则不
  改变既有顶层 governed `intent` 的向后兼容解析。
- provider-observed 与 LLM-generated 值只能是 `informational`、
  `navigational`、`commercial` 或 `transactional`；user-confirmed 与 legacy
  governed 仍允许向后兼容的 bounded 非空字符串。provider lineage 必须命中同一
  Keyword item 内一个 exact `dataforseo_ranked` occurrence。user-confirmed 必须
  对应 `reviewOrigin=user` 且值与 governed `intent` 一致；legacy governed 必须
  与 governed `intent` 一致且不得声称 user-confirmed；`reviewOrigin` 可为
  `migration_baseline`、`system_suggestion` 或 `null`，其中 `null` 表示该字段值及其
  provenance 早于 decision ledger/本契约；`unavailable` 只允许在
  `intent=null` 时出现。
- 已发布 generation 只从其冻结的 exact keyword decision 与 occurrence refs 解析
  `searchIntent`；不得读取或回退到更新的治理 decision、Observation 或模型调用。
- relation refresh 只产生候选；人工 decision 通过 optimistic revision 追加，
  不覆盖历史。

### 4.3 Competitor Library

- 产品画像可初始化直接/间接竞品；同一个 DataForSEO Search Landscape Snapshot
  产生的 domain overlap、seed-based SERP competitor、keyword gap、manual、
  AI citation 等来源以 typed origin occurrence 追加。domain intersection count
  与 SERP rating 必须保持不同 metric/shape，不得解释为百分比、相似度或已确认
  竞争关系；确定性规则只形成可编辑的直接/间接草稿。
- 自然搜索重叠度只读取 `dataforseo.competitor_domain.v2` 已持久化的 exact
  numerator/denominator/ratio；共同关键词继续读取其独立 `intersections` pointer。
  AI 引用只读取 `dataforseo.competitor_ai_citation.v1` 已持久化的 fixed-20 cohort
  aggregate。缺少 exact Observation、版本、market/language/model/query-set lineage
  或算术不一致时必须 fail closed 为 unavailable，不能在 read time 猜测或重算。
- 采集完成后自动 upsert 当前 Competitor Library；已发布诊断仍通过冻结的 origin
  refs 保持可追溯，后续资料库编辑不得改写旧 generation。
- candidate/approved/excluded、relationship 和 analysis scope 都有独立 revision；
  用户审核不能改写旧来源。
- dynamic monitor 只比较可比的 immutable snapshots，signal 必须带匹配关键词、
  URL、topic 与 limitation；首次发现不等于发布日期证据。

### 4.4 Technical / Content / GEO / CRO

- 12 条确定性规则覆盖 Technical SEO、Search、Content、CRO、GEO。
- `TECH-INDEXABILITY-006@1` 只在冻结 Crawl 中、对拥有唯一 exact-fetch lineage
  的 URL 判断 `page.status` 为 exact 2xx、`sitemapMember=true` 且
  `robotsIndexable=false` 的矛盾。redirect source 即使 terminal document 为 2xx
  也不触发；exact fetch 非 2xx 交给 HTTP/redirect 规则。本规则不能从 final
  response 猜测源 URL，缺失或歧义 lineage 必须 inconclusive。
- Topic Model、internal link map、backlink authority 与 GEO citation 都复用
  canonical URL/keyword/topic identity。
- DataForSEO Backlinks 是 `provider_import` authority；其 `dataforseo_rank` 与
  Ahrefs `domain_rating`、Moz `domain_authority` 是不可互换的 typed scale。
  cap 内 source-page 二次验链只补充独立 verification evidence，不改变 provider
  index total、coverage 或 Snapshot identity。
- Finding 默认 unreviewed；只有显式 review 才能形成或更新一个 primary Action。
- Opportunity 是 canonical facts 的只读 projection，不创建第二套 Opportunity
  table。

### 4.5 Opportunity execution preview

`executionPreview` 是 server-side pure projector 从当前 `ActionTemplate` 与 Project
`default_delivery_locale` 形成的 current-view 展示文案。reviewable/confirmed
Opportunity 与 Growth Map URL Finding 的该字段为 nullable；无可解析 template
时返回 `null`，不能合成内容。它不是 run replay input、Finding/Opportunity
identity、Action、Artifact、workflow state、approval/publication authority 或
Measurement lineage，也不得创建任何状态；历史 generation 不能因当前 template
变化而被写回。

## 5. 执行中心

1. 一个 primary Finding 只拥有一个 canonical Action。
2. Action execution state 由 append-only step definitions 和 state events 投影；
   batch read 与单 Action timeline 必须一致。
3. Artifact 只能从 Action 创建；内容变化追加 immutable ArtifactRevision。
4. 支持的客户交付包括 Content Brief、English Blog Draft、Metadata Rewrite、
   Technical Ticket/Code Patch 及其可审核 revision。
5. Content Shadow 冻结 ICP、目标 URL、关键词簇、竞品集、Research Pack、prompt、
   provider/model、输入输出 hash 与 QA verdict。
6. approval event 精确绑定 Artifact、revision、content hash、QA snapshot 和 actor；
   revoked/superseded 不删除历史。
7. UI 的批准、修改、重新生成、执行状态与分享动作必须进入对应 route/dialog，
   不得只显示 toast 或修改浏览器内存。

Content Shadow state: **reviewed, not published**

## 6. Publication authority 与外部写入边界

v0.4 的数据库与 HTTP 已激活：

- delivery authorization、Artifact approval ledger；
- GitHub/WordPress destination/preview/attempt/receipt 的严格 persistence；
- publish / rollback preview 的 issue 与 revoke；
- Delivery Receipt → verified Change Receipt lineage；
- measurement clock 对 verified Change Receipt 的引用。

preview 是短期、server-issued authority，不是外部写入；Delivery Receipt 也不
证明内容 live。只有同 provider、同 artifact content、同 remote scope 且完成
live canonical URL 验证的 Change Receipt 才能成为 Measurement Window anchor。

Current v0.4 external-write boundary: **no external writes**

当前 80 个 operation 不包含真正执行 GitHub PR/merge 或 WordPress publish 的
publication-attempt command。production UI 必须把这类能力显示为
unavailable/尚未连接，而不能写“已发布”。新增外部写入必须原子加入 provider
adapter、worker handler、idempotency、remote precondition、rollback、
reconciliation、route/OpenAPI 与测试。

## 7. 效果追踪

- Results 从 immutable Measurement Window 读取，不从 Artifact status 推断效果。
- before/after 时间窗由服务端从 verified Change Receipt 的 changedAt 对称冻结；
  浏览器不能提交窗口、目标、provider、metric 或结果。
- GSC、GA4/UTM、keyword rank 与 GEO citation 各自保留 Snapshot/Observation
  lineage。
- insufficient_data、not_observed、provider unavailable 与真实 0 必须区分。
- before/after 是 observation，不自动声明 causality；limitation 在客户界面可见。
- `createProjectMeasurementWindow` 虽返回 `202`，使用专用 accepted envelope，
  其 measurement window identity 与 run status 都必须可继续读取。

## 8. 安全、隔离与运行

- same-origin API、HttpOnly session、CSP nonce 与 Supabase session refresh 是
  production request boundary。
- 页面未登录时重定向 `/login?next=...`；API 由 route auth 返回 401 problem。
- 除 login 与 health 外页面不公开。health 不依赖用户 session，但 ready 必须
  真实检查数据库、迁移、queue 与 worker。
- repository 查询以 workspaceId/projectId 同 SQL scope；未知或跨租户 child ID
  返回 404。
- `app` schema 对 Supabase `anon` / `authenticated` 无 USAGE/table 权限。
- dev auth 只在 development + exact loopback APP_ORIGIN + explicit flag 成立；
  production/staging/test 均 fail closed。
- 所有异步 canonical command 在同一 DB transaction 写 run/domain/idempotency/
  pg-boss job；active key 与 idempotency 防重复副作用。
- Crawl/provider 网络及 Backlinks source-page verification 遵守 SSRF、防私网、
  DNS/IP pin、redirect 逐跳重验、timeout/body cap 与 credential redaction；只有完整
  2xx HTML 无匹配时才可记录 `absent`。

## 9. 冻结 API inventory

以下列表必须与 OpenAPI 的 80 个 operationId 完全一致。

<!-- API_OPERATIONS_BEGIN -->
- `listProjects`
- `createProject`
- `getProject`
- `deleteProject`
- `getProjectContext`
- `updateProjectContext`
- `getProjectProductProfile`
- `updateProductProfileDraft`
- `createProductProfileSynthesisRun`
- `reviewProductProfileCompetitor`
- `addProductProfileCompetitor`
- `confirmProductProfile`
- `getProjectWorkspaceView`
- `listProjectSources`
- `connectProjectSource`
- `handleGoogleOAuthCallback`
- `importProjectSourceFile`
- `disconnectProjectSource`
- `createCollectionRun`
- `createAnalysisRefreshRun`
- `listProjectSnapshots`
- `getProjectRun`
- `createDiagnosticRun`
- `createGrowthAuditRun`
- `createContentShadowRun`
- `listContentShadowRuns`
- `getContentShadowRun`
- `reviewContentShadowRevision`
- `createActionRecheck`
- `listProjectAuditUrls`
- `getProjectAuditUrl`
- `getProjectAuditInternalLinkMap`
- `getProjectAuditBacklinks`
- `getProjectAuditTopicModelWorkspace`
- `getProjectAuditTopicModelInsights`
- `beginProjectAuditTopicModelDraft`
- `patchProjectAuditTopicModelDraft`
- `confirmProjectAuditTopicModelDraft`
- `listProjectAuditKeywords`
- `getProjectAuditKeyword`
- `reviewProjectAuditKeyword`
- `approveProjectAuditKeywordReviewSuggestion`
- `getProjectAuditKeywordRankHistory`
- `listProjectAuditKeywordRelations`
- `refreshProjectAuditKeywordRelations`
- `getProjectAuditKeywordRelation`
- `decideProjectAuditKeywordRelation`
- `listProjectAuditCompetitors`
- `getProjectAuditCompetitor`
- `reviewProjectAuditCompetitor`
- `getProjectAuditCompetitorMonitor`
- `updateProjectAuditCompetitorMonitor`
- `listProjectFindings`
- `reviewProjectFinding`
- `listProjectActions`
- `updateProjectAction`
- `getArtifactExecutionStateBatch`
- `getActionExecutionStateTimeline`
- `updateActionExecutionState`
- `listProjectArtifacts`
- `createActionArtifact`
- `getProjectArtifact`
- `updateProjectArtifact`
- `appendArtifactApprovalEvent`
- `getProjectReport`
- `createProjectExport`
- `getProjectExport`
- `getProjectGrowthAudit`
- `getProjectAuditModule`
- `listProjectOpportunities`
- `getProjectOpportunity`
- `getProjectResults`
- `issuePublicationPreview`
- `issuePublicationRollbackPreview`
- `revokePublicationPreview`
- `getProjectRecentMeasurementWindows`
- `getProjectMeasurementTargetKeywordRanks`
- `getProjectMeasurementGeoCitations`
- `createProjectMeasurementWindow`
- `getProjectMeasurementWindowHistory`
<!-- API_OPERATIONS_END -->

十个共享 AsyncAccepted operation：

<!-- ASYNC_OPERATIONS_BEGIN -->
- `createProductProfileSynthesisRun`
- `importProjectSourceFile`
- `createCollectionRun`
- `createAnalysisRefreshRun`
- `createDiagnosticRun`
- `createGrowthAuditRun`
- `createContentShadowRun`
- `createActionRecheck`
- `createActionArtifact`
- `createProjectExport`
<!-- ASYNC_OPERATIONS_END -->

## 10. 冻结数据库 inventory

以下 80 张应用表来自 `0001_init.sql` 至
`0048_topic_model_generation.sql` 的 48 个 ordered migrations 与
static schema catalog；pg-boss 自有表不计入。

<!-- TABLES_BEGIN -->
- `workspaces`
- `operator_profiles`
- `client_projects`
- `sites`
- `icp_profiles`
- `source_connections`
- `source_credentials`
- `oauth_intents`
- `import_previews`
- `async_runs`
- `analysis_refresh_runs`
- `analysis_refresh_steps`
- `collection_runs`
- `data_snapshots`
- `normalized_observations`
- `provider_discrepancies`
- `diagnostic_runs`
- `diagnostic_run_rules`
- `analysis_invocations`
- `evidence`
- `findings`
- `finding_observations`
- `finding_review_events`
- `actions`
- `action_override_audit`
- `execution_artifacts`
- `artifact_revisions`
- `export_bundles`
- `idempotency_keys`
- `telemetry_events`
- `capability_runs`
- `audit_runs`
- `audit_module_results`
- `site_pages`
- `page_snapshots`
- `product_profile_runs`
- `product_profile_invocation_attempts`
- `topic_model_generation_runs`
- `topic_model_generation_invocation_attempts`
- `finding_targets`
- `keyword_occurrences`
- `keyword_entities`
- `keyword_entity_sources`
- `competitor_entities`
- `competitor_origin_occurrences`
- `flow_shadow_runs`
- `flow_shadow_research_packs`
- `flow_shadow_qa_gates`
- `delivery_authorization_grants`
- `artifact_approval_events`
- `publication_destinations`
- `publication_preview_events`
- `publication_attempts`
- `publication_receipts`
- `measurement_windows`
- `measurement_gsc_dimensions`
- `measurement_ga4_dimensions`
- `measurement_geo_dimensions`
- `measurement_utm_identities`
- `measurement_ga4_campaigns`
- `topic_model_revisions`
- `topic_node_identities`
- `topic_node_revisions`
- `topic_cluster_aliases`
- `topic_node_successors`
- `keyword_review_decisions`
- `keyword_relation_identities`
- `keyword_relation_candidates`
- `keyword_relation_decisions`
- `action_execution_step_definitions`
- `action_execution_state_events`
- `competitor_monitor_settings`
- `competitor_monitor_runs`
- `competitor_monitor_evaluations`
- `competitor_monitor_signals`
- `geo_query_observations`
- `geo_citation_occurrences`
- `backlink_authority_snapshots`
- `backlink_facts`
- `backlink_page_metrics`
<!-- TABLES_END -->

## 11. 冻结规则

规则集 `mvp.rules.0.2.4` 的 12 条规则与版本：

<!-- RULES_BEGIN -->
- `TECH-HTTP-001`: 2
- `TECH-CANONICAL-002`: 2
- `TECH-INDEXABILITY-006`: 1
- `TECH-LINKGRAPH-005`: 3
- `SEARCH-CTR-004`: 1
- `SEARCH-DECAY-002`: 1
- `CONTENT-COVERAGE-001`: 1
- `CONTENT-GAP-011`: 2
- `CRO-PATH-001`: 1
- `CRO-LANDING-003`: 1
- `GEO-ENTITY-001`: 1
- `GEO-CRAWLER-002`: 1
<!-- RULES_END -->

规则输出只能是 deterministic pass/candidate/skipped/inconclusive 及其 Evidence。
阈值或 Evidence shape 改变必须 bump 对应 rule version；registry、ALL_RULES、
lock、authority 与 export manifest 必须同时变化。

## 12. 原子变更与验收

active surface 的任何扩展必须在同一 reviewed change 中更新：

1. OpenAPI 与 generated contracts；
2. route/service/repository/worker/provider implementation；
3. ordered migration、schema catalog 与 schema smoke；
4. authority mirror/generated schema、narrative marker blocks；
5. active lock inventory、versions 与 hashes；
6. positive、negative、cross-scope、idempotency、no-data 与 failure tests。

最低验收：

- `pnpm verify:authority`
- `pnpm verify:spec`
- `pnpm verify:spec:test`
- `pnpm implementation:check`
- `pnpm contracts:check`
- `pnpm openapi:lint`
- `git diff --check`

验证器必须在 operation、shared async classification、migration/table、generated
schema、mirror bytes、rule version、active pointer 或 reviewed hash 被故意修改时
失败。CI 不自动重算 lock；显式运行 lock generator 只准备待审核变更，不等于批准。
