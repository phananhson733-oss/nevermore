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

**D1. ~~CI 的 branch coverage 门是红的~~ —— 2026-07-26 已解决(改口径,不是灌水)。**

原状:只跑 `--project unit` 的门实测 **77.97%(11301/14494)**,红。

**裁决与理由**:门被改成同时计入 unit 与 integration。这不是为了让数字变好看 ——
只测 unit 的门在回答另一个问题。仓库层的 unit 测试跑在 `FakeExecutor` 上(`repositories-core.test.ts:28-60`),
它只**记录** `.where()` 收到了什么;给 keyset 分页写 unit 测试,能断言的只有
「我们把某个 drizzle 表达式对象传进去了」——那是实现的形状,不是「翻页不重不漏」。
**一个只有无法断言真实行为的测试才能满足的门,度量的是错的东西。**
先例:`vitest.config.ts` 早已对 `packages/db/src/schema.ts` 做过同类豁免,理由同构。

**实测数字(本机,全库)**:

| 口径 | 分支 | 覆盖 | 百分比 |
|---|---:|---:|---|
| 改前(只 unit) | 14494 | 11301 | **77.97%** ❌ |
| 合并 unit+integration | 15455 | 12740 | **82.43%** ✅ |
| 合并 + 排除测试夹具与 `scripts/**` | 14907 | 12563 | **84.28%** ✅ |
| 上面两项改完、再加本轮补的测试(**最终实测**) | 14911 | 12636 | **84.74%** ✅ |

最终一行是本轮全部改动落地后跑出来的:`pnpm test:coverage` 全绿,376 个测试文件 / 4454 条测试。
分母从 14907 变 14911,是删掉死代码(−)与 S1/S2/S3 新增分支(+)相抵后的净值。

**阈值维持 80%,未下调。** 排除项只有 5 个文件,且逐条写明了理由(`vitest.config.ts` 注释):
`scripts/backup-restore-drill.mjs`(289 分支,**已有自己独立的 80% 分支门** `restore:drill:test`,重复计分)、
`scripts/schema-catalog.mjs`、以及 `__tests__/{full-chain-harness,current-diagnostic-fixture,project-archive-race}.ts`
(测试夹具,不是产品代码)。

**落点**:`ci.yml` 的 `database` job(本就有 postgres、本就在跑 `test:integration`)改跑 `pnpm test:coverage`
(= `vitest run --coverage`,两个 project 一次跑完)并在那里把门;`unit` job 改跑 `pnpm coverage:unit-gaps`。

**配套的诚实性补丁(重要)**:合并会掩盖「某文件一条 unit 测试都没有」这个事实。
新增 `scripts/report-unit-coverage-gaps.mjs`,在 `unit` job 上**无阈值、非阻塞**地打印
unit 分支覆盖 ≤30% 的文件清单(最终实测 17 个,其中 `capability-runs.ts` / `i18n/src/index.ts`
**没有任何 unit 测试触及**,`flow-shadow-runs.ts` 是 0/58,`growth-map.ts` 是 24/259)。
**这 17 个就是下一轮该看的清单**,而不是覆盖率百分比。单测本身失败仍然阻塞;只有覆盖数字不阻塞。
**不要让口径修复变成遮羞布 —— 这份清单就是为此存在的。**

**明确写下的反向约定**:若将来推翻这次合并,正确做法是**下调阈值或收窄 `coverage.include` 并写进 ADR**,
**不是**为过门写 mock 断言。这条同样写在 `vitest.config.ts` 的注释里。

**D2. `pnpm audit` 红**:11 个漏洞(5 moderate / 6 high),主要来自 `next`(GHSA-955p-x3mx-jcvp 要求 >=16.2.11),另有 js-yaml、sharp。上游 advisory 漂移,与本 Slice 无关。

**D3. ~~`authority/implementation-spec-v0.3/scripts/verify-spec.test.mjs` 是 935 行未接入任何 gate 的过时并行副本~~ —— 2026-07-26 已解决(判定为**修**,不是删)。**

