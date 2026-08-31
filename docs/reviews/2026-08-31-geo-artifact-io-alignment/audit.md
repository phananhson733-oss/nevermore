# GEO 原型输入/输出一致性审计

状态：**NOT ALIGNED / 尚未完成对齐**。本轮只读审计与本地证据保存；没有应用代码改动、commit/push/PR、部署、数据库写入或付费调用。

## 1. 验收对象与证据边界

- 用户本次指定原型：[geo-product-ui.jsx](https://claude.ai/public/artifacts/37bb86f4-c185-4835-9394-a867a2b1264f)。它是新的产品验收输入，不能被较小的当前实现反向改写。
- 已从Preview逐个读取9个界面状态（KB输入/冻结、T1输入/结果、T2输入/结果、T3输入/结果、内容链）及公开Code。JSX为示例，33726字符，无fetch/axios/XMLHttpRequest；页面上的42、420、16.2%、187页等不是生产证据或必须硬编码的值。
- 原型证据：[UI状态](reference-ui-states.md)，[只读JSX](reference-geo-product-ui.jsx.txt)。JSX SHA-256：`597746987d71170e80353fbcbad458a6c0596d10b867369b65e54bd0d9cebe2a`。
- 源码工作树：`/Users/wzb/.config/superpowers/worktrees/signalframe-mvp-app/geo-brief-release-20260830`，HEAD `bfdaf79a0c5283d7ecc7cb8bc1c9b5d7b5942e77`；本轮fetch确认origin/main为 `807e2cdce85ed7e6cdde3016e3cfd178a0b45556`，Marketing目录与其无净差异。原主checkout的用户dirty改动未触碰。
- 上一轮上线与paid canary是可运行性证据，不是本Artifact的一致性证据。本轮没有重新声称生产部署/付费结果。
- 外部ChatGPT Pro没有被启用或上传源码：本任务未授权外部上传；使用原生子代理做独立只读审计，不称为外部双代理交付。

## 2. 结论

当前四工具不是原型的等价实现。Page Citability输入/两分组报告最接近；知识库的资产归属与自动补全被改形，Visibility仅覆盖单引擎观察与有限基线对比，GEO Brief采用自有合同且内容链未接通。缺少的不是颜色或标题，而是输入来源、冻结身份、证据链、输出字段与消费者。

最重要的缺口：

1. 原型的Website Profile GEO扩展，变成独立KB+一次性Import；positioning/features继承、竞品自动解析、GSC角色来源缺失。
2. Visibility没有多引擎/SOV/均位次/引用页类型与本站在位/A-B-C-D缺口/运行文件导出/两文件对比/待办导出。
3. Visibility→Brief没有任何参数化交接。当前`brief-contract.ts:114-123`直接承认run-id handoff与server run read不存在。
4. GEO Brief是`marketing-geo-brief.v1`，而现有Content Draft只认SEO的`gengrowth.content_brief/v1`并严格重算ledger/fingerprint；改名字或跳转不会实现原型所述ContentBrief v1.1。
5. 原型要求的KB直答Q1、跨样本must-answer覆盖、candidate/omitted计数、geo_origin evidence、site-index links、Draft来源分流T2均未闭合。

## 3. 逐项矩阵

状态不是质量分数；“部分”表示确有相应基础，但字段、语义或端到端链路不足以证明要求。路径未写前缀的geo文件位于`apps/marketing/src/lib/geo-tools`，TSX位于`apps/marketing/src/components/tools`。

### 共享

| ID | 原型要求 | 状态 | 当前事实 | 证据位置 |
|---|---|---|---|---|
| SH-01 | 实际绑定KB的运行携网站/kb/prompt-set锚点；T2可独立 | 部分 | 有内部snapshot/revision/hash，无一致的跨工具上下文头 | brief-contract.ts:103; visibility-contract.ts:175 |

### 知识库

| ID | 原型要求 | 状态 | 当前事实 | 证据位置 |
|---|---|---|---|---|
| KB-01 | 设置→网站→GEO扩展，不另立资产编辑器 | 冲突待确认 | 独立/tools/geo-knowledge-base + 自有KB；8/29设计记录四入口 | geo-knowledge-base.tsx:581; design.md:9-16 |
| KB-02 | 继承domain/productName/positioning/features | 部分 | 一次复制name/category/market/role/competitors；无positioning/features字段 | kb-contract.ts:63; kb-import.ts:98 |
| KB-03 | aliases候选生成、确认及category terms | 部分 | import中proposeGeoAliasCandidates；可编辑alias/category，但脱离Profile后独立 | kb-import.ts:100; kb-contract.ts:138 |
| KB-04 | 明确market/language输入并贯穿问题与provider | 不一致 | UI US/GB且写死en，import可带非en；生成模板仍英文 | kb-import.ts:120; geo-knowledge-base.tsx:697; kb-questions.ts:202 |
| KB-05 | 1–5竞品域名→抓首页解析brandName/aliases→确认 | 部分 | 最多5；brandName/domain/confirmed手填，无首页抓取、竞品aliases | kb-contract.ts:34; kb-import.ts:43 |
| KB-06 | GSC90天聚类ICP，source/queryCount及角色字段 | 缺失 | 单ICP预填/手写roles；无GSC/window/cluster/source/queryCount | kb-contract.ts:24; kb-import.ts:57 |
| KB-07 | 未连接GSC时明确角色/问题层缺失策略 | 不一致 | 无GSC仍按手填role生成；freeze要求至少1role | kb-contract.ts:405; kb-questions.ts:211 |
| KB-08 | 已核事实key/value/source/time/status | 部分 | 人工key/value/reason/sourceUrl/observedAt；空值reason已有，无crawl receipt/status | kb-contract.ts:54; geo-knowledge-base.tsx:967 |
| KB-09 | kb+prompt-set不可变锚点和可重读题表 | 部分 | snapshot/hash核心已有；预览不传roleId/requiredEntities，reload后无preview | kb-store.ts:86; kb-handler.ts:267; geo-knowledge-base.tsx:404 |

### 可见性

| ID | 原型要求 | 状态 | 当前事实 | 证据位置 |
|---|---|---|---|---|
| V-01 | 选择冻结prompt-set并识别新基线 | 部分 | 以kbId/snapshotId输入；每KB只提供current pointer，不是历史选择 | visibility-handler-deps.ts:36; visibility-handler.ts:123 |
| V-02 | ChatGPT/Perplexity多引擎及独立状态 | 缺失 | 单ChatGPT模型/surface固定，无engines输入/byEngine | visibility-workflow-steps.ts:25; visibility-contract.ts:175 |
| V-03 | 每题3/5/10样本和动态调用量费用 | 匹配 | 3/5/10默认5；按冻结题数计算 | visibility-contract.ts:9; ai-visibility-check.tsx:1335 |
| V-04 | 四指标mention/citation/prompt coverage/SOV | 部分 | 问题级与样本级mention/citation、coverage数字有；SOV没有 | visibility-contract.ts:124; ai-visibility-check.tsx:400 |
| V-05 | 分引擎表及五层均位次/样本 | 部分 | 五层mention/citation有；分引擎和平均位次无 | ai-visibility-check.tsx:462; visibility-contract.ts:50 |
| V-06 | 引用源按回答数/页面类型/本站在位 | 部分 | 域名/回答数/URL/own-competitor有；页面类型/本站在位缺 | visibility-contract.ts:158; ai-visibility-check.tsx:509 |
| V-07 | A/B/C/D及未归因缺口卡、站点索引与T2证据 | 缺失 | report无gaps/actions；固定notAttribution | visibility-contract.ts:197; visibility-contract.ts:258 |
| V-08 | A/D→Brief、B→T2、C→第三方待办 | 缺失 | 只有无参数相关工具链接 | tool-handoff.ts:39; ai-visibility-check.tsx:870 |
| V-09 | 同版本上次对比、CI与逐题变化 | 部分 | 服务端同hash上一轮+配对问题级统计有；非原型本地摘要 | visibility-store.ts:182; visibility-contract.ts:208 |
| V-10 | 运行JSON导出/两文件对比/Markdown待办 | 缺失 | 无下载/文件导入/待办export | ai-visibility-check.tsx:870 |
| V-11 | Brief可追溯run/sample/excerpt evidence | 缺失 | summary不存sample原文/节选，无下游resolver | visibility-store.ts:608; brief-contract.ts:114 |

### 可引用性

| ID | 原型要求 | 状态 | 当前事实 | 证据位置 |
|---|---|---|---|---|
| C-01 | URL必填+提问选填、免登录、确定性且无模型调用 | 匹配 | 严格{url,question?}；question<=200字符；无模型调用 | citability-handler.ts:125; page-citability-check.tsx:329 |
| C-02 | 两组检查、状态、每项evidence/fix | 部分 | readable/extractable已有；14行、11counted、3advisory | citability-contract.ts:45; citability-rules.ts:787 |
| C-03 | 真实render/raw SSR ratio | 缺失 | 只抓raw HTML，不执行JS | citability-handler.ts:256; citability-contract.ts:179 |
| C-04 | 共享根因总结并保留逐项修法 | 缺失 | 只有逐条检查，没有root-cause合并对象 | page-citability-check.tsx:424 |
| C-05 | 训练/检索/grounding语义准确 | 需修订语义 | 已有advisory区分，但Google-Extended被简单归training | citability-rules.ts:787; Google crawler docs |

### GEO Brief

| ID | 原型要求 | 状态 | 当前事实 | 证据位置 |
|---|---|---|---|---|
| B-01 | gap A/B/D或manual入口，C拦截 | 缺失 | 仅冻结题/手填题，无gapType或上游run | brief-handler.ts:142; geo-brief.tsx:393 |
| B-02 | role+kb+promptset+run/excerpt版本锚 | 部分 | JSON有kb/snapshot/revision/question/layer/role；缺run/gap/promptset，UI无origin | brief-contract.ts:103; geo-brief.tsx:486 |
| B-03 | 共享ContentBrief v1.1消费合同 | 不一致 | GEO=marketing-geo-brief.v1，SEO=gengrowth.content_brief/v1 | brief-contract.ts:8; packages/public-tools/src/content-brief/contract.ts:331 |
| B-04 | lead_answer冻结KB评分锚且进入Q1 | 不一致 | requiredEntities来自KB；requirement通常model；未注入KB Q1 | brief-contract.ts:59; brief-assemble.ts:218 |
| B-05 | must_answer跨样本cluster/覆盖分子分母/来源 | 不一致 | 单样本最多8个结构片段+M新增；无cross-sample coverage | brief-subtopics.ts:86; brief-contract.ts:65 |
| B-06 | 候选/展示/隐藏数量且问题清单不可悄改 | 缺失 | 未返回candidateCount/omittedCount；允许M新增 | brief-subtopics.ts:86; brief-assemble.ts:55 |
| B-07 | fact_table value|null+reason+source+time | 部分 | flat facts/null reason有，人工sourceUrl会被标crawl | brief-contract.ts:214; geo-knowledge-base.tsx:1013 |
| B-08 | outline source=model、问题引用可覆盖核验 | 部分 | Q/M结构/每节至少1引用；未保证每条Q被outline覆盖 | brief-assemble.ts:123; geo-brief.tsx:530 |
| B-09 | verdict不可判定、length unavailable、site-index内链 | 缺失 | 没有这三个字段或site-index输入 | brief-contract.ts:126 |
| B-10 | 共用Content Draft+kb事实约束+源分流T2 | 缺失 | Draft已存在但只解析SEO ledger与fingerprint；不认KB/AI sample | content-draft-handler.ts:265; content-draft-handler.ts:499; tool-handoff.ts:132 |
| B-11 | v1.1 JSON+上下文交接，复制/MD同源 | 部分 | 自有JSON/MD/Copy有；MD漏origin/market/fact time，未接Draft | brief-export.ts:62; content-brief-handoff.ts:57 |
| B-12 | 按gap/意图预选format：D→对比页，A→按意图层推断 | 缺失 | GEO无format；现有SEO format只从SERP分布派生 | reference-geo-product-ui.jsx.txt:540; brief-contract.ts:126; packages/public-tools/src/content-brief/contract.ts:379 |

## 4. 为什么两条设计线会分叉

`docs/plans/2026-08-29-marketing-geo-tools-design.md:9-16`记载四独立tools及替代原方案；D1/D2/D9/D12（:31-42）记录单引擎、独立KB、独立Brief、不接GSC。它证明存在范围调整记录，但不是本次已获得全部降scope批准的原始证据。

同文D8（:38）仍要求上线即带归因beta，实施记录`2026-08-29-marketing-geo-tools-implementation.md:108`却写“有意偏离、不做归因”；之后设计:76再写成“按裁决延期”。本轮没有找到原始用户批准链接或明确supersedes链，因此不判定当时未经批准，也不能用作者叙述自动抵消本次用户指定原型。

即使只按8/29较小设计，D1的多选输入建模、D5运行导出/两文件对比、D6品牌同场提及率、§6逐题证据→Brief仍未全部落地。设计:78的“没有content-draft”在当前源码已经过时；消费者现在存在，但合同不兼容。

另有未提交的`marketing-geo-knowledge-base-20260828`工作树要求Website Profile唯一持久知识库，但它不是当前上线来源；更早的本地单Artifact批准只限本地Artifact，不能扩大成生产降scope批准。没有找到当前public Artifact与原geo-handoff ZIP的hash/版本绑定，原型版本关系也应在下一份design中冻结。

## 5. 不应为了看起来一致而制造的假证据

- 不复制demo数量/百分比。原型部分示例本身不自洽：输入420 calls，而结果混合n/engine n示例口径不同；gap标题26与分组+未归因需要真实定义；这些是展示样例，不能转成断言。
- 不把缺GSC、renderer、Perplexity或site-index伪装成完整。需要实现真实采集能力与状态；在其上线前显示未接通/未知不能算该需求完成。
- 保留current对无数据的`null/reason`、notApplicable、付费POST不盲重试、按问题配对比较、冻结身份与来源隔离等保护。不同底层字段名只在语义和消费合同完全等价时可映射。
- 不直接用样本总数充作独立问题数，不把提示性品牌问题算成无提示发现。
- Google-Extended不能简单写成“只控制训练”。[Google官方说明](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers#google-extended)明确包含Gemini/Vertex的training和grounding，同时不影响Google Search收录/排名。后续T2应分别说明这些控制面，而非用一个总通过/失败暗示所有产品。
- 原型Draft同时出现“零改动可消费”和“三处最小增量”，且示例outline有空answers；应在明确的合同升级中解决这些矛盾，不复刻对消费者不成立的承诺。

## 6. 本轮附带确认的当前字段缺陷（未修）

1. **事实来源错误升级**：`brief-contract.ts:226`只凭手填sourceUrl就给`source:crawl`；KB UI允许手填URL/时间，URL不是抓取凭证。
2. **语言显示不等于真实冻结payload**：`kb-import.ts:120-136`可导入非en，UI:730却固定en；生成模板仍是英文。需统一或在冻结/付费前拒绝未支持组合。
3. **样本编号off-by-one**：workflow按1开始，UI:647又+1。
4. **问答覆盖不全仍可解析**：GEO parser允许所有Q保留，但outline只覆盖其中一条；必须把完整must-answer覆盖校验接到实际消费者，而不是声称现有绿测已覆盖。

## 7. 建议的完整对齐方案（待批准，非已实施）

目标是恢复原型的完整输入/输出及内容链，不把缺功能的较小工具重新定义成完成。

### 入口有两种落法

- **建议：设置→网站为GEO资产canonical入口，保留旧KB tool URL为同一资产的快捷入口。** 对用户已保存KB/历史snapshot制定显式连接/迁移方案，不静默合并或删除已有历史。既符合原型资产归属，又不让旧入口失效。
- **若仍需四个独立工具canonical入口：** 保留KB tool位置，但页面继承同一Website Profile引用、显示同一冻结资产与字段，不能再复制出两份互不一致的事实。该入口偏差需用户明确接受，其余输出/链路目标不减少。

### 按依赖落实，而非缩小验收

1. 冻结本Artifact版本、字段清单、语义和原型样例矛盾的修正；明确KB资产归属、market/language及GSC缺失时策略。
2. 补KB Profile引用/竞品brand+aliases解析/role来源/fact receipt/promptset anchor与可重读题表；旧历史保持exact可读。
3. 补Visibility多引擎adapter和capabilities、SOV/位次/引用页分析、versioned run export/import、站点索引和T2-backed gap分类；无证据保留unattributed，不把C送内容链。
4. 原子升级共享Content Brief消费合同（建议显式SEO/GEO分支，共用writer核心），producer/parser/fingerprint/export同时支持geo_origin/lead_answer/fact_table/KB来源及site-index links；SEO原有v1保持可读。不能伪造SERP/GSC字段来过旧parser。
5. 接通Visibility→Brief→现有Content Draft→T2。session handoff复用既有固定key/TTL/单次消费实现，不另造一串无校验runId key。HTML/JSON/MD/UI来源同一模型，避免字段丢失。
6. 原型逐项验收：输入fixture→服务器冻结→观测与gap证据→Brief→Draft gate→T2；再做中文/英文、错误态、刷新恢复、导出导入与真实provider批准canary。

此方案涉及真实数据/来源/跨消费者合同，不是本轮只读审计自动授权的发布。完成设计确认前不改应用；发布、迁移、付费和外部上传权限按新任务边界另行确认，不沿用上一轮一次性canary授权。

## 8. 本轮执行与未执行

主代理实跑（无外部provider）：

```text
pnpm vitest run --project unit apps/marketing/src/lib/geo-tools \\
  apps/marketing/src/components/tools/geo-knowledge-base.test.tsx \\
  apps/marketing/src/components/tools/ai-visibility-check.test.tsx \\
  apps/marketing/src/components/tools/page-citability-check.test.tsx
21 files passed / 458 tests passed
```

子代理另跑178条定向测试，与主套件存在重叠，不相加。绿测证明当前实现合同，不证明不存在的GSC/多引擎/缺口/导出/共享Draft输入输出。未发现GEO Brief专用React测试或四工具贯通E2E，旧GEO Agent E2E不能替代。

未运行build/deploy、未更改env、未跑SQL、未发付费provider请求；仅创建本目录的审计报告、需求CSV、公开原型source/UI快照与manifest。新的对齐目标保持active，不能标complete。

