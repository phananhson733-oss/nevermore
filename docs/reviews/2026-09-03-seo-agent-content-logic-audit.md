# SEO Agent「内容方面」逻辑审计（判定层 + 建议层）

- 审计对象：`origin/main@c7dc27cc`（只读；行号以该提交为准）
- 审计日期：2026-09-03
- 范围：目录 D 组、2/3/4 组；evaluate 执行规则；记录构造器；方案模板 / AI 草稿；On-Page Checker 同事实阈值；zh/en 文案抽查
- 方法：只读代码；下文每条都带 `文件:行号`。推测处标「推测」。

以下路径均相对于仓库根目录。

---

## 结论摘要

1. **「已确认目标词」和「页面类型」在普通 Agent 运行里根本没送进评估器。** 只有从 On-Page Checker 带 handoff 进来时才发 `targetQueries`/`pageRole`（`apps/marketing/src/components/agents/agent-workbench.tsx:285-298`），因此 2.3/3.2/3.4/3.5/3.6/4.2/4.3/7.2 在直接打开 Agent 时一律 excluded，但诊断页仍按 Profile 的页面类型渲染 H2/H3 预设区间和「已确认目标词」标签。判定层最大的口径缺口。
2. **「仅列出待复核，不作判定」的 4.2/4.3/4.4 实际被渲染成「提示 / Tip」，实测值写成「1 个测试单元中有 1 个受影响观测」，并作为 P2 建议进入 Stage 03 排序、套上「内容简报」模板。** 结果状态枚举里没有「观测」这一档，evaluate 对无规则记录只要 `affected>0` 就判 full（`packages/public-tools/src/agent-audit/evaluate.ts:209-212`）。
3. **3.6 文案说「中日韩页面不在此判定」，代码会判。** `collectWordsUnderEachH3` 按空白切词（`packages/sources/src/crawl/parse-page.ts:959-975`），`sectionSubstanceRecord` 无 CJK 门（`records.ts:432-449`），中文页每个 H3 下约 1「词」→ 必判 thin。同产品对 `staticBodyWords` 做了 CJK 置空（`extract.ts:213-229`），这里没做。
4. **AI 草稿不携带、也不校验触发它的那条阈值。** search-presentation prompt 不给显示宽度区间、不要求包含目标词（`packages/public-tools/src/seo-audit/solution-draft.ts:96-105`），reader 只校验 JSON 形状/≤320 字/占位符（:124-165），UI 不显示宽度。为修 2.1/2.3 生成的草稿本身可能仍然超宽/不含词，且被标为「草稿 · 仅供审阅」而无读数。
5. **同一事实两套标准。** On-Page Checker 对文本/代码比 <10% 判 warn 并扣分（`checks-meta.ts:37,304-317`），目录 4.4 说「绝不当成缺陷」；Checker 正文长度用绝对档 300/600/1200 + 封顶 100/300/600，目录 4.1 用「前十中位数 60%」且永不运行；Checker 给 description/URL/开头/小标题关键词命中计分并按 topic focus 封顶 25/45/65，目录 4.3 说位置「不作判定」。

---

## 逐题回答

### 1. 各检查项：能否判定 / 阈值 / 依据 / 文案与执行是否一致

判定机制（`evaluate.ts`）：`issueRules` 为空的检查，只要匹配记录 `state==="observed" && affected>0` 即 `"full"`（:209-212）→ `failureState` 取 `check.failureResult`（:285-292）；`failureResult` 由 `DECLARES_NO_JUDGEMENT` 正则或硬编码 tip 列表决定（`catalog.ts:1077-1081`）；`scored` 由同一正则取反（:1028-1031）；`thresholdAuthority` 由 `authority()` 决定，**默认兜底是 `"industry"`（行业惯例）**（:571-583）。