**为什么不删。** 29 条里有 14 条确实是并行副本(把 hash 已冻结的 authority 文本再抄一遍),
但另外 15 条不是:它们构造 fixture 迁移集去**变异**输入,证明 `verify-spec.mjs` 真的会拒
(14 条否定用例 + 1 条完整正向用例)。
而 `verify-spec.mjs` 本身**在 CI 里跑** —— `verify:spec` 先按 lock 校验它的 sha256
再执行它(`REQUIRED_AUTHORITY_FILES` 含 `scripts/verify-spec.mjs`)。
全仓没有第二个门证明这个 verifier 不是空转。删掉这 14 条 = 净减守护。

**修了什么。** 4 条红全部是过期快照,不是行为漂移:表 41→44、op 38→49、async 6→9;
schema smoke 标记 51→56 索引、63→69 触发器、16→18 例程、终态迁移版本 0019→0021;
fixture 的 `completeMigrations` 补上 0020/0021 与三张 `flow_shadow_*` 表
(缺它们时 verifier 恒报 "Content Shadow foundation migration is missing",
14 条变异测试的 `status != 0` 那一半因此是**空转的** —— 只有 stderr 正则那一半还在起作用)。
**顺带补强**:新增 0020/0021 两条迁移漂移变异测试,与 0018/0019 同形。29 → 31 条,全绿。

**接进了哪个门。** 新增 `pnpm verify:spec:test`,并在 CI 的 `contracts-and-unit` job 里
紧挨 `pnpm verify:spec` 之后跑。它一并收编另外两个同样孤立的 `node --test` 套件:
`scripts/verify-spec-lock.test.mjs`(见 D3d)与 `scripts/verify-implementation-source.test.mjs`
(当时是绿的,但同样不在任何门里 —— 只修有红的两个、留下第三个孤儿,就是本条要根治的模式本身)。
合计 66 条。为防这一步日后被悄悄拿掉,`deploy:check` 现在断言 CI 里存在该步;
同时把它原有的 `/run:\s*pnpm verify:spec/` **加了行尾锚**
—— 不加锚的话 `verify:spec:test` 自己就能满足它,真正的门被删掉也不会红。
两条断言均已变异自验(逐条删掉对应 CI 步骤 → `deploy:check` 红)。

**D3d. `scripts/verify-spec-lock.test.mjs` 单条红 —— 2026-07-26 已解决。**
`:240` 冻结的是 45 op / 8 async / 44 表,真实 lock 是 49/9/44。同样是过期快照:
改为 49/9/44,并把四个 Content Shadow operation、`createContentShadowRun`(async)、
三张 `flow_shadow_*` 表加进逐项抽查名单。26 条全绿,随 D3 一起接进 `verify:spec:test`。

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

**D3c. ~~`growth-map.mock.spec.ts:124`("reviews only the canonical Opportunity…")红~~
—— 2026-07-26 已解决(移锚点,不是削断言)。**
缺的是 Task 7 按 a11y 规格删掉的 `Delivery chain` region 及其 `<h2>`
(十一个无样式表的类名 + `<h2>` 排在页面自己的 `<h1>` 之前)。
与 `audit-technical-vertical`(`66ce9ce`)同一处理:三条断言里两条原样搬到交付物现在所在的
studio artifact queue,第三条(面板自己的 `<h2>`,无后继)由「queue 本身可见」承接。
**计数反而更强**:旧计数只作用于那一个面板,别处多出的 ticket 看不见;新计数覆盖整个 queue,
类型改从每行自己的 `data-studio-artifact-type` 读。**三向变异自验**(仅针对本条测试):
0 个 artifact → 红(expected 1, received 0);2 个 technical ticket → 红(expected 1, received 2);
1 ticket + 1 content brief → 红(整 queue 计数 expected 1, received 2 —— 旧的面板内计数抓不到这一种)。
**注**:此前判它「与 D8 同源、需双平台基线」是误判 —— 本 spec 内 `toHaveScreenshot` 数量为 0,
是纯行为测试。D8(`real-vertical-chains`,24 张快照)才是那一类。

