# Slice 2 stop gate — 残留与已知简化清单(Task 9 输入)

本文件汇总 Task 2/4/4b/5/6/6b 各轮验证与返工中**确认存在、有意保留**的限制。
Task 9 写 stop gate 时必须**逐条如实转录**,措辞要让 Owner 直接读懂后果。

**禁止使用掩饰性表述**(「未来可扩展」「后续迭代」「暂不支持」)。每条要写清:**现在会发生什么**、**对谁有影响**、**代价边界**。

---

## A. QA 判定的能力边界(Task 6,最重要的一组)

**A1. 可引用外部来源数 = 0,是构造上的 0。**
research pack 只从已确认的 DB 行组装,**不做任何外部检索**。因此:
- 草稿里任何**外部**引用都无处可解析 → 至少 `needs_review`,高置信时 `blocked`;
- `passed` 要求一篇**不含无法核实的外部引用**的草稿。
- **这不是缺陷,是 Slice 2 范围的诚实后果** —— 但它意味着 `blocked` 是常见状态,Owner 看到大量 blocked 属预期。

**A2. 被显式归属的第一方链接也会 blocked。**
pack 冻结的是 `site.origin`(以及可得时的 ICP 转化 URL),**不是页面内容**。所以「According to [我们自己的产品页](our-site), X」会被拦 —— 我们确实无法确认那页说了 X。
逻辑正确,但这是最可能引发误报抱怨的一处。

**A3. 名字谓词不查词典,Title Case 项目符号列表会降级。**
`- Track Activation Milestones Weekly` 与 `- Forrester Digital Experience Report` 在不查词典时无法区分。
**这是一条已测量的回归**:该形态从 `passed` 变为 `needs_review`。
**代价边界**:该 claim 只会是 `unevaluated`、**永远到不了 `blocked`**(blocking 需要年份/引号标题/`et al.` 作第二信号),detail 明写「这个名字可能是产品、功能或章节标题……由审阅者判断」。

**A4. 其余已测量的判据边界**:
- `U.S. Department of Labor` 因内部句点把 token 串打断而**漏检**(方向保守)。
- 2-token 且无年份的真实外部作品(`- Forrester Wave`)**escape 到 `passed`**(未达 3-token 未佐证下限)。
- `According to Search Console, clicks fell 34%` 会 **blocked**,尽管数据是第一方;只有所有格形式(`Our Search Console export…`)豁免。
- 定位标准区段(`## Further reading` 等)里既非地址也非名字短语的句子(`- Read the onboarding guide`)被**静默接受** —— 属设计意图(导航标题下的散文),但意味着写成句子的编造在那里不被看见。
- frontmatter 掩码的内容**不被任何规则扫描**。多词伪 key(`Bottom line:`)不会被掩码,但**单词伪 key(`Summary:` / `Evidence:`)会**。**Slice 3 发布时 `description`/`summary` 是会上线的内容,届时必须重估。**

**A5. 三条能力缺口(Task 6 Q10)**:
1. **无抄袭检测** —— RL3 需要 SERP 语料,SignalFrame 没有。**一篇从竞品页面逐字抄来的草稿会通过本 gate。**
2. **无外部事实核查** —— pack 只读我们自己的数据库。**一条对外部世界为假、但不带研究措辞的断言不会被检出。**
3. **无品牌语气检查** —— 无作者人设,`BANNED_AUTHOR_TOKENS` 为空,**跑偏的语气会通过**。

**A6. 未移植的规则**:RL1 / RL2 / RL3 / RL6 / RL9(各有源码内成本说明);SC8 的 URL 相等半边(转化目标虽已冻结,但断言 CTA-URL 相等会让每一篇链到定价/文档的草稿失败,属产品决策)。

---

## B. 数据与呈现的限制

**B1. research pack 只携带身份,不携带指标**(Task 4 起)。
pack 里是 keyword/competitor/generative 的 **id 与名称**,**没有搜索量、展现、点击**。
Task 7 UI 必须如实渲染 `limitations`,**不得**让界面读起来像「已测量的需求」。