| 项 | EVIDENCE 映射（catalog.ts） | 阈值（文案） | 执行 | 依据标签 | 一致性 |
|---|---|---|---|---|---|
| D1 重复 Title | `title_duplicate` :301 | <2% 否则 Warning；排除 canonical 收敛 :56 | affected-ratio passBelow 0.02 :362-371；记录 tested=自指 canonical 且有 title 的页 `model.ts:819-830` | industry（兜底） | 一致 |
| D2 重复描述 | `meta_description_duplicate` :263 | <5% 否则 Tip :57 | passBelow 0.05 :355-361；D2 在 tip 列表 :1079 | industry（兜底） | 一致 |
| D3 缺 Title/H1 | `title_missing`,`h1_missing` :264 | 0 页；>0 Warning :58 | 默认任一 affected→warning；sibling 按 URL 去重 `evaluate.ts:169-181` | industry（兜底） | 一致 |
| D4/D5 | 图片 alt / Schema 覆盖 | — | — | — | 非内容项，略 |
| 2.1 Title 长度 | `title_length_outside_range` :281 | 「已审阅工作区间 显示宽度 15–60」**未写严重度** :79 | 任一 affected → **Tip**（在 tip 列表 :1079）；记录 `model.ts:1001-1019` 用 `displayWidth` | judgment :576 | 文案没说结果是 Tip；Checker 同事实判 warn（见问 2） |
| 2.2 Title 唯一 | `title_duplicate` :269 | 否则 Warning :80 | 默认→warning | industry | 一致 |
| 2.3 Title 含词 | `title_without_target_query` :322 | 否则 Warning；2× 权重；无同义/词形 :81 | 默认→warning；`scoreWeight` 2 :1069；记录 `keyword-evidence/records.ts:29-105`，token 序列匹配 `match.ts:31-59` | industry | 一致；**但见问 1 缺口：普通运行拿不到词** |
| 2.4 描述长度 | `meta_description_length_outside_range` :282 | 显示宽度 50–160，未写严重度 :82 | Tip :1079 | judgment | 同 2.1 |
| 2.5 描述唯一 | `meta_description_duplicate` :270 | 否则 Warning :83 | 默认→warning | industry | 一致 |
| 2.6 OG 三项 | `open_graph_incomplete` :297 | 否则 Tip :84 | Tip :1079 | industry | 一致 |
| 3.1 H1 数量 | `h1_missing`,`multiple_h1` :271 | 恰好 1；否则 Warning :85 | 默认→warning；记录 `model.ts:855-869` | industry | 一致 |
| 3.2 H1 含词 | `h1_without_target_query` :323 | 否则 Tip :86 | Tip :1079 | industry | 一致（同 2.3 缺口） |
| 3.3 层级连续 | `heading_level_skipped` :298 | 无跳级否则 Tip :87 | Tip；`firstSkippedLevel` 只判向下跳级 `model.ts:264-282` | industry | 一致 |
| 3.4/3.5 H2/H3 数 | `h2/h3_count_outside_reviewed_range` :306-307 | 页面类型审阅区间；超出 Tip :88-89 | Tip；记录 `records.ts:132-181` 用 `AGENT_AUDIT_HEADING_PRESETS` :1163-1166 | sop :572 | 一致；视图层把阈值文案改写成预设区间 `agent-audit-model.ts:175-188` |
| 3.6 H3 下均字数 | `thin_section_under_h3` :312 | 低于区间 Tip；「中日韩页面不在此判定」:90 | Tip；记录 `records.ts:422-472` **无 CJK 门** | judgment | **文案与代码不一致**（缺陷 F3） |
| 4.1 正文字数 | **无映射**（:253-337 无 "4.1"） | ≥前十中位数 60%；否则 Warning :91 | 永不执行；`UNMEASURABLE_HERE["4.1"]` :233-236 | sop :572 | 阈值文案仍写 Warning，见问 3、F5 |
| 4.2 密度 | `target_query_density` :308 | 「不作判定」:92 | **渲染为 Tip**（记录恒 affected:1 `records.ts:217-223`） | judgment | **不一致**（F2） |
| 4.3 首现位置 | `target_query_first_appearance` :314 | 「仅内部启发式」:93 | **渲染为 Tip**（恒 affected:1 `records.ts:394-399`） | judgment | **不一致**（F2） |
| 4.4 文本/代码比 | `content_to_code_ratio` :304 | 「不作判定…不要当成缺陷」:94 | **渲染为 Tip**（每页一条观测 `model.ts:1366-1385`）；无侧车时→**Pass**（F4） | judgment | **不一致**（F2/F4） |
| 4.5 站内相似度 | `page_near_duplicate_of_another_page` :257 | <70% 否则 Warning；P6 门 :95 | 默认→warning；`NEAR_DUPLICATE_THRESHOLD=0.7`，仅 ≥0.7 出观测 `model.ts:413,1499-1523`；门=去 chrome 0.8/≥4 页/≥20 shingle/分页排除 `page-similarity.ts:35-50,175` | judgment | 一致；「P6」是内部代号直接露给用户 |

