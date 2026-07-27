# Slice 2 Task 6 — 主 agent 对 Q1-Q10 的裁决 + 蓝图勘误(2026-07-25)

配套蓝图:`2026-07-25-slice2-task6-qa-port-blueprint.md`(同目录)。
本文件是**硬约束**,与任何蓝图正文冲突时以本文件为准。

---

## 零、先行勘误:上游 Task 4 蓝图 §1 关于 RL8 的表述是错的

`docs/plans/2026-07-25-slice2-task4-content-shadow-blueprint.md` §1 写的:

> RL8(科学背书无支撑=FAIL)

**这条描述的是兄弟仓库的 oracle(占星)profile**,其语义是 *禁止一切* "research shows / evidence-based / studies suggest" 类措辞。把它照搬到 B2B SaaS 内容上是**灾难性**的 —— B2B 技术内容引用研究是正常且必要的写作行为,全禁等于让每一篇 draft 都 FAIL。

**正确的移植对象是 `red-lines.gengrowth.mjs` 的 B2B 反转版 `rl8b2b_attribution_required`:研究类断言必须携带可解析的出处。** 语义从"禁止提及"反转为"提及必须有归属"。

**裁决:Task 6 移植 B2B profile 分支,不移植 oracle 分支。** B2B profile 明确丢弃 RL1/RL2/RL6/RL9、反转 RL8/RL12 —— 按 B2B profile 的取舍执行。

同理接受另两条事实修正:实际是 **RL1-RL13**(非 RL1-12);`structure-checks.mjs` 导出 **14 个** check(SC1-11 + SC3b/SC3c/SC9b)且**无聚合导出**,聚合语义由我们自己定义并写进文档。

**排除 `_config.mjs`** —— 它在模块 import 时从磁盘 JSON 读阈值,是 IO + 隐藏全局态,直接破坏 content-addressed run 的可复现性。阈值改为包内常量(见 Q4)。

---

## Q1 — authority A/B/C/D 与既有 `EvidenceGrade A/B/C` 的冲突

**裁决:采纳推荐。A/B/C 与 `EvidenceGrade` 恒等;D 只作 QA 侧输出层级("无法解析到任何 source"),research pack 永不产生 D。**

理由:0012 的触发器已把 provider→grade 钉死,再造一套平行 authority taxonomy 会立刻产生两套语义漂移的分级,且没有任何真实收益。恒等复用让 "authority 等级" 有唯一权威来源。D 不是一个证据等级,而是 *证据缺失* 的标记,所以它只活在 QA 输出层,不进 pack。

实现要求:在类型定义处注释说明 D 的非对称性(pack 侧不可能出现),避免后人给 pack 加 D 分支。

---

## Q2 — 是否引入 QA-LLM 判官 `content_shadow_qa`

**裁决:采纳推荐,不引入。**

理由:红线 C 的整个价值在于 run 可复现、可审计。塞一个 LLM 判官进 QA 判定路径,等于让 gate 结论变成不可复现的随机量 —— 重放同一冻结输入可能得到不同 verdict,`flow_shadow_qa_gates` 的 immutable-match 幂等语义随之失效。这不是"稍微降低确定性",是**直接破坏本 Slice 的核心不变式**。

D4 留的 `content_shadow_qa` 口子**本轮不使用**,也不要预先加进 `ANALYSIS_INVOCATION_TASKS`(未使用的枚举值是误导)。

---

## Q3 — `english_blog_draft` 是否加必需 section 契约

**裁决:采纳推荐,不改 validator,只在 QA 层做软性期望。**

理由:validator 在 revision 创建时生效,回溯收紧会让**已铸出的 revision 变成 invalid** —— 那是在改历史。QA 层表达"期望有 Sources / FAQ / CTA 段"完全够用,且天然对应 `needs_review` 而非硬失败。

---

## Q4 — 阈值/规则清单是否落库

**裁决:采纳推荐,不落库。阈值由已冻结的 `flow_adapter_version` 唯一决定,以包内常量形式存在于 `@sf/flow-shadow`。**

理由:这正是 R3(adapter 版本服务端固定常量)的延伸。阈值落库会引入一个**不在 content_hash 冻结元组里**的可变输入 —— 同一 content_hash 在阈值被改后重放会得到不同 verdict,红线 C 当场破功。反过来,阈值作为包常量意味着改阈值**必须**碰 adapter 版本,这是正确的强制函数。

`flow_shadow_qa_gates.claims jsonb`(CHECK 要求 array)不用来存规则清单。

---

## Q5 — 非 EN locale 的降级策略