**B2. `citableCount` 名字未改但语义已变** —— 现在只数**外部**可引用来源(Task 6b)。
改名是干净的后续项;当前语义写在字段注释里。

**B3. 版本历史一期只有两点**(当前版本 / 上一版本)。
`listArtifactRevisions` 留 Slice 3。**UI 不得暗示这是完整历史。**

---

## C. 各 Task 自承的测试与可达性缺口

**C1(Task 5)**:`createContentShadowRun` 里 `countActionsForFinding === 0` 分支**按构造不可达**(准入路径已持有非 dismissed Action),仅 mock 覆盖 —— 属防御性断言。
**C2(Task 5)**:`brief_archived` 不可达(`findLiveByActionType` 先过滤 archived,archived brief 表现为 `CONTEXT_INCOMPLETE`)。
**C3(Task 5)**:`brief_not_live` 只有单测无集成测试(构造 failed/generating 的 brief 要与状态转移触发器搏斗)。
**C4(Task 4b)**:`sanitizeOutlineItem` 在**截断边界恰好落在 `key=` 正后方**时非幂等(420 次探测中 3 例):第 6 步切进了第 3 步写下的 `[redacted]` 标记,`password=[redact` 仍是凭据形状,下一遍会再脱敏一次。

**2026-07-26 修正(最终修复轮 M3)**:本条此前写「该声称已被指出过度」——被指出过,但代码里那句绝对措辞一直没改。现在 docstring 写清了幂等成立的条件,单测钉住了反例,并且本条从未写出的后果也被写到了它真正发生的地方(`safePromptContentBriefOutline`):**对这一类值,冻结 manifest 里是提取器那一遍的字节,模型看到的是边界那一遍的字节,两者差一个 `[redacted]` 标记的尾巴。** 这个偏差是被接受的(否则就得在唯一每条路径都会跑到的边界上不做净化),红线 C 不受影响 —— 两遍都是同一批冻结字节的确定性函数。
**C5(Task 6)**:`FlowShadowResearchPacksRepository.insert` 重放仍只比对 `content_hash`(pack 侧未做 Q8 式严格比对)—— **有意为之**:`pack.limitations` 含 `unconfirmedMappingCount`,而 O-3 明确允许它漂移。

---

## D. Pre-existing 债(**非本 Slice 引入,但 stop gate 要标注**)

**D1. CI 的 branch coverage 门是红的**:78.21% < 80% 阈值(`ci.yml:86`)。
**已用 json-summary 逐文件证明与 Slice 2 无关**:扣掉 Slice 2 触碰的全部文件后,剩余部分只有 77.96%,缺口集中在 Slice 1 的 `growth-map.ts`(9.26%)/`context.ts`(6.25%)/`recheck-results.ts`/`diagnostics.ts`/`csv-import.ts`/`collection.ts`。**这条门会挡住合入,需 Owner 决定单独处理。**

**D2. `pnpm audit` 红**:11 个漏洞(5 moderate / 6 high),主要来自 `next`(GHSA-955p-x3mx-jcvp 要求 >=16.2.11),另有 js-yaml、sharp。上游 advisory 漂移,与本 Slice 无关。

**D3. `authority/implementation-spec-v0.3/scripts/verify-spec.test.mjs` 是 935 行未接入任何 gate 的过时并行副本**,在 Slice 2 开始前就 4-red(断言 41 表 / 38 op / 6 async,迁移列表止于 0019)。CI 从不运行它,vitest 只收 `.ts`。**需单独 commit 修或删。**