关于「有没有公开依据」：只有 8.1–8.3 标 official；3.4/3.5/4.1 标 sop；2.1/2.4/3.6/4.2–4.5 标 judgment；**其余（D1 2%、D2 5%、D3、2.2、2.3、2.5、2.6、3.1–3.3）全部落到 `authority()` 的兜底 `"industry"`**（`catalog.ts:583`），界面显示「行业惯例 / Industry practice」（i18n `diagnosis.authorities`），代码里没有任何来源引用。2% / 5% 这类数字实为内部选择却被贴上「行业惯例」。

### 2. catalog 与 On-Page Checker 同事实阈值不一致清单

Checker 文件：`apps/marketing/src/lib/on-page-checker/checks-meta.ts`、`checks-keyword.ts`、`scoring.ts`、`checks-site.ts`。

| 事实 | catalog（Agent） | On-Page Checker | 结论 |
|---|---|---|---|
| Title 长度 | 显示宽度 15–60 → Tip（`catalog.ts:79,1079`） | 同常量 `SNIPPET_TITLE_WIDTH`（`text-width.ts:47`）→ **warn**，3/6 分（`checks-meta.ts:92-104`） | 数值一致（已统一到 `text-width.ts`），**严重度不一致**（Tip vs warn） |
| 描述长度 | 50–160 → Tip | 同常量 → warn 3/5（:113-130） | 同上 |
| H1 数量 | 恰好 1 否则 Warning（3.1） | 缺失 **fail** 0/5；多个 warn 2/5（:239-250） | 方向一致，等级词不同 |
| H1 长度 | **无此检查** | 显示宽度 10–70，出界 warn 3/5（`H1_WIDTH` :35, :252-276） | Checker 多出一条目录没有的判定 |
| 正文长度 | 4.1「前十中位数 60%」，**未接线** | 绝对档 `BODY_UNITS` 300/600/1200（:31, :219-232），且 `UNIT_CAPS` 100/300/600 封顶 35/55/75（`scoring.ts:120-125`） | **两套标准**：一个相对且不存在实现，一个绝对且无目录条目 |
| 文本/代码比 | 4.4「不作判定，不要当成缺陷」（:94；HOW_TO_FIX :917-920） | `TEXT_RATIO_FLOOR=0.1`，<10% **warn** 1/3 分（:37, :304-317） | **直接矛盾** |
| 关键词密度 | 4.2 不作判定 | `observation`，不计分（`checks-keyword.ts:132-147`，注释 :17-31） | 一致 |
| 关键词落位 | 仅判 Title（2.3 Warning）与 H1（3.2 Tip）；4.3「位置不是排名信号，不作判定」 | 六槽位计分 title 8/description 4/h1 8/subHeadings 3/openingText 3/url 2（`checks-keyword.ts:34-41`）；`topicFocus` 封顶 25/45/65（`scoring.ts:106-111`） | Checker 对描述/URL/开头/小标题命中计分并封顶总分，目录侧刻意不判 |
| 小标题 | 3.4/3.5 按页面类型区间 → Tip | `subHeadings.none` 一律 warn 0/3（:286-289），不分页面类型 | 口径不同 |
| Title 重复 | 2.2 Warning；D1 站级 <2% | `title_duplicate` flagged → **fail** 0/3（`checks-site.ts:22`） | 方向一致，等级词不同 |
| 描述重复 | 2.5 Warning；D2 站级 <5% Tip | warn 0/3（:23） | 一致 |

### 3. 4.1 的前十中位数从哪来？没有时怎么处理？