**裁决:采纳推荐。非 `en-*` 只跑语言无关规则,其余标 `evaluable:false`,整体至少 `needs_review`。**

理由:`Intl.Segmenter` 的分词结果跨 ICU 版本不稳定 —— 在不同 Node/OS 上重放同一输入会得到不同字数/句数,进而不同 verdict。这是**确定性漏洞**,不是精度问题。诚实地标"未评估"远好过给出一个不可复现的分数。

实现要求:`evaluable:false` 必须携带原因("locale not supported by deterministic segmentation"),让 Task 8 的评审 UI 能如实呈现,而不是显示成"通过"。

---

## Q6 — SC2/SC4 内链规则

**裁决:采纳推荐。Slice 2 落 advisory,gating 推迟到 Slice 3。**

理由:它们依赖 SignalFrame 尚不存在的 TBD 占位符约定和 tier 词汇。用不存在的输入做 gating 判定只会产生噪声 FAIL。

---

## Q7 — RL13 词表重导

**裁决:采纳推荐。HARD 表收缩到 4 词,整条规则降 advisory。**

附加要求:被剔除的词(`architecture`/`mechanism`/`engine` 等 SaaS 正常词汇)**必须在代码注释里列出并说明剔除理由**,否则后人会以为是漏移植而加回去。

---

## Q8 — 是否顺手修 `insert` 重放不比对 claims

**裁决:不采纳"本轮不改"的推荐。修,但按下述安全边界修。**

理由:`FlowShadowQaGatesRepository.insert` 重放时只比对 verdict、不比对 claims(`flow-shadow-runs.ts:310`),意味着**同一 run 重放产生了不同 claims 时会被静默吞掉**。红线 C 的承诺是"可复现、可审计";一个会静默吞掉复现性偏差的幂等实现,恰好把最该报警的情形变成无声通过。这不是洁癖,是不变式本身漏了个洞。

蓝图建议"用确定性单测钉死前提"是对的,但那只覆盖了**已知的**确定性路径;repo 层的比对是兜住未知路径的最后一道。两者都要。

**安全边界(必须全满足)**:
1. 先保证 claims 有**规范化排序 + 稳定序列化**(纯函数侧),否则比对会因顺序抖动误报。
2. 不匹配时抛**显式的数据完整性错误**,不是静默通过、也不是覆盖写。
3. 双向回归测试:相同 claims 重放通过;人为构造不同 claims 重放报错。
4. **单独成 commit**,便于在它导致不稳定时独立回退。
5. 若任何既有绿测试因此变红 —— **停下报告,不要改测试**。

---

## Q9 — SC-DUP(draft 复读 brief 检测)

**裁决:采纳推荐。做,advisory,复用 RL3 的 DP 算法。**

理由:约 40 行成本,却直接对冲 Flow Shadow 最现实的失败模式 —— LLM 把 content_brief 换个说法复读一遍冒充 draft。advisory 级别足够:它是质量信号,不是事实性错误。

---

## Q10 — 已知缺口记录

**裁决:采纳。三条各记一条进 Slice 2 stop gate 的"已知简化"**:无抄袭检测(无 SERP 语料)、无外部事实核查、无品牌语气检查。

要求措辞诚实、可被 Owner 直接读懂后果,**不要用"未来可扩展"这类掩饰性表述**。这三条会由 Task 9 写进 stop gate 文档。

---

## 跨 Q 的统一约束

- **`blocking` 集恰好三条**(RL8-SF 断言无出处、RL12-SF 引用无法解析、SC9b-SF Sources 条目不在 pack),其余 `review`/`advisory`。要扩 blocking 集必须先报告。
- **判据链必须堵住原版的两个洞**:兄弟仓库 RL8-B2B 的 ALLOW 含 `\b\d{4}\b`(任意年份)和 `by [A-Z]\w+`(任意大写词),LLM 编一句 "According to a 2024 Forrester study" 就能过。SignalFrame 版要求归属**真的解析到 research pack 里的一条 source**,而 pack 只从 DB 行组装 → 幻觉无处可藏。**这是本 Task 最核心的正确性要求。**
- **`blocked` ≠ run failed**:run 仍 `completed`,draft artifact 照常铸出(它本身是证据),只是 gate 记 blocked、Task 8 禁用采纳控件。
- **零契约税**是验收条件:`pnpm contracts:check` 必须 no diff。若 Task 4 把 `QaClaim` 留成宽松形状而 Task 6 需要收紧,那会触发两份 openapi 字节一致 + lock sha256 刷新 —— 届时**停下报告**,不要静默扩大范围。
- QA 全部判定必须是**纯函数、零 IO、可脱 worker 单测**。

