# Slice 2 Task 6 实现蓝图 · SEO/GEO QA + Factual Review gate(移植规格)(2026-07-25)

基线:worktree `unified-growth-opportunity-v03` @ `4025577`(Task 2 已落地,`packages/flow-shadow/` **尚不存在**,由 Task 4 建骨架)。配套:`2026-07-25-slice2-task4-content-shadow-blueprint.md`(§1 pinned Flow adapter 提取)、`2026-07-25-slice2-content-shadow-execution-plan.md`(裁决 D:禁 runtime import 兄弟仓库)。

兄弟仓库 `/Users/wzb/gengrowth-flow-mvp` **只读**,本文件所有引用均为 clean-room 重写依据,**不得** copy-paste 其测试文本或 fixture。

---

## 0. 三条对上游蓝图的事实修正(实现前必读)

移植清单在 Task 4 蓝图 §1 里写的是 "RL1-12 / SC1-10"。核实兄弟仓库真实代码后,三处与事实不符,**以本节为准**:

| 上游写法 | 真实情况 | 影响 |
|---|---|---|
| `red-lines.mjs` 有 RL1-12 | 实际是 **RL1-RL13**(`checkRL13` 在 `red-lines.mjs:1239`,banned jargon,HARD=FAIL / SOFT=WARN),且 `redLinesCheck` orchestrator 跑全部 13 条 | 清点必须覆盖 13 条 |
| `structure-checks.mjs` 有 SC1-10 | 实际导出 **14 个** check:SC1/SC2/SC3/**SC3b**/**SC3c**/SC4/SC5/SC6/SC7/SC8/SC9/**SC9b**/SC10/**SC11**。**没有** `structureCheck` 聚合导出——每个 caller 自己拼 | 清点必须覆盖 14 条;聚合语义由我们自己定义 |
| "RL8(科学背书无支撑=FAIL)、RL12(幻觉引用=FAIL)是 unsupported-claim 核心" | **oracle 版 RL8 的语义是反的**:`red-lines.mjs:776 checkRL8` 禁止一切"research shows / studies suggest / evidence-based"措辞(占星站不许披科学外衣)。SignalFrame 是 **B2B SaaS SEO**,禁掉这些词等于禁掉正常商业写作。真正对口的是 **`red-lines.gengrowth.mjs:95 checkRL8`(`rl8b2b_attribution_required`)**:研究类断言**必须带出处**,否则 FAIL——这才是"无支撑 claim"。RL12 同理有 B2B 版 `rl12b2b_citation_integrity`(`red-lines.gengrowth.mjs:122`) | **本 Task 移植的是 B2B profile 分支,不是 oracle 分支**。这是本蓝图最重要的一条裁决(见 §2 D-A) |

另有两条真实现状值得记:

- `_phase2-validate.mjs:738` 的 `WAIVERS` 是**空 Set**(豁免机制是死代码);`--allow-missing-serp` 在 `_phase2-validate.mjs` **从未被解析**(RL3 只要 SERP cache 缺失就自动 `pass:true, skipped:true`)。→ 兄弟仓库的"escape hatch"实际不存在,**我们不移植任何豁免机制**。
- 兄弟仓库全部 QA lib(`red-lines*` / `structure-checks*` / `citability` / `authority-allowlist` / `review-fact-guard` / `_config`)**零第三方依赖**。`marked` + `sanitize-html` 只在 `gg-md-to-gengrowth-blog.mjs`(md→HTML 发布桥)用,而那个文件 Task 4 蓝图已明确**不移植**(Slice 3)。→ **`@sf/flow-shadow` 零第三方 runtime dep 的目标无阻碍**,§2 里没有任何一条规则因第三方依赖被迫排除。

---

## 1. RL1-13 / SC1-14 逐条清点

字段说明:**FAIL/WARN** = 兄弟仓库原级别;**SF 级别** = 本 Task 在 SignalFrame 的判定级别(`blocking` / `review` / `advisory` / `—`=不移植)。SF 级别→verdict 的映射见 §3。

### 1.1 红线 RL1-RL13

| ID | 兄弟仓库判定逻辑 | 输入形状 | 阈值 | 原级别 | 第三方依赖 | 移植决定 + SF 级别 |
|---|---|---|---|---|---|---|
| **RL1** `no_clinical_claim` | 单条巨型正则 `RL1_CLINICAL_REGEX`(`red-lines.mjs:33`):临床动词 + 必须跟临床语境名词(treats/diagnoses/cures/heals/prescribes) | `(draft)` | 无 | FAIL | 无 | **排除**。`red-lines.gengrowth.mjs:61` 在 B2B profile 已 no-op(`no clinical/medical domain`)。SignalFrame 无医疗域。代价:零 |
| **RL2** `no_competitor_smear` | 硬编码 6 家占星竞品名 × ±200 字符窗口内出现 12 词负面情绪词 → FAIL | `(draft)`,竞品名来自模块常量 | `RL2_WINDOW_CHARS=200` | FAIL | 无 | **移植但重写数据源**,`review`。B2B profile 把它 no-op 掉是因为占星竞品名单不适用,**不是因为规则本身无价值**。SignalFrame 有真实竞品身份:`competitor_entities`(domain/name,`review_status='approved'`)。规则重写为:draft 中出现 **approved** 竞品 domain 或 name,且 ±200 字符窗口内命中情绪词 → `review`。理由:自有博客抹黑具名竞品是品牌/法务风险,但情绪词表粗糙(FP 高),不配当 `blocking` |
| **RL3** `no_serp_plagiarism` | draft tokens vs SERP top-3 snippet tokens 的**最长连续公共 n-gram**(DP,`longestCommonNgram`),> 阈值 FAIL;snippets 为 undefined/非数组/空 → FAIL;`serpState='missing-skipped'` → 直接 pass | `{serpState, snippets: string[], escapeReason}` | `RL3_NGRAM_THRESHOLD=12`(可 sheet 覆盖 `phase2.RL3_n_gram`) | FAIL | 无 | **排除(Slice 2)**。SignalFrame **没有 SERP snippet 语料**:`dataforseo` provider 存在但 Slice 2 无 SERP 片段缓存,且抓 SERP = 新外部读取面(不在 Task 6 范围)。**代价明确记入 stop gate**:Slice 2 无抄袭检测。`longestCommonNgram` 纯函数仍**保留**在 `qa/ngram.ts`(供 §1.3 SC-DUP 与未来 Slice 3 复用) |
| **RL4** `keyword_anchored` | 按 H2 切段,取每段首段落(跳过免责声明行/表格/列表首段),对 target keyword 算 jaccard + 5-gram shingle + target-recall,三者都低且不含 entity → 记 drift;drift 段数 ≥ 阈值 FAIL;`Take Action/Related Reading/Sources` 段跳过 | `{targetKeyword, entity, driftThreshold?}` | jaccard≥0.05 / shingle≥0.10 / recall≥0.5 / drift 段数 ≥2(oracle)或 **≥4**(`GENGROWTH_RL4_DRIFT_FAIL=4`) | FAIL | 无(但依赖 `Intl.Segmenter` 走 ZH) | **移植 B2B 变体**,`review`。B2B 版 `red-lines.gengrowth.mjs:50` 额外做**连字符归一化**(`white-label`→`white label`)+ drift 阈值抬到 4。SignalFrame 的 `targetKeyword` 来自冻结的 `searchCluster`(见 §5.2);`entity` 用 ICP `productName`。级别 `review`:关键词漂移是 SEO 质量问题,不是真实性问题 |
| **RL5** `no_keyword_stuffing` | 全词计数 target keyword,超过 `max(flatCap, densityCap)` FAIL;densityCap 按词数分档(单词 1.5%、多词 2.8%) | `{targetKeyword, maxCount?}` | `RL5_MAX_COUNT=12`、单词密度上限 0.015、多词 0.028 | FAIL | 无 | **移植**,`review`。B2B 版**明确不做**连字符归一化(否则 hyphen 变体会灌高计数造成假堆砌)。原样保留该不对称 |
| **RL6** `psych_safety_disclaimer` | 需要免责声明行 + 禁短语 + 16 词黑名单 + "condition" 语境正则;未传 flag 直接 FAIL(反接线 bug) | `{effectivePsychSafety:'Y'\|'N', targetKeyword}` | 无 | FAIL | 无 | **排除**。`red-lines.gengrowth.mjs:63` 已 no-op。代价:零 |
| **RL7** `author_banned_tokens` | 逐条扫 author persona 黑词(整词,跨行 `\s+`),命中 FAIL;黑词若整词落在 target keyword 内则豁免(keyword ≤80 字符 / ≤7 词) | `{authorBannedTokens: string[], targetKeyword}` | 关键词豁免上限 80 字符 / 7 词 | FAIL | 无 | **移植函数、Slice 2 不接线**,`advisory`(默认空表 = N/A pass)。SignalFrame 无 author persona 概念。保留 `bannedTokens: readonly string[]`(默认 `[]`)入参,Slice 3 品牌禁词表可零改动接入。代价:零(空表恒 pass) |
| **RL8** oracle `no_scientific_endorsement` | 9 条科学背书短语的 global 匹配,同**子句内**有否定线索则豁免(`clauseBeforeMatch` 截到最近标点) | `(draft)` | 9 条短语常量 | FAIL | 无 | **排除**(语义与 B2B 相反,见 §0)。但 `clauseBeforeMatch` + 同行否定豁免这个**技巧移植进 RL8-SF**(否则 "there is no evidence that X" 会被误判为无支撑断言) |
| **RL8-B2B** `attribution_required` | 3 条 REJECT 正则(research/studies/data + shows/suggests…;scientists/experts + say…;`(studies)`)命中后,**同一行**若命中 7 条 ALLOW 之一(`according to` / `per a|an|the` / `source:` / `<study\|report\|survey…> by\|from` / `by\|from <Capitalized>` / 一个 4 位年份 / 行内 `](https://`)则放行,否则 FAIL。扫描前剥 frontmatter、fenced code、inline code,并**从 `## Sources` / `## References` / `## Related Reading` 标题起截断全文** | `(draft)`(无 ctx) | 无可调阈值 | FAIL | 无 | **核心移植 + 强化**,`blocking`。这是"无支撑 claim 被 block"的第一根支柱。**SignalFrame 强化**:ALLOW 不能只是"这一行长得像有出处",必须**真的解析到 research pack 里的一条 source**(见 §4.3 判据链)。原版 ALLOW 里的 `\b\d{4}\b`(任意 4 位年份)和 `by [A-Z]\w+`(任意大写词)是明显可被幻觉绕过的洞——LLM 编一个 "According to a 2024 Forrester study" 就过。**必须堵上** |
| **RL9** `atom_label_leak` | 行首结构标记 `Topic Sentence:` / `Topic-Process-Example` 泄漏 → FAIL;跳过标题行 | `(draft)` | 2 个标签 | FAIL | 无 | **排除**。`red-lines.gengrowth.mjs:64` 已 no-op(B2B 模板脚手架不同)。SignalFrame draft 走 markdown LLM envelope,无 atom-block 脚手架 |
| **RL10** `depersonalization` | 5 条聊天残留短语(`as you said` / `you mentioned` / `your logic` …)全局匹配 → FAIL。刻意**不**禁裸 `you`(FAQ 语气合法) | `(draft)` | 5 条短语 | FAIL | 无 | **移植**,`review`。域无关、FP 极低、成本近零。级别降为 `review`(是"像聊天记录"的质量问题,不是真实性问题) |
| **RL11** `weak_verb` | `is about` / `relates to` → 记 violation,但 `pass` 恒 `true`,只置 `warn:true` | `(draft)` | 2 条短语 | **WARN** | 无 | **移植**,`advisory`。WARN 语义原样保留(永不影响 verdict) |
| **RL12** oracle `citation_hallucination` | (a) 裸外链(含无 scheme 的 `www.` / `host/path`)不在 TBD 占位符内、不在 `ownDomains`、不在 `allowedUrls` → FAIL;(b) TBD 占位符标题含 paranormal/pseudoscience/alternative → FAIL;(c) **幻觉引用标记**:斜体书名近专名、`(19xx\|20xx)` 年份紧邻归属动词、`et al.`、`<X> University study` → FAIL;(d) 归属型专名不在 allowlist → **WARN** | `{allowedUrls?, ownDomains?, authorityAllowlist?}` | ownDomains 默认 `['astrologywiki.com']` | (a)(b)(c) FAIL,(d) WARN | 无 | **核心移植(混合版)**,`blocking`。见下 |
| **RL12-B2B** `citation_integrity` | 裸 URL(不在 markdown link 内、不在 TBD 内)→ FAIL;孤儿 `et al.`(前面无 `Name et al`)→ FAIL。同样剥 Sources 段 | `(draft, _ctx)` | 无 | FAIL | 无 | **与 oracle 版合并**成 RL12-SF(见下) |
| **RL13** `banned_jargon` | HARD 10 词命中 FAIL;SOFT 4 词命中 WARN;跳过标题行 | `(draft)` | HARD=`recursive/systemic/navigate the landscape/delve/unlock/high-bandwidth/antenna/rebooting/architecture/mechanism`;SOFT=`engine/module/robust/lag` | FAIL/WARN | 无 | **移植机制、重导词表**,`advisory`。**原 HARD 表对 B2B SaaS 是敌意的**:`architecture` / `mechanism` / `engine` / `module` / `robust` 全是 SaaS 正常词汇(SignalFrame 自己的文档就在用)。重导后 HARD 只留 4 个纯 AI-slop 词:`delve` / `unlock`(动词滥用)/ `navigate the landscape` / `recursive`,且**全部降为 `advisory`**——文风偏好不该 block 内容。见开放问题 Q7 |

### 1.2 结构检查 SC1-SC11(14 个函数)

| ID | 判定逻辑 | 输入 | 阈值 | 原级别 | 移植决定 + SF 级别 |
|---|---|---|---|---|---|
| **SC1** `bolded_definition` | 第一个 H2 段体内必须有非空 `**…**` 粗体跨度 | `(draft)` | 无 | FAIL | **移植**,`review`。GEO 直答句,对 AI Overview 抽取有直接价值 |
| **SC2** `internal_link_tier` | 数 `[[<TBD-internal-link:>]]` + 已解析的 `](/en/blog/<slug>)`,按 tier 阶梯 T1≥5 / T2≥3 / T3∈[1,2] 判定;**读 `process.env.GG_SITE`** 切换计数正则 | `{tier}` | T1:5 / T2:3 / T3:1-2 | FAIL | **移植但重写**,`advisory`(Slice 2)。SignalFrame **无 tier 词汇、无 TBD 占位符约定**。重写为:统计指向本项目自有域(`ownDomains`)的 markdown 链接数,下限由 research pack 的 `internalLinkCandidates.length` 派生。**必须删掉 `process.env` 读取**(见 §5.4 纯度红线)。真正 gating 推迟到 Slice 3(有 publish/链接解析时) |
| **SC3** `paragraph_length` | prose 段落 + list item 块,任一超 7 句 / 180 词 / 430 CJK 字 → FAIL | `(draft)` | 7 / 180 / 430 | FAIL | **原样移植**,`review`。纯结构、域无关 |
| **SC3b** `paragraph_fragmentation` | 叙事段(排除 FAQ/Sources/CTA 等短段设计区)句数中位数 ≤1 → WARN,需 ≥10 段才判 | `(draft)` | 中位数 ≤1,最少 10 段 | **WARN** | **移植**,`advisory` |
| **SC3c** `section_scatter` | 每个 H2/H3 子节内连续 prose 块 >3 → FAIL | `(draft)` | 3 | FAIL | **移植**,`review` |
| **SC4** `link_distribution` | `Related Reading` 之前、且位于 prose 行上的内链数需 ≥1;首链须在开篇 150 词 / 200 CJK 字内 | `(draft)` | 150 词 / 200 字 | FAIL | **移植但重写**,`advisory`(Slice 2)。同 SC2:依赖 TBD 占位符 + 固定 `Related Reading` 标题,SignalFrame 都没有。重写为 markdown 链接 + 可配 tail-section 标题集 |
| **SC5** `faq_section` | 定位 FAQ H2(EN/ZH 角色词),数整行加粗且以 `?`/`？` 结尾的问句,<3 FAIL | `(draft)` | ≥3 问 | FAIL | **排除(Slice 2)**,理由:SC5/SC8/SC9/SC10 全部预设一份**模板强制的 section 契约**,而 SignalFrame 的 `english_blog_draft` 在 `packages/artifacts/src/validators/index.ts:79` 明确是 **free-form markdown,无必需 section**。强推 FAQ 等于隐式给 draft 加契约。见开放问题 Q3。函数本体仍移植,`advisory` 常关 |
| **SC6** `h1_value_prop` | H1 是裸关键词(无分隔符 + 比 keyword 多 ≤1 token)或用了 `[关键词]: [从句]` 死板模板 → WARN | `{target_keyword}` | ≤1 额外 token;CJK ≤12 字 | **WARN** | **移植**,`advisory` |
| **SC7** `snippet_bullets` | 首个 H2 段内 list-item 行 ≥3 | `(draft)` | 3 | FAIL | **移植**,`advisory`。GEO structure 杠杆,与 citability 同向 |
| **SC8** `cta_url` | 定位 Take Action 段;必须有真实 http(s) URL(排除 example.com);若给了 `cta_target_url` 则段内 URL 须**规范化后精确等于**它;禁 `here`/`click here`/`这里` 等空泛锚文本 | `{cta_target_url}` | 无 | FAIL | **移植但重写定位**,`review`。SignalFrame 有真实对口输入:`PromptIcp.primaryConversion.targetUrl`(`packages/artifacts/src/types.ts`)+ content_brief 的 `## Conversion Path` 段。重写为:扫全文而非固定 Take Action 段;若 draft 含任何指向 `ownDomains` 的链接,则其中至少一条须等于 `conversionTargetUrl`。`canonicalUrl` 归一化函数原样移植 |
| **SC9** `sources_section` | 锚定精确标题 `## Sources` / `## 参考来源`,段内 ≥1 条列表项 | `(draft)` | ≥1 | FAIL | **移植**,`review`。是事实评审 gate 的结构锚点。缺 Sources 段本身不 `blocking`(无引用的纯观点文是合法的),但只要文中有**被判为需出处的断言**,RL8-SF 就会独立 block |
| **SC9b** `sources_named_in_body` | Sources 条目名(取首个破折号/冒号前的部分)必须在正文出现(全名或最长 token 命中即可) | `(draft)` | 名长 ≥3 | **WARN** | **移植并升级为 `blocking`**,重命名 `sc9b_sources_resolve_to_pack`。这是第三根支柱:**Sources 段列出的每一条,必须能解析到 research pack 的一条 source**。原版只查"是否在正文出现"(防悬空引用),SignalFrame 版查"是否在 pack 里"(防**编造来源**)。见 §4.3 |
| **SC10** `table_integrity` | 首个 markdown 表格 ≥4 列 × ≥3 数据行;`required=true` 时无表格也 FAIL | `{required}` | 4 列 / 3 行 | FAIL | **移植**,`advisory`(`required=false`)。同 SC5:无模板契约不宜强制 |
| **SC11** `banned_headings` | 3 个模板化标题模式:字面 `vs Adjacent Concepts`;`^What is `(小写 is);`^How to Read <小写实词>`(功能词白名单豁免)。仅扫 `##`/`###`,EN-only | `(draft)` | 3 模式 | FAIL | **移植**,`review`。廉价、确定性高、直接反"批量生产感" |

### 1.3 GEO citability(`citability.mjs` + `structure-checks.geo.mjs`)

- **判定逻辑**:7 个确定性特征计数(statistics / citations / quotations / definitions / structure / excerptability / fluency),各自按饱和目标归一到 0-1,再按 `DEFAULT_WEIGHTS`(和=1.0)加权得 0-1 分。`checkScGeo` 与阈值 `SC_GEO_DEFAULT_THRESHOLD=0.5` 比,`mode='warn'` 时 `pass` 恒 true。
- **原级别**:**advisory / 非 gating**。`structure-checks.geo.mjs:9-20` 的头注明确写:oracle 路径只消费 `formatScGeoAdvisory()` 做 print-only,**从不进 findings/warnings/manifest,从不翻转 OVERALL pass/fail**,并写死一句 `Do NOT promote it to a blocking check without recalibration`。
- **第三方依赖**:无。
- **移植决定**:**移植,`advisory`,永不参与 verdict**。`citability.mjs:14-16` 的 clean-room provenance 头注(GEO paper Aggarwal/Murahari et al., KDD 2024, arXiv:2311.09735;"不 vendor/复制任何无 license 源码")+ `:141` 的 `caveat` 字段("启发式编辑信号,非测量数字、非已证因果;权重未经校准")**必须逐字保留**到 `packages/flow-shadow/src/qa/citability.ts` 的文件头与返回对象。理由:(1) 这是我们对 clean-room 出处的书面承诺,删掉等于抹掉合规痕迹;(2) `caveat` 是 SignalFrame 数据层纪律(启发式分不得包装成测量数字)的载体,Task 7 渲染时必须能读到它。
- **附加规则 SC-DUP(新,非移植)**:用 §1.1 保留的 `longestCommonNgram`,算 draft 与**冻结的 content_brief 正文**的最长连续公共 n-gram。>40 token 说明 draft 只是在复读 brief,`advisory`。这是把 RL3 的算法用在我们**真正拥有的**语料上。可选,若时间紧可砍。

### 1.4 明确不移植的兄弟仓库件

| 文件/机制 | 不移植理由 | 代价 |
|---|---|---|
| `lib/_config.mjs` + `.gg-cache/config-snapshot.json` | 阈值在**模块 import 时**从磁盘 JSON 读取并冻结(`red-lines.mjs:51` 等顶层调 `getConfig`)。这是 IO + 隐藏全局态,直接违背"纯确定性、无 IO"要求,更致命的是**破坏 content-addressed run 的可复现性**(同一 `content_hash` 在两台机器上可能得出不同 verdict) | 无。阈值改为纯函数显式入参 + 冻结默认常量,见 §5.3 |
| `lib/authority-allowlist.mjs` + `content-draft-templates/authority-allowlist.json` | 数据模型是 `{author_id: string[]}` 的人名白名单,**无 tiering、无 scoring**,且是 import 时读文件 + deep-freeze 的模块级单例。SignalFrame 的 authority 由 DB provenance 派生(§4),不需要静态白名单 | 无。RL12 sub-(d) 的 allowlist 语义由 research pack 的 `sources[].label` 承担 |
| `lib/review-fact-guard.mjs` | **名字有误导性**:它不是 claim→source→authority 模型,而是**改稿前后的受保护 token 差异守卫**(4 类正则:日历日期 / 精确时刻 / 星座度数 / URL;任一类有增删 → `hasDrift=true` → 整份修订被丢弃)。占星域强相关(星座度数),且它守的是"评审者不许改坐标",不是"断言要有出处" | 无(Slice 2)。**但它的思路对 Task 8 有价值**:人工评审编辑 draft 时,若改动了 Sources / URL / 数字,应触发 QA 重跑而非沿用旧 gate。记入 Task 8 备忘 |
| `gg-md-to-gengrowth-blog.mjs`(唯一用 `marked`+`sanitize-html` 的文件) | md→HTML 发布桥,属 Slice 3 | 无。Task 4 蓝图已排除 |
| `_phase2-validate.mjs` 的 `WAIVERS` 豁免机制 / `--allow-missing-serp` | 前者是空 Set 死代码,后者从未被解析。移植一个不存在的豁免只会引入绕过 gate 的口子 | 无。**SignalFrame 明确不提供 QA 豁免**;需要人工放行走 Task 8 的评审决策,而不是 gate 内部开后门 |
| `Intl.Segmenter` + `ZH_DOMAIN_LEXICON` 中文分词 | 分词结果依赖 Node/ICU 版本,**跨环境不可复现**;且词表是占星域词汇(脉轮/星盘/塔罗) | 见开放问题 Q5(locale 策略)。Slice 2 产物是 `english_blog_draft`,EN 快路径足够 |

---

## 2. 移植/排除总表 + 三大裁决

### 裁决 D-A(最重要)· 移植 B2B profile 分支,不是 oracle 分支

`red-lines.gengrowth.mjs` 是兄弟仓库自己为 **B2B SEO+GEO** 做的 profile,与 SignalFrame 场景**完全同构**。它的策略即我们的策略:

- **原样复用(域无关)**:RL3 / RL4 / RL5 / RL7 / RL10 / RL11 / RL13
- **丢弃(占星专属)**:RL1 / RL2 / RL6 / RL9
- **反转替换(安全核心)**:RL8 → 归属必需;RL12 → 引用完整性

其头注一句话说清了本 Task 的立意:*"Oracle forbids scientific framing; B2B REQUIRES research be attributed and checkable and FAILS invented/vague citations. This is the anti-fabrication guard."*

我们只在两点上偏离 B2B profile:保留 RL2(因为 SignalFrame 有真实竞品实体,数据源可替换);重导 RL13 词表(因为 B2B profile 的 HARD 表仍是从占星侧继承的)。

### 裁决 D-B · GEO citability 保持 advisory,并保留 provenance 头注

见 §1.3。硬性要求写进 review checklist:`packages/flow-shadow/src/qa/citability.ts` 的返回值必须携带 `method` / `basis` / `caveat` 三字段,且 `evaluateContentShadowQa` 的 verdict 计算**不得读取 citability 的任何字段**(用一个单测钉死:只改动 citability 相关内容,verdict 不变)。

### 裁决 D-C · 三根支柱构成 `blocking` 集,其余一律不 block

`blocking` 集**恰好三条**,全部围绕"无支撑 claim / 编造引用":

1. **RL8-SF** `rl8_unsupported_claim` — 研究/数据类断言无法解析到 pack source
2. **RL12-SF** `rl12_citation_integrity` — 外链/引用标记无法解析到 pack source 或 ownDomains
3. **SC9b-SF** `sc9b_sources_resolve_to_pack` — Sources 段条目无法解析到 pack source

其余全部是 `review` 或 `advisory`。理由:`blocked` 是最强信号,只应保留给"内容里有假东西"。SEO 结构问题(段落墙、缺 bullets、H1 不够磁性)让人去改,不该冒充真实性问题。

---

## 3. SignalFrame 侧判定映射(以真实 schema 为准)

### 3.1 真实表/仓库接口(已核实,不得臆造)

`packages/db/migrations/0020_content_shadow_foundation.sql:94-111`:

```sql
CREATE TABLE IF NOT EXISTS app.flow_shadow_qa_gates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  flow_shadow_run_id uuid NOT NULL REFERENCES app.flow_shadow_runs(id) ON DELETE RESTRICT,
  evaluated_artifact_id uuid NOT NULL REFERENCES app.execution_artifacts(id) ON DELETE RESTRICT,
  evaluated_revision integer NOT NULL CHECK (evaluated_revision >= 1),
  analysis_invocation_id uuid REFERENCES app.analysis_invocations(id) ON DELETE RESTRICT,
  verdict text NOT NULL CHECK (verdict IN ('passed','needs_review','blocked')),
  claims jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(claims) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (flow_shadow_run_id, evaluated_artifact_id, evaluated_revision)
);
```

**verdict 值域就是 `'passed' | 'needs_review' | 'blocked'` 三值**(CHECK 约束原文),TS 侧同名 union 在 `packages/db/src/repositories/flow-shadow-runs.ts:61`。

仓库接口(`flow-shadow-runs.ts:279-355`):

```ts
export interface FlowShadowQaGateInsert {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly flowShadowRunId: string;
  readonly evaluatedArtifactId: string;
  readonly evaluatedRevision: number;
  readonly analysisInvocationId: string | null;
  readonly verdict: "passed" | "needs_review" | "blocked";
  readonly claims: readonly unknown[];
}
class FlowShadowQaGatesRepository {
  insert(values: FlowShadowQaGateInsert): Promise<FlowShadowQaGateRow>;
  findByRun(scope: ProjectScope, flowShadowRunId: string): Promise<FlowShadowQaGateRow[]>; // created_at DESC, id DESC
}
```

**三条不可忽略的既有约束**:

1. `insert` 走 `onConflictDoNothing` + 冲突后 `findGate` 复查,**只比对 `verdict` 是否相等**(`:310`),**不比对 `claims`**。→ 若同一 `(run, artifact, revision)` 重放时 verdict 相同但 claims 不同,会静默返回旧行。**我们的 QA 必须是严格确定性函数**,这一点从"好习惯"升级为**正确性前提**。必须有单测钉死(§6 P2)。
2. 表被 `flow_shadow_qa_gates_append_only` 触发器保护(BEFORE UPDATE OR DELETE → `reject_append_only_mutation`)。**QA 结论不可修改**。重评审(Task 8 编辑 draft 产生新 revision)只能**追加**一条新 gate 行,`evaluated_revision` 不同,UNIQUE 不冲突。
3. `flow_shadow_qa_gates_provenance_guard` 强制 `flow_shadow_run_id` 必须属于同 workspace+project 的 `flow_shadow_runs` 行。
4. **无迁移**:Task 6 不新增表/列/枚举。`claims jsonb` 是唯一自由面。

### 3.2 规则组合 → verdict

```
severity(rule) ∈ { blocking, review, advisory }

blocked      ⟸ ∃ rule ∈ blocking-set,   rule.pass === false
needs_review ⟸ ¬blocked ∧ ( ∃ rule ∈ review-set, rule.pass === false
                            ∨ ∃ rule, rule.evaluable === false )
passed       ⟸ 其余
```

- **优先级**:`blocked` > `needs_review` > `passed`,单调不可降级。
- **advisory 永不影响 verdict**(RL7/RL11/RL13/SC2/SC3b/SC4/SC5/SC6/SC7/SC10/SC-DUP/citability)。
- **`evaluable === false` → `needs_review`(fail-to-human,绝不 fail-open)**。触发场景:`targetKeyword` 为空(RL4/RL5 无法判)、`outputLocale` 非 EN 且规则是 EN-only 启发式(见 Q5)、draft 为空。这是对兄弟仓库 RL3 的直接教训——`_phase2-validate.mjs` 的 RL3 在 SERP cache 缺失时**静默 `pass:true`**,等于抄袭检测被"缓存不存在"关掉了。**我们绝不允许"缺上下文 → 静默 pass"**。

| verdict | 规则组合 | 语义 | 下游行为 |
|---|---|---|---|
| `blocked` | RL8-SF / RL12-SF / SC9b-SF 任一 fail | draft 里有无支撑断言或编造引用 | 运行仍 `completed`(见下);Task 7 显式渲染被 block 的 claim 行号+原因;Task 8 禁用"采纳/评审通过"控件 |
| `needs_review` | 无 blocking fail,但有 review fail 或有不可判规则 | 内容可信但质量/结构需人看 | 正常进入 side-by-side 人工评审 |
| `passed` | 全绿 | 确定性 gate 无异议 | 正常进入人工评审(**`passed` ≠ 可发布**;Slice 2 止于 reviewed revision,零外部写入) |

### 3.3 `blocked` ≠ run failed(必须写死的语义)

`blocked` 是**内容判定**,不是**运行失败**。`runContentShadow` 在写完 gate 行后仍 `setTerminal(completed, resultType='flow_shadow_run')`。理由:

- draft artifact 必须被铸出并保留——它是"模型当时产出了什么"的证据,删掉就无法做事实评审;
- `async_runs.status='failed'` 会触发 recovery/重试语义,而重跑一个确定性 gate 只会得到同一个 `blocked`,纯粹浪费;
- 红线 D:任何阶段都不得把 artifact 标 `ready`/`published`。`blocked` 时 artifact 停在 draft 状态,这本身就是正确行为,不需要用 run failure 表达。

对应到 `ContentShadowRunResponse.phase` 派生(Task 4 蓝图 §3):`blocked` 仍派生为 `complete`,verdict 由 `qa.verdict` 字段单独表达。

---

## 4. Research Pack authority 字段

### 4.1 真实列(已核实,`0020:76-88`)

```sql
CREATE TABLE IF NOT EXISTS app.flow_shadow_research_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL ...,
  project_id uuid NOT NULL ...,
  flow_shadow_run_id uuid NOT NULL REFERENCES app.flow_shadow_runs(id),
  analysis_invocation_id uuid REFERENCES app.analysis_invocations(id),  -- nullable
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  pack jsonb NOT NULL CHECK (jsonb_typeof(pack) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (flow_shadow_run_id)          -- 一 run 一 pack
);
```

**结论:没有 `authority` 列。authority 只能是 `pack` jsonb 内部的字段。** 0020 已落地且 append-only,Task 6 **不得**加迁移。→ `pack.sources[].authority`。

`FlowShadowResearchPacksRepository.insert` 的重放校验比对 `content_hash`(`flow-shadow-runs.ts:253`),所以 pack 也必须是确定性组装。

### 4.2 A/B/C/D 分级定义

**先说冲突**:SignalFrame **已有** `EvidenceGrade = 'A' | 'B' | 'C'`(`packages/db/src/repositories/evidence.ts:25`),且 `0012_page_snapshot_lineage_hardening.sql:326-329` 用触发器把 provider→origin→grade 钉死:

```
gsc/ga4      + first_party        → A
crawl        + direct_public      → B
dataforseo   + vendor_observation → B
csv          + user_provided      → C
llm          + generated          → C (且必须有 analysis_invocation_id)
```

如果 Task 6 另起一套语义不同的 A/B/C/D,同一封 UI 里两个 "B" 含义不同,是可预见的事故源。

**推荐方案(见开放问题 Q1)**:保留计划要求的 A/B/C/D 字面量,但**把 A/B/C 定义成与 `EvidenceGrade` 恒等**,D 定义为一个 evidence 体系里根本不存在的新层。

| authority | 定义 | 来源(全部是 DB 内已有行,零外部抓取) | 与 EvidenceGrade 关系 |
|---|---|---|---|
| **A** | 一方测量 | `evidence` 行,`grade='A'`(origin `first_party`,provider gsc/ga4),且经 `finding_observations` 挂在**冻结的 source Finding** 上 | 恒等 |
| **B** | 直接公开观测 / 供应商观测 | ① `evidence` 行 `grade='B'`(crawl `direct_public` / dataforseo `vendor_observation`);② 本项目 `site_pages` 行(我们真的抓到过这个页面);③ `competitor_entities` 行且 `review_status='approved'`(身份经 operator 复核) | 恒等(②③ 语义等价于 direct_public) |
| **C** | 操作者提供 / 系统派生 | ① `evidence` 行 `grade='C'`(csv `user_provided`,或 `origin='generated'` 且有 `analysis_invocation_id`);② 冻结的 `content_brief` revision 正文本身;③ `keyword_entities` 行且 `status='approved'` | 恒等 |
| **D** | **不可核验** | **确定性 research 组装永不产生 D**。D 是 **QA 侧的输出层级**:draft 里一条断言,其归属**无法解析到 pack 里任何一条 source** 时,该 claim 被打 `authority:'D'` | evidence 体系无 D,故无冲突 |

**不变式(review 必查)**:

- **INV-1 authority 是派生的,永不由 LLM 断言**。pack 组装只从 DB 行读 provenance 计算 authority;prompt/LLM 输出中的任何 "authority" 字段一律丢弃。
- **INV-2 pack 里不出现 D**。若 Task 4 的组装实现产出了 D,视为 bug(说明它凭空造了一条无 provenance 的 source)。
- **INV-3 每条 source 必带 `provenance:{table,id}`**,指向真实行,便于 Task 7 渲染"这条出处从哪来"。

### 4.3 判据链:claim → source → authority

RL8-SF / RL12-SF / SC9b-SF 共用同一条解析链,实现在 `qa/claims.ts`:

```
1. 抽取候选 claim
   RL8-SF: 逐行跑 REJECT 正则(research/studies/data + shows/…;experts + say/…;(studies))
           先剥 frontmatter / fenced code / inline code(prose-only)
           同子句内有否定线索(clauseBeforeMatch + NEGATION 正则)→ 不算 claim(诚实免责句合法)
   RL12-SF: 逐行抽 URL(裸的 + markdown link 的)、抽幻觉引用标记(斜体书名近专名 / 年份紧邻归属动词 / et al. / <X> University study)
   SC9b-SF: 抽 `## Sources` 段的每条列表项名(破折号/冒号前的部分)

2. 抽取归属 token(同一行内,按优先级)
   a. markdown link 的 URL           → canonicalUrl 归一
   b. 裸 URL                          → canonicalUrl 归一
   c. `according to X` / `per a X` / `<study|report|survey> by X` / `by|from <Capitalized...>` 里的 X → 名称归一(trim/collapse ws/lowercase)
   d. 域名字面量(example.com 形态)   → 域归一(去 www.)

3. 在 pack.sources[] 里解析(短路,首个命中为准)
   URL 精确命中     → matched
   域命中           → matched
   名称精确命中     → matched
   名称最长 token 命中(token 长度 ≥4,避免 "the"/"data" 误配) → matched
   否则             → unresolved

4. 定级
   matched   → claim.authority = source.authority   ∈ {A,B,C}
               claim.resolvedSourceId = source.sourceId
   unresolved→ claim.authority = 'D',claim.resolvedSourceId = null
               → 该规则 pass=false → verdict = blocked

5. 豁免(不算 unresolved)
   - URL 落在 ownDomains(自有站/CTA)→ matched,authority='B'(我们自己的页面)
   - URL 等于 conversionTargetUrl     → 同上
   - claim 出现在 fenced code / frontmatter 内 → 根本不进入第 1 步
```

**这条链直接堵住了兄弟仓库 RL8-B2B 的两个洞**:原版 ALLOW 里 `\b\d{4}\b`(任意四位年份)和 `by [A-Z]\w+`(任意大写词)只检查"这行长得像有出处",LLM 编造 "According to a 2024 Forrester study" 照样过关。SignalFrame 版要求出处**真的在 pack 里**,而 pack 只能由 DB 行组装 —— 幻觉出处天然无处可藏。

### 4.4 Task 6 依赖的 ResearchPack 读契约

Task 4 拥有 `packages/flow-shadow/src/research/` 的组装实现。Task 6 只需一份**读契约**。若 Task 4 落地的形状与下列不同,**适配它,不要另起一份**(把差异记进 Task 6 的 commit message):

```ts
// packages/flow-shadow/src/types.ts (Task 4 拥有;Task 6 消费)
export type SourceAuthority = "A" | "B" | "C";
export type ClaimAuthority = SourceAuthority | "D";

export interface ResearchSource {
  readonly sourceId: string;               // pack 内稳定确定性 id
  readonly kind: "evidence" | "site_page" | "competitor" | "keyword" | "content_brief";
  readonly authority: SourceAuthority;     // INV-1 派生,非 LLM 断言
  readonly label: string;                  // 名称匹配用的展示名
  readonly url: string | null;             // 已 canonicalUrl 归一
  readonly domain: string | null;          // 已去 www.
  readonly claim: string | null;           // evidence.claim 原文(若有)
  readonly observedAt: string | null;
  readonly provenance: { readonly table: string; readonly id: string };  // INV-3
}

export interface ResearchPack {
  readonly packVersion: string;            // = CONTENT_SHADOW_ADAPTER_VERSION
  readonly sources: readonly ResearchSource[];   // 按 sourceId 升序,确定性
  readonly ownDomains: readonly string[];
  readonly conversionTargetUrl: string | null;
  readonly internalLinkCandidates: readonly string[];  // site_pages URL,SC2/SC4 用
}
```

---

## 5. 纯函数 API 设计(`packages/flow-shadow/src/qa/`)

### 5.1 文件布局

```
packages/flow-shadow/src/qa/
  index.ts            # barrel:只导出 evaluateContentShadowQa + 类型 + DEFAULT_QA_THRESHOLDS
  types.ts            # QaRuleId / QaSeverity / QaRuleResult / QaClaim / QaEvaluation / QaThresholds
  thresholds.ts       # DEFAULT_QA_THRESHOLDS(Object.freeze)+ resolveThresholds
  text.ts             # stripFrontmatter / stripFencedCode / stripInlineCode / proseBody / splitByH2 / sectionByHeading / canonicalUrl / tokenize
  ngram.ts            # longestCommonNgram / shingles / jaccard(RL4 + SC-DUP 复用)
  claims.ts           # extractClaims / resolveAuthority(§4.3 判据链)
  red-lines.ts        # checkRl2 / Rl4 / Rl5 / Rl7 / Rl8 / Rl10 / Rl11 / Rl12 / Rl13
  structure-checks.ts # checkSc1 / Sc2 / Sc3 / Sc3b / Sc3c / Sc4 / Sc5 / Sc6 / Sc7 / Sc8 / Sc9 / Sc9b / Sc10 / Sc11
  citability.ts       # clean-room GEO 评分(provenance 头注逐字保留)
  evaluate.ts         # evaluateContentShadowQa 编排 + verdict 计算
```

每文件 <400 行;`red-lines.ts` / `structure-checks.ts` 若超 400 行按 `red-lines/*.ts` 再拆一层。

### 5.2 导出签名

```ts
// types.ts
export type QaSeverity = "blocking" | "review" | "advisory";

export type QaRuleId =
  | "rl2_competitor_smear" | "rl4_keyword_anchor" | "rl5_keyword_stuffing"
  | "rl7_banned_tokens" | "rl8_unsupported_claim" | "rl10_chat_residue"
  | "rl11_weak_verb" | "rl12_citation_integrity" | "rl13_banned_jargon"
  | "sc1_bolded_definition" | "sc2_internal_link_density" | "sc3_paragraph_wall"
  | "sc3b_paragraph_fragmentation" | "sc3c_section_scatter" | "sc4_link_distribution"
  | "sc5_faq_section" | "sc6_h1_value_prop" | "sc7_snippet_bullets"
  | "sc8_conversion_link" | "sc9_sources_section" | "sc9b_sources_resolve_to_pack"
  | "sc10_table_integrity" | "sc11_banned_headings" | "scdup_brief_overlap";

export interface QaRuleResult {
  readonly ruleId: QaRuleId;
  readonly severity: QaSeverity;
  /** false = 规则判定不通过 */
  readonly pass: boolean;
  /** false = 上下文不足无法判定 → 强制 needs_review,绝不静默 pass */
  readonly evaluable: boolean;
  /** 稳定机器码,禁止把可变数字拼进去(如 "count=13");数字放 detail */
  readonly reasonCode: string;
  readonly detail: string;
  readonly claimIds: readonly string[];
}