- **数据从不存在。** `UNMEASURABLE_HERE["4.1"]`：「前十名结果的正文从不抓取，因此没有中位数」（`catalog.ts:229-236`）。SERP 取样只在 On-Page Checker 路线上跑，且只取页面一的域名/条目类型给 9.x 用（`audit-handler.ts:157-170` 注释；`buildSerpShapeRecords` :884-893），不抓正文。
- **没有 SERP 时 4.1 = excluded，没有用别的分母。** `EVIDENCE` 无 "4.1" → `inventoryReady=false`（:1017）→ `engine()` 返回 `"needs-integration"`（:618-634）→ `evaluateCheck` 走 `records.length===0` 分支 → `result:"excluded"`，`engine` 保持 `"needs-integration"`，`truth` 为 `"unavailable"`（或 availability 为 partial 时 `"partial"`）（`evaluate.ts:314-341`）。Checker 的 `BODY_UNITS` 没有接到 4.1。
- 附带问题：4.1 的 `threshold` 仍写「否则为警告」、`authority` 标 `sop`（:572）、`howToFix` 落到组级通用句（:1000-1007，HOW_TO_FIX 无 4.1），而 `dataSource` 说「超出有边界匿名抓取可观测的范围」——四个字段在一张卡上互相打架。诊断页引擎芯片还会显示「本版本无法识别」（见 F5）。

### 4. 4.2/4.3/4.4「不作判定」在 UI 上如何渲染？

- 记录侧：`densityRecord` 和 `firstAppearanceRecord` 只要能算就 `state:"observed", affected:1`（`records.ts:217-223, 394-399`）；`content_to_code_ratio` 对每个有侧车的 HTML 页出一条观测（`model.ts:1366-1385`）。
- 评估侧：这三项 `issueRules` 为空 → `issueSeverity` 走 `rule === undefined → "full"`（`evaluate.ts:209-212`）→ `failureState` → `failureResult`，三项因命中 `DECLARES_NO_JUDGEMENT` 得 `"tip"`（`catalog.ts:1077-1081`）；`scored=false`（:1028-1031）。`measurement()` 无 aggregate 规则时输出「`1 affected observations across 1 tested units` / `1 个测试单元中有 1 个受影响观测`」（`evaluate.ts:169-185`）。
- 诊断页：结果徽章 `results.tip` = 「提示 / Tip」，样式 `border-brand-info`（`agent-diagnosis.tsx:42-56`），与 3.2 等真正的 Tip 完全同款；分数贡献显示「不参与计分」。
- 建议页：`ACTIONABLE_RESULTS` 含 `"tip"`（`agent-result-helpers.ts:79-83`）→ 三项以 **P2 建议**进入排序（:91-95, :186-222）；`seoShape()` 把 `4.*` 全映射到 `contentBrief`（`agent-solution-templates.ts:510`），推荐文案是「把它当成内容简报…写出回答这些判断的章节」（i18n `seo.kinds.contentBrief.recommendation`），预览里「measured this run: 1 affected observations…」。
- 测试只钉了「不是 Warning」和「不计分」（`catalog.test.ts:147-166`），没有钉「不是 Tip / 不进建议」。
- **不会显示成 Pass**（有观测时）；**但 4.4 在目标页没有侧车时会显示成 Pass**：观测为空 → `population:"every_collected_page"` → `projectRecordToTarget` 判 `not_observed` → pass（`evaluate.ts:80-89`；`onPage` 在原始类型里是可选的 `packages/sources/src/crawl/types.ts:155`）。3.3 同理（`tested: htmlPages.length` 为数字，population 默认 every_collected_page，`model.ts:1284-1296`）。出现频率取决于缓存的旧 payload 是否带侧车——**推测**：实际生产中多数新 payload 带侧车。

### 5. howToFix 文案

- 内容相关项全部有专属文案：D1/D2/D3、2.1–2.6、3.1–3.6、4.2–4.5（`catalog.ts:677-973` 的 HOW_TO_FIX 键）。**只有 4.1 落到组级通用句**「打开实测证据，确认页面角色与意图，完成最小审阅修正后复跑该检查」（:1000-1007）。
- 抽 5 条：
  - 2.1（:761-764）：「主题放最前、品牌放最后；区间是工作区间；改完与兄弟页对比」——给了改法，且主动说明区间不是硬规则。✓
  - 3.1（:777-780）：「没有→把可见标题提升为 H1；多个→保留点题的、其余降 H2；多出来的通常来自站名/侧栏/卡片组件」——定位到成因位置。✓
  - 4.5（:697-700）：「合并到更强 URL + 301，或让两页各答一问；只加 canonical 不合并等于留着弱页耗抓取」——二选一且否定了常见错误修法。✓
  - 4.2（:877-880）：明说「只公布不判定；要动手就看 2.3/3.2；为凑密度写作是本检查拒绝鼓励的做法」——诚实、把用户引到有证据的项。✓
  - 3.6（:893-896）：「答掉标题提出的问题或并入相邻小节；为凑数加字是失败模式」——改法清楚；**但末句「不使用词间空格的文字…在这里根本不参与判定」与代码相反**（F3）。
