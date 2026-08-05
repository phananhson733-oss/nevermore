# SEO Audit Prompt → URL Opportunity 判断逻辑设计

**状态：** 2026-08-05 用户已批准推荐方案 C

**基线：** `origin/main@1bc2a5c`

**隔离工作树：** `/Users/wzb/Code/nevermore/seo-audit-opportunity-logic-v1`

**客户范围：** 登录后 GenGrowth 四模块工作台
**外部评审：** [ChatGPT Pro 设计复核](https://chatgpt.com/c/6a72f022-b9bc-83e8-b228-9729cd485627)

## 1. 背景与目标

用户提供了一套“技术 SEO 全站审计与转化增长闭环”Prompt。该 Prompt 的
输入中，网站、产品类型、核心业务、目标用户、目标地区等内容已经部分或完整
存在于 GenGrowth 的 Site、confirmed Product Profile/ICP 和数据 Snapshot 中；
技术检查清单中的部分事实也已经存在于 Crawl canonical observations。

本设计的目标不是把整套 Prompt 原样放进运行时，而是把其中有效要求拆到现有
canonical chain 中，使 URL、Topic、Keyword、Technical、Content、CRO 和 GEO
机会更完整、更可执行，同时维持：

```text
Project / confirmed Product Profile
→ immutable Snapshot / Observation
→ Evidence
→ deterministic Finding
→ human Review
→ exactly one Action
→ Artifact Revision / Approval
→ verified Change Receipt
→ immutable Measurement Window
→ Results
```

成功标准：

1. 已有画像和数据不需要由用户在审计 Prompt 中重复填写。
2. 新的技术机会必须来自冻结 Observation 和确定性规则。
3. URL Opportunity 必须保留 exact target、Evidence 和 run/snapshot lineage。
4. reviewable Opportunity 能显示可执行的下一步，但不能提前创建 Action。
5. 缺失、不可用、部分覆盖和不适用保持不同语义。
6. LLM 只用于受限解释和 Artifact，不产生事实、风险、优先级或 ROI。
7. 历史 DiagnosticRun 可按其原 generation 重放，不被新编译器回填。

## 2. 权限与非目标

本任务当前授权：

- 读取仓库、Active Authority 和本地环境；
- 在隔离 worktree 修改本地文档、代码和测试；
- 运行不涉及真实用户数据或外部写入的本地验证；
- 使用已登录的 ChatGPT Pro 做设计复核，但没有源码上传授权，外部评审只收到
  自包含的事实摘要和用户 Prompt。

当前未授权：

- commit、push、创建 PR；
- deploy；
- 对共享、Hosted 或 Production 数据库执行 migration；
- 修改线上配置或客户站点；
- 上传仓库源码、补丁、客户数据或内部文档到外部服务；
- 启用 GitHub、WordPress、CMS 或其他 provider external writes。

非目标：

- 不修改 Public Tools 的 facts-only 合同；
- 不建立第二套 Opportunity truth、priority、Action policy 或 Measurement policy；
- 不在首期实现 hreflang、CWV、JavaScript rendering、image hygiene、security
  headers、服务器日志 bot classification 或 AI citation visibility；
- 不承诺排名、流量、转化或收入效果；
- 不把 7/14 天提醒建模成 Measurement Window；
- 不实现自动修改 robots、sitemap、canonical、noindex 或生产代码。

## 3. 方案比较与决策

### 方案 A：运行时大 Prompt

每次把画像、站点、数据可用性、审计清单、执行要求和输出格式全部拼入模型
Prompt。

优点是 Demo 快；缺点是重复输入、不可稳定重放、容易让模型越权判断
applicability、severity、confidence、priority、risk 和 ROI，并与 server-owned
Analysis Refresh 冲突。

**决策：拒绝。**

### 方案 B：仅报告或 Artifact 模板

只保留原 Prompt 的章节、验证清单、回滚步骤和复盘格式，用于报告或技术工单。

该方案可以改善交付表达，但不会扩大真实 Opportunity coverage。

**决策：作为方案 C 的下游组件保留，不单独采用。**

### 方案 C：分层嵌入现有 canonical chain

将画像和站点事实编译成 run-local context；将检查项实现为确定性规则；复用
Evidence、Finding 和 GrowthOpportunity projection；将执行信息从现有
ActionTemplate 投影为只读 preview；继续使用现有 Review、Action、Artifact 和
Measurement 主链。

**决策：采用精简版方案 C。**

精简版明确不新增以下顶层版本对象：

| 拟议对象 | 首期判定 | 原因 |
| --- | --- | --- |
| `AuditPolicyVersion` | Drop | Growth Audit 已有 scope，Analysis Refresh 是 server-owned 固定编排 |
| `SiteTechnologySnapshot` | Defer | 首批规则不依赖 tech stack；未来应先建 typed Observation/Evidence |
| `RuleCoverageRegistryVersion` | Drop | 复用 rule registry 和 rule-set version，coverage 由运行输入派生 |
| `OpportunityProjectionVersion` | Drop | 现有 projection 已有确定性 key、Evidence、limitations 和唯一 Action 约束 |
| `ActionPolicyVersion` | Drop | ActionTemplate 已固定 artifact type、effort、risk 和 copy |

## 4. 六层职责分解

| 层 | canonical owner | 本设计中的职责 |
| --- | --- | --- |
| 输入上下文 | Site、confirmed Product Profile、reviewed governance | 自动复用业务和站点事实，生成有来源的 run-local projection |
| 采集/规则 | immutable Snapshot/Observation、rule registry | 确定性判定；不调用模型决定是否命中 |
| Evidence/状态 | Evidence、coverage、rule result | 区分 available、partial、unavailable、no_data、inconclusive、failed、not_applicable |
| Opportunity | 现有 GrowthOpportunity projection | 保持确定性 key、target、Evidence、queries、limitations；增加 execution preview |
| Action/Artifact | Review、ActionTemplate、Action、Artifact Revision | Review 后创建唯一 Action；LLM 只生成受限 Artifact 内容 |
| Measurement | verified Change Receipt、Measurement Window | 保持固定 28-day before/after 和 observational_non_causal |

模型不得生成或覆盖：

- 数据是否可用；
- rule applicability；
- severity、confidence、priority、roadmap lane；
- ActionTemplate risk、effort、artifact type；
- audit mode 或 external-write capability；
- published/deployed/applied 状态；
- attribution、Measurement Window 或 ROI；
- 技术栈、后端、数据库、CDN 等未观察事实。

## 5. Prompt 字段与 canonical owner

| Prompt 字段 | canonical owner | 首期行为 |
| --- | --- | --- |
| `website_url` | `Site.origin`、URL inventory | 直接复用，不写入 Product Profile 副本 |
| `site_type` | Product Profile `category/productType/businessModels` | 编译映射，不新增自由文本 `siteType` |
| `core_business` | `productName/oneLiner/valueProposition/coreFeatures` | 直接复用 |
| `target_users` | primary `targetAudience` 及 JTBD、roles、pains、use cases | 直接复用 |
| `target_region` | Product Profile `targetMarkets` + Site market scope | 不同 owner 冲突时显式呈现，不静默选值 |
| `languages` | `Site.languageCodes` | 按 RFC 5646 验证并原样冻结声明顺序与拼写；空数组表示 unknown；禁止回退到 delivery locale |
| `conversion` | 长期拆成 business intent、URL target 和 measurement mapping | MVP 只读现有 generation；缺失时 CRO 精确降级 |
| `tech_stack` | 未来 Site-scoped typed Observation/Evidence | MVP 不新增、不允许模型猜测 |
| `available_data` | frozen snapshots | 不接受自由文本声明作为数据可用性事实 |
| `mode` | server command/capability boundary | 不进入 Profile、Site 或 context projection |
| `priorityUrls` | 未来 reviewed URL inventory/governance | legacy 值只做有来源兼容；新 Profile 不回填字符串数组 |
| technical/resource constraints | 未来 execution constraint context | 只有真实声明来源时投影，否则 missing |

### 5.1 Conversion 的长期归属

旧 `CompleteIcpProfileInput.primaryConversion` 将三种语义混在一起：业务希望的
转化、具体 URL、以及可能的分析事件。长期合同应拆分为：

1. Product Profile：稳定的 business conversion intent，例如 signup、demo、
   purchase；
2. URL governance：实际转化入口和目标 URL；
3. Measurement governance：GA4 event、conversion definition 和 attribution
   mapping。

这项拆分不属于 S1–S3。首期不得为了 Prompt 完整度而双写或回填历史 Profile。

## 6. `contextProjection.v1`

### 6.1 定位

`contextProjection.v1` 是 `DiagnosticRun.input_manifest` 内的 exact-key、
hash-covered、run-local compiler output。它：

- 不建表；
- 不建独立 ID 或 mutable pointer；
- 不提供 CRUD；
- 不成为 Site/Profile/Snapshot 之外的新 authority；
- 只由 run creation writer 生成；
- 随 manifest 一起进入 `input_hash`；
- 由对应 executor generation 解析；
- 不能由当前编译器回填历史 Run。

### 6.2 最小内容

首版只承载跨 Profile generation 容易漂移、且规则路由或受限说明需要的
normalization：

```text
contextProjection.v1
├── schemaVersion
├── compilerVersion
├── profileGeneration
├── productRouting
│   ├── productType / businessModels
│   ├── primaryMarket
│   └── primaryAudience reference/summary
├── siteLanguage
│   ├── state: declared_non_empty | declared_empty
│   └── languageCodes[]
├── primaryConversion
│   ├── state: available | missing
│   ├── sourceKind
│   └── value?          # 只在该 generation 有 canonical value 时
├── priorityUrlSubjects
│   ├── state: available | missing
│   ├── sourceKind / sourceHash?
│   └── normalizedRefs[]
└── declaredExecutionConstraints
    ├── state: available | missing
    ├── sourceKind
    └── technical[] / resource[]
```

这里的 `productRouting` 是 pinned Profile 的机械投影，不是第二份可编辑事实。
Manifest writer 必须验证其来源 Profile ID/content hash；reader 继续验证 Profile
lineage 和 manifest hash。Site 当前不是 append-only，因此 `siteLanguage` 是
run creation 时的冻结值，后续 Site 修改不得改变该 Run。
当前 worker 读取还必须使用 immutable Profile 与其 content hash 重编译
Profile-derived 子树，并与 manifest 做 canonical equality 校验；重编译时
沿用已冻结的 Site language 数组，不从后续可变 Site row 回读语言。

### 6.3 明确排除

- 不复制 manifest `snapshots[]` 已经表达的 provider availability；
- 不写 audit mode、permission intent、workflow state；
- 不写 P0–P3、severity、confidence、priority 或 risk；
- 不写 AI 推断、自由文本 tech stack、估算数据或 ROI；
- 不写 7/14/28 cadence；
- 不写 applied、published、deployed 或 measured 状态。

### 6.4 Profile generation 规则

编译器必须先判断明确的 profile schema generation，再使用该 generation 的固定
字段映射。禁止：

- `newValue ?? legacyValue` 式跨 generation 隐式 merge；
- 根据内容相似度猜 profile 类型；
- 将 legacy 字段静默升级成 URL-first confirmed Product Profile 字段；
- 双写新旧合同；
- 回填历史 profile 或 historical run。

### 6.5 Language 行为修正

当前 URL-first create 会写入空的 `Site.languageCodes`，而 engine 仍可能使用
`defaultDeliveryLocale` 判断网站是否英文。新行为：

- `languageCodes.length > 0`：按 Site language 路由；
- 保留 Site 已声明数组的顺序、原始拼写与原始成员；不用 `Intl` 改写、去重或重排。这使 manifest 与创建时的 Site authority 保持字节一致，也覆盖合法的 grandfathered/private-use tag；
- 空数组：`declared_empty/unknown`；
- language-sensitive rule 在 unknown 时返回 `inconclusive`；
- `deliveryLocale` 只决定客户可见 copy；
- 不从市场、受众、浏览器 locale 或模型输出推断站点语言。

### 6.6 Version 与 persistence 边界

现有 worker、DB trigger 和 repository read boundary 对 manifest exact keys、
rule set 和 prompt set 做 fail-closed 校验；当前没有独立持久化的 executor 或
manifest-compiler version 列。为避免再造一套版本 authority，首期把新 manifest
shape 与第 12 条规则共同绑定到新的 rule-set generation。实现必须：

- 为新的 `mvp.rules.0.2.4`（实施时核对后固定）定义新的 exact manifest shape；
- 旧 executor generation 保留旧 shape；
- `contextProjection.compilerVersion` 继续用于内容自描述和 parser 校验，但
  executor selection 仍由 persisted rule-set/prompt-set pair 决定；
- 将主审计 read-model 的 `GROWTH_AUDIT_PROJECTION_VERSION` 从
  `growth-audit.0.3.0` bump 到 `growth-audit.0.3.1`，避免 latest-readable
  selector 把旧 11-rule 投影与新 12-rule/context-aware 投影当作同一代；
- latest-readable 只选当前 `growth-audit.0.3.1`；显式指定历史
  DiagnosticRun ID 的读取可以继续允许已知的 `growth-audit.0.3.0`，
  但必须按该 Run 自身的 rule-set/manifest generation 校验，不得升级或
  回填 `contextProjection`；
- projection bump 后，项目在完成新 `0.3.1` audit 之前，latest-current
  Growth Map、Overview/模块投影和 Opportunities 均可能暂无当前代结果；
  这是避免新旧 truth 混读的 fail-closed rollout 行为；
- `GROWTH_AUDIT_CAPABILITY_VERSION` 与
  `GROWTH_AUDIT_CAPABILITY_CONTRACT_VERSION` 保持不变：公开 request shape、
  scope 和 capability addressing 维度均未改变；
- S1 与 S3 可以按测试和提交顺序开发，但 authority/DB promotion 必须原子完成；
- 不新增 executor-version 数据库列或独立版本表；
- 不因本设计自动 bump prompt-set version；
- 如数据库触发器约束 manifest shape，允许新增一份只修改约束/函数的 migration
  文件，但本任务未授权对共享或生产数据库执行 migration。

数据库 migration 至少需要同步重建
`app.expected_diagnostic_rule_version(...)` 与
`app.enforce_finding_target_lineage()`。后者将新 rule 映射到
`direct_url`，并要求 `resolved + crawl_exact_fetch`；现有通用 lineage
guard 继续验证 exact SitePage/Observation/PageSnapshot，不新增第二个
URL lineage authority。

## 7. Opportunity `executionPreview`

### 7.1 数据来源

`executionPreview` 由一个 server-side 纯 projector 使用现有
`ruleId → ActionTemplate` 映射构建。它进入 `GrowthOpportunity` 合同，同时由
同一 helper 镜像到现有 `GrowthMapUrlFinding` read model，供当前 URL detail rail
直接渲染。Growth Map 当前不消费 `/opportunities` API；复用 helper 可以避免为
每张 Finding 卡追加一次 Opportunity detail 请求，也不会形成第二套 truth。

不得由 UI 自己 join，因为真正 Action 的 copy 使用项目
`defaultDeliveryLocale`，不是浏览器当前 locale。Growth Map read context 因此要
保留 server 读取到的 project delivery locale；request `uiLocale` 仍只控制
chrome copy。

建议输出：

```text
executionPreview
├── templateId
├── templateVersion
├── artifactType
├── effort
├── risk
├── contentLocale
├── title
├── description
└── expectedOutcome
```

UI 将 `expectedOutcome` 标为“验证目标”或“预期可观察信号”，不得显示为效果
承诺。

### 7.2 安全边界

- preview 不包含 `actionId`、status、revision、baseRevision、queued 等字段；
- 读取 reviewable Opportunity 不创建 Action，不消耗 idempotency key；
- 不进入 DiagnosticRun hash、historical replay、approval、publication 或
  Measurement lineage；
- 它是 current-view presentational copy；项目 delivery locale 变更后可变化；
- Finding 仍必须经 Review，确认事务才创建唯一 Action；
- RuleId/ActionTemplate registry 应保持穷举；若运行时出现缺失映射，Opportunity
  Evidence 仍可读取，但 confirm 必须 fail closed，不能调用模型补建议。

## 8. 第一条新规则：Sitemap 包含不可索引 URL

暂定 ID：`TECH-INDEXABILITY-006`。实施时须先核对 active registry 后固定。

### 8.1 Predicate

只在以下条件全部成立时生成 candidate：

1. 使用与 DiagnosticRun 绑定的 Crawl snapshot；
2. snapshot availability 为 `available` 或 `partial`；
3. exact URL 有 crawl page observation lineage；
4. exact fetch identity 的 `page.status` 为 2xx；
5. `sitemapMember === true`；
6. `robotsIndexable === false`。

第一版不做 `priority_noindex`，也不让模型判断页面“应该被索引”。不能只使用
`finalStatus`：Crawl projection 会把终点 HTML 的 robots facts 保留在起始
`fetchUrl` 记录上；若只要求 `finalStatus=2xx`，`301 → 200 noindex` 会把终点
noindex 错归给 sitemap 中的重定向源。要求 exact `page.status=2xx` 与现有
canonical rule 的归因边界一致。

### 8.2 Target 与 Evidence

- target relation：`direct_url`；
- target ref：exact observed URL；
- evidence origin/method：沿用 Crawl direct-public observed lineage；
- evidence claim：精确描述 sitemap membership 与 observed indexability
  contradiction；
- evidence limitation：partial crawl 时说明只证明该 observed URL，不宣称全站
  sitemap 完整性。

### 8.3 与现有规则的去重边界

- exact fetch 非 2xx 页面由 `TECH-HTTP-001` 或后续 redirect rule 处理，本规则
  不重复创建 candidate；
- 不复用旧 RuleId；必须新增 registry item 和 rule version；
- 不改变 canonical priority derivation；
- 不因 legacy priority URL 或模型判断提升 severity；
- Opportunity key 继续使用现有 `target/ref/ruleId`；
- 历史 rule set 不出现新 Finding。

### 8.4 ActionTemplate

- artifact type：`technical_ticket`；
- risk：`high`，因为 noindex/sitemap 变更可能影响收录；
- 动作语义：人工确认页面预期索引状态，然后解除矛盾；
- 不预先规定一定删除 sitemap entry 或一定移除 noindex；
- 不执行生产写入；
- expected outcome 只描述可验证状态：同一 URL 的 sitemap membership 与
  indexability signal 不再冲突，同时保留预期 canonical/URL。

## 9. 错误与降级行为

| 情况 | 必须行为 |
| --- | --- |
| Site language 为空 | language-sensitive rules `inconclusive`；不得使用 delivery locale |
| 新 Product Profile 缺 primary conversion | Technical/Search/Content 继续；依赖 conversion 的 CRO rule 明确 skipped/inconclusive + limitation |
| GSC/GA4/DFS 不可用 | 相关 rule `no_data/unavailable`；不得填 0 |
| Crawl partial | 只对 exact observed subjects 下结论；不得宣称全站通过 |
| 未观察 tech stack | 不生成 framework/backend/CDN-specific 建议 |
| context schema/hash 不符 | Run/read boundary fail closed |
| LLM 失败 | deterministic Finding、Opportunity 和 executionPreview 仍可用；Artifact generation 单独失败 |
| ActionTemplate 缺失 | Evidence/Opportunity 可读；confirm fail closed；不得模型补齐 |
| Finding 已有 Action | 返回现有唯一 Action，不创建重复 Action |
| 没有 verified Change Receipt | 不创建 Measurement Window，不显示发布后效果 |
| 没有 external-write capability | 只能生成 Action/Artifact/preview，不显示 applied/deployed/published |

## 10. 原 Prompt 中的产品化规则

### 10.1 直接保留为不变量

- 结论必须来自真实代码、页面或数据；
- 不制造流量、排名、收录、转化或收入；
- 保护既有 URL、canonical、主题和历史权重；
- 不做关键词堆砌、隐藏文字、虚假评价、虚假作者或误导 schema；
- 每个技术问题保留 Evidence、位置、风险和验证方法；
- 高风险变更必须 Review/Approval，并支持回滚计划；
- 缺数据明确说明，不用估计值代替。

### 10.2 转为条件化模板或 UI 提示

- FAQ、目录、步骤、表格；
- 2–5 个站内链接；
- 低风险/观察/高风险分组；
- 7/14 天提醒；
- 分批修改与发布后复核；
- “问题—影响面—假设—验证目标”报告结构。

这些内容按页面类型、Action 类型和 Evidence 决定，不成为所有页面的固定规则。

### 10.3 拒绝成为 canonical invariant

- 固定 60/25/15 内容配比；
- 最多追问 5 个；
- P0–P3 作为第二套 priority；
- 固定 attribution precedence；
- 所有文章都强制 FAQ/目录/固定内链数；
- AI 自动识别不可公开观察的技术栈；
- 无 baseline 的预计影响百分比或 ROI；
- preview/Artifact ready 被解释为已发布；
- 7/14 天成为与现有 28 天 Measurement 并列的新 truth。

## 11. MVP 切片与验收

### S1：Run-local context projection

交付：

- generation-aware context compiler；
- 新 manifest/executor generation；
- Site language freeze 和 unknown 语义；
- manifest writer/read boundary 校验；
- 必要的 authority/schema/DB constraint 更新；
- replay 和 backward-compat tests。

验收：

- 相同冻结输入 + 相同版本生成稳定 projection/hash；
- draft profile 变化不影响 Run；
- confirm 新 Profile 只影响新 Run；
- Site 修改不改变已启动 Run；
- 历史 Run 不回填、不重算；
- 明确语言项目保持行为；未知语言项目不再回退 delivery locale；
- snapshots availability 不在 context 中重复持久化；
- context 不含 mode、permission 或 LLM judgement。

S1 的代码可以先完成测试，但不得以旧 rule-set version 写入新 manifest，也不得
在 S3/authority 尚未原子更新时部署。

### S2：Read-only execution preview

交付：

- GrowthOpportunity 与 GrowthMapUrlFinding contract/OpenAPI 增加同一 preview
  schema；
- 共享 server projector 使用 ActionTemplate 和 project delivery locale；
- Growth Map reviewable/confirmed UI 展示；
- projection、locale、zero-write 和唯一 Action tests。

验收：

- reviewable read 不新增 Action；
- preview 不改变 key、priority、Evidence、readiness；
- confirm 后仍只有一个 Action；
- preview 不进入 run/replay/measurement authority；
- 不显示已执行、已发布或已产生效果。

### S3：`TECH-INDEXABILITY-006`

交付：

- RuleId、registry、executor、ActionTemplate；
- rule-set version bump；
- authority/lock 的 rule inventory 从 11 原子更新到 12；
- exact URL Evidence/Finding/Opportunity；
- deterministic unit、integration 和 UI tests。

S3 与 S1 共同激活新的 rule-set/executor generation；该 promotion 必须同时包含
manifest DB guard、worker reader、Growth Map reader、rule inventory 和 authority
lock，不能拆成两个可部署状态。

验收矩阵：

| 输入 | 结果 |
| --- | --- |
| sitemap + indexable + exact fetch 2xx | 不触发 |
| sitemap + noindex/none + exact fetch 2xx | 触发 |
| 非 sitemap + noindex | 第一版不触发 |
| sitemap + exact fetch non-2xx，即使 final 2xx | 本规则不触发，避免终点 HTML 事实错归 |
| 缺 observation lineage | inconclusive |
| partial crawl + exact observed contradiction | 触发并带 partial limitation |
| 同 target/ref/rule | 一个 Opportunity key |
| reviewable | 无 Action |
| confirmed | exactly one Action |
| historical rule set | 不出现新 Finding |

## 12. 后续能力

无需新 Provider 的下一批：

1. redirect chain，限定 final 2xx；
2. invalid JSON-LD，仅声称 `errorCount > 0`；
3. 更细的 sitemap contradiction，但继续受 partial coverage 限制。

需要新 Observation/Provider：

- hreflang；
- CWV/LCP/INP/CLS；
- rendered DOM / JavaScript hydration；
- image inventory；
- CSP/security headers/CDN crawl impact；
- server log bot classification；
- AI answer/citation visibility；
- order/payment/revenue attribution 和 causal experiment evidence。

需要另行产品决策：

- reviewed priority URL inventory；
- new Product Profile conversion intent；
- URL conversion target 与 GA4 event governance；
- 稳定画像约束和动态执行约束的 owner；
- attribution policy。

## 13. 验证策略

实施计划必须把以下证据映射到具体文件和命令：

1. Contract/Zod/OpenAPI generated-type parity；
2. manifest compiler determinism 和 exact-key rejection；
3. historical executor/read compatibility；
4. Site language unknown/inconclusive；
5. ActionTemplate exhaustive mapping；
6. Opportunity zero-write preview；
7. new rule predicate、Evidence、target、dedupe、partial limitation；
8. confirm transaction 的 exactly-one Action；
9. authority、rule count 和 implementation lock 一致；
10. Public Tools facts-only regression；
11. formatter、lint、typecheck、unit、适用 integration/build/E2E；
12. secrets scan 和最终 `git diff --check`。

涉及 disposable PostgreSQL 的 migration/integration 命令必须在执行前单独确认
授权；Hosted/Production 数据库不在本任务范围。

## 14. 外部评审采用与拒绝记录

ChatGPT Pro 第一轮建议新增 AuditPolicy、SiteTechnologySnapshot、独立 coverage
和 projection versions。Codex 用真实仓库事实反馈后，Pro 修正版同意首期全部
Drop/Defer，并收敛到 run-local projection、execution preview 和已有 Crawl
observation 支持的 deterministic rule。

采用：

- 不新增顶层 authority；
- 首期不依赖 tech stack/new provider；
- 复用现有 Opportunity 和 ActionTemplate；
- 先做 sitemap/noindex contradiction；
- Measurement 保持 verified Change Receipt + 28-day observational window。

拒绝或修正：

- 不把 audit mode 写入 context；
- 不复制 provider availability；
- 不把 priority URL “governance state”建成新 authority；
- 不扩展 Product Profile 只是为了匹配 Prompt；
- 不把 execution preview 当成 latent Action 或 replay truth。
