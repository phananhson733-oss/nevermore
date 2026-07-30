# Nevermore / GenGrowth 完整增长工作台 — Active Authority v0.4

状态：**active**

规范性：**normative**

Authority 版本：**0.4.0**

当前产品版本：**0.3.0**

合同版本：**2026-07-21**

本目录是 Nevermore 仓库中 GenGrowth 四模块客户工作台的当前唯一机器权威。
`authority/index.json` 指向本目录与 `scripts/spec-v0.4-lock.json`；v0.3
保留为历史快照，不再约束当前实现。

当前机器面精确包含 **78 个 operation、10 个 shared async operation、78 张应用表、11 条规则**。
第十一个返回 `202` 的 `createProjectMeasurementWindow` 使用专用、强类型的
`MeasurementWindowAcceptedHttpResponse`，不冒充共享 `AsyncAccepted`；verifier
会同时冻结这条例外。规则集为 `mvp.rules.0.2.2`，其中
`CONTENT-GAP-011` 为 version 2。

## 权威文件

按冲突优先级读取：

1. [MVP-IMPLEMENTATION-SPEC.md](MVP-IMPLEMENTATION-SPEC.md)：四模块产品模型、数据诚实性、授权边界和验收不变量。
2. [openapi.yaml](openapi.yaml)：当前 78 个 HTTP operation 的逐字镜像；必须与 `openapi/mvp.yaml` 字节一致。
3. [schema.sql](schema.sql)：由 34 个 ordered migration 确定性生成的完整可执行 SQL；禁止手改。
4. [schemas/service-bundle-manifest.schema.json](schemas/service-bundle-manifest.schema.json)：导出 bundle manifest 机器合同。
5. [scripts/schema-smoke.sql](scripts/schema-smoke.sql)：当前数据库约束 smoke；必须与应用迁移目录中的 smoke 字节一致。
6. [scripts/verify-spec.mjs](scripts/verify-spec.mjs)：authority、active lock 与当前实现的强一致性验证器。
7. [`../../scripts/spec-v0.4-lock.json`](../../scripts/spec-v0.4-lock.json)：inventory、版本、规则版本与 reviewed file hash 的激活锁。

晋升前的 publication candidate 已完整移动到
[historical-publication-candidate/](historical-publication-candidate/)，并明确标记为
non-normative、not executable。它只保留审计线索，不是第二套 OpenAPI/SQL/lock；
active verifier 禁止 candidate machine file 留在本目录根部。

`schema.sql` 不是第二套手写 DDL。以下命令按文件名排序读取
`packages/db/migrations/0001_init.sql` 至
`0034_dataforseo_search_landscape.sql`，验证每个 migration 的事务框架与
`schema_migration_version`，再生成带精确边界 marker 的完整 SQL：

```bash
node authority/implementation-spec-v0.4/scripts/generate-schema.mjs
```

authority verifier 会独立重新生成并逐字比较，所以修改 migration 而忘记更新
authority 会失败；直接编辑 `schema.sql` 也会失败。表 inventory 同时通过
`scripts/schema-catalog.mjs` 解析，`CREATE TABLE app.*` 与
`CREATE TABLE IF NOT EXISTS app.*` 都会被识别。

## 当前客户产品：固定四模块

GenGrowth 面向中文客户提供中文优先工作台；客户的海外市场、英文关键词和英文
Blog 正文继续保留对应英语内容。顶层导航只包含：

| 模块 | 客户问题 | 当前 canonical truth |
| --- | --- | --- |
| 概览 | 现在是什么情况、下一步做什么 | 已确认 Product Profile/ICP、真实数据连接、URL 组合、当前 Opportunity 与全项目工作 |
| 增长地图 | 哪些页面、关键词、竞品和增长路径值得处理 | 多 URL 审计、Technical/Search/Content/CRO/GEO signals、关键词治理与关系、竞品来源/审核/动态监控、Topic Model、内链、外链 |
| 执行中心 | 应该交付什么、如何审核 | Finding → Action → execution state → Artifact/Revision → approval；包含 Brief、英文 Blog、Metadata、Technical/Code 类交付 |
| 效果追踪 | 上线前后发生了什么 | 只从 immutable Measurement Window 展示 GSC/GA4/UTM/GEO 的 before/after observation，并保留 publication Change Receipt 锚点和限制 |