- 结论：不是共用样板；质量普遍是「怎么改」而非复述问题。唯一的问题是个别句子替代码做了不成立的承诺。

### 6. 方案模板 SEO_SHAPES（content 类）

- `${facts.fillIn}` 确实**原样渲染**给用户：`fillIn` 来自 i18n `previewFillIn` = 「[待填写] / [to fill in]」（`agent-recommendations.tsx:260`），`template.preview` 直接放进 `<pre>`（:355-361）。这是刻意设计（注释 :362-367「为每句仍要业主写的话留一个槽」），且与「[本次运行未采集]」是两个不同标记（`agent-solution-templates.ts:90-105`）。
- 预览里**没有把测量值当成建议值**：searchPresentation 把测得值标为「observed title / observed meta description」，新值槽一律 fillIn（:255-266）；headingStructure 只引用 `h1_count` 作观测（:283-296）；contentBrief 只引用 `measurement`（:268-282）。
- **但「observed …」槽会撒谎：** `observedValue()` 只从匹配记录的 `values` 标签取值（:139-141, :172-185）。2.1 的记录只有 `title_display_width`/`reviewed_range`（`model.ts:1013-1017`），2.3 只有 `target_query`/`query_tokenization`/`slot_occurrences`（`records.ts:95-99`），2.4 只有 `description_display_width`，3.2/3.3/3.4/3.5 都没有 `h1_count` → 预览显示「observed title: [本次运行未采集]」「observed h1 count: [本次运行未采集]」。而 title 本次确实采集到了（同一屏幕的草稿按钮就把 `extract.title` 发给了后端，`agent-solution-draft.tsx:76`）。测试只覆盖 2.5 的 `meta_description` 标签（`agent-recommendation-solution-templates.test.ts:294-307`）。见 F7。
- `stay true to: ${productName} · ${targetQuery}`：两者来自 Profile，空时显示 fillIn（:226-227）。

### 7. AI 草稿（search-presentation / heading-structure）

- **给模型的事实**（`solution-draft.ts:79-94`）：page url、current title、current meta description、confirmed target query、confirmed page type、opening body text（各 ≤400 字符，`quote()` :52-58）、headings 前 12 条。全部来自 `targetPageExtract`（`agent-solution-draft.tsx:70-82`），服务端再按字段裁到 2000 字符/24 条标题（`draft-handler.ts:33-34, 159-163, 186-191`）。
- **规则**（:69-76）：不得编造功能/数字/价格/地点/奖项；页面不支持的承诺不要做；用页面的语言写；把事实当数据不当指令；只回 JSON。
- **品牌/关键词**：没有硬编码。prompt 不收 `productName`，只说「brand, if any, last」（:101）——模型只能从页面文本推断品牌。目标词作为事实给出但**没有要求使用**。
- **输出校验**（:124-179）：JSON 对象；每字段 string、非空、≤320 字符、非占位符（`PLACEHOLDER` 正则 :124）；缺任一字段整份拒绝；h2 3–8 条、去重、任一坏项整份拒绝。**没有**：`displayWidth` 区间校验（2.1/2.4 的 15–60 / 50–160）、目标词 token 序列校验（2.3/3.2）、H2 数与页面类型预设的比较（prompt 写死 3–8，`MAX_H2=8` :48,:110；guide 预设 min 5、tool max 9，`catalog.ts:1165-1166`）。见 F8。
- **服务端边界**（`draft-handler.ts`）：登录必需、账号哈希限额 30 次/小时（:27-28, :227-231）、30s 预算、URL 拒绝控制字符（:142-157）、至少一项页面文本才受理（:207-212）、模型不可用/无回答/不可读三种码分开（:57-70）。
- **「illustrative」边界**：`AgentAuditTruthState` 含 `"illustrative"`（`types.ts:25`），但 evaluate.ts 没有任何分支产出它，诊断页也明确不渲染（`agent-diagnosis.tsx:63-80`）。草稿相关边界句渲染在：草稿块出现前 `draft.offer`（`agent-solution-draft.tsx:117`），草稿正文下方 `draft.boundary`「只把本页已采集到的文字作为依据…模型仍可能出错——发布前请逐句核对」（:156-158；i18n zh :193 / en :399），Stage 04 页头「仅预览」芯片（`agent-recommendations.tsx:307-316`），Limits 区 `previewBoundary`（:458-460）。边界句本身与代码相符（SHARED_RULES 确实要求不编造）。