**D4. ~~完整 `pnpm test:e2e:mock` 大面积红~~ —— 2026-07-26 已解决:79 passed / 0 failed(1.8 分钟)。**
旧记录 24 passed / 84 failed / 108(约 31.5 分钟)。两件事同时变了:
(a) `bb659e9` 删掉了断言产品已不存在的屏的用例、`939129a`/`7bf70d8` 补齐了 `sf_ui_locale`(见 D3b),
用例总数从 108 降到 79 —— **这是减少了声称,不是修好了失败**;
(b) 余下的真实红逐条修完,最后一条是 D3c。**本地已有可信的完整 mock E2E 基线**,
`next dev --webpack` 冷启动超时的成片失败未再复现。仍**不覆盖** `test:e2e:real`
(D8 `real-vertical-chains` 需双平台视觉基线,本机只产 darwin)。

**D5. 5 个既有 operation 抛出未在 openapi 声明的 503**:`createActionArtifact` / `listProjectFindings` / `listProjectArtifacts` / `getProjectReport` / `createProjectExport`。**这是本仓既有惯例**(只有 growth-map / keyword / competitor 三个 op 被 verifier 强制声明 503),Task 5 沿用了它。

**D6. 两处活的凭据脱敏绕过(已立项未修)**:
- `finding-summary-client.ts:110` —— 实测把 `Password<U+200B>=hunter2` 原样转发外部 LLM。
- `product-profile-client.ts:390` —— 同上;其 `stripUnsafeTextControls` 跑在 `redactText` 之后且覆盖面窄于 `\p{Cc}\p{Cf}`。另有两个纠缠缺陷:`safeUrlText:411` 经 `redactUrl` 泄露、`hasUnsafeRawContent:712` 拿 `redactText(v) !== v` 当检测器继承同一盲点。
**已修的同类**:`envelope.ts` 的 `safePromptText`(commit `05b1282`)。

**D7. 已在最终修复轮(L11)解决。** `product-profile-competitor-projection.test.ts` 原本在 unit project 里却是 DB-backed,且硬编码了某台机器的库名:导出 `DATABASE_URL` 时 `pnpm test` 变红,不导出时它的五条断言不在任何门里跑。现已改名为 `*.integration.test.ts`,改用共享的 `requireSafeTestDatabaseUrl` 而非机器本地库名,五条测试跑在 `pnpm test:integration` 里;`pnpm test` 导出与不导出 `DATABASE_URL` 均为绿。

---

## F. 2026-07-26 覆盖率轮:规格对齐、删除与一处自承的假名测试

**F1. 我们自己写了一条「声称多于实际」的测试,已修。**
`content-shadow.integration.test.ts` 里名为 `"pages newest first through the shared cursor convention"` 的用例,
**从不翻页**:它在两个**不同 project** 各建 1 个 run,`limit:1` 读第一页,断言 `nextCursor === null`,
**cursor 一次都没有回传**。`FlowShadowRunsRepository.listByProject` 的 `hasNext` / `encodeCursor` / `decodeCursor` /
`or(lt, and(eq, lt))` 整条 keyset 链**零执行**,而测试名让每一个读到它的人以为分页已验过。
它实际验的是跨 project 隔离。
**已修**:拆成两条各如其名的用例。分页那条现在在**同一个 project** 建 3 个 run、`limit:2`、
把 `nextCursor` 回传取下一页,断言走出来的序列与一次性整页读**逐位相同、无重复、无遗漏**,并断言 `createdAt` 确为降序。
**变异自验(证据)**:把实现改成「忽略 cursor,永远返回第一页」→ 新用例红(`expected 4 to be less than or equal to 3`,
分页因此不收敛),而**HEAD 上的旧用例对同一处破坏是绿的**;再把 `.limit(opts.limit + 1)` 改成 `.limit(opts.limit)`
(`hasNext` 永假)→ 新用例红(`expected 1 to be 2`)。

**F1a.(已覆盖,见 §G 附带项 2)** 原文写的是:`and(eq(created_at), lt(id))` 那一臂只有两行 `created_at` 相同时才触发,
而 `flow_shadow_runs` 的 append-only 触发器(`0020:181-183`)不允许事后压平时间戳,所以「不划算,没做」。
**触发器那半句仍然成立,但结论错了**:不需要事后改,`created_at` 默认 `now()`,而 PostgreSQL 的 `now()` 是**事务时间戳** ——
在**一个事务里**用普通仓储路径写三行,它们的 `created_at` 按构造相同。两个触发器全程armed、零 UPDATE、零手写时间戳。
2026-07-26 已补测试并做双向变异自验。

