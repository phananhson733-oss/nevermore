# Slice 2 Task 4b — 主 agent 对 O-1..O-8 的裁决(2026-07-25)

配套蓝图:`2026-07-25-slice2-task4b-brief-outline-blueprint.md`(同目录)。
本文件是**硬约束**,与蓝图正文冲突时以本文件为准。Owner 已拍板方案 C(结构化提取,不放自由文本)。

---

## O-1 — 全局 `PROMPT_SET_VERSION` bump vs 范围化常量

**裁决:采纳推荐。用新的 `CONTENT_SHADOW_PROMPT_SET_VERSION`,绝不 bump 全局 `PROMPT_SET_VERSION`。新字段门控在 `english_blog_draft`,其余三类 prompt 字节不变。**

理由:全局常量被 `diagnostic_runs.prompt_set_version` 的 DB CHECK 钉死(`0001_init.sql:436` + authority `schema.sql:390`)。全局 bump 要连带迁移 + authority schema + 两个 verifier + verifier 源码文本断言 + 规格正文 + 约 40 处 fixture,**并让诊断流水线所有已入队 run 判 drift** —— 为了给 content shadow 加一个字段而让整条诊断线停摆,代价与收益完全不成比例。仓内 `PRODUCT_PROFILE_PROMPT_SET_VERSION = "mvp.prompts.product-profile.0.3.0"` 已是同款先例,`analysis_invocations.prompt_set_version` 无 CHECK,DB 层本就接受多字面量。

**附带必修**:蓝图发现的 split-brain —— service 从 `@sf/engine` import `PROMPT_SET_VERSION`(`content-shadow.ts:26`),worker 从 `@sf/artifacts` import(`run-content-shadow.ts:23`),是**两个独立常量**(`registry.ts:11` 与 `types.ts:24`),当前值恰好相等。任一侧单独改动会让每个 content shadow run 判 drift。本 Task 顺手修掉,并加一条测试或静态断言钉死"两侧引用同一个源"。**这是既有潜伏 bug,在总结里单列。**

---

## O-2 — outline 进不进冻结 manifest

**裁决:采纳推荐,进。**

理由:红线 C 的承诺是"给定冻结输入,run 可复现、可审计"。outline 是**真正塑造 draft 的那个东西**;不把它记进冻结记录,审计者就无法在不重跑提取器的情况下看到模型到底被告知了什么。把它纳入后,因果链、可复现、漂移检测、可见性四件事一次到位,且不需要新增守卫代码。

配套:`mapping_decision` 是可变的(带 `mapping_revision` 计数器),是真实漂移源。outline 进 manifest 后,accept→claim 窗口内的 mapping 变更会被既有漂移守卫自然捕获 → `CONTENT_SHADOW_INPUT_DRIFT`。这是正确行为,不要为它开特例。

---

## O-3 — `pageAssignment` 取值域与是否按 `mapping_review_state` 过滤

**裁决:采纳推荐。4 值(`existing_page` / `new_asset` / `mixed` / `unassigned`),不按 `mapping_review_state` 过滤。**

理由:一个 cluster 里多个 keyword 的 `mapping_decision` 可以合法地不一致,把它硬塞进 Owner 原定的 2 值等于**编造一个不存在的共识**。`mixed` / `unassigned` 是诚实的答案,而且对模型也是有用信息。

**附加要求**:不过滤 unconfirmed 意味着未确认的 mapping 决策会影响 draft。这本身可接受(操作员显式选了这些 keyword),但**必须可见**:research pack 的 limitations 要记录本次 outline 里有多少 keyword 的 `mapping_review_state` 不是 confirmed。让评审者知道这一层,而不是让它隐形。

---

## O-4 — 提取失败(`sections === []`)降级 vs 硬失败

**裁决:降级,但必须是"响亮的降级",不是静默降级。**

不采纳"降级 + research pack limitation"的**轻量版**——只写一条 limitation 太安静了。提取失败意味着 brief→draft 的因果链**整条断掉**,悄悄退回本 Task 要修的那个原状,正是我在 Task 6 Q8 否决过的"静默吞掉偏差"模式。

**降级必须同时满足三条**:
1. research pack 记 limitation(说明提取为何失败);
2. **QA gate 的 verdict 至少 `needs_review`**,不允许 `passed`;
3. API 响应/Task 7 UI 必须显式呈现"outline 提取失败,本次 draft 未受 brief 引导"。