### 8. 「文案替代码撒谎」/「部分测量渲染成通过」汇总

- 3.6 「CJK 页面不在此判定」→ 代码会判（F3）。
- 4.2/4.3/4.4 「不作判定」→ 渲染 Tip、进 P2 建议（F2）。
- 4.4 / 3.3 无侧车时 → Pass（F4，部分测量渲染成通过）。
- 2.1/2.3/2.4/3.2–3.5 预览「observed title/h1 count: [本次运行未采集]」→ 实际已采集（F7）。
- `agent-diagnosis.tsx:63-68` 注释「evaluator 从不返回 needs_integration」→ 4.1/B4/B5/C5 就返回它，芯片显示「本版本无法识别」（F5）。
- 4.1 卡片：阈值写 Warning、依据写 SOP、数据源写「超出可观测范围」、修法是通用句（问 3）。
- `seo.kinds.searchPresentation.limits`「这里的字数 / The character counts here」→ 实测单位是显示宽度（catalog 与 Checker 文案都强调「中日韩按 2 计」），建议层文案回退到「字数」。P2 文案。
- 「已确认目标词」标签（Stage 04 `queryLabel`，`agent-recommendations.tsx:276`）与 2.3/3.2 阈值「已确认目标词」→ 普通运行时该词从未参与判定（F1）。
- D1/D2 等数值标「行业惯例」→ 只是 `authority()` 的兜底值，无出处（F9）。

---

## 缺陷清单