**F2. 规格 ↔ 实现分歧,按规格改了实现(三条)。**

- **S1(安全项)**:`recheck-results.ts` 里两处**来自 jsonb 的指针**在跨租户查不到时抛 503,现改为 **404 `NOT_FOUND`**。
  `priorRunId` / `actionId` 读自 `async_runs.request_payload`,**无外键、无形状约束**,调用方可以带着别的 workspace 的 id 走到这里;
  503 与 404 的差别会告诉他「这个 id 存在,只是不属于你」。SPEC:878 写明 404 `NOT_FOUND` **含跨 project/workspace**。
  同一对指针在**创建**路径(`action-recheck.ts:98,105`)本来就返 404 —— 本仓惯例早已如此,读路径只是漏了。
  两处共用同一条文案,响应也不会告诉调用方是哪一个指针没命中。
  **全仓 grep 复核**:同类(scope 命中失败 → 非 404)的其余命中都不是租户边界 ——
  `artifacts.ts:341/360`、`action-recheck.ts:136`、`recheck-results.ts:177/193/204/208` 的 id 全部来自**已 scope 校验过的行的外键列**,
  不由调用方控制,查不到确属完整性破损,503 正确,未改;`apps/worker/**` 的同形状代码没有 HTTP 调用方,不泄露,未改。

- **S2**:规则账本缺行不再抛 503,改为报 **`insufficient_data` + 一条明确的 limitation**。
  裁决 1(`slice1-landing-execution-plan.md:43`)与 SPEC:925 的三态里,`no_data` 映射到 `insufficient_data`,不是故障。
  缺行那一侧的状态按该账本自己的词汇报作 `skipped`(= 该次运行对这条规则没有产出结果),
  limitation 逐字说明「其中一次运行没有记录」,**不把「没看」渲染成「看了,没事」**。

- **S3**:`RUN_ALREADY_ACTIVE` 现在把现有 run **写进 body**,不只写 `Location` 头。
  SPEC:1100 §13.4 要求「body 提供现有 runId/statusUrl」,AC-019(SPEC:1258)把它列为具名验收标准;
  此前 `csv-import.ts` 的预检只给 header,竞态败者路径连 header 都是可选的。
  现在两处共用 `activeImportConflict()`,形状与 `collection.ts` 的 `activeConflict` 一致(`headers.Location` + `current:{runId,statusUrl}`)。
  **仍存在、未改的同类缺口**:`collection.ts:583` 在既找不到 idempotency winner 又找不到 active run 时,
  抛的 409 **既无 Location 也无 body 指针**。它比修好前的 csv-import 更弱,但 `collection.ts` 紧邻按 N-1 冻结的 Sources 面,
  本轮未动 —— **需要一个独立任务**。
  csv-import 自己也保留了一个「找不到 winner」的裸 409:该路径要么是 winner 已在两次读之间完成,
  要么违反的是 `source_connections_one_active_provider_idx`(根本没有 run 在后面)。**编一个 runId 比承认没有更糟。**

**F3. S5:蓝图跟随实现(不是反过来)。**
`task5-redline-b-blueprint.md` 的 A2 行与 OQ8 裁定 `>1` 个非 dismissed Action 应返 503,实现返 409 `FINDING_ACTION_ACTIVE`。
**实现是对的,蓝图过期**:`UNIQUE (source_finding_id, template_id)` 只保证「一 Finding + 一 template」唯一;
当规则集版本把同一 `rule_id` 映到**新的** `template_id`,该 Finding 可以合法地再得一个 Action ——
这是**可达的产品状态**,不是数据破损,503 的「稍后重试」是假话(重试永不收敛)。
蓝图两处已就地改判并写明理由。**注意该蓝图文件未纳入版本控制**,故此条同时记在这里。

**F4. 删除的死代码(删前逐条 grep 复核)。**
- `AuditRunsRepository.findByCapabilityRunId` —— 全仓零调用方(命中全部属 `FlowShadowRunsRepository` 的同名方法);
  且 `schema.sql:744` 有 `CHECK (diagnostic_run_id = capability_run_id)` 且两列均 UNIQUE,与 `findByDiagnosticRunId` 语义等价。