**D3b. 一批 mock spec 断言英文 chrome 却从不设 `sf_ui_locale`。**
`DEFAULT_LOCALE` 在 `3c2ecc6` 翻成 `zh-CN` 之后,这些 spec 一直红。**已修**:
`studio-first-paint` / `studio-workspace` / `studio-multi-run` / `mobile-shell` 现在全绿,
`cursor-pagination` 从 0/8 变 4/8。变异自验:去掉 cookie,这五个文件 16/16 全红。
**未修、原因已确诊**:`report-workspace` / `report-artifact-convergence` /
`diagnosis-nonblocking-snapshots` 以及 `cursor-pagination` 剩下的 4 条,走的是已退役的
`/diagnosis` `/plan` `/report` 路由与 `Studio`/`Plan` 侧栏链接 —— 四入口 shell 不再渲染它们。
补 cookie 对这些用例不够,属 D-1 残留(内容表面仍在 workspace 之上),需独立任务。
`sources-readiness.mock.spec.ts` 同类,但按 N-1 冻结未动。
`critical-flows` / `diagnosis-evidence` / `frontend-error-states` /
`context-localization-guard` / `dataforseo-source` / `plan-lane-layout` /
`plan-status-transitions` 是**混合**的(同一文件里既断言中文又断言英文),
补 cookie 会打断它们的中文断言 —— 需要逐条翻译,不是一行 cookie。

**D3c. `growth-map.mock.spec.ts:124`("reviews only the canonical Opportunity…")红,
与本轮无关。** 缺的是 `Delivery chain` region。**已用 stash 对照证明**:把本轮 Task 3
改动全部撤掉后仍然红。与 D8(`real-vertical-chains`)同源 —— Growth Map 的
audit-and-confirm 走查需要独立重写任务。同文件的 axe/overflow 用例是绿的。

**D4. 完整 `pnpm test:e2e:mock` 大面积红**:24 passed / 84 failed / 108(约 31.5 分钟)。
根因是 mock config 的 webServer 用 `next dev --webpack` 按需编译,冷启动 + CPU 饱和致首次命中重路由编译超时成片失败;叠加少量真实既有漂移。
**已用 base 提交对照证明与 Slice 1/2 零关系**。**本地无可信的完整 E2E 基线**(需 CI 隔离/warm 跑)。Slice 2 只跑隔离的内容 vertical spec。

**D5. 5 个既有 operation 抛出未在 openapi 声明的 503**:`createActionArtifact` / `listProjectFindings` / `listProjectArtifacts` / `getProjectReport` / `createProjectExport`。**这是本仓既有惯例**(只有 growth-map / keyword / competitor 三个 op 被 verifier 强制声明 503),Task 5 沿用了它。

**D6. 两处活的凭据脱敏绕过(已立项未修)**:
- `finding-summary-client.ts:110` —— 实测把 `Password<U+200B>=hunter2` 原样转发外部 LLM。
- `product-profile-client.ts:390` —— 同上;其 `stripUnsafeTextControls` 跑在 `redactText` 之后且覆盖面窄于 `\p{Cc}\p{Cf}`。另有两个纠缠缺陷:`safeUrlText:411` 经 `redactUrl` 泄露、`hasUnsafeRawContent:712` 拿 `redactText(v) !== v` 当检测器继承同一盲点。
**已修的同类**:`envelope.ts` 的 `safePromptText`(commit `05b1282`)。

**D7. 已在最终修复轮(L11)解决。** `product-profile-competitor-projection.test.ts` 原本在 unit project 里却是 DB-backed,且硬编码了某台机器的库名:导出 `DATABASE_URL` 时 `pnpm test` 变红,不导出时它的五条断言不在任何门里跑。现已改名为 `*.integration.test.ts`,改用共享的 `requireSafeTestDatabaseUrl` 而非机器本地库名,五条测试跑在 `pnpm test:integration` 里;`pnpm test` 导出与不导出 `DATABASE_URL` 均为绿。

---

## E. 未做的产品决策(stop gate 应列为 Owner 待决)

- **E1. 品牌轴对齐**:app 是 SignalFrame(cobalt/Fraunces/Manrope),artifact 是 GenGrowth(深绿/Source Serif 4/IBM Plex Sans)。Task 7/8 全走 `var(--sf-*)` 语义层,**裁决后重绑 `:root` 即整屏跟随**。`growth-map.module.css` 的私有 `--gm-*` token 记入该任务。
- **E2. SC8 的 CTA-URL 相等判定**是否启用(转化目标已冻结,阻碍已消除,但启用会让每篇链到定价/文档的草稿失败)。
- **E3. `citableCount` 改名**。
- **E4. D1/D3 两条红门如何处理**(单独修 / 调阈值 / 接受)。