export interface QaClaim {
  readonly claimId: string;                 // sha256Hex(`${ruleId}|${line}|${excerpt}`).slice(0,16)
  readonly ruleId: QaRuleId;
  readonly severity: QaSeverity;
  readonly line: number;                    // 1-based,相对原始 draft
  readonly excerpt: string;                 // <=200 字符,原文截断
  readonly authority: ClaimAuthority | null;// 仅 §4.3 链路产出的 claim 有值
  readonly resolvedSourceId: string | null;
  readonly reasonCode: string;
  readonly detail: string;
}

export interface CitabilityReport {
  readonly score: number;                   // 0-1
  readonly features: { readonly raw: Record<string, number>; readonly normalized: Record<string, number> };
  readonly weights: Readonly<Record<string, number>>;
  readonly weakFeatures: readonly string[];
  readonly method: string;                  // "citability-geo-heuristic-v1"
  readonly basis: string;                   // GEO paper provenance,逐字保留
  readonly caveat: string;                  // 启发式免责,逐字保留
}

export interface QaThresholds { /* §5.3 */ }

export interface QaEvaluationInput {
  readonly draftMarkdown: string;
  readonly briefMarkdown: string;                       // 冻结的 content_brief revision 正文
  readonly researchPack: ResearchPack;
  readonly targetKeyword: string;                       // 由 searchCluster.clusterKey 派生
  readonly clusterKeywords: readonly string[];          // keyword_entities.display_keyword(search_query)
  readonly generativeQueries: readonly string[];        // 独立集合,绝不与上者塌缩(invariant 8)
  readonly competitors: readonly { readonly domain: string; readonly name: string | null }[];
  readonly entityName: string;                          // ICP productName
  readonly outputLocale: string;
  readonly thresholds?: Partial<QaThresholds>;
}