---

## 来自 Task 4b O-6 的跨 Task 约束

> **2026-07-25 修正(Task 6 缺陷修复轮):coverage 判定改用 `targetKeywords`,不再用 `briefSections`。**
> 见本节末尾「O-6 修正」。以下原文保留,因为它对 SC 结构检查的约束仍然成立。

**`briefSections` 是覆盖清单(coverage checklist)语义,不是文档结构。**

Task 4b 裁决 O-6 把 `contentBriefOutline.briefSections` 定义为「这些主题必须被覆盖到」,
而**不是**「文档要按这些标题组织」。Task 6 的 SC 结构检查针对的是**固定脚手架**
(Title / Summary / Problem / Approach / Evidence / FAQ / Sources / CTA)。

**两者不得互相断言**:

- SC 结构检查**不得**读取 `briefSections`,也不得断言 draft 的标题集合与之匹配 ——
  那会**必然失败**,因为两者按设计描述的是不同的东西;这是设计层自相矛盾,不是实现 bug。
- 覆盖判定(`content-shadow.qa.brief-outline` claim)**不得**断言任何标题结构,
  只问「每条 committed 主题是否在正文某处被谈到」。

实现落点:`packages/flow-shadow/src/qa/coverage.ts`(读 briefSections、不看标题)与
`packages/flow-shadow/src/qa/structure-checks.ts`(看脚手架、不读 briefSections)两个文件互不引用对方的输入,
且各自文件头注写明这条边界。

---

## O-6 修正(2026-07-25,Task 6 缺陷修复轮)

**裁决:`content-shadow.qa.brief-outline` 的覆盖判定改为针对 `briefOutline.targetKeywords`,
不再针对 `briefSections`。`briefSections` 仍留在 manifest / pack 里(它是塑造 prompt 的冻结输入,
红线 C 需要它被记录),只是不再是覆盖判定的对象。**

### 根因:两条各自正确的裁决复合起来互相摧毁

- **O-6(Task 4b)** 把 `briefSections` 定义为「承诺覆盖的主题清单」。
- **Task 4b 跨 O 约束的注入面净化** 要求:命中 §10.1 别名表的标题一律归一为**英文 canonical 常量**,
  operator 的原始字节根本不进 prompt。

而 `content_brief` 的 validator **强制要求全部 9 个标准 section**。于是对任何合规 brief,
`briefSections` 恒等于:

```
Objective / Audience / Search Intent / Target Topics & Queries / Outline /
Evidence / Conversion Path / Proof & Source Requirements / Acceptance Checklist
```

这是一组**文档结构标签**,不是主题词。一篇讲 onboarding analytics 的博客正文永远不会出现
objective / outline / acceptance / requirements 这些词。实测:合规 brief + 完全干净的 draft →
coverage claim = `failed`,9 条主题报 8 条「未覆盖」,verdict 被永久钉在 `needs_review` ——
**正是 coverage.ts 声称要治的那个病**。

换句话说:**让这个值变安全的那一步(canonical 化),恰好抹掉了让它可判定的那部分信息。**
两条裁决单独看都对,复合起来产生了一个 by-construction 恒失败的判据。

### 为什么是 `targetKeywords`

`targetKeywords` 来自冻结的 SearchQuery cluster,是真实的主题词,
「这篇文章有没有谈到这个 cluster 讲的事」正是这条 claim 一直想问的问题。
它同样是冻结输入(在 `contentBriefOutline` 里、进 `content_hash`),所以不破坏红线 C 与 Q8 的重放比对。

### 实现要求(已落地)

- `targetKeywords` 为空 → claim 报 `unevaluable`(`status: "unevaluated"`)并说明原因,**不报 failed**。
- 所有 keyword 都短到无法检索(全部 token < 4 字符或是 stopword)时,同样报 `unevaluated` 而非
  「全部覆盖」—— 否则又是一次「我没看」被写成「它没有」。
- O-4 不变:`briefSections === []`(提取整体失败)仍然是 `failed`,因为那意味着 brief→draft 因果链断了。
- `structure-checks.ts` 与 `coverage.ts` 的边界不变:前者只看固定脚手架,后者不断言任何标题结构。
  现在后者连 `briefSections` 也不读了,边界比原来更干净。

### 给 Task 7 / Task 8 的话

Task 8 的评审 UI 呈现这条 claim 时,措辞应是「本次 draft 是否覆盖了冻结 cluster 的目标关键词」,
**不要**写成「是否覆盖了 brief 的所有 section」—— 后者在 canonical 化之后已经不是一个可判定的问题。