| 编号 | 严重度 | 所在层 | 现象 | 证据 | 建议修法 |
|---|---|---|---|---|---|
| F1 | P1 | 判定 | 普通 Agent 运行不发送 `targetQueries`/`pageRole`，2.3/3.2/3.4/3.5/3.6/4.2/4.3/7.2 全部 excluded；诊断页仍按 Profile 页面类型渲染预设区间与 3.4/3.5/3.6 阈值文案，Stage 04 仍显示「已确认目标词」 | `agent-workbench.tsx:195-200, 285-298`；`audit-handler.ts:788-795, 866-880`；`records.ts:48-52, 144-155`；`agent-audit-model.ts:175-188, 268-270`；`agent-diagnosis.tsx` headingPreset aside；`agent-recommendations.tsx:276` | 把 Profile 的 `targetQuery`（非空时）与 `pageType` 一并发送；或在诊断卡上明说「本次未提交目标词/页面类型，这 8 项未判定」，并把预设 aside 与阈值改写只在 pageRole 实际送达时显示 |
| F2 | P1 | 判定+建议 | 4.2/4.3/4.4「不作判定」却渲染为 Tip；实测值写成「1 个受影响观测」；作为 P2 建议进入排序并套「内容简报」模板 | `records.ts:217-223, 394-399`；`model.ts:1366-1385`；`evaluate.ts:209-212, 169-185`；`catalog.ts:1077-1081`；`agent-result-helpers.ts:79-95`；`agent-solution-templates.ts:510`；`catalog.test.ts:147-166` 未钉 | 新增结果状态（如 `"observed"`/「观测」）或让 `DECLARES_NO_JUDGEMENT` 命中项 result 固定为非 actionable；`measurement()` 对 observation-only 记录直接展示数值（密度 %、槽位、比例）；`ACTIONABLE_RESULTS` 排除之；补测试钉「不进建议、不是 Tip」 |
| F3 | P1 | 判定 | 3.6 阈值与 howToFix 都说 CJK 页面不判，代码按空白切词后照判，中文页必被判 thin | `catalog.ts:90, 893-896`；`parse-page.ts:959-975`；`records.ts:432-449`；`extract.ts:250-251`；`audit-handler.ts:253-270`；对照 `extract.ts:43, 213-229` 的 CJK 置空 | 在 `sectionSubstanceRecord` 或 `headingShapeFor` 加 CJK 门（复用 `cjkShare`），CJK 时置 unverified 并给 limitation；或改用 `text_units` 计数并把文案改成「按文本单位」 |
| F4 | P2 | 判定 | 目标页无 on-page 侧车时，4.4/3.3 无观测 → `every_collected_page` → not_observed → Pass（部分测量渲染成通过） | `model.ts:1366-1385, 1284-1296`；`evaluate.ts:80-89`；`packages/sources/src/crawl/types.ts:155`（`onPage?` 可选） | `tested` 只计有侧车的页并标 `conditional_subset`/`targetTested`；无侧车时 limitation 明示。频率**推测**较低（依赖旧缓存 payload） |
| F5 | P2 | 判定 UI | 4.1（及站级 B4/B5/C5）引擎芯片显示「本版本无法识别 / Unrecognised in this build」；文件注释声称该状态不可达；4.1 卡四字段互相矛盾 | `catalog.ts:618-634, 1017`；`evaluate.ts:314-341`；`agent-audit-model.ts:146-148`；`agent-diagnosis.tsx:63-80, 96-103, 200-205`；i18n 已有 `engines.needsIntegration` 却未接 | `ENGINE_KEY` 补 `needs_integration: "needsIntegration"`；4.1 阈值文案改为说明性（不再写「否则为警告」），howToFix 写专属句或留空 |
| F6 | P2 | 判定 | 2.1/2.4 阈值文案未写严重度，实际为 Tip；同事实在 On-Page Checker 判 warn 并扣分 | `catalog.ts:79, 82, 1079`；`checks-meta.ts:92-104, 113-130` | 阈值文案补「出界为提示」；两工具统一等级或在 Checker 文案注明「Agent 侧记为提示」 |
| F7 | P2 | 建议 | 2.1/2.3/2.4/3.2/3.3/3.4/3.5 的方案预览显示「observed title / meta description / h1 count: [本次运行未采集]」，实际已采集 | `agent-solution-templates.ts:139-141, 172-185, 260-261, 291`；`model.ts:1013-1017, 1036-1041`；`records.ts:95-99, 168-173`；测试只覆盖 2.5 `templates.test.ts:294-307` | `AgentSolutionPreviewInput` 传入 `targetPageExtract`（title/description/h1.length），`observedValue` 找不到标签时回退到 extract；补 2.1/2.3 测试 |
| F8 | P1 | 建议 | AI 草稿 prompt 不给 15–60/50–160 宽度区间、不要求含目标词；reader 不校验宽度/含词；UI 不显示宽度。为修 2.1/2.3/2.4/3.2 生成的草稿可能本身不满足该项 | `solution-draft.ts:96-113, 124-179`；`agent-solution-draft.tsx:125-160`；`text-width.ts:47-48` 有现成 `displayWidth` 未用 | prompt 注入 `SNIPPET_*_WIDTH` 与「必须以词序列包含目标词（若已确认）」；reader 用 `displayWidth`/`countOccurrencesInText` 复核并在 DraftBody 旁显示宽度与是否含词（不通过则标出而非拒绝） |
| F9 | P2 | 判定 UI | `authority()` 兜底 `"industry"`，D1 2%、D2 5%、B2 0.5% 等内部数值显示「行业惯例」，无任何出处 | `catalog.ts:571-583`；i18n `diagnosis.authorities` | 兜底改为 `"judgment"`，显式列出真有出处的项为 industry，并在 docs 记来源 |
| F10 | P2 | 判定 | 文本/代码比：目录 4.4「绝不当成缺陷」，Checker <10% warn 扣 2/3 分 | `catalog.ts:94, 917-920`；`checks-meta.ts:37, 304-317` | 二选一：Checker 改为 observation；或目录 4.4 承认阈值并写明 |
| F11 | P2 | 判定 | 正文长度：Checker 绝对档 300/600/1200 + 封顶，目录 4.1 相对中位数且永不运行；两套「够不够长」标准并存 | `checks-meta.ts:31, 219-232`；`scoring.ts:120-125`；`catalog.ts:91, 233-236` | 目录加一条绝对档观测/提示项引用 `BODY_UNITS`（authority=judgment），4.1 保留为「不可测」或删除 |
| F12 | P2 | 判定 | 关键词落位：Checker 给 description/URL/开头/小标题命中计分并按 topicFocus 封顶总分；目录只判 title/H1，且 4.3 声明位置不作判定 | `checks-keyword.ts:34-41`；`scoring.ts:106-111`；`catalog.ts:81, 86, 93` | 在两处文案互相注明差异，或把 Checker 的四个次级槽位降为 observation |
| F13 | P2 | 建议文案 | `seo.kinds.searchPresentation.limits` 写「字数 / character counts」，实测单位是显示宽度 | i18n zh :60 / en :266（本审计 dump 行号）；`catalog.ts:79` | 改为「显示宽度（中日韩按 2 计）」 |