export interface QaEvaluation {
  readonly adapterVersion: string;          // = CONTENT_SHADOW_ADAPTER_VERSION
  readonly verdict: "passed" | "needs_review" | "blocked";
  readonly claims: readonly QaClaim[];      // → flow_shadow_qa_gates.claims
  readonly rules: readonly QaRuleResult[];
  readonly citability: CitabilityReport;    // advisory,不参与 verdict
  readonly thresholds: QaThresholds;        // 生效值回显
}

// evaluate.ts —— 唯一对 worker 暴露的入口
export function evaluateContentShadowQa(input: QaEvaluationInput): QaEvaluation;
```

**worker 侧只需两行**:

```ts
const evaluation = evaluateContentShadowQa(input);
await qaGatesRepo.insert({
  workspaceId, projectId, flowShadowRunId,
  evaluatedArtifactId: draftArtifactId,
  evaluatedRevision: draftRevision,
  analysisInvocationId: null,          // Slice 2 QA 全确定性,无 LLM 判官(Q2)
  verdict: evaluation.verdict,
  claims: evaluation.claims,           // QaClaim[] 直接进 jsonb array,满足 CHECK
});
```

### 5.3 阈值:显式参数,禁配置文件/env

```ts
// thresholds.ts
export const DEFAULT_QA_THRESHOLDS = Object.freeze({
  rl2WindowChars: 200,
  rl4JaccardFloor: 0.05,
  rl4ShingleFloor: 0.10,
  rl4ShingleN: 5,
  rl4TargetRecallFloor: 0.5,
  rl4DriftedSectionsFail: 4,        // B2B 值(GENGROWTH_RL4_DRIFT_FAIL),非 oracle 的 2
  rl5FlatMaxCount: 12,
  rl5SingleWordDensityCeil: 0.015,
  rl5MultiWordDensityCeil: 0.028,
  sc3MaxSentences: 7,
  sc3MaxWords: 180,
  sc3cMaxSectionParas: 3,
  sc4FirstLinkMaxWords: 150,
  sc5MinFaqQuestions: 3,
  sc7MinBullets: 3,
  sc9MinSourceEntries: 1,
  sc10MinCols: 4,
  sc10MinRows: 3,
  scdupMaxBriefNgram: 40,
  citabilityAdvisoryFloor: 0.5,     // advisory only,永不 gating
  maxDraftChars: 400_000,           // ReDoS/DP 上界,超出 → evaluable:false
  nameMatchMinTokenLen: 4,
} as const);
export type QaThresholds = typeof DEFAULT_QA_THRESHOLDS;
export function resolveThresholds(p?: Partial<QaThresholds>): QaThresholds;
```

**版本耦合裁决**:QA 规则集与阈值由 `CONTENT_SHADOW_ADAPTER_VERSION`(`"content-shadow-adapter.0.3.0"`,`src/version.ts`,Task 4 拥有)统一 pin,**不引入第二个版本字面量**。后果是刻意的:**改任何一个阈值都必须 bump adapter version**,而 adapter version 在 `flow_shadow_runs.flow_adapter_version` 与 `content_hash` 冻结元组里 → 新 run、新 hash,旧 run 的 verdict 永远可复现。这正是红线 C 想要的。

### 5.4 纯度红线(review 必查,逐条对应兄弟仓库的真实缺陷)

| # | 红线 | 兄弟仓库对应问题 |
|---|---|---|
| 1 | `qa/` 下**任何文件不得** import `node:fs` / `node:process` / `@sf/db` / `@sf/artifacts` 的运行时值 | `red-lines.mjs:51` 顶层调 `getConfig()` 读磁盘 JSON |
| 2 | 不得读 `process.env` | `structure-checks.mjs:137` 读 `process.env.GG_SITE` 切换计数逻辑 |
| 3 | 不得用 `Date.now()` / `new Date()` / `Math.random()` / `crypto.randomUUID()` | claimId 用 `sha256Hex` 派生 |
| 4 | 不得在模块作用域持有带 `g`/`y` flag 的 regex 并用 `.exec()`/`.test()`(`lastIndex` 是可变全局态) | `structure-checks.mjs:940` 手动 `MD_LINK_REGEX.lastIndex = 0` 兜底,脆弱。我们只用 `String.prototype.matchAll`(每次内部克隆),或在函数内 `new RegExp` |
| 5 | 不得用 locale 敏感排序 / `Intl.*` | `red-lines.mjs:265` 用 `Intl.Segmenter`,跨 ICU 版本结果不同 → 破坏可复现 |
| 6 | 所有输出数组按稳定键排序(claims 按 `line` 再 `ruleId` 再 `claimId` 的 code-unit 序;rules 按 `QaRuleId` 声明序) | 无 |
| 7 | 输入长度上界 + 正则线性化,防 ReDoS | `RL12_ITALIC_NEAR_NAME_REGEX` / `RL12_YEAR_ATTRIB_REGEX` 有嵌套量词回溯风险;`longestCommonNgram` 是 O(n·m) DP |
| 8 | 纯函数不抛异常(除非编程错误)。上下文缺失走 `evaluable:false`,不走 throw | `redLinesCheck` 在 `draftMd` 非 string 时 throw;`_phase2-validate.mjs:764` 用 try/catch 把 throw 当 FAIL |

建议在 `scripts/verify-implementation.mjs` 加一条 guard(与 Task 4 蓝图提的 `gengrowth-flow-mvp` 字面量 guard 并列):对 `packages/flow-shadow/src/qa/**` grep `process.env|node:fs|Date.now|Math.random|Intl\.`,命中即失败。

---

## 6. 测试策略

### 6.1 Fixture(全部 clean-room 自写,禁止 copy 兄弟仓库测试文本)

放 `packages/flow-shadow/src/qa/__fixtures__/`,全部是 SignalFrame 自己的 B2B SaaS 语境(不用占星/气场词汇)。每个 fixture 配一个手写的最小 `ResearchPack`。

| fixture | 内容要点 | 期望 |
|---|---|---|
| `supported-draft.md` | "According to the Q2 Search Console export, organic clicks fell 34% ..." ,pack 里有一条 `kind:'evidence', authority:'A', label:'Search Console export'` | `passed` |
| `unsupported-claim.md` | "Research shows teams cut onboarding time by 40%." 单独一行,无任何归属 | `blocked`;≥1 claim `ruleId:'rl8_unsupported_claim'`, `severity:'blocking'`, `authority:'D'` |
| `phantom-source.md` | "According to the 2024 Forrester Digital Experience Report, ..." ,Forrester **不在** pack | `blocked`,`authority:'D'`(**这条是最关键的证明**:形式合规、内容幻觉) |
| `negated-claim.md` | "There is no evidence that switching CMS improves rankings." | 不产生 claim,`passed`(证明否定豁免) |
| `fenced-claim.md` | 同 `unsupported-claim` 的句子,但整段包在 ``` 围栏内 | 不产生 claim(证明 prose-only 剥离) |
| `bare-url.md` | 正文里一个裸 `https://randomblog.example/post`,不在 pack | `blocked`,`ruleId:'rl12_citation_integrity'` |
| `own-domain-cta.md` | 唯一外链是 `ownDomains` 内的 conversionTargetUrl | 不 block(证明自有域豁免) |
| `phantom-source-list.md` | Sources 段列了 3 条,其中 1 条不在 pack | `blocked`,`ruleId:'sc9b_sources_resolve_to_pack'` |
| `structure-weak.md` | 断言全部有支撑,但 8 句的段落墙 + 无 Sources 段 + 模板化 H2 `What is signal frame?` | `needs_review`(证明结构问题不升级为 blocked) |
| `geo-thin.md` / `geo-rich.md` | 只在统计/引用/列表密度上不同,断言集合完全一致 | 两者 **verdict 相同**,只有 `citability.score` 不同(证明 GEO 非 gating) |
| `empty.md` | 空串 | `needs_review`(`evaluable:false`),不 throw |
| `oversized.md` | 长度 > `maxDraftChars` | `needs_review`(`evaluable:false`),不超时 |

### 6.2 边界用例(单测,不必配 fixture 文件)

- claim 出现在 frontmatter / inline code / blockquote;
- 同一行多个 claim(必须全部抽出,不能只抽第一个 —— 兄弟仓库 `RL8_SCI_CLAIM_REGEX_G` 就是为修这个 bug 才加的 global 变体);
- 归属在**上一子句**而非同子句("Not surprisingly, research shows ..." 必须仍算无支撑,`clauseBeforeMatch` 语义);
- URL 尾随标点 `...example.com/a.` / `(https://x/y)` 的剥离;
- URL 归一化:大小写、`www.`、尾斜杠、`#fragment`;
- 名称匹配的 token 长度下限(`the` / `data` / `2024` 不得作为匹配 token);
- 重复 claim 去重(同 ruleId+line+excerpt → 同 claimId,只留一条);
- `targetKeyword` 为空 → RL4/RL5 `evaluable:false` → `needs_review`,**不是** `passed`;
- `outputLocale='zh-CN'` 时的降级路径(依 Q5 裁决);
- H2 为零 / 只有 H1 的 draft(SC1/SC7 必须"无意见 pass"而不是双重失败 —— 兄弟仓库刻意做了这个避让)。

### 6.3 证明义务(必须逐条有具名测试)

| ID | 命题 | 断言 |
|---|---|---|
| **P1** | **无支撑 claim 被 block** | `unsupported-claim.md` 与 `phantom-source.md` → `verdict==='blocked'` 且 `claims.some(c => c.severity==='blocking' && c.authority==='D')` |
| **P2** | **严格确定性** | 同一 input 跑两次 → `deepStrictEqual`;且 `contentHash(evaluation)` 两次相同。(**这是 `FlowShadowQaGatesRepository.insert` 只比 verdict 不比 claims 的正确性前提**) |
| **P3** | **GEO 永不 gating** | `geo-thin` vs `geo-rich` verdict 相同;且把 `citability` 整块从 evaluation 里删掉后 verdict 计算不变(用只依赖 rules 的纯函数验证) |
| **P4** | **advisory 永不 block** | 构造一份让**每一条** advisory 规则都 fail 的 draft → verdict 至多 `needs_review` |
| **P5** | **无 IO / 无环境依赖** | 源码 guard:`qa/**` grep `process.env|node:fs|Date.now|Math.random|Intl\.` 零命中;且 `import` 图不含 `@sf/db` |
| **P6** | **fail-to-human** | 任一 `evaluable:false` → verdict 至少 `needs_review`;不存在"上下文缺失 → passed"的路径 |
| **P7** | **worker 集成(integration test)** | 一次含无支撑 claim 的 run:`flow_shadow_qa_gates` 落一行 `verdict='blocked'`;`async_runs.status='completed'`;`execution_artifacts` 的 draft **未**被标 ready/published;`export_requests` 为空(零外部写入) |
| **P8** | **重放幂等** | 同一 run 重投递两次 → `flow_shadow_qa_gates` 仍只有一行(UNIQUE + onConflictDoNothing),verdict 不变 |
| **P9** | **新 revision 追加新 gate** | Task 8 人工编辑产生 revision 2 → 再评一次落**第二行**(`evaluated_revision=2`),第一行不变(append-only 触发器) |
| **P10** | **零 runtime import 兄弟仓库** | 全仓 grep `gengrowth-flow-mvp` 在 `packages/`/`apps/` 下零命中(与 Task 4 的 guard 合并) |

TDD 顺序:先写 P1/P2/P6 的失败测试(RED)→ 落 `claims.ts` + `evaluate.ts`(GREEN)→ 再逐条补规则。覆盖率目标:`qa/` ≥90%(高于全局 80%,因为它是 gate)。

---

## 7. 契约税与非税增量

**净变化:apiOperations / asyncOperations / tables 全部不变**(Task 6 不加 op、不加表、不加迁移、不加枚举)。

但有两处**必须同 commit 处理**:

1. **`QaClaim` schema 落地**。Task 2 蓝图 §4 已在 `ContentShadowRunResponse` 里声明了 `qa{gateId,verdict,evaluatedRevision,claims[QaClaim],evaluatedAt}`。若 Task 4 落地时把 `QaClaim` 留成 `z.unknown()` 或宽松对象,Task 6 需把它收紧为 §5.2 的真实形状 → 触发:`openapi/mvp.yaml` + `authority/.../openapi.yaml`(**字节一致同 sha256**)+ `pnpm contracts:generate` + `scripts/spec-v0.3-lock.json` **刷新 file sha256**(计数不变)。**实现前先看 Task 4 实际落成什么形状再决定改不改**。
2. **`ANALYSIS_INVOCATION_TASKS`**。D4 说 "QA-LLM 判官(Task 6 若用)按需再加 `content_shadow_qa`"。本蓝图推荐**不用 LLM 判官**(Q2),因此 **`ANALYSIS_INVOCATION_TASKS` 不动**,gate 行的 `analysis_invocation_id` 恒 `null`(列本身 nullable,合法)。若主 agent 裁决要 LLM 判官,则需加枚举值 + 可能的 DB CHECK + 全套契约税,并且 §6 P2 的确定性证明作废 —— 那是一次范围显著变大的改动。

非税同 commit 代码:新建 `packages/flow-shadow/src/qa/**` + `__fixtures__/**` + 单测;`packages/flow-shadow/src/index.ts` barrel 加 qa 导出;`apps/worker/src/content-shadow/run-content-shadow.ts` 第 6 步把 Task 4 的 `verdict:'needs_review'` 骨架替换为真判定;`scripts/verify-implementation.mjs` 加纯度 guard。

---

## 8. 风险与开放问题(需主 agent 裁决)

> 每条给推荐选项。未裁决前,实现 agent 按"推荐"走并在 commit message 里显式标注。

### Q1 · authority A/B/C/D 与既有 `EvidenceGrade A/B/C` 的字面量冲突 【高】

SignalFrame 已有 `EvidenceGrade='A'|'B'|'C'`,由 `0012` 触发器按 provider/origin 钉死。新引入一套 A/B/C/D 若语义不同,同一界面两个 "B" 含义不一致。

- **(推荐) 选项 1**:保留 A/B/C/D 字面量,但**把 A/B/C 定义为与 `EvidenceGrade` 恒等**(§4.2 表),D 只作为 QA 侧"无法解析"的输出层级,pack 永不产生 D。优点:满足计划文本、零语义冲突、authority 完全由既有 provenance 派生。缺点:D 与 A/B/C 不在同一个"数据来源质量"轴上(前者是判定结果,后者是来源属性),需在 Task 7 的 UI 文案里说清。
- 选项 2:改名 `authorityTier: 'first_party'|'direct_public'|'operator_provided'|'unverified'`。零歧义、自解释,但偏离执行计划文本,且 Task 4 若已按 A/B/C/D 落 pack 就要返工。
- 选项 3:pack 也允许 D(表示"我们知道有这么个来源但没 provenance")。**不推荐**:pack 只从 DB 行组装,一条无 provenance 的 source 无处可来,允许 D 等于给幻觉开口子(违反 INV-2)。

### Q2 · 是否引入 QA-LLM 判官(`content_shadow_qa`) 【高】

D4 留了口子。

- **(推荐) 不引入**。Slice 2 的 QA 保持 100% 确定性纯函数,`analysis_invocation_id` 恒 null。理由:(a) 红线 C 要求 run 可确定性重渲染,LLM 判官直接破坏 P2 确定性证明,进而破坏 `FlowShadowQaGatesRepository.insert` 的重放语义(它只比 verdict);(b) 省一次契约税(枚举+可能的 DB CHECK);(c) 确定性 gate 的结论可以逐行给出行号+原因,对 Task 7 的"无抽象 gate 措辞"渲染要求更友好。
- 选项 2:引入 LLM 判官做**只读 advisory**(不影响 verdict,只在 UI 加一段建议)。范围可控但仍需加枚举值。留给 Slice 3。

### Q3 · `english_blog_draft` 是否需要必需 section 契约 【中】

SC5(FAQ)/ SC8(CTA)/ SC9(Sources)/ SC10(表格)都预设模板强制 section,而 `packages/artifacts/src/validators/index.ts:79` 明确把 `english_blog_draft` 定为 free-form markdown(注释:*"QA gating is a shadow concern"*)。

- **(推荐) 不改 validator**,只在 **QA 层**软性期望 Sources 段(SC9 `review` 级)+ 转化链接(SC8 `review` 级),FAQ/表格降 `advisory`。理由:改 validator 是契约变更,且会让**已铸出的** draft revision 变成 invalid(`artifact_revisions.validation_errors` 语义),风险大于收益。
- 选项 2:给 draft 加必需 section 契约(Sources + FAQ + CTA),SC5/SC8/SC9/SC10 全部升 `review`。内容质量更硬,但要动 `validators/sections.ts` + prompt 模板,且与 "free-form" 的既有注释冲突。

### Q4 · 阈值快照 / 规则清单是否需要落库 【中】

`flow_shadow_qa_gates` 的自由面只有 `claims jsonb`(CHECK 要求是 **array**),没有 metadata 列。

- **(推荐) 不落库**。QA 版本与阈值由 `flow_shadow_runs.flow_adapter_version`(已冻结、已进 `content_hash`)唯一决定 —— 给定 adapter version + draft revision,阈值与规则集可完全重建。`claims` 保持纯 `QaClaim[]`。
- 选项 2:在 `claims` 数组首元素塞一个 `{kind:'meta', thresholds, rules}` 伪 claim。能落库但污染数组语义,Task 7/8 每处都要过滤,**不推荐**。
- 选项 3:等 Slice 3 需要时加 `metadata jsonb` 列。本轮不做。

### Q5 · 非 EN locale 的降级策略 【中】

`outputLocale` 是冻结输入且可为 `zh-CN`;移植的规则大多是 EN-only 启发式(SC11 明确 EN-only,RL8/RL10/RL13 词表是英文)。兄弟仓库靠 `Intl.Segmenter` + 占星域中文词表处理 ZH,而 Segmenter 跨 ICU 版本不可复现(§5.4 红线 5)。

- **(推荐) 选项 1**:Slice 2 产物类型就叫 `english_blog_draft` —— 若 `outputLocale` 不匹配 `^en(-|$)`,只跑**语言无关**规则(RL12 URL 类、SC9/SC9b 结构+解析类、citability),其余标 `evaluable:false` → verdict 至少 `needs_review`。诚实、可复现、零新依赖。
- 选项 2:在 `createContentShadowRun` 直接拒绝非 EN locale(422)。更简单但可能与既有 `Bcp47Locale` 契约冲突,需查 Task 4 的 zod 实际怎么写的。
- 选项 3:移植 ZH 分词。**不推荐**:破坏可复现性,且词表是占星域的。

### Q6 · SC2 / SC4 内链规则在 Slice 2 是否有意义 【低】

两者都依赖 SignalFrame 不存在的约定(`[[<TBD-internal-link:>]]` 占位符、tier T1/T2/T3、`Related Reading` 固定标题)。

- **(推荐)** Slice 2 落 `advisory`,下限用 pack 的 `internalLinkCandidates.length` 派生,真正 gating 推迟到 Slice 3(publish/链接解析落地后)。stop gate 如实标注"内链阶梯未 gating"。
- 选项 2:整条不移植,省 ~150 行。代价是 Slice 3 要从零写。

### Q7 · RL13 词表重导范围 【低】

原 HARD 表含 `architecture` / `mechanism` / `engine` / `module` / `robust` —— 全是 B2B SaaS 正常词汇,照搬会把正常技术写作判 FAIL。

- **(推荐)** HARD 收缩到 4 个纯 AI-slop 词(`delve` / `unlock` / `navigate the landscape` / `recursive`),其余全进 SOFT,**整条规则降为 `advisory`**。文风偏好不该影响 verdict。
- 选项 2:整条不移植。省事但丢掉一个便宜的反 AI-slop 信号。

### Q8 · `FlowShadowQaGatesRepository.insert` 重放只比对 `verdict` 不比对 `claims` 【中】

`packages/db/src/repositories/flow-shadow-runs.ts:310`。若 QA 有任何非确定性,重放会静默保留旧 claims 而不报错。

- **(推荐)** 本轮**不改仓库代码**(那是 Task 2 的文件,已 review 通过),改为用 §6 P2 的确定性单测把前提钉死,并在 Task 6 的 commit message + stop gate 里显式记录这个耦合。
- 选项 2:顺手把重放校验加上 `claims` 深比较。更稳,但改的是已 review 过的 Task 2 文件,且深比较 jsonb 需要规范化(键序),容易引入新 bug。若主 agent 要改,建议单独一个 commit。

### Q9 · SC-DUP(draft 复读 brief 检测)做不做 【低】

RL3 因无 SERP 语料被排除,但我们有冻结的 brief 正文,可以用同一个 DP 算法测"draft 只是把 brief 抄了一遍"。

- **(推荐)** 做,`advisory`,阈值 40 token。成本约 40 行(算法本就要为 RL4 保留)。
- 选项 2:不做,把 `ngram.ts` 只留给 RL4。

### Q10 · 已知的能力缺口(不是问题,是需要如实记录的事) 【记录】

Slice 2 的 QA **没有**:(a) 抄袭检测(无 SERP 语料,RL3 排除);(b) 事实核查外部世界(pack 只读本库 DB,无外部检索);(c) 语气/品牌一致性(无 author persona)。这三项都不该在 Task 6 偷偷补 —— 每一项都会引入外部读取面或新数据模型。**建议在 Slice 2 stop gate 的"已知简化"里各记一条。**

---

## 实现前必核

1. **先看 Task 4 实际落成的 `packages/flow-shadow/` 骨架**(本蓝图写作时该目录尚不存在,HEAD=`4025577`)。以 Task 4 落地的 `src/types.ts` / `src/research/` / `src/version.ts` 真实形状为准,**适配而非另起**;差异写进 commit message。
2. **不加迁移**。`flow_shadow_qa_gates` 的列、CHECK、UNIQUE、append-only 触发器均已在 `0020` 落定,verdict 值域就是 `('passed','needs_review','blocked')`。任何"想加一列"的冲动都应先回到 Q4。
3. **绝不 runtime import 兄弟仓库**;`packages/flow-shadow/package.json` 保持零第三方 runtime dep(§0 已证明无阻碍)。
4. **红线复核**:无真实 CMS/publish 写;`blocked` 不把 run 标 failed;draft artifact 任何时候不得进 ready/published;search 与 generative 集合在 QA 输入里保持分离(`clusterKeywords` vs `generativeQueries` 两个字段,绝不合并计数)。
5. **跑完整 CI gate 集**,不只窄集:`verify:spec` / `implementation:check` / `openapi:lint` / `contracts:check` / `lint` / `typecheck` / `pnpm test` / `pnpm test:integration` / `db:migrate:check` / `db:smoke` / `pnpm build`。若 §7 判定需要动 openapi,记得两份 openapi **字节一致**并刷新 lock 的 file sha256。
6. **e2e:mock 既有环境性红**(执行计划 §6)非本轮引入,不要试图在 Task 6 里修;如实标注。