这与 Task 6 的 Q5(非英文 locale 标 `evaluable:false` 并携带原因)是同一条原则:**诚实的"未达成"永远优于静默的"看起来通过"**。

硬失败被否决的理由:标题非标准的 brief(operator 手改过)会让操作员完全跑不了 content shadow,惩罚过重。

---

## O-5 — generative queries 进不进 outline

**裁决:采纳推荐,不进。**

理由:把 generative queries 混进同一个 outline 字段,等于**在 prompt 层塌缩 invariant 8** —— 数据层辛苦维持的 search/generative 分离,会在送进模型的那一刻合并成一坨。invariant 8 不是只约束 DB 形状,它约束的是"这两类观测不得被当成同一种需求信号"。prompt 是这条约束最该被守住的地方之一。

若将来确实需要让 generative 影响生成,必须是**独立的、显式命名的第二个字段**,并单独走一次裁决。

---

## O-6 — `sections` 与固定脚手架 `CONTENT_SHADOW_OUTLINE` 的冲突(跨 Task)

**裁决:采纳推荐。`sections` 定义为「覆盖清单」(coverage checklist),不是文档结构。**

理由:若让模型按 brief 的 sections 组织文档结构,Task 6 的 SC 结构检查(它断言 Title/Summary/…/FAQ/Sources/CTA 这套固定脚手架)会**必然失败** —— 那是设计层面自相矛盾,不是实现 bug。定义成"这些主题必须被覆盖到"则两者正交:文档结构由脚手架决定,内容覆盖面由 brief 决定。

**必须知会 Task 6**:在 Task 6 蓝图/decisions 里补一条,说明 `briefSections` 是覆盖清单语义,SC 检查针对的是固定脚手架,两者不得互相断言。实现 agent 完成后请提醒主 agent 同步这条到 Task 6 文档。

---

## O-7 — 字段改名

**裁决:采纳推荐,改名 `sections` → `briefSections`。**

理由:与 §10.1 的"必需 section 合同"同名不同物,是一个必然会被后人误读的命名。现在改最便宜。O-6 把它定义成覆盖清单后,名字里带 `brief` 也更贴语义。

---

## O-8 — 是否同时 bump `CONTENT_SHADOW_PROJECTION_VERSION`

**裁决:采纳推荐,bump。**

理由:成本近零,且它是**唯一能记录"提取算法变了"的版本位**。outline 进冻结 manifest(O-2)之后,提取算法的任何变更都会改变冻结元组的内容;没有版本位记录这件事,未来审计者无法区分"输入变了"和"算法变了"。

注意:Task 4 修复轮刚把 projection version 的漂移守卫改成用 pinned 常量,所以 bump 后**已入队的旧 run 会被判 drift → failed**。蓝图判定这是正确行为,**我确认**:生产 `flow_shadow_runs` 预期 0 行,新地址与失败旧行不同键、不会撞 `flow_shadow_runs_content_hash_idx`,且"pinned 版本推进 → 旧 run 失败"正是红线 C 想要的语义。不要为它加兼容层。

---

## 跨 O 的统一约束

- **注入面净化是本 Task 最重要的一节,不许敷衍。** `briefSections` 从 operator 可编辑的 markdown 提取,operator 完全能把一整段指令写成一个标题。蓝图给的方案(命中别名表则归一为**英文 canonical 常量**、operator 原始字节根本不进 prompt、`headingMatches` 前缀匹配顺带截断)方向正确 —— 实现必须落实,并补**明确的注入尝试拒绝测试**(至少覆盖:超长标题、含换行、含控制字符、含 "ignore all previous instructions" 式指令、条数爆炸)。
- **契约税预期 0 处 openapi 改动**(`ArtifactPromptInput` 是内部类型,`ContentShadowResearch`/`ContentShadowFrozenInputs` 是 `.strict()` 窄投影)。净税 = 规格 §10.2 一段文字 + lock 里一条 sha256。计数必须仍是 **47/9/44/11**。若实际产生了额外税,**停下报告**。
- **零迁移**。若论证确实需要 DDL,停下报告,不要自行加。
- 提取器归 **`@sf/artifacts`**(需复用 `validators/markdown.ts` 的 heading 语法 + `CONTENT_BRIEF_SECTIONS` 别名表 + zod + `redactText`),不归 `@sf/flow-shadow`(后者硬约束零第三方 runtime 依赖)。
- AC-032 的 fixture 更新必须既覆盖新字段、又保持"不含未 allowlist 字段"的原意 —— 不要为了让它过而放宽断言。