关键词库与竞品库是增长地图的内置判断依据，不是独立第五模块，也不是离线
Artifact。URL、关键词、竞品、Topic、Action、Artifact 与 Results 都必须来自
canonical repository 或显式 `unavailable/no_data` 状态；生产界面不得用 mock
数字补空。

## 真实数据与诚实性

- GSC、GA4、Crawl 与 DataForSEO 是分析数据来源。连接状态不等于数据可用；
  只有已完成且作用域匹配的 immutable Snapshot/Observation 才能支持结论。
- DataForSEO Search Landscape（DFS）是 Analysis Refresh worker 的内置、
  成本受限复合步骤，不是客户连接器。服务端从冻结 Site/market/language 与配置
  生成 ranked-keyword + competitor-domain 两个请求，并原子写入一个
  `dataforseo.search_landscape.v1` Snapshot；公共 `createCollectionRun` 只接受
  Crawl/GSC/GA4，且不接受 DFS scope、limit、凭据或 API key。
- URL、Keyword、Competitor 的 list/detail GET 都可用 canonical
  `diagnosticRunId` 固定一个已发布 Growth Map generation；省略时读取最新可读
  generation。只有 Keyword/Competitor detail GET 支持 `view=review` 读取当前
  governance，且不能与 `diagnosticRunId` 同时使用；对应 PATCH 拒绝全部 query。
- Sitemap、站内解析、规则计算、关键词关系、竞品监控与 GEO/Backlink 模型是
  内置能力，不作为需要客户连接的外部数据卡重复展示。
- `unavailable` 不等于 `0`；缺失 volume、rank、click、conversion、citation
  等必须返回 nullable unavailable 与 limitation。
- 所有 Evidence 保留 workspace/project/site/run/snapshot/observation lineage；
  LLM 生成内容不能伪装 observed evidence。
- Product Profile/ICP 从客户提交的核心 URL 与基础业务信息开始，系统可以基于
  冻结 Crawl 证据形成可审核草稿；用户确认前不得把推断当最终画像。

## 执行、授权、发布和 Results 边界

当前主链是：

```text
Project / confirmed Product Profile
→ immutable Snapshot / Observation
→ Evidence
→ Finding + review
→ Action + execution state timeline
→ Artifact Revision + QA
→ durable approval event
→ server-issued publication/rollback preview authority
→ verified Change Receipt anchor
→ immutable Measurement Window
→ Results
```

v0.4 已激活 publication authority persistence、精确 Artifact approval、preview /
rollback preview、receipt lineage 与 Measurement Window 合同。**当前 active
HTTP surface 仍不包含执行 GitHub/WordPress 外部写入的 publication-attempt
operation**：preview 不是发布，Delivery Receipt 不是 live change，只有经过
provider 与 live canonical URL 验证的 Change Receipt 才能锚定观察窗口。
任何未实现 provider adapter 或权限必须明确显示 unavailable，不能把计划状态
渲染为已发布。

Content Shadow state: **reviewed, not published**

Current v0.4 external-write boundary: **no external writes**

后续若加入真正的 GitHub PR、WordPress publish、自动 PR merge 或 CMS 写入，
必须在同一提交更新 route、worker/provider adapter、OpenAPI、migration、
generated contract、authority、lock、回滚/幂等测试与客户状态，不得只改文案。

## 安全边界

- 浏览器只通过 same-origin `/api/mvp` 访问数据。
- Supabase Auth session 必须解析到预配置的 `app.operator_profiles`；生产环境不
  自动创建 workspace membership。
- `app` schema 对 `anon` / `authenticated` 撤权；repository 查询始终携带
  `workspaceId + projectId`，跨租户资源返回 404。
- `SF_DEV_AUTH` 只有在显式 development、精确 loopback origin 与本地开关同时
  成立时可用；production/staging/test 均 fail closed。
- 每次 provider/crawl 网络访问遵守 URL 安全、DNS/IP 重验、重定向上限与凭据
  隔离；密钥不得进入浏览器、日志、telemetry、Artifact 或导出。

## 验证

从仓库根目录执行：

```bash
pnpm verify:authority
pnpm verify:spec
pnpm verify:spec:test
pnpm implementation:check
pnpm contracts:check
pnpm openapi:lint
git diff --check
```

`verify:spec` 只有在以下四层同时一致时通过：active discovery、reviewed lock、
authority package、当前实现。verifier 自测会故意制造 OpenAPI、migration、
schema、rule version、hash 和 active-pointer drift 并要求失败；重新计算 lock
不是 CI 的自动行为，必须作为显式 authority 变更接受审核。