---

## 已核实无问题的项（避免后人重查）

- **D1/D2/D3/2.2/2.5/3.1/4.5 阈值文案 ↔ evaluate 执行一致**：D1 passBelow 0.02、D2 passBelow 0.05（`catalog.ts:355-371`）；D3/2.2/2.5/3.1/4.5 走「任一 affected 即失败」默认；4.5 仅 ≥0.7 出观测（`model.ts:413, 1512`）。
- **Title/描述长度两工具共用一份常量**：`SNIPPET_TITLE_WIDTH`/`SNIPPET_DESCRIPTION_WIDTH`（`text-width.ts:47-48`），catalog 文案用模板字符串插值（`catalog.ts:79, 82`），Checker 直接引用（`checks-meta.ts:20-21`）。数值不会再漂。
- **D1 排除 canonical 收敛变体**：`selfCanonicalHtmlPages` 同时约束 tested 与分组（`model.ts:452-458, 819-830`）。
- **4.2/4.3/4.4 不计分、不为 Warning**：`catalog.test.ts:147-166, 225-250` 钉住。
- **4.5 的 P6 假阳性门已实现**：去 chrome（≥80% 页面共有段落）、<4 页不判、<20 shingle 不判、rel=next/prev 分页不判（`page-similarity.ts:35-50, 175`）；记录命名 `nearest_page`（`model.ts:1515-1518`）。
- **3.3 只判向下跳级、从首个标题起算**（`model.ts:264-282`），避免 nav h2 在前的假阳性。
- **2.3/3.2 匹配口径与文案一致**：token 序列、无同义/词形；CJK 去空格子串匹配（`match.ts:31-59, 97-115`）；无 title/H1 时置 unverified 而非重复计缺陷（`records.ts:72-78`）。
- **conditional_subset 目标页投影用 `targetTested`**，不会把「未测」读成「通过」（`evaluate.ts:73-100`；`model.ts:114-117`）。
- **`staticBodyWords` 对 CJK 页置空**（`extract.ts:43, 213-229`），Checker 改用 `text_units` 计数（`checks-meta.ts:206-233`）。
- **草稿 reader 拒绝半份/占位符回复；h2 去重、数量 3–8**（`solution-draft.ts:124-179`）；草稿组件按 `targetUrl:checkId:kind` 键控重挂载（`agent-recommendations.tsx:368-379`）；无页面文本不受理（`draft-handler.ts:207-212`）；`illustrative` 真实性状态 evaluate 从不产出。
- **fillIn 与 notCaptured 是两个不同标记**，预览从不把测量值放进「new …」槽（`agent-solution-templates.ts:87-105, 252-296`）。
- **content 相关 `tools.seoAudit.evidence.*` 标签在 zh/en 均齐全**（脚本核对 30 个标签无缺失）。
- **howToFix 内容项全部专属**，仅 4.1 走通用句（见问 5）。
- **D2 站级 Tip / 2.5 页级 Warning 用同一记录但严重度不同**：站级是比例、页级是成员关系，属有意区分，不算缺陷。