- `AuditRunsRepository.findLatest` —— 全仓零调用方(命中全部属 `DiagnosticRunsRepository.findLatest`,含 `repositories-core.test.ts:801`);
  它正是同文件注释所警告的反模式(不带 projection version 的 latest 会被 recheck 劫持)。
- `content-shadow.ts` 里 `ContentShadowObservationSeparationError` 的 catch —— 按构造不可达:
  `keyword_entities.query_kind` 是行级 CHECK(`0018:242-244`),而本函数上方已要求搜索集每行 `search_query`、生成式集每行 `generative_query`,
  两集不可能相交。**同时改掉了那段不实的 docstring**(它声称「下面每一条只读断言都与 provenance 触发器冗余」,实际这两条背后没有触发器)。

**F4a. 主 agent 的 D5 里点名的第三项 `"audit module result canonical scope mismatch"` 没有删,也不该删。**
它不是死代码:`audit-runs.ts` 的 `insertModuleResults` 用它挡跨 scope 写入,而 `app.audit_module_results`
**没有 workspace_id / project_id 列**,只有 `audit_run_id` 外键 —— **这行应用层检查是 DB 层挡不住的唯一关卡**。
「零引用」说的是**没有任何测试引用过这条消息**(这是 §3 #4 列的测试缺口),不是没有调用方。删掉它会开一个跨租户写入口。
**它至今仍无测试,这一条留作待办。**

**F4b.(已修,见 §G F2)本轮新发现的缺陷 —— `flattenLine` 会改写 URL。**
`text.ts` 的 `flattenLine` 在扫描链接**之前**先对整行跑 `stripEmphasis`(`names.ts:63-67`),
而那条正则会删掉**两侧不是字母数字**的 `_` 与 `~`。实测:
- `[Home](https://example.com/~alice/report)` → target 变成 `https://example.com/alice/report`
- `See https://example.com/_next/static/report` → `flat.urls[0].value` 变成 `https://example.com/next/static/report`,
  而**同一行**用 `extractUrls` 得到的却是正确的 `/_next/`。

**现在会发生什么**:同一个 URL 在同一行上、取决于哪个提取器去读,会得到两个不同的值;
随后 `canonicalUrl` 把被改写的那个规范化,pack / ownDomains 的解析链(蓝图 §4.3 第 3、5 步)就找不到它,
一条**合法的第一方或供应商链接**因此拿到 authority D 并被 **blocked**。
这与 `text.ts:803-805` 自己承诺的「target 始终可还原」直接矛盾,**且不属于 §A 已承认的能力边界**。
~~本轮没有修~~ —— **2026-07-26 已修,见 §G F2**。修法与实测后果(含一处比上文更严重、方向相反的真实危害)写在 §G。

**F4d.(已修,见 §G F1)本轮新发现的第二个缺陷 —— RL8 每行只抽一条 claim,是 fail-open。**
`claims.ts:691,699-700` 的 `findUnsupportedClaims` 每行**至多产出一条**命中。
蓝图 §6.2 明文要求相反:「同一行多个 claim(**必须全部抽出,不能只抽第一个** —— 兄弟仓库 `RL8_SCI_CLAIM_REGEX_G`
就是为修这个 bug 才加的 global 变体)」。
当一行里**前一条**断言能解析、**后一条**不能时,后一条直接消失。已端到端复现(pack 持有 `https://analyst.example/benchmark`):

> `[Forrester](https://analyst.example/benchmark) reports that 73% of teams churn. A 2026 Meridian study found a 30% lift.`

→ RL8 `pass:true`,detail 写「All **1** external-research assertion(s) resolve…」;RL12 也 `pass:true`。
把那句伪造的话**单独成行**,则得到 1 条命中、authority `D`。

**现在会发生什么**:**一条编造的引用,只要与一条有据的引用同行,对两条 blocking 规则都完全隐形。**
这与整个 gate 的「never fail open」约定(`evaluate.ts:43-44`)直接冲突,
也与 A5.2 所说的边界不同 —— A5.2 说的是「无外部事实核查」,这里是**我们本可以看见却没看**。
(注:同一行两条**都**无法解析时 RL8 仍会 fail;缺口专属于「先解析成功、后解析失败」这个次序。)
~~本轮没有修~~ —— **2026-07-26 已修,见 §G F1**。

**F4e. 另两处无规格依据、同样未冻结**:`flattenLine` 从不反转义(label 保留 `\]`,destination 保留 `\(`,
CommonMark 会反转义);`paragraphBlocks` 把 `<li>…` 与 `: term` 行判为 `kind:"prose"`,
于是 SC3b 会把它们当叙事段计入中位句数 —— 这与 E5 的口径问题同源。

**F5. 新增的 unit 测试(补的是真缺口,不是分母)。**
`_context-draft.ts`(此前无测试文件)与 `lib/http/validate.ts`(此前无测试文件)各补一份,
断言的是契约要求的行为:draft patch 的「显式 null 清空 vs 缺键继承」(spec §6.2、`icp.ts:115-118`)、
半填 Persona 必须**拒绝保存而不是静默丢弃**、以及 §11.1 的状态码归属
(传输问题 400 / schema 违规 422 带 RFC6901 pointer / 超限 413 且**解析之前** / 畸形路径 id 404 不泄露存在性)。

## E. 未做的产品决策(stop gate 应列为 Owner 待决)

- **E1. 品牌轴对齐**:app 是 SignalFrame(cobalt/Fraunces/Manrope),artifact 是 GenGrowth(深绿/Source Serif 4/IBM Plex Sans)。Task 7/8 全走 `var(--sf-*)` 语义层,**裁决后重绑 `:root` 即整屏跟随**。`growth-map.module.css` 的私有 `--gm-*` token 记入该任务。
- **E2. SC8 的 CTA-URL 相等判定**是否启用(转化目标已冻结,阻碍已消除,但启用会让每篇链到定价/文档的草稿失败)。
- **E3. `citableCount` 改名**。
- ~~**E4. D1/D3 两条红门如何处理**~~ —— **D1 已解决**(见上,改口径至 82.43% / 84.28%,阈值仍 80%)。
  **D3 仍待决**(`authority/.../verify-spec.test.mjs` 那份 935 行的过时并行副本:修还是删)。
- **E5. SC3b 的叙事段口径是否排除 FAQ / CTA(产品裁决,本轮未动)。**
  蓝图 `task6-qa-port-blueprint.md:57` 写「叙事段(**排除 FAQ/Sources/CTA 等短段设计区**)」,
  实现 `structure-checks.ts:228` 用 `paragraphBlocks(context.body)`,而 `qa/context.ts:19-23` 只排除 referenceSections
  —— **FAQ 段与 CTA 段仍计入中位句数**。
  **现在会发生什么**:一篇带长 FAQ(每条一句)的合规草稿,其叙事段句数中位数会被 FAQ 拉到 ≤1,
  在段数达到 `sc3bMinParagraphs: 10` 之后可能被 SC3b 判 fail —— 也就是**因为写了 FAQ 而被扣分**。
  反过来,若按蓝图排除,一篇正文全是单句段、只靠 FAQ 凑数的草稿会逃过 SC3b。
  **代价边界**:目前所有 fixture 段数都 <10,`checkSc3b` 永远走早退 advisory,所以**这条规则本体从未真正执行过**,
  两种口径当下都不影响任何已知输出。**本轮刻意没有给 SC3b 写测试** —— 先写测试就等于替 Owner 把口径定死了。
  **需要 Owner 裁决后再补测试。**

---

## G. 2026-07-26 fail-open 修复轮:两条反编造门的绕过路径已关闭

上一轮把 F4b / F4d 定位到行但**没有修、也没有冻死**。本轮修了两条,各自独立 commit,各自带两组变异证据
(一组证明修复真的生效,一组证明没有误伤 / 没有放水)。**前四轮的守卫一条未动、一条未红。**

### G-F1. `findUnsupportedClaims` 每行只抽一条 claim(fail-open,已修)

**原状**:`claims.ts` 的 `findUnsupportedClaims` 用 `Set<number>` 按**行号**去重,一行至多产出一条命中。
一行里前一条断言能解析、后一条不能时,后一条**直接消失**,RL8 写下「All 1 … resolve」。

**根因不止一处**。补全抽取之后缺口仍然存在,因为 `locatedAttributions` 给具名归属记的**跨度是原始捕获组**:
`according to\s+([^\n]{2,120})` 一次吃掉 120 个字符,`value` 在逗号处被截断而 `span` 没有。
于是一行里**第一条**「According to <我们持有的来源>」的跨度盖住了该行**后面每一句**,
两句之外的 `According to Forrester, 73% …` 把那个能解析的名字拉进了自己的支撑候选集。
**「一条断言只能由它所归属的那个来源支撑」这条第三轮结论,是被跨度而不是被取值破坏的。**

**修法**(蓝图 §6.2「必须全部抽出」):
1. 抽全每行所有断言,**逐条各自解析**;
2. `cleanNameAt` 同时裁剪取值与跨度(取代只裁值的 `cleanNameCandidate`,后者现在是它的薄封装),
   让归属**落在它自己的名字上**;
3. 去重口径:**同一句 + 同一解析结果** = 同一条 claim(多个 pattern 认出同一个断言时不重复上报);
   **同一句里解析结果不同 = 两条 claim**,所以「同行/同句任一 claim 解析成功即整行通过」不成立;
4. 未具名的断言若与具名断言**跨度重叠**,让位给具名的那条(只有具名读法知道这句归属给谁),
   方向是 fail-closed:未具名读法的候选集是整句,比具名读法更宽松。

**变异证据(4 条,全部端到端过 `evaluateDraftQa`)**
- 生效 A:`According to Analyst Insights, activation rose 30%. According to Forrester, 73% …`(pack 持有 Analyst Insights)
  → 修前 `passed`(RL8 「All 1 … resolve」),修后 **`blocked`**,`rl8_unsupported_claim` = `failed`。
- 生效 B(RL12 那一半,由跨度收窄带来):同一行换成 `… activation rose 30%. Forrester (2024) found a 73% lift.`
  → 修前 `passed`,修后 **`blocked`**,`rl12_citation_integrity` = `failed`。
- 不误伤 A:同一形状、两条归属**都**被 pack 持有 → 仍 **不 blocked**,`rl8` claim = `passed`。
- 不误伤 B:`The Analyst Insights report found that activation improves 30%.`(一个断言被两种 pattern 同时认出)
  → 仍是 **1 条** claim、authority `B`,没有因为「抽全」而多报一条无支撑。

**仍然没有变的**:同一句里两条归属**都**无法解析时仍合并为一条 claim(仍然 `blocked`,只是不报两次)。

### G-F2. `flattenLine` 会改写 URL(已修)

**原状**:`flattenLine` 对整行跑 `stripEmphasis`,而它删掉 `~`(无条件)与两侧非字母数字的 `_`。
于是同一行同一 URL,`extractUrls`(读原文)与 `flattenLine().urls`(读剥离后)得到**两个不同的值**。

**F4b 原文推断的后果(第一方链接因此被 blocked)——实测不可达,如实更正。**
`resolveAttribution` 的 URL 路径在精确 URL 之后**还有一级 domain 兜底**,而 `_`/`~`/`*` 都不在
`canonicalUrl` 允许的 host 字符类 `[a-z0-9.-]` 里,所以剥离**只可能改路径、不可能改一个合法 host**;
路径被改而 domain 不变时解析照样命中。**穷举第一方 URL 的 `_`/`~` 变体,没有一个被 blocked。**

**真实危害是反方向的,而且更重:删除可以伪造 host。**
`https://signal~frame.example/onboarding` —— 一个**不是**客户的域名 —— 被剥离成 `signalframe.example`,
于是 RL12b 判定它是「客户自有属性」并 `passed`;SC9b 在导航类标题下也会把它算作 resolved。
**这是把一个陌生域名洗成第一方,不是把第一方误判成陌生域名。**

**修法**:`stripEmphasisOutsideUrls` —— 先在(遮蔽内联代码后的)原文里定位 URL 跨度,只在跨度之外剥离强调,
跨度之内**逐字节保留**。跨度末尾的 `[*~_]+` 连续段仍算 markup(`**url**` / `~~url~~` 照旧剥离)。
**第三轮的「不从 URL 内部提取」没有被打开**:`locatedAttributions` 的 `insideUrl` 守卫原样保留,
名字候选的 URL 守卫仍作用于**原始捕获跨度**而不是收窄后的跨度。

**变异证据(4 条)**
- 生效:`[Book a demo](https://signal~frame.example/demo)` → 修前 `rl12b_unresolved_link` = `passed`(被洗成第一方),
  修后 **`failed`**;`resolveLinkProvenance` 修前 `first_party` → 修后 `unresolved`。
- 不误伤:合法第一方 `https://signalframe.example/~guides/deep_dive_2024`(同时含 `~` 与 `_`)
  → 修后 **不 blocked**,`rl12b` 与 `rl12` 两条 claim 均 `passed`。
- 不放水:外部编造 URL `https://forrester-insights.example/_reports/2024_state` 挂在 `## Sources` 下
  → 修前修后**都** `blocked`(`sc9b_sources_resolve_to_pack` = `failed`)。
- 一致性:四个含 `_`/`~` 的地址,`flattenLine().urls` ≡ `extractUrls()` ≡ 原文,markdown link 的 destination 亦逐字节相同。

### G-确定性(Q8 前提)

抽全 claim 会改变 `claims` 数组,而 `FlowShadowQaGatesRepository.insert` 的重放比对依赖它逐字节稳定。
新增 P2 用例:上述 6 份草稿各连跑 **100 次**,`verdict` 与 `JSON.stringify(qaClaimsToJson(claims))` 与首次**完全相同**。
排序仍确定(断言按 `index` 升序产生、`hits` 按行号稳定排序),`qa/**` 仍零 IO / 零时钟 / 零随机。

### G-附带项 1. `hooks-diagnosis.ts`(D4 名单内,部分完成)

那 20 个未覆盖分支里,**四个是 TanStack 声明式包装**(`useProjectFindings` / `useProjectSnapshots` /
`useCreateDiagnosticRun` / `useReviewFinding`):它们的可断言内容就是传给 `useQuery`/`useMutation` 的字面量,
写出来是同义反复;要真的执行它们需要 `@testing-library/react` + jsdom,
而本仓 unit project 是 `environment: "node"` 且 `apps/web` 没有任何测试期依赖 ——
**加依赖 + 加 DOM 环境不在本任务范围**,如实记在这里。

**有真逻辑的那一份已经补了**:`useProjectRun` 的 `refetchInterval` 抽成纯函数 `runPollInterval(state)`
(行为零变化),测了 1s→2s→4s→5s 的升档与保持、status query 报错即停(否则 `dataUpdateCount` 永远 0、
对 401/404/5xx 每秒重试一次)、以及终止态即停(与 `0002_async_run_terminal_invariant` 的不可逆集合逐个对齐)。
**`hooks-diagnosis.ts` 分支覆盖 56.52% → 80.43%**,剩余未覆盖行 417-514 即上述四个 hook 体。

### G-附带项 2. keyset seek 的 `and(eq(created_at), lt(id))` 一臂(已覆盖)

见上文对 §F F1a 的更正。测试在**一个事务**里用普通仓储路径写三行(`now()` = 事务时间戳 ⇒ `created_at` 相同),
再用 `limit:2` 走 cursor 翻页,断言与整页读**逐位相同、无重复、无遗漏**且 id 降序。
**双向变异自验**:把 seek 改成只有 `lt(created_at)` → 红(第二页 0 行,整条 tie 被跳过);
把 `lt(id)` 改成 `lte(id)` → 红(走出 4 行,边界行被重复发一次)。
两个 append-only 触发器全程未动。

### G-本轮仍未做的(如实)

- **F4a**「audit module result canonical scope mismatch」仍无测试(它不是死代码,是 DB 挡不住的跨租户写入关卡)。
- **F4e** `flattenLine` 不反转义、`paragraphBlocks` 把 `<li>` / `: term` 判为 prose —— 未动。
- **E5** SC3b 叙事段口径仍待 Owner 裁决,仍刻意无测试。
- ~~**D3** `authority/.../verify-spec.test.mjs` 过时并行副本仍待决。~~ 2026-07-26 已修并接进
  新的 `pnpm verify:spec:test` 门(连同 `verify-spec-lock.test.mjs`、
  `verify-implementation-source.test.mjs` 两个同样孤立的套件),见上文 D3 / D3d。
- `collection.ts:583` 的裸 409 仍在(紧邻 N-1 冻结的 Sources 面,需独立任务)。
