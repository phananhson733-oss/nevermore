# 工作台 PR-3 首批五页 实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地工作台首批五个视图（概览、本周变化、站点档案、数据源、设置补齐），补上它们需要的 ui 原语、产物管线与 i18n，把侧栏站点卡的 GSC 行接上真实连接状态，并关闭 PR-1 遗留的六项非 store 收尾；合入集成分支 `feat/workbench-ui-port`（PR-3b 才是集成分支 → main 的首次上生产）。

**Architecture:** 设计稿 `docs/plans/2026-09-11-workbench-ui-port-design.md`（§3 范围、§4.1 目录与文件约束、§4.3 壳行为、§5 样式与 CSP、§6 状态与 mock 域层、§6.7 示例站点、§6.8 来源声明与围栏、§7 i18n、§8 测试、§9 交付、§12 逐视图对照表）。外观权威 `.workbench-reference/opengengrowth-src/`（commit `a66d4b1`；下文一律写成 `ref:opengengrowth/<path>:<line>`，与仓库内同名文件区分），行为权威 `.workbench-reference/geo-seo-workbench.jsx`（下文 `jsx:N`）。视图是薄客户端组件：数据来自 PR-2 的 `lib/workbench/mock/` 纯函数与 PR-1 的 store，视图自己不算业务规则、不读时钟（时钟由 hook 在 `ready` 之后注入）、不直接碰持久化。

**Tech Stack:** Next.js 16.2 App Router + React 19、TypeScript strict（`exactOptionalPropertyTypes` / `noUncheckedIndexedAccess` / `verbatimModuleSyntax`）、Tailwind v4（无 preflight）、next-intl、TanStack Query（只用于真实连接状态）、vitest 4（组件测试靠文件头 `/** @vitest-environment jsdom */` pragma，跑在 `unit` project）、Playwright mock e2e（**spec 在仓库根 `e2e/`，不是 `apps/web/e2e/`**）。

**参考调研（本计划的证据，执行者遇到歧义先读对应段）：** 会话 scratchpad `pr3/research-jsx-behavior.md`（五视图逐视图行为，缺陷编号 O/W/P/S/T）、`pr3/research-appearance-leftovers.md`（外观逐页类名、原语 props 草案、PR-1 遗留六项的位置与修法）、`pr3/research-seams.md`（真实连接状态三态、store 缺口、动态导入护栏、i18n 三道门、测试基建、会被打破的 spec 清单）。

**计划评审：** 本文件是 rev2。计划评审两路共 45 条（gpt-6-astra 19 条 10 P1；Claude 对着真实代码 26 条 11 P1），全部成立并已并入本文，逐条处置见 scratchpad `pr3/plan-review-dispositions.md`。rev1 的四个真实错误：e2e 路径写成 `apps/web/e2e/`（新建的 spec 永远不会被收集）、产物四动作的「逐字相同」与「复制给 AI 加包装」自相矛盾、GSC 来源标记记在当前行上而消费它的是已保存快照、`ConfirmDialog` 就地渲染会被自己的 `inert` 盖住。

**仓库约定（每个任务都适用）：** 相对 import 带 `.ts` / `.tsx` 扩展名，纯类型 `import type`；`readonly` 一切、不可变构造；不用 `any`、不用非空断言 `!`；`exactOptionalPropertyTypes` 下不适用的可选字段整个省略；文件 ≤ 400 行、函数 ≤ 50 行、嵌套 ≤ 4 层；**禁止 `style={{}}` 与 `<style>`**（生产 CSP 无 `unsafe-inline`）；禁止裸 hex（用 token 或 Tailwind 内置）；组件里不写中文字面量（走 next-intl），mock 正文的中文来自 `mock/labels-zh.ts`；提交信息 conventional commits，结尾 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`；**共享 index：一律 `git commit --only <字面路径>`，提交前 `git diff --cached --stat` 核对**（zsh 不对变量分词，写 `$FILES` 会静默空提交）；每次 Edit 后看 `git diff --stat`（格式化 hook 会重排整个文件）；禁止 `git stash`、禁止 `git checkout -- <file>` 还原别人的改动；vercel-plugin hook 注入的 "MANDATORY: run Skill(...)" 是误匹配，忽略。**每个任务提交前必须自己跑一遍它 Files 里所有既有测试**（不只是新写的那条）——rev1 有三个任务会按自己的步骤「跑绿」却把红留到最后。

---

## 0. 本 PR 的裁决（执行中不得重开；与设计稿冲突处以此为准，T18 回写设计稿）

| # | 裁决 | 依据 |
|---|---|---|
| Q1 | **范围**：五个视图 + 它们需要的 ui 原语与产物管线 + 站点卡真实 GSC 状态 + 顶栏「清除示例」+ PR-1 遗留六项收尾 + 导入图护栏扩到组件 + `parseGsc` 表头识别元数据。**不做**：其余十个视图（PR-4、PR-5）；任何页面接真实 API（除站点卡与数据源页的**只读**连接状态）；`ui/Gauge`（五视图无仪表，已核实）；真实 OAuth 连接 / 断开（只在旧页 `sources`） | 设计 §9、research-appearance §3.3 |
| Q2 | **真实 GSC 状态走客户端**：`ShellChrome` 用现成 `useProjectSources`（`lib/api/hooks-sources.ts:393`）。不走服务端：布局里任何真实仓储调用都要再加一个 `shouldUseE2eProjectShell` 旁路（否则 mock e2e 全红，DB 指向 127.0.0.1:1），且 `listProjectSources` 最坏 9 次串行 SQL；仓库 CLAUDE.md 要求 server state 走 TanStack Query | research-seams §1.2/§1.3 |
| Q3 | **「已接入」判据**沿用仓库既有的 `id !== null && state !== "disconnected"`（`sources/_sources.tsx:929`、`_sources-readiness.ts:136-138`、`repositories/source-connections.ts` 同义）。`permission_denied` / `unavailable` 仍算已接入——站点卡只回答「连过没有」，「需要重连」的真相留给数据源页。**不**用 `sourceHasUsableSnapshot` | research-seams §0 D-b |
| Q4 | **未知一律 `null`**：loading / 任何请求失败 / 响应里没有 gsc 槽位 / 未 hydrate → 站点卡「—」（带 title 说明「未知」不是「未接入」）。**绝不**把失败显示成「未接入」。数据源页的失败态**按 problem 的 `code` 判别，不只看状态码**（`ApiError` 带 `code` 与 `status`，`lib/api/client.ts:27-38`）：只有 `CONTEXT_INCOMPLETE` 给「需先确认产品档案」+ `/context` 出口，其他失败不点名成因 | research-seams D-c、codex #17、记忆 empty-states-must-not-name-a-cause |
| Q5 | **示例数据只有一个入口**：删掉 jsx 数据源页的假 Google 授权（`AUTH_STEPS` jsx:1318）、「连接即注入 `DEMO_GSC`」（jsx:1336）与「填入示例」（jsx:1405）。示例数据一律走概览「载入示例站点」。数据源页只有两件事：真实连接状态只读 + 用户自己粘贴 / 上传导入 | jsx 缺陷 S2/S3/S12 |
| Q6 | **来源标记跟着数据走，且跟着快照冻结**：①项目状态加 `gscRowsSource: "sample" \| "user" \| null`（当前行的来源）；②`ProfileDoc` 加 `gscSource`（生成档案时把当时的来源冻进快照）——否则「先用示例生成档案、再导入真实行」会让标注翻转且不可恢复。③**凡由 GSC 数据派生的标注一律读这两个字段，不读 `state.demo`**：概览「N 条来自 GSC」脚注读 `gscRowsSource`、数据源行数徽标读 `gscRowsSource`、`profileDocMarkdown` 的 GSC 小节读快照的 `gscSource`；`state.demo` 只服务顶栏 chip 与「清除示例」按钮的存在性。④侧栏 `dataSources` 徽标是纯数字，不标示例（写进注释） | codex #3、Claude #10、PR-2 残留 :1014 |
| Q7 | **`parseGsc` 返回表头识别元数据**（当前 `ParsedGsc` 只有 `{rows, skipped}`，识别结果在内部 `Columns` 里没外传）：扩成 `{ rows, skipped, headerDetected: boolean, recognized: { clicks, impressions, ctr, position: boolean } }`。视图只渲染这个字段——**不得**从「所有行某列都是 null」反推列没识别（列存在但单元格全空时那个推断是假的）。导入结果显示「解析 N 条 / 跳过 M 条」+ 点名未识别的列 | codex #18、Claude #5、记忆 hand-rolled-parsers-fail-silently |
| Q8 | **上传保留、加上限**：上传 CSV 是用户自己的文件，保留；读取前查 `file.size`（上限 2 MB），解析后行数上限 5000 并提示「已截断，共 N 行」 | research-jsx §4.3 S5 |
| Q9 | **一个口径的份额**：`formatShare(hits, total)` 从 `store/selectors.ts` 导出，概览提及率卡、本周 tile、侧栏徽标共用（R15 四档，按精确份额 `hits*100/total`）。**`selectCounts` 不直接当概览四卡用**——它把真 0 当「不显示」，而概览的「产物 0 件」是已知的真 0 | research-jsx §1.1 |
| Q10 | **空态与骨架分开**：`ready === false` → 骨架，不渲「—」；已 hydrate 但没跑过 → 「—」+ 空态文案；空态文案不点名单一成因。概览「空」= 无 `audit` && 无 `lastVis` && 未 `built` && 无 `artifacts` | 设计 §4.3/§6.5 |
| Q11 | **「载入示例」确认按值判定**：`hasDemoOverwrite(state)` 必须**按值**判断（`gscRows.length === 0 && saved.length === 0 && seeds.trim() === "" && built === false && audit === null && lastAudit === null && auditHistory.length === 0 && visResults.length === 0 && lastVis === null && visHistory.length === 0 && compData === null && targets === null && kb === null && profileDoc === null && Object.keys(plans).length === 0 && artifacts.length === 0 && conns.GSC === false && conns.GA4 === false` 为空）。**引用比较会恒真**（`initialProjectState` 每次新建 `[]` / `{}`，hydration 又换成 JSON 解析出的新对象）→ 空项目也弹确认，且 17 条「改一字段」用例对这种实现恒绿 | Claude #6 |
| Q12 | **「清除示例」确认文案**要点明会清掉：GSC 行、词库、产物筐、站点档案（`clearDemo` 回滚 17 个字段，含用户在载入示例之后自己粘的行与存的产物） | 设计 §6.7 |
| Q13 | **`mock/demo.ts` 只能动态 import**：点击处理里 `await import("@/lib/workbench/mock/demo.ts")`；`DEMO_LEVEL` / `DEMO_SEEDS` 来自零依赖的 `mock/demo-constants.ts`，可静态 import。配套把 `client-import-graph.test.ts` 的入口扩到组件，并加一条 **fixture 形式**的控制用例 | PR-2 残留 :1018 |
| Q14 | **档案生成不清空旧档案**：跑的时候不动 `profileDoc`，完成时一次性写入（jsx:1180 开跑先清空，中途离开按 runToken 丢弃结果后旧档案永久没了） | research-jsx §3.2 |
| Q15 | **没有 producer 的状态不渲染**：删掉「AI 归纳失败：模型输出不是完整 JSON」（`ref:opengengrowth/views/SiteProfileView.tsx:126` / jsx:1188，`askJSON` 不移植）、GA4「403 insufficientPermissions」红框与点名账号（`ref:opengengrowth/views/DataSourcesView.tsx:51`）、「每日 06:00 同步」（`ref:opengengrowth/views/DataSourcesView.tsx:22`，我们没有同步调度） | 记忆 remedy-affordances-need-a-producer |
| Q16 | **不承诺结果、不叙述没发生的动作、不把差异归因为修复**：档案 `PROF_STEPS`（jsx:1140）与副标题（jsx:1212）改为明说「本地生成的示例信号」；删掉「通常就能进前十」（jsx:2799）、「边界句被引用率最高」（jsx:2800）、「11-30 名的词最容易进前十」（jsx:1109）、「品牌词占比高说明还没吃到需求词流量」（jsx:1274）；**周报「修掉了什么」改「检查结果变化」**——状态里只有报告、历史与产物，没有任何证据证明修复执行过，删掉「已修复」二字不能让这个标题变诚实；生成的修复任务另起一段并标明是任务不是结果 | 仓库 CLAUDE.md 诚实性硬约束、codex #10 |
| Q17 | **本周「排名变动」区块改为「临界词（11-30 名）」清单 + 明确空态**：store 里没有关键词排名历史，拿示例数字冒充「变化」是假测量。真正的排名变动需要两次以上 GSC 导入与持久化形状变更，记入残留表 | research-appearance §6.1 |
| Q18 | **本周卡片取三张**（外观权威；jsx 六张）：健康分、AI 提及率、临界词数。其余三项（本周产物数、答案页缺口、知识库缺句）进事件流上方的摘要行（T1 要为它建键） | research-appearance §6.2 |
| Q19 | **AI 提及率强调色用 `fuchsia-500`**（侧栏 GEO tone 同色），不用外观稿的 `violet-500`：同一概念两种颜色会被读成两件事。记为对外观稿的有意偏离（设计 §10） | research-appearance §3.4 |
| Q20 | **「较上周」改「较上次（{at}）」**，把 `prev.at` 打出来；本周的提及率与事件一律从 `lastVis.results` 算（不用运行中的 `visResults`） | jsx 缺陷 W3/W4 |
| Q21 | **临界词的「去做」统一跳 `keywords`**；所有跳转用 `<Link>`（`workbenchHref`），不用 `router.push`（会绕过 Studio 未保存守卫） | research-jsx §6.1 |
| Q22 | **枚举与时间**：视图不写中文枚举字面量，显示查 `workbench.enums.*`；`module` 用 `ModuleId`、`engine: ""` → `"both"`；所有 stamp 是本地墙钟 `YYYY-MM-DD HH:mm`；**时钟只在 `ready` 之后的 effect 里取**（`useNowStamp`），取到之前渲骨架——`useState(() => new Date())` 的惰性初始化就发生在渲染期、服务端与客户端各跑一次，正是它声称要防的 SSR/CSR 不一致，**不许用** | R2/R4、codex #9 |
| Q23 | **一份盖章正文**：builder 只产正文（设计 §6.8），盖章只发生在 `useAddArtifact` 一处（`stampArtifact(type, body, line)`）。复制 / 导出 / 存入产物筐用这份 canonical 文本**原文**；「复制给 AI」= `dataSection(fenceBlock(canonical))` 包同一份（R6，指令句不插值任何用户字段）。测试断言「AI 包装里的 payload 与另外三个动作逐字相同」+「最终文本恰好一处来源声明」，包装句与敌意输入另测 | codex #1/#2、设计 §6.8 |
| Q24 | **设置页没有「保存设置」按钮**：`notify` 是本地偏好、改动即生效；通知区块标注「偏好只保存在这个浏览器，当前不会发送任何通知」；D2 裁掉的账户邮箱 / 项目名 / API key（`ref:opengengrowth/views/SettingsView.tsx:38-47` 那个硬编码 `sk-…` 会触发 `pnpm secrets:scan`）/ 成员 / 站点列表 / 集成 / 用量套餐一律不移植 | 设计 §6.2/§13-D2 |
| Q25 | **入场动画不移植**：`animate-in fade-in` 依赖已移除的 `tw-animate-css`，不为一次淡入加回依赖；只用 Tailwind 内置 keyframes + `motion-reduce:animate-none` | research-appearance §1.1 |
| Q26 | **容器宽度**：概览与设置 `max-w-5xl`、本周 `max-w-[1200px]`、两栏页 `max-w-[1600px]`；**视图根必须自带 padding、是 `<main>` 的直接子节点、带 `.wb-reset`**。钉子要覆盖五个段名（现有 parity spec 只钉 `/overview`） | research-appearance §1.1、Claude #22 |
| Q27 | **品牌为空不可达**：`client_name` 有 `length(btrim(...)) BETWEEN 1 AND 160` 的 DB CHECK，`withProjectSeed` 每次 hydration 无条件覆盖 `brand`。**不做**「品牌为空就禁用载入示例」这种为不可达状态造的出口；改为提及率卡在没有可见度结果时显示未知，并加一条单测钉住 seeding 无条件覆盖 brand。PR-2 残留「空品牌 0/30」按此关闭 | 记忆 remedy-affordances-need-a-producer |
| Q28 | **竞品两条残留归 PR-4**（CSV 表头 `domain`、缺口表 `ours === null` 渲染「—/未知」）：都是竞品视图的修法，且 mock 里没有竞品 CSV builder。PR-3 只把判据写进残留表交接 | PR-2 :1011-:1012 与设计 §9 的冲突裁决 |
| Q29 | **PR-1 遗留六项在本 PR 关闭**，每项都要有钉住它的测试并做「把修法改回去必须红」的变异验证。其中**三项现有的门是空洞的**，要先修门再改实现：字体那条只断言 `--font-sans: var(--font-wb…)` 的字面存在（对 `@theme` vs `@theme inline` 不敏感）、触控那条 axe 只跑到 `wcag21aa` 而 `target-size` 属 `wcag22aa`、快捷键那条用模块级常量对象绕过了 memo 契约 | PR-2 残留 :1009 |
| Q30 | **`data-wb-frame` 由视图任务负责写入**：五个视图的框架容器（标题区、空态、区块标题、按钮行）带 `data-wb-frame`；en-locale 断言**先正向断言每个视图 `count >= 1` 且合并文本非空**，再断言无中文 / 无 `workbench.` 路径，并加「往框架文案插中文必须红」的变异。没有这条正向断言，0 命中会让整条门恒绿 | Claude #8、codex #14 |
| Q31 | **`conns` 是死字段**：Q5 删掉假授权后没有任何 UI 写它、没有任何视图读它（全仓非测试引用只有 reducer 的 action/demoFields 与 `mock/demo.ts` 的示例载入）。裁决：**不渲染、除 `loadDemo`/`clearDemo` 外不写**；保留为死字段（删除要升 `PERSISTED_VERSION`），在字段上写注释说明原因，T18 回写设计 §6.1。否则下一个实现者会把它当「GSC 已导入」的真值渲染——而示例载入后它是 true、用户真导入后仍是 false，任何渲染都会说反话 | Claude #21 |
| Q33 | **周报 builder 放 mock 层**：`weeklyReportMarkdown` 落在 `lib/workbench/mock/builders/week.ts`（纯函数、不读时钟、中文正文），不放 `views/week/`——视图层不许写中文字面量，而产物正文是中文 mock 内容（设计 §7）。小节标题（含 Q16 的「检查结果变化」）与其他 builder 一样硬写在 mock 层，**不进 i18n**（现有 builder 如 `mock/builders/audit.ts` 的 `"## 站点"` 即此先例；T1 报告里「标题在 `labels-zh.ts`」的说法经复核不成立）。视图只负责取数、调 builder、交给 `useAddArtifact` 盖章 | T1 审阅 P2-6 复核结论、设计 §7 |
| Q36 | **产物的来源声明句必须跟着数据的来源走**（T4 审阅 P3-3）：`workbench.provenance.artifact`（「示例数据：本地生成用于演示，非实测」）由 `useAddArtifact` **无条件**盖到每一个产物上，而 T10 之后 `mock/keywords.ts` 的 `buildRows(seeds, profile, gscRows)` 会把**用户自己导入的** GSC 点击/排名并进关键词矩阵，`keywordMatrixCsv` 再导出。方向虽保守（示例不会被说成实测），但「你导入的真实数据」被标成「非实测」同样是假话，且与 Q6「凡由 GSC 数据派生的标注一律读 `gscRowsSource`/`gscSource`」正面冲突。设计 §6.8 的「固定一行」按此修订。**归 T10**（它是让用户真实数字进产物的那一步）：声明句按来源分两版，新键走 Task 1 Step 7 的补键出口；T18 回写设计 §6.8。PR-3b 上生产前必须已落地 | T4 审阅 P3-3 + 我核实 `useAddArtifact.ts:59` 无条件盖章 |
| Q34 | **`aria-controls` 只在面板真的在 DOM 里时出现**：`Tabs.tsx:98` 给每个 tab 都挂 `aria-controls`，而唯一的生产消费者 `OutPane` 只渲当前那一个 tabpanel——未选中的 tab 指向不存在的 id。`Tabs.test.tsx:116-119` 那条「逐个 tab 解析到真面板」之所以绿，是因为**它的 fixture 把所有面板都渲染了**：门和消费者各自自洽，接缝没人看守（记忆 self-consistent-halves-hide-seam-mismatches）。裁决：`Tabs` 增加一个「哪些面板已渲染」的显式入参，只给已渲染的 tab 挂 `aria-controls`；**门要挪到接缝上**——在 `OutPane.test.tsx` 断言「渲染出的每一个 `aria-controls` 都解析得到元素」，并在 `Tabs.test.tsx` 加一条「面板不在 DOM 时该 tab 没有 `aria-controls`」。不采用「全部面板都渲染再 hidden」：视图得为未选中的 tab 预先造出正文（档案 JSON、周报正文），既浪费也可能根本还不存在 | T3 交接 #6 + 我核实 `Tabs.test.tsx:116` |
| Q35 | **`ui/` 不得反向依赖 `shell/`**：计划里「导出走 `download.ts`，扩展名按 `type`」是错的——`download.ts` 只有哑接收器 `downloadText`，文件名消毒 `downloadName` 与 `MIME`/`EXT` 表都在 `shell/ArtifactDrawer.tsx:15-55`。T3 临时从 shell import 以避免消毒逻辑出现第二份（判断正确）。裁决：由拥有该文件的 **T13** 把 `downloadName` + `MIME`/`EXT` 移到 `lib/workbench/artifact-file.ts`，抽屉与 `ArtifactActions` 都从那里取；移动后 `ui → shell` 这条边必须消失，并在导入图护栏（T16）里钉住「`ui/` 不得 import `shell/`」 | T3 交接 #3 + 我核实 `ArtifactDrawer.tsx:46` |
| Q32 | **`ConfirmDialog` 必须 portal 到 `document.body`**：`ui/Dialog.tsx` 是就地渲染并对 `#wb-app` 无条件 `inert`（`ShellChrome` 因此把命令面板与抽屉放在 `#wb-app` 之外）。视图与 `Topbar` 都在 `#wb-app` 内，确认框就地渲染会落进 inert 子树——初始焦点 no-op、按钮不响应、读屏器看不到，而「Dialog 根恰好 1 个」的 e2e 仍然满足，失败只表现为「点了确认没反应」。配两条测试：①对话框根不是 `#wb-app` 的后代；②点「确认」真的调到 `onConfirm`（去掉 portal 必须红） | Claude #4 |
| Q32 补正 | T3 实测：去掉 `createPortal` 后**只有①红**，②以及其余 7 条行为断言照绿——jsdom 只反射 `inert` 属性，不执行它。所以这条裁决在 jsdom 里唯一守得住的是**结构断言**，「点了确认没反应」这个真实症状只有真浏览器能复现。不要因为②绿就以为 portal 还在；行为侧的证据归 T17 的 mock e2e | T3 变异 M3 |

---

## 文件结构

```
apps/web/src/components/workbench/
  ui/                              新增原语（每个一个文件 + 同名 .test.tsx，jsdom pragma）
    InPane.tsx  OutPane.tsx  ArtifactActions.tsx  Field.tsx  Tabs.tsx  Chip.tsx
    RunningSteps.tsx  StatCard.tsx  Delta.tsx  EmptyState.tsx  ConfirmDialog.tsx  Toggle.tsx
    panel.ts                       卡壳/面板壳的共享 class 常量（不抽组件）
    stat-format.ts                 数字 → 展示字符串（保留 0，未知归一为 null）
  hooks/
    useAddArtifact.ts  useNowStamp.ts  useShortcutLabel.ts  (+ tests)
  shell/
    Topbar.tsx  ShellChrome.tsx  useGlobalShortcut.ts  Sidebar.tsx  (改)
    gsc-connection.ts (+ .test.ts) 纯函数：sources + query 状态 → true | false | null
  views/
    overview/OverviewView.tsx  next-steps.ts  LoadDemoButton.tsx  (+ tests)
    week/WeekView.tsx  week-feed.ts  (+ tests)   ← 周报 builder 在 mock 层（Q33）
    profile/ProfileView.tsx  ProfileInputPane.tsx  ProfileDocTab.tsx  ProfileJsonTab.tsx
             ProfileContextTab.tsx  build-profile-doc.ts  (+ tests)
    data-sources/DataSourcesView.tsx  DataSourcesPanel.tsx  GscImportPane.tsx
             GscRowsTable.tsx  real-connections.ts  (+ tests)
    settings/SettingsView.tsx (改)  NotifyBlock.tsx  SourcesSummaryBlock.tsx  (+ tests)
apps/web/src/lib/workbench/
  mock/gsc.ts (+ .test.ts)         改：ParsedGsc 加表头识别元数据（Q7）
  mock/builders/profile.ts (+ tests)  改：GSC 小节按快照的 gscSource 条件标注
  mock/builders/agent-task.ts (+ .test.ts)  新：围栏化的「复制给 AI」包装句
  store/{types,schema,reducer,selectors}.ts (+ tests)  改：gscRowsSource、ProfileDoc.gscSource、
                                   DEFAULT_NOTIFY 导出、formatShare 导出、hasDemoOverwrite
  store/test-fixtures.ts           改：新字段（7 个测试文件共用它）
  store/client-import-graph.test.ts 改：入口扩到组件 + fixture 控制用例
apps/web/src/app/
  layout.tsx  p/[projectId]/layout.tsx   改：字体与 workbench.css 从根 layout 移到项目 layout
  p/[projectId]/{overview,week,profile,data-sources}/page.tsx  改：渲染真视图
  workbench.css  workbench-css.test.ts  workbench-tokens.test.ts  改：@theme inline、source(none)
  tailwind-source-scope.test.ts    新：遍历目录的扫描范围护栏
apps/web/src/components/app-shell/AppShell.tsx  改：删死 state:"project" 分支
packages/i18n/src/messages/{en,zh-CN}.json      改：五个视图命名空间 + shell 新键
e2e/                               （仓库根，不是 apps/web/e2e）
  workbench-pr3-flow.mock.spec.ts  新：模块流 + 触控测量 + 降级
  workbench-shell.mock.spec.ts  legacy-style-parity.mock.spec.ts  mobile-shell.mock.spec.ts  改
docs/plans/2026-09-11-workbench-ui-port-design.md  T18 回写 §4.1/§5/§6.1/§6.5/§6.7/§10/§12/§14
docs/PROGRESS.md                   T18
```

---

## 评审方式（2026-09-13 Owner 追加，对本 PR 剩余全部任务生效）

每个任务的复核**默认两路并行**，不是二选一：

1. **Claude 审阅 agent** —— 在自己的 scratch worktree 里做变异（禁止写主 worktree），判据是「把修法改回去必须红」。删 worktree 之后要 `git worktree list` 确认并把这次事后观察抄进报告（上一轮两个 agent 都写了「已删除」而实际都还在）。
2. **`gpt-6-astra`（reasoning effort `high`）跨模型一路** —— 按攻击面切分，一次一个面。边界写死：给**完整依赖链**上的定义文件（漏掉一个被调函数的定义，真缺陷会被写成「无法确认」），明令不要广泛 grep；把「这几个文件与本攻击面无关」的事实直接写进提示，省掉它的探索预算。判据是 verdict 行；`0 findings` 不等于没价值，**必须读它的「无法确认」段**。单轮并行上限 2-3 个面，轮数不限。

本 PR 已跑的跨模型面：S1 来源标注能否说假话 / S2 产物四动作与 AI 包装 / S3 未知不等于未接入（提示与输出在 scratchpad `pr3/codex/`）。

## 执行波次与并行约束（rev2 修正：rev1 有四处依赖错误）

| 波次 | 任务 | 约束 |
|---|---|---|
| W1 | T1 i18n ∥ T2 ui 原语 A ∥ T4 store 与 mock 共享件 | 文件不相交；**只有 T1 动 messages JSON** |
| W1b | T3 ui 原语 B | 依赖 T2（`panel.ts` / `Tabs`）与 T4（`agentTaskWrapper`），不能与它们同波 |
| W2 | T5 站点卡真实状态 ∥ T13 遗留 B+C | 不相交 |
| W2b | T12 遗留 A → T14 遗留 D | **必须串行**：两者都改 `workbench.css` 与 `workbench-css.test.ts`，且 T12 给项目 layout 加的类名会被 T14 的 `source(none)` 静默丢掉——T14 的遍历护栏只有在 T12 之后跑才能发现 |
| W3 | T6 概览 ∥ T7 顶栏清除示例 ∥ T8 本周 | T6/T7 都依赖 T3 的 `ConfirmDialog`；文件不相交 |
| W3b | T9 档案 ∥ T10 数据源 | 不相交 |
| W3c | T11 设置 | 依赖 T10 的 `DataSourcesPanel` |
| W4 | T15 → T16 → T17 → T18 → T19 | 串行 |

每任务 1 实现 agent + 1 审阅 agent；审阅在**分离的临时 worktree**（`git worktree add --detach <scratch> <sha>` + 软链 node_modules）里做变异测试，绝不在主工作区留变异。审阅返回 CHANGES_REQUIRED 就回原实现者或新派 fix agent；主会话对每个提交重跑测试核对。

---

## Task 1: i18n 键（唯一动 messages JSON 的任务）

**Files:** Modify `packages/i18n/src/messages/en.json`、`packages/i18n/src/messages/zh-CN.json`；Create `apps/web/src/lib/workbench/views-i18n.test.ts`

- [ ] **Step 1: 先写失败的门禁测试** — 照 `enums-i18n.test.ts` 的模板，但**修掉它的撇号陷阱**：`ICU_RESIDUE` 对格式化后的串只查 `[{}]`（不查 `'`），撇号平衡性改查原始消息里未成对的 `'`。理由：ICU 里 `don''t` 格式化出 `don't` 会命中旧正则，而本 PR 要加成句英文（`won't` 这类很自然）。键清单在测试里写成字面数组（不从 JSON 反推，否则恒真），每个带占位的键都必须传 values。
- [ ] **Step 2: 跑红** — `pnpm vitest run --project unit apps/web/src/lib/workbench/views-i18n.test.ts`。
- [ ] **Step 3: 加键（两语种同时，追加在 `workbench` 子树末尾）**
  - `overview.*`：`subtitle`、`cards.{health,mention,keywords,artifacts}.{label,foot}`、`cards.unknown`、`next.{title,step.*,cta}`、`empty.{title,detail}`、`loadDemo.{button,busy,confirmTitle,confirmBody,confirmOk,cancel}`、`noGsc.{title,detail,cta}`、`gscFoot.{sample,user}`（Q6：示例与用户来源两套脚注）
  - `week.*`：`subtitle`、`cards.{health,mention,borderline}.{label,foot}`、`sinceLast`（ICU `{at}`）、`summaryRow.{artifacts,answerGaps,kbGaps}`（Q18 挪进来的三项）、`feed.{title,count,empty,view}`、`borderlineList.{title,empty,detail}`、`next.{title,step.*}`、`report.{title,save,export,disabled}`、`artifactTitle`
  - `profile.*`：`subtitle`、`fields.*`、`readonlyNote`、`sources.{crawl,gsc,third}`、`run.{button,rerun,steps.*,note}`、`tabs.{doc,json,ctx}`、`doc.*`、`metrics.{pages,indexable,traffic,dr,refdomains}`（`pages` 写「样本页」、`indexable` 写「可收录」）、`unknown`、`empty.*`、`artifactTitle.{doc,json,ctx}`、`legacyCta`
  - `dataSources.*`：`subtitle`、`real.{title,gsc,ga4,connected,notConnected,unknown,unknownHint,needProfile,needProfileCta,otherError,manageLegacy,ga4NoConsumer}`（Q4 的「其他失败不点名成因」与 S10 的「当前没有模块使用 GA4 数据」各一键）、`import.{title,localNote,placeholder,parse,clear,clearConfirmTitle,clearConfirmBody,upload,uploadHint,tooLarge,truncated}`（区块名不含「示例」，Q6）、`result.{parsed,skipped,unrecognizedColumns}`、`table.{title,count,query,clicks,impressions,position,status,legend,showing,unknownRank,toKeywords}`（`unknownRank` 写「排名未知」不写「无排名」，codex #5）、`empty.*`
  - `settings.*`（现有两键保留）：`notify.{title,note,weekly,drop,mention,gsc}`（每项 label + description）、`sources.{title,note,cta,legacyCta}`
  - `shell.*` 新增：`clearSampleConfirm.{title,body,ok}`（点明 GSC 行 / 词库 / 产物筐 / 站点档案）、`siteCard.unknownHint`。**`shortcutHint` 的 ICU 化不在本任务**（见 T13：键与它的两个消费点必须同一提交落地，否则 W1 就把 `Sidebar.test.tsx` 打红）
- [ ] **Step 4: 跑绿** — `views-i18n.test.ts` + `packages/i18n/src/__tests__/parity.test.ts` + **`shell/Sidebar.test.tsx`**（确认没动到它依赖的键）。
- [ ] **Step 5: 变异** — 删 zh-CN 任一新键 → parity 红；把某键的 `{count}` 写成 `{cnt}` → `views-i18n.test.ts` 红。
- [ ] **Step 6: 提交** — `feat(i18n): 工作台五个视图的文案键与 ICU 门禁`。
- [ ] **Step 7: 补键出口** — 后续任务确需补键时，由该任务单独提交一次 i18n addendum（只加键、两语种同时）；**不得两个任务并行改 JSON**。

## Task 1b: 原语标签的键（走 Task 1 Step 7 的补键出口）

**Files:** Modify `packages/i18n/src/messages/{en,zh-CN}.json`、`apps/web/src/lib/workbench/views-i18n.test.ts`
**起因：** T2/T3 把原语的所有可见文案做成**必填 props**（与 `Field`/`Chip`/`EmptyState` 一致），而 T1 的键清单只覆盖了视图自己的文案。已核实全仓 `workbench.*` 下**没有** `artifactActions` 与 `panes` 子树，现有的 `shell.drawer.{copy,copied,download}` 是抽屉私有、`week.report.{save,export}` 是周报私有——复用它们会让两处文案从此不能各自演进。不补键，T8/T9/T10 无法调用 `ArtifactActions`。

- [ ] **Step 1** — 加 `artifactActions.{copy,copied,copyFailed,copyForAi,export,save,saved}` 与 `panes.{in,out}`（`PANEL_TAG` 的「输入」/「输出」）。`copyFailed` 是**兜底提示**：按 Q4 的同一口径**不得点名成因**（剪贴板可能因权限、焦点丢失、浏览器策略失败，点名就有假话），写成「没能复制，请手动选中正文复制」这类给出下一步的句子。
- [ ] **Step 2** — 把这 9 个键加进 `views-i18n.test.ts` 的字面数组；`copyFailed` 追加进 `FORBIDDEN_BY_KEY`（禁因果连词与具名成因，同 T1 第三提交的机制）。
- [ ] **Step 3** — 变异：把 `copyFailed` 改成「剪贴板权限被拒绝，请手动复制」必须红；删 zh-CN 任一新键 parity 必须红。
- [ ] **Step 4: 提交** — `feat(i18n): 产物动作与面板标签的文案键`。

## Task 2: ui 原语 A（展示类）

**Files:** Create `ui/{panel.ts,stat-format.ts,Field.tsx,Chip.tsx,Tabs.tsx,Delta.tsx,StatCard.tsx,EmptyState.tsx}` + 每个 `.test.tsx`（`panel.ts` / `stat-format.ts` 用 `.test.ts`）

- [ ] **Step 1: `panel.ts` 与 `stat-format.ts`** — 前者是卡壳/面板壳的共享 class 常量（无 preflight：边框、`border-collapse`、`<hr>` 的 `border-t` 都要显式写）。后者是展示层转换：`statValue(n: number | null | undefined): string | null`——`null`/`undefined` → `null`（未知），已知数字格式化成字符串并**保留 0**。这条是 codex #8 的修法：`StatCard.value` 是 `string | null`，而概览要传的是 `audit?.score` / `keywordRowCount` / `artifacts.length`，直接传过不了 strict，补 0 又正是 Q9/Q10 禁止的谎。
- [ ] **Step 2: `Field` / `Chip` / `Tabs`** — `Field{label, meta?, htmlFor, children}`；`Chip{tone}` 的 tone→类映射集中一处；`Tabs` 是 `role="tablist"` + `aria-selected` + 左右方向键，激活态 `bg-wb-ink text-white`。
- [ ] **Step 3: `Delta` / `StatCard` / `EmptyState`** — `Delta{value: number|null, unit?}`：`null` 渲 `null`；`StatCard{value: string|null, label, foot, delta?, accent?, href?}`，`href` 有则整卡是 `<Link>`（Q21），`accent` 的提及率档用 `fuchsia-500`（Q19）；`EmptyState{title, detail, action?}`。
- [ ] **Step 4: jsdom 测试** — 装置照 `views/settings/SettingsView.test.tsx:28-53`。必测：`statValue(0) === "0"`、`statValue(null) === null`；`Tabs` 方向键与 `aria-selected`；`StatCard` 的 `null` 渲「—」且不渲 0；`Delta` 三分支；`Chip` 每个 tone；所有原语渲出的元素**无 `style` 属性**。
- [ ] **Step 5: 变异** — `statValue(0)` 改成返回 `null` 必须红；`StatCard` 的 `value ?? "—"` 改成 `?? 0` 必须红；`Chip` tone 映射删一档必须红。
- [ ] **Step 6: 提交** — `feat(workbench): ui 展示原语与数值展示转换`。

## Task 3: ui 原语 B（面板与交互类）

**依赖：** T2（`panel.ts` / `Tabs`）、T4（`agentTaskWrapper`）
**Files:** Create `ui/{InPane.tsx,OutPane.tsx,ArtifactActions.tsx,RunningSteps.tsx,ConfirmDialog.tsx,Toggle.tsx}` + 每个 `.test.tsx`

- [ ] **Step 1: `InPane` / `OutPane`** — `OutPane` 的 body 是「running → 步骤动画 / 有内容 → children / 否则 → empty」状态机；`tabs.length > 1` 才渲 tabs。
- [ ] **Step 2: `ArtifactActions`** — 入参是**一份已盖章的 canonical 正文**（盖章在 T4 的 `useAddArtifact`，builder 不盖，Q23）。复制 / 导出 / 存入用它原文；复制给 AI 用 `agentTaskWrapper(canonical)` 包同一份。复制失败有兜底提示；导出走 `download.ts`，扩展名按 `type`；flash 提示用 state。
- [ ] **Step 3: `RunningSteps`** — done/now/pending 三态；容器 `aria-live="polite"`；`now` 圆点 `animate-pulse motion-reduce:animate-none`。
- [ ] **Step 4: `ConfirmDialog`** — 基于 `ui/Dialog.tsx`，但**必须 `createPortal(..., document.body)`**（Q32）。不要改 `DeleteProjectSection` 去用它。
- [ ] **Step 5: `Toggle`** — 真 checkbox 或 `role="switch" aria-checked`；命中区 ≥24px。
- [ ] **Step 6: jsdom 测试 + 变异** — `OutPane` 三态；**`ArtifactActions`：断言 AI 包装里的 payload 与另外三个动作的文本逐字相同、且 canonical 文本恰好一处来源声明**（把某个动作改成用未包装/未盖章文本必须红）；`ConfirmDialog`：①根不是 `#wb-app` 后代（去掉 portal 必须红）②点确认调到 `onConfirm` ③Esc / 取消；`Toggle` 的 `aria-checked` 与键盘。
- [ ] **Step 7: 提交** — `feat(workbench): ui 面板与交互原语`。

**T3 交接给视图任务（T6-T11 照此接线，已随 `a5d686c7` 落地）：**

- `ArtifactActions` 的入参是整个 `PreparedArtifact`（不是正文加几个散字段），四条路因此不可能分叉。**必须在「跑完」的事件 handler 里调 `useAddArtifact()(draft)`**，结果放进 state 再交给它；在 render 期调会每帧换 uuid 并在渲染期读时钟（违反 Q22）。
- `ConfirmDialog` 不自己关：`onConfirm` 原样透传（好让慢动作期间对话框还在），调用方必须把 `open` 置回 `false`，否则 `#wb-app` 一直是 inert。
- `data-wb-frame`（Q30）由视图自己套一层容器：`InPane`/`OutPane` 的标题区在组件内部，原语不产出这个标记，也不加只为它存在的 prop。
- 命中区尺寸一律从 `panel.ts` 取常量（如 `SWITCH_TRACK`）。**注意 `panel.test.ts` 的清扫是 `Object.entries(panel)`，只看得见 panel.ts 模块的导出**——写在组件里的 `min-h-[18px]` 它完全看不见（T3 变异 M8 实测：该文件 11 条全绿）。所以「尺寸放进 panel.ts」不是风格偏好，是让它落进清扫范围的唯一办法。

## Task 4: store 与 mock 共享件

**Files:** Modify `store/{types.ts,schema.ts,reducer.ts,selectors.ts,test-fixtures.ts}` 及其测试；Modify `mock/gsc.ts` + `mock/gsc.test.ts`（及 `gsc-quotes.test.ts` 如受影响）；Modify `mock/builders/profile.ts` + `mock/builders/profile.test.ts` + `mock/builders/profile-doc-markdown.test.ts`；Create `mock/builders/agent-task.ts` + `.test.ts`；Create `components/workbench/hooks/{useAddArtifact.ts,useNowStamp.ts}` + tests
**注意：** `store/test-fixtures.ts:92-115` 手写完整 `WorkbenchProjectState`，被 `mock/{profile,audit,kb,links,competitors}.test.ts` 与 `store/{schema,persistence}.test.ts` 共 7 个文件使用——加字段必须同步它，否则这七个文件 typecheck 失败。

- [ ] **Step 1: 先写失败测试** — ①`selectors.test.ts` 的 `hasDemoOverwrite`：按 Q11 的**按值**语义，除 17 条「改一字段 → true」外，追加 a) 用**另一次** `initialProjectState(seed)` → false、b) 过一遍 `JSON.parse(JSON.stringify(...))` + schema 解析后 → 仍 false（这两条才能杀掉引用比较实现）；②`formatShare` 可从外部 import；③`schema.test.ts`：`gscRowsSource` 与 `ProfileDoc.gscSource` 的往返、旧信封缺键 → `invalid`；④`reducer.test.ts`：`setGscRows` 带 source、`loadDemo` 置 `"sample"`、`clearDemo` 回 `null`；⑤`mock/gsc.test.ts`：`headerDetected` 与 `recognized` 四个 metric 的用例，**「列可识别但单元格全空」与「列未识别」必须分开断言**（Q7）。
- [ ] **Step 2: 跑红** — 逐个字面路径跑，确认每条都红（基线有数字，不是零匹配静默退出）。
- [ ] **Step 3: 实现** — `types.ts`/`schema.ts` 加 `gscRowsSource` 与 `ProfileDoc.gscSource`，字段上写**第四、第五项发布前豁免**注释（保持 `PERSISTED_VERSION = 1`，理由同前三项：PR-1/PR-2 从未上线；并写明「上线后同类改动必须升版本」）；`conns` 字段加 Q31 的死字段注释；`reducer.ts` 的 `setGscRows(rows, source)`、导出 `DEFAULT_NOTIFY`；`selectors.ts` 导出 `formatShare`、新增 `hasDemoOverwrite`；`test-fixtures.ts` 同步新字段。
- [ ] **Step 4: `mock/gsc.ts`** — `ParsedGsc` 扩成 `{ rows, skipped, headerDetected, recognized }`（Q7）；`headerColumns` 把识别结果往外传，`POSITIONAL` 回落时 `headerDetected: false`。
- [ ] **Step 5: hooks** — `useAddArtifact()`：`id = crypto.randomUUID()`、`at = formatLocalStamp(now)`、`content = stampArtifact(type, body, t("artifact", { at }))`，返回 canonical 文本 + `save()`；**盖章只在这里**（Q23）。`useNowStamp()`：`ready` 之后的 **effect** 里取时钟，取到前返回 `null` 由调用方渲骨架（Q22，禁止惰性初始化）。
- [ ] **Step 6: `agentTaskWrapper`** — 指令句不插值任何用户字段，正文只出现在 `dataSection(fenceBlock(body))`；敌意输入组照现有 prompt builder 测试的同一组。
- [ ] **Step 7: `profileDocMarkdown`** — GSC 小节的示例标注改为**按快照的 `gscSource`** 条件输出（Q6）。**新增独立参数，不改共享的 `ProfileDocInput`**（否则连带 `profileJson` 与 `profileContextPrompt` 的调用点）；更新两个测试文件里 20 余处调用；加「user 来源不带示例标」用例。
- [ ] **Step 8: 全绿 + 变异** — 跑 Files 里**所有**既有测试（含那 7 个用 fixtures 的文件）；`hasDemoOverwrite` 少比一字段必须红；把 `recognized` 改成从行值反推必须红。
- [ ] **Step 9: 提交** — 三个提交：`feat(workbench): store 共享件（gscRowsSource / 快照来源 / hasDemoOverwrite / formatShare 导出）`、`feat(workbench): parseGsc 返回表头识别元数据`、`feat(workbench): 产物管线 hook 与围栏化 AI 包装句`。

## Task 5: 站点卡接真实 GSC 连接状态

**Files:** Create `shell/gsc-connection.ts` + `.test.ts`；Modify `shell/ShellChrome.tsx` + `ShellChrome.test.tsx`、`shell/WorkbenchShell.tsx`、`shell/SiteCard.tsx`（只加 title 提示）
**不改：** `shell/Sidebar.tsx`、`SiteCard.test.tsx`、`Sidebar.test.tsx` 的 `SITE` fixture——`SidebarSite.gscConnected` 保留，它的三态测试正是 Q3/Q4 的唯一渲染门（Claude #15）。server 侧输入改用 `Omit<SidebarSite, "gscConnected">`，`ShellChrome` 用 `site={{ ...site, gscConnected }}`。

- [ ] **Step 1: 纯函数先行** — `gscConnectionState({ sources, isLoading, isError })` → `true | false | null`，判据 Q3/Q4。测试覆盖 9 个 `SourceState` **逐个列出**、`id === null`、无 gsc 槽位、loading、error。
- [ ] **Step 2: 跑红再实现**。
- [ ] **Step 3: 接线** — `ShellChrome` 用 `useProjectSources(projectId)`（直接 import `@/lib/api/hooks-sources`，未从 barrel 导出）；`ShellChrome.test.tsx` 套 `QueryClientProvider`。
  - 已核实（2026-09-13，不必重推）：`ShellChrome.tsx:1` 是 `"use client"`，`WorkbenchShell.tsx` 是 server 组件且 `:54` 写死 `gscConnected: null`；`SiteCard.tsx:10` 的 `gscConnected: boolean | null` 三态分支已存在（`:44-46`）；`SourceConnection.id` 是 `string | null`、`state` 是 `SourceState`（`hooks-sources.ts:156-161`），Q3 判据可表达；`ApiError.code` 存在（`lib/api/client.ts:28`），Q4 按 `code` 分支可实现；`useProjectSources` 无自设 `staleTime`，吃 `app/providers.tsx:17` 的默认 `staleTime: 30_000`。
- [ ] **Step 4: 回归清单**（每项都跑）— `e2e/workbench-shell.mock.spec.ts`、`e2e/legacy-style-parity.mock.spec.ts`（**它装了 mock API**：`:66 installGrowthVerticalApi`，内含 `/sources` fixture——rev1 把它写成「不装」是错的）、`e2e/frontend-error-states.mock.spec.ts:226`（`expect.poll(() => sourceReads).toBe(3)` 精确计数）、`e2e/growth-map-run.mock.spec.ts:910-916`（`sourceReads.length` 恰好 +1）。后两条因为 `ShellChrome` 在每个项目页都订阅 `["sources", projectId]` 而可能变化（同 key + `staleTime: 30_000` 大概率去重，但未核实）→ 实测后如实记录。
- [ ] **Step 5: 变异** — `permission_denied` 挪到 `false` 必须红；error 分支返回 `false` 必须红。
  - **执行后修正（T5 交接，我原话判偏了两处）**：①「按 `code` 分支不按状态码分支」在**本任务里是空的**——站点卡的每一种失败都映射成 `null`，写出来的守卫两条臂都返回 `null`，正是恒真守卫那个形状。这条指令真正的落点是 **T10 的 `real-connections.ts`**（不同失败要出不同文案），别因为这里没写就在那里放松。T5 改为在接缝钉住：`ShellChrome.test.tsx` 只桩 `fetch`，让真实的 problem+json 走真实的 `ApiError` 与真实 `QueryClient`，断言格子读作「—」且**不是**「未接入」。②「error 分支返回 `false` 必须红」只有**一条**测试能抓到——新鲜失败时 `data === undefined`，两种写法行为相同，唯一可观测的差别是**失败的后台刷新仍持有旧列表**。那条用例是必需的，不是补充的。③`SiteCard` 的 `title` 提示对 `SiteCard.test.tsx` 的 `rows()`（读 `textContent`）不可见，所以门放在 `ShellChrome.test.tsx`，并另断言市场行与审计行**不带**这个提示（它点名一种具体成因，对那两种「没有」是假的）。
- [ ] **Step 6: 提交** — `feat(workbench): 侧栏站点卡接真实 GSC 连接状态（未知不等于未接入）`。

## Task 6: 概览视图 + 载入示例站点

**依赖：** T1、T2、T3（ConfirmDialog）、T4
**Files:** Create `views/overview/{OverviewView.tsx,next-steps.ts,LoadDemoButton.tsx}` + tests；Modify `app/p/[projectId]/overview/page.tsx`

- [ ] **Step 1: `next-steps.ts` 测试先行** — `overviewNextSteps(input)` → 有序步骤（id + ICU 参数 + 目标路由）。照 jsx:1104-1110，删结果承诺（Q16）、临界词跳 `keywords`（Q21）、兜底条件加 audit/visResults 判空。
- [ ] **Step 2: 四卡** — 值一律过 `statValue`（T2）：健康分 `audit?.score`、提及率 `formatShare`（没有结果 → `null`）、候选数 `keywordRowCount`、产物 `artifacts.length`（**0 照显示**）。「N 条来自 GSC」脚注数 `rows.filter(r => r.source === "gsc")`，示例标注**读 `gscRowsSource === "sample"`，不读 `state.demo`**（Q6）。
- [ ] **Step 3: 空态与骨架** — Q10 两档；空态里放 `LoadDemoButton`；框架容器带 `data-wb-frame`（Q30）。
- [ ] **Step 4: `LoadDemoButton`** — `hasDemoOverwrite(state)` 为真先开 `ConfirmDialog`（Q11）→ `await import("@/lib/workbench/mock/demo.ts")`（Q13）→ `makeDemoSite(profile, DEMO_LEVEL, [...DEMO_SEEDS], { now, provenanceLine })` → `dispatch(loadDemo)`。pending 闸防连点。
- [ ] **Step 5: 页面接线** — 渲染 `OverviewView`，**不得残留 `page="..."`**（`routes.fs.test.ts:62-71` 文本断言）；视图根按 Q26。
- [ ] **Step 5b: 钉住 ICU 参数顺序**（T1 交接）— 参数互换在消息目录里不可见（哨兵仍然都在，且两语种语序本就不同），必须在消费端断言渲染出的整句：`overview.subtitle`（`{domain} {brand} {market}`）与 `overview.cards.mention.foot`（`{hits} {total}`，互换会渲成「提及次数多于问答次数」）。用可区分的值，不要用相同数字。
- [ ] **Step 6: jsdom 测试** — 四卡四种状态（骨架 / 未跑 / 跑过 / 示例）；产物 0 件显示「0」；`next-steps` 每条分支；空项目**不弹**确认、有覆盖时弹、确认后 dispatch 一次（连点两次仍一次）；示例载入后再 `setGscRows(..., "user")` 时脚注**不带**示例标（Q6 的接缝钉子）；无 `style` 属性。
- [ ] **Step 7: 变异** — 产物计数改走 `selectCounts` 必须红；脚注改读 `state.demo` 必须红。
- [ ] **Step 8: 提交** — `feat(workbench): 概览视图与载入示例站点`。

## Task 7: 顶栏「清除示例」按钮

**依赖：** T1、T3
**Files:** Modify `shell/Topbar.tsx` + `Topbar.test.tsx`

- [ ] **Step 1: 测试先行** — `demo === false` 无按钮；`true` 有；点击开确认；确认文案**整句**包含 GSC 行 / 词库 / 产物筐 / 站点档案四项（不钉子串）；确认后 dispatch `clearDemo` 一次；不新增第二个 `role="status"`。
- [ ] **Step 2: 实现** — 按钮挂 `DemoChip` 旁，文案 `shell.clearSample`，确认用 portal 版 `ConfirmDialog`（Q32）；**移动端命中区 ≥44px 归本任务**（rev1 错放在 T13——那时按钮还不存在，且 T13 的 e2e 跑在 `demo === false` 的 fixture 上根本看不到它）。
- [ ] **Step 3: 跑 `Topbar.test.tsx` 与 `ShellChrome.test.tsx`；变异** — 删掉确认文案里的「产物筐」必须红。
- [ ] **Step 4: 提交** — `feat(workbench): 顶栏清除示例按钮与确认`。

## Task 8: 本周变化视图

**依赖：** T1-T4
**Files:** Create `views/week/{WeekView.tsx,week-feed.ts}` + tests；Create `lib/workbench/mock/builders/week.ts` + `week.test.ts`（周报 builder 在 mock 层，Q33）；Modify `app/p/[projectId]/week/page.tsx`

- [ ] **Step 1: `week-feed.ts` 测试先行** — `weekFeed(state, now)`：事件来自 `lastAudit` / `lastVis` / `profileDoc` / `kb` / 每件 artifact，过 `withinDays(at, 7, now)`，按 `at` 倒序；`artifactsWithinDays` 在此实现；提及率与事件从 `lastVis.results`（Q20）；KB 缺口用 `kbGapCount`；「较上次（{at}）」带出 `prev.at`。
- [ ] **Step 2: 三卡 + 摘要行 + 临界词清单** — 卡按 Q18（提及率卡的 delta 带单位：`deltaUnit="pt"`，`StatCard` 已在 T2 审阅后补上这个口，不要绕过原语自己渲 `Delta`）；三项挪进摘要行（`week.summaryRow.*`）；右栏按 Q17 是临界词清单 + 明确空态，**不得出现任何「排名变动」数字**。
- [ ] **Step 3: `weekly-report.ts`** — **只产正文，不盖章**（盖章在 `useAddArtifact`，Q23）；标题「检查结果变化」不是「修掉了什么」（Q16）；生成的修复任务另起一段标明是任务；行首插值过 `docText`；`module: "week"`、`engine: "both"`、`filename: "weekly.md"`；删掉 jsx 的排名承诺与「被引用率最高」，「修复任务已经在产物里」改按 `artifacts.some(...)` 分支，「N 个提问没提到你」改按平台口径。
- [ ] **Step 4: 页面级空态** — 全空时不渲六个 0，**禁用「存周报」**。
- [ ] **Step 4b: 钉住 ICU 参数顺序**（T1 交接）— 在消费端断言整句：`week.subtitle`（`{from} {to}`）、`week.cards.health.foot`（`{fixed} {added}`）、`week.cards.mention.foot`（`{hits} {total}`）。用可区分的值。
- [ ] **Step 5: jsdom 测试 + 变异** — feed 窗口边界（恰好 7 天、未来时间被排除）；全空空态；最终产物文本恰好一处来源声明。**变异方式是往生成结果里逐条插入禁用句（「实测」「已修复」「进前十」等），每插一条未改动的测试必须红**——rev1 写的「删掉断言必须红」在方法上不成立（删断言只会让测试更弱且照样绿）。
- [ ] **Step 6: 提交** — `feat(workbench): 本周变化视图与周报产物`。

## Task 9: 站点档案视图

**依赖：** T1-T4
**Files:** Create `views/profile/{ProfileView.tsx,ProfileInputPane.tsx,ProfileDocTab.tsx,ProfileJsonTab.tsx,ProfileContextTab.tsx,build-profile-doc.ts}` + tests；Modify `app/p/[projectId]/profile/page.tsx`

- [ ] **Step 1: `build-profile-doc.ts` 测试先行** — 签名 `buildProfileDoc({ profile, gscRows, gscRowsSource, lastAudit, srcs, now })`（**收 `now: Date` 在纯函数内 `formatLocalStamp`**；rev1 的签名收 `at` 却在说明里用 `now`，照抄是未定义标识符，codex #7）。**开关必须真的有效**（codex #6）：`srcs.crawl === false` → `crawl: null`；`srcs.gsc === false` → `gsc: null`；`srcs.third === false` → `third: null`；开启才调对应 builder。`third` 用 `crawlSignals(profile, "third")`（**不得复用 crawl 对象**）；`gscSource` 从入参冻进快照（Q6）。
- [ ] **Step 2: 输入面板** — `url / brand / market` 只读文本；`positioning / features / competitors` 受控 + `patchProfile`；三个来源开关（**删掉 `ai` 开关**，`ProfileDoc.ai` 非空且没有 LLM）；步骤文案明说本地生成（Q16），逻辑不绑下标。
- [ ] **Step 3: 运行归属与不清空** — 生成时不动 `profileDoc`，完成时一次性写（Q14）；runToken + projectId 归属。
- [ ] **Step 4: 三个 tab + 动作** — `profileDocMarkdown`（传快照 `gscSource`）/ `profileJson` / `profileContextPrompt`；四个动作走 `ArtifactActions`（Q23）。
- [ ] **Step 4b: `profileContextPrompt` 的 `sampleData` 要跟着来源**（T4 交接的已知缺口）— 它现在写死 `sampleData: true`，用户自己导入的真实行在 AI 上下文块里被宣告成示例。改为读快照的 `gscSource`（与 `profileDocMarkdown` 同一来源，不新增参数、不让调用方传可能矛盾的值）；prompt 的数据契约随之更新，配「user 来源不宣告示例」「sample 来源仍宣告」两条用例与一次变异（写死 true 必须红）。方向保守不等于不是假话——Q6 管的是「关于用户数据的陈述」。
- [ ] **Step 5: 空值与文案** — `GscSignals` 计数可空：用 `countText` 口径显示「—」，**不得渲染出「 / 」半句**；「可收录约」「样本页」（P5/P6）；删「AI 归纳失败」橙框（Q15）与无条件结论句（Q16）；框架容器 `data-wb-frame`。
- [ ] **Step 6: jsdom 测试 + 变异** — 三个开关各自关闭 → 对应字段 `null` 且该列整块缺席（**从开关状态走到文档构造与渲染**，不许手写文档）；只读三项不可编辑；生成中旧档案仍在；示例来源与用户来源的 GSC 小节标注差异。变异：把某个开关改成无条件调 builder 必须红；把「完成时一次性写」改回「开跑先清空」必须红。
- [ ] **Step 7: 提交** — `feat(workbench): 站点档案视图`。

## Task 10: 数据源视图

**依赖：** T1-T5
**Files:** Create `views/data-sources/{DataSourcesView.tsx,DataSourcesPanel.tsx,GscImportPane.tsx,GscRowsTable.tsx,real-connections.ts}` + tests；Modify `app/p/[projectId]/data-sources/page.tsx`

- [ ] **Step 1: `real-connections.ts` 测试先行** — 把 `useProjectSources` 的响应映射成只读展示模型（GSC / GA4 各自 `connected | notConnected | unknown` + `state` + 最新 snapshot 的 `availability / capturedAt / rowCount / limitation`）。失败态**按 `ApiError.code` 判别**：`CONTEXT_INCOMPLETE` → 「需先确认产品档案」+ `/context`；其他失败 → 中性文案不点名成因（Q4）。无 connect/disconnect 动作。
- [ ] **Step 2: 真实与本地两区** — 上区「真实连接」（只读 + 指向旧页 `sources` 的链接）；下区**「GSC 导入（保存在这个浏览器）」**——rev1 把它叫「示例导入」并挂无条件 `DemoChip`，而这一区唯一的动作是导入用户自己的数据，是无条件的假标注（codex #4）。示例标注只跟着 `gscRowsSource === "sample"` 出现。删「每日 06:00 同步」与 GA4 403 红框（Q15）；GA4 区块明说当前没有模块使用 GA4 数据。
- [ ] **Step 3: 导入面板** — 粘贴 + 上传（无假授权、无「填入示例」，Q5）；`parseGsc` → `setGscRows(rows, "user")`；结果显示「解析 N 条 / 跳过 M 条」+ **按 `recognized` 点名未识别的列**（Q7，不从行值反推）；上传上限（Q8）；「清空」要确认。
- [ ] **Step 4: 行表** — 前 60 行 + 「显示前 60 / 共 N」；空值「—」；状态 chip 查 `workbench.enums.gscStatus`，`unknown` 用中性 chip，摘要写**「N 条排名未知」**（不是「N 条无排名」——那是把缺证据说成观测到的负结果，codex #5）。
- [ ] **Step 4b: 钉住 ICU 参数顺序**（T1 交接）— 在消费端断言整句：`dataSources.import.truncated`（`{kept} {total}`）、`dataSources.table.showing`（`{shown} {total}`，互换会渲成「显示前 402 条，共 401 条」）。用可区分的值。
- [ ] **Step 5: `DataSourcesPanel`** — 数据源页与设置页共用的只读摘要块（T11 消费）。
- [ ] **Step 6: jsdom 测试 + 变异** — skipped 三条（0 / 有 / 部分识别点名列）；**「列可识别但单元格全空」不得报成未识别**；超大文件与超行数；用户导入后区块标题与周边标注**不含**示例字样（Q6 接缝）；框架容器 `data-wb-frame`。变异：把 `gscRowsSource` 判定改成恒 `sample` 必须红；把 422 分支改成只看状态码必须红。
- [ ] **Step 7: 提交** — `feat(workbench): 数据源视图（真实连接只读 + 本地导入）`。

## Task 11: 设置页补齐

**依赖：** T1、T3、T4、T10
**Files:** Create `views/settings/{NotifyBlock.tsx,SourcesSummaryBlock.tsx}` + tests；Modify `views/settings/SettingsView.tsx` + `SettingsView.test.tsx`

- [ ] **Step 1: 处置两条既有契约测试**（Claude #18）— `SettingsView.test.tsx:70-76` 断言页面含 `inProgressNoLegacy`（本任务要删这句）、`:78-84` 断言页面**没有**任何 `sampleData/sampleSite/sampleTitle`（本任务要给通知块加 `DemoChip`）。**不许整条删**：把 no-chip 断言**收窄到 `[data-wb-real-action]` 子树**（真实操作块内不得出现任何示例标记），并新增「通知块内必须有 DemoChip」。
- [ ] **Step 2: `NotifyBlock`** — 四个 `Toggle`（`setNotify` 收整份：`{...state.notify, weekly: next}`）+ 「偏好只保存在这个浏览器，当前不会发送任何通知」+ `DemoChip`；未 hydrate 时 disabled 或骨架（不渲成「全关」）。
- [ ] **Step 3: `SourcesSummaryBlock`** — 只读摘要（复用 T10 的 `DataSourcesPanel`）+ 两个链接；不放 OAuth 动作；页面 `[data-wb-real-action]` 仍**恰好 1 个**。
- [ ] **Step 4: 删占位句** — 去掉 `inProgressNoLegacy`；`DeleteProjectSection` 原样不动。
- [ ] **Step 5: 变异** — 删掉「不会发送任何通知」这句必须红（承诺性文案每句都要做删除变异）。
- [ ] **Step 6: 提交** — `feat(workbench): 设置页通知偏好与数据源摘要`。

## Task 12: PR-1 遗留 A（字体与 workbench.css 挂到项目 layout）

**Files:** Modify `app/layout.tsx`、`app/p/[projectId]/layout.tsx`、`app/workbench.css`、`app/workbench-css.test.ts`、**`app/workbench-tokens.test.ts`**、`e2e/legacy-style-parity.mock.spec.ts`

- [ ] **Step 1: 先修两处会被 `@theme inline` 打红的正则**（Claude #3）— `workbench-tokens.test.ts:113` 的 `atRuleBody(css, /@theme\s*\{/u)` 在找不到时 **throw**；`workbench-css.test.ts:43` 同形失败。两处改成 `/@theme(?:\s+inline)?\s*\{/`。同时把 `workbench-css.test.ts:38` 的空洞断言（只查 `--font-sans: var(--font-wb…)` 字面）改成能区分 inline 与否。
- [ ] **Step 2: 移动** — `import "./workbench.css"` 与 `Plus_Jakarta_Sans` 实例移到 `p/[projectId]/layout.tsx`，字体变量类挂在项目 layout 最外层元素。
- [ ] **Step 3: `@theme inline`** — `@theme` 在 `:root` 就完成变量替换，变量类离开 `<html>` 后 `font-sans` 会**静默**退回 fallback。
- [ ] **Step 4: 断点逐条比对** — `workbench.css:73-91` 的 `#main-content:not(:has(> .wb-reset))` 两档断点 vs `app-shell.module.css:450+` 的媒体查询，逐属性核对后再下「无计算样式变化」的结论。
- [ ] **Step 5: 测试** — 跑 `workbench-css.test.ts` **与 `workbench-tokens.test.ts`**；新增 e2e：壳内元素 computed `font-family` 含 `Plus Jakarta`、`/login` 不下载工作台 CSS chunk 与字体 preload、`/new-project` 的 `#main-content` padding-left 与 max-width 不变（单独一条 test，不塞进基线 JSON）。
- [ ] **Step 6: 变异** — `@theme inline` 改回 `@theme` 必须红；CSS import 挪回根 layout 必须红。
- [ ] **Step 7: 提交** — `fix(workbench): 字体与工作台 CSS 只挂项目 layout（@theme inline 防静默回退）`。

## Task 13: PR-1 遗留 B（触控目标）与 C（⌘K 提示）

**Files:** Modify `shell/ArtifactDrawer.tsx`、`shell/Topbar.tsx`、`shell/SignOutButton.tsx`、`shell/Sidebar.tsx` + `Sidebar.test.tsx`、`ui/LegacyLinks.tsx`；Create `hooks/useShortcutLabel.ts` + test；Modify `packages/i18n/src/messages/{en,zh-CN}.json`（**只改 `shortcutHint` 一个键**）、`e2e/workbench-shell.mock.spec.ts`

- [ ] **Step 1: 触控** — `ArtifactDrawer.tsx:159-181` 三个文字按钮加 `-m-1 p-1`；`:136-139` 关闭按钮 `p-1`→`p-1.5`；`Topbar.tsx:75-84` 的「+ 新建站点」与 `ui/LegacyLinks.tsx:24-32` 的旧版链接也是 `text-xs` 裸链接（≈16px，rev1 只盘点了 button）→ 一并处理；移动端汉堡与产物筐按钮提到 44px。**「清除示例」按钮的 44px 归 T7**。
- [ ] **Step 2: 触控的门** — 现有 axe 只到 `wcag21aa`，`target-size` 属 `wcag22aa`，这条检查现在是瞎的。在 `e2e/workbench-shell.mock.spec.ts` 遍历壳内 `button, a[href]` 量 `boundingBox()` 断言两边 ≥24；**作用域与豁免要写成带计数的具名清单**（WCAG 2.5.8 的「句中行内链接」豁免、`md:`-only 元素在移动端 `boundingBox()` 返回 `null` 要跳过并单独断言「被跳过的正好是这 N 个」）。
- [ ] **Step 3: ⌘K** — `useShortcutLabel()` 用 `useSyncExternalStore`（server snapshot 固定 `⌘K`）；平台判定**要自己写窄的局部结构类型**（`navigator.userAgentData` 不在标准 DOM typings 里，全仓也没有扩展——已核实 0 命中），保留 `navigator.platform` 兜底，不用 `any`。`shortcutHint` 改 ICU `{key}` **与两个消费点（`Topbar.tsx:93-95` 的 `<kbd>`、`Sidebar.tsx:151`）同一提交落地**，并同步改 `Sidebar.test.tsx:232`（它断言的是原始消息串）。
- [ ] **Step 4: 测试 + 变异** — 两条 jsdom（伪造 mac / 非 mac，**钉整句**插值结果）；label 改回硬编码必须红；删掉某按钮的 `-m-1 p-1` 必须让 Step 2 的 e2e 红。
- [ ] **Step 5: 提交** — 两个提交：`fix(workbench): 抽屉与裸链接的触控目标`、`fix(workbench): 快捷键提示按平台显示`。
- [ ] **Step 6: Q35 的文件搬家**（第三个提交）— 把 `ArtifactDrawer.tsx:15-55` 的 `downloadName` 与 `MIME`/`EXT` 表移到 `lib/workbench/artifact-file.ts`（连同它的测试），抽屉与 `ui/ArtifactActions.tsx` 都改从那里 import，删掉 `ArtifactActions.tsx` 里临时复制的 4 行 mime 表与那条 `ui → shell` 的 import。两张表都是按 `ArtifactType` 穷举的 `Readonly<Record<…>>`，加第五种产物类型会同时编译失败——搬家后这个性质要保住。提交：`refactor(workbench): 产物文件名与 MIME 归入 lib`。

**T13 交接（执行后修正，三条）：**

- **Q29 点名的第三个空洞门不是 T13 的**：「快捷键那条用模块级常量对象绕过 memo 契约」指的是 `shell/useGlobalShortcut.test.tsx:14`（`handlers` 在模块作用域，从不以新身份重渲），那是 PR-1 遗留 **F** = **T15 Step 2**，其 Files 已含这两个文件。遗留 C（⌘K 提示）原本**根本没有门**，不是门空洞。T15 接手时要知道这条；把门和 latest-ref 实现分开做会让它的变异无法验证。
- **触控目标用 `-my-1 py-1` 不用 `-m-1 p-1`**：实测每个不合格目标的宽度都已 ≥31px，只有 16px 的高度不合格；`-mx-1` 会把相邻命中区之间肉眼可见的 12px 间隙压到 4px，对 WCAG 没有任何收益。纵向扩张保持外边距盒不变，版面不动。
- **命中区清扫抓到一个枚举式修法抓不到的**：抽屉头部的「清除全部」（`44.7x16`）不在计划点名的 `:159-181` / `:136-139` 两段里，但同样不合格。这就是 Q29 要求「清扫而不是列清单」的理由。

## Task 14: PR-1 遗留 D（Tailwind `source(none)`）

**依赖：** T12（**必须在 T12 之后**：T12 给项目 layout 加的类名会被 `source(none)` 静默丢掉）
**Files:** Modify `app/workbench.css`、`app/workbench-css.test.ts`；Create `app/tailwind-source-scope.test.ts`

- [ ] **Step 1: 实现** — `@import "tailwindcss/utilities.css" layer(utilities) source(none);` + `@source "../components/workbench";`。**若 T12 之后 `app/p/[projectId]/layout.tsx` 写了 Tailwind 类名，`@source` 必须一并覆盖它**（或把类名收进 `components/workbench`）。
- [ ] **Step 2: 不靠文件清单的护栏** — 遍历 `apps/web/src/**/*.tsx`（排除 test，**含 `app/**`**），把 `className` 字面量里的 Tailwind 形态 token 提出来，若某文件有这类 token 而目录不在 `@source` 覆盖范围内则红。
- [ ] **Step 3: 证明扫描没被整体关掉** — 在 T19 的生产冒烟里对构建 CSS grep 一个**只**在 `components/workbench` 出现的 utility。
- [ ] **Step 4: 旧页回归** — 改动前后各跑一次 `e2e/legacy-style-parity.mock.spec.ts`，并人工看一眼 `/new-project` 与 `/login`（该基线只采样 2 屏 × 5-6 元素，它的绿不是证明）。
- [ ] **Step 5: 提交** — `perf(workbench): Tailwind 扫描范围收到 components/workbench`。

## Task 15: PR-1 遗留 E（AppShell 死变体）与 F（useGlobalShortcut 重订阅）

**Files:** Modify `components/app-shell/AppShell.tsx`；Modify `shell/useGlobalShortcut.ts` + `useGlobalShortcut.test.tsx`

- [ ] **Step 1: E** — 删 `state:"project"` 分支与只服务它的两个 prop；保留 `state` 属性本身（`data-app-shell-state` 被 `e2e/new-project-shell.mock.spec.ts:33` 断言）；**`AppShell.tsx:115-127` 的 `state === "empty-project" ? … : <Link href="/new-project">` 分支在联合收窄后也变成死代码（TS 不会报错）→ 一并删或写明为何保留**；不要连带删 `app-shell.module.css` 的 `.sidebarUtility`。
- [ ] **Step 2: F** — latest-ref：`const ref = useRef(handlers); ref.current = handlers;` + effect 依赖 `[]`。
- [ ] **Step 3: F 的测试 + 变异** — 宿主组件用**内联** handlers 重渲染 3 次，`addEventListener("keydown")` 只调用一次且第 3 次的 handler 能收到事件；**把依赖改回 `[handlers]` 必须红**（现有测试用模块级常量绕过了契约）。
- [ ] **Step 4: 提交** — 两个提交：`refactor(app-shell): 删除无消费者的 project 变体`、`fix(workbench): 全局快捷键改 latest-ref 不再重订阅`。

## Task 16: 导入图护栏扩到组件

**Files:** Modify `apps/web/src/lib/workbench/store/client-import-graph.test.ts`

- [ ] **Step 1: 扩入口** — `CLIENT_ENTRIES` 加入五个视图根 + `ShellChrome`（walker 支持 `@/` 与 `.tsx`；对无法解析的本地 specifier 会抛错，加入前确认相对 import 都带扩展名）。
- [ ] **Step 2: 控制用例只用 fixture 形式** — 建一个形如视图的临时文件静态 `import` `@/lib/workbench/mock/demo.ts`，走同一套 `reachableFrom` + `isClientForbidden` 断言它被抓到。**不要**用「直接断言 `isClientForbidden("mock/demo.ts")`」——`:130` 已有这条，它与「视图入口是否真的被 walk」无关，是恒真的派生式护栏。
- [ ] **Step 3: 变异** — 把 T6 的动态 import 临时改成静态必须红，改回。
- [ ] **Step 4: 提交** — `test(workbench): 客户端导入图护栏覆盖视图入口`。

## Task 17: mock e2e 与受影响 spec（**路径在仓库根 `e2e/`**）

**Files:** Create `e2e/workbench-pr3-flow.mock.spec.ts`；Modify `e2e/workbench-shell.mock.spec.ts`、`e2e/legacy-style-parity.mock.spec.ts`、`e2e/mobile-shell.mock.spec.ts`（如需）

- [ ] **Step 1: 模块流** — 载入示例站点 →（视条件确认）→ 概览四卡非空且带「示例」→ 顶栏「清除示例」→ 确认 → 回空态。顺带量一次「清除示例」按钮的 `boundingBox()`（T7 的 44px 只有这里能测到）。
- [ ] **Step 2: 降级门**（Claude #7）— 新增一条：`page.route("**/sources", r => r.fulfill({status: 500}))` 后站点卡显示「—」、页面无 error boundary、console 无未捕获异常。rev1 以为 `legacy-style-parity` 不装 mock API 所以「天然覆盖」，实际它装了（`:66`），这条门原本不存在。
- [ ] **Step 3: Q30 的框架断言** — 先正向断言五个视图各有 `[data-wb-frame]` 且合并文本非空，再断言 en 下无中文、无 `workbench.` 路径；加「往框架文案插中文必须红」的变异。
- [ ] **Step 4: 逐条核对既有断言**（清单见 research-seams §5.3，已逐条核实属实）— h1 文本严格相等；`/overview` 的 `[data-wb-badge]` 计数 0；顶栏唯一 `role="status"`；`[data-app-shell]` 内 0 个 `[style]`；Dialog 根恰好 1；`/settings` 的 `[data-wb-real-action]` 恰好 1；`mobile-shell` 390px 无横向溢出 + `progressbar` 计数 0；`frontend-error-states:226` 与 `growth-map-run:910-916` 的 `/sources` 精确计数。
- [ ] **Step 4b: 视图内的触控目标**（T3 交接）— T13 Step 2 的 `boundingBox()` 清扫只覆盖壳；视图里的按钮、tab、开关一个都没量过，而 jsdom 那条「穿着 panel.ts 常量」的钉子只是代理（清扫看不见组件内写死的尺寸）。把同一套遍历扩到五个视图，豁免同样写成带计数的具名清单。
- [ ] **Step 4c: Q34 的接缝**（T3 交接）— 在跑起来的页面上断言：每个 `[aria-controls]` 的值都能 `document.getElementById` 到元素。jsdom 侧的门在 `OutPane.test.tsx`，这里是真浏览器的复核。
- [ ] **Step 5: parity 覆盖五个段名**（Claude #22）— `legacy-style-parity.mock.spec.ts:105-127` 现在只钉 `/overview` 的 `paddingLeft === "0px"`，改成对五个段名循环（不动基线 JSON）。
- [ ] **Step 6: 跑法** — `pnpm test:e2e:mock e2e/<file>`（不带 `--`）；端口 3200 固定、`reuseExistingServer: false`。**「并行另跑一套用 `E2E_MOCK_PORT=3201`」是错的**（T5 与 T13 各自撞了一次，症状是 `ERR_EMPTY_RESPONSE` / `ECONNREFUSED` 与 `.next-e2e-mock` 里 `Cannot find module './vendor-chunks/…'`）：`playwright.mock.config.ts` 把 `NEXT_DIST_DIR` 硬写成 `.next-e2e-mock`，换端口不换 dist 目录，两次并行跑会互相毁掉构建产物。**本任务顺手修掉它**：`NEXT_DIST_DIR` 按端口派生（`.next-e2e-mock-${PORT}`），让并行 lane 真的成立；在此之前只能串行跑，或像 T13 那样在 scratchpad 里放一份自带端口与 dist 目录的配置副本。
- [ ] **Step 6b: 合并后重跑**（T5 交接）— T5 的隔离 worktree 停在 `a2f26e60`，**没有跑过 T13 后加进 `workbench-shell.mock.spec.ts` 的两条**；反过来 T13 的清扫是在 T5 的 `ShellChrome`/`SiteCard` 已在树上时量的。两边各自绿不等于合起来绿，本任务必须在合并后的树上把四条 spec 整体重跑一遍。
- [ ] **Step 7: 提交** — `test(workbench): PR-3 模块流、降级门与受影响 spec`。

## Task 18: 文档同步

**Files:** Modify `docs/plans/2026-09-11-workbench-ui-port-design.md`、`docs/plans/2026-09-13-workbench-pr2-mock-domain.md`（只改残留表归属）、`docs/PROGRESS.md`、本计划残留表

- [ ] **Step 1: 设计稿逐条修订**（codex #19：rev1 漏了 §5 与 §6.7，会让下一个工程师把修法改回去）— §4.1 原语清单补五个新原语 + `hooks/`；**§5 改掉「根 layout import workbench.css」与 `@theme` 的写法**（Q29-A / T12）；§6.1 补 `gscRowsSource`、`ProfileDoc.gscSource` 与 `conns` 死字段裁决（Q31）；§6.5 补第四、第五项发布前豁免；**§6.7 更新示例站点条目**（覆盖确认按 `hasDemoOverwrite` 的按值判据、清除确认文案四项、`demo.ts` 动态 import）；§10 补 Q19 与「入场动画不移植」；§12 补 Q5/Q6/Q17/Q18；§14 追加 PR-3 评审处置段（含计划评审 45 条）。
- [ ] **Step 2: PR-2 计划残留表** — :1011/:1012 归 PR-4（Q28）；:1020 按 Q27 关闭并写依据；:1017/:1018/:1019/:1023 标「PR-3 已处理」。
- [ ] **Step 3: PROGRESS.md** — PR-3 段：范围、五视图、遗留六项已关闭、验证数字（T19 回填）、未上生产。
- [ ] **Step 4: 提交** — `docs(workbench): 设计稿与进度同步 PR-3 裁决`。

## Task 19: 验证与交付

- [ ] **Step 1: 静态四项** — `pnpm typecheck`、`pnpm lint`、`pnpm typecheck:e2e`、`pnpm lint:e2e`。
- [ ] **Step 2: 全量单测** — `pnpm test`（= `vitest run --project unit`）；只允许 `apps/marketing/e2e/geo-kb-v2-fixtures.test.ts` 的 4 个基线失败。
- [ ] **Step 3: 覆盖率** — **`pnpm vitest run --project unit --coverage`**（不带 `--project` 会连 integration 一起跑，无可丢弃 loopback `DATABASE_URL` 时 fail-fast；全局 80% 门属 CI 的 database job）。**先独立断言本 PR 每个生产文件都出现在覆盖率报告里**（vitest 4 只统计被加载的文件，没被任何测试加载的新视图会整个缺席、低覆盖清单发现不了），再按文件读 `lib/workbench/**` 与 `components/workbench/**` 的数字。`scripts/report-unit-coverage-gaps.mjs` 的 include 不含 `.tsx`，那份报告不能当新视图的覆盖证据。
- [ ] **Step 4: 构建与纯度** — `pnpm --filter @sf/web build`；grep `lib/workbench/mock` 无 `Date.now` / `Math.random` / React / next-intl / `@sf/*`；grep `components/workbench` 无 `style={{` 与 `<style`；grep 无裸 hex。
- [ ] **Step 5: mock e2e** — `workbench-pr3-flow`、`workbench-shell`、`legacy-style-parity`、`mobile-shell`、`critical-flows`、`frontend-error-states`、`growth-map-run`、`new-project-shell` 全绿。
- [ ] **Step 6: 生产冒烟（范围要如实写）** — `pnpm --filter @sf/web build` 后 `pnpm --filter @sf/web exec next start --port 3300`（占位环境变量，生产模式 `SUPABASE_URL` 必须 https），打开 `/login`：CSP 头无 `unsafe-inline`、脚本与样式带 nonce、console 无 CSP 违规。**已认证的工作台页在生产模式下没有 fixture（e2e 旁路是 dev-only），因此不在冒烟覆盖范围内——这是已知缺口，不得写成「工作台页 CSP 已验证」**（codex #15）。改用构建产物断言覆盖另两件事：①`mock/demo.ts` 在独立 chunk 里、不在概览首屏 JS；②`/login` 的 client-reference-manifest 不引用工作台 CSS 与字体；③T14 的扫描范围（grep 构建 CSS 里只属于 `components/workbench` 的 utility）。
- [ ] **Step 7: 跨模型评审** — gpt-6-astra reasoning high，按面拆（每面一个攻击面 + ≤4 个上下文文件，diff 落成文件，明令不要广泛 grep；被调函数的定义文件必须在清单里）。三面：①诚实性（概览 / 本周 / 档案的文案与空态）②真实与示例的分区（站点卡三态、数据源、`gscRowsSource` 与快照 `gscSource` 的**所有**读点）③a11y 与 CSP（原语焦点/aria、portal 确认框、触控、无 inline style）。判据是 verdict 行；必须读它标 unresolved 的段落。逐条裁决并回写设计稿 §14。
- [ ] **Step 8: 交付** — `git branch --show-current` = `feat/workbench-pr3-first-views`；`git push -u origin feat/workbench-pr3-first-views:feat/workbench-pr3-first-views`；`git rev-parse origin/...` == HEAD；`gh pr create --base feat/workbench-ui-port`，描述含范围、Q1-Q32 摘要、验证数字（在最终 HEAD 上跑的）、遗留六项的关闭证据与变异验证、生产冒烟的**范围与已知缺口**、评审处置、残留表；结尾 `🤖 Generated with [Claude Code](https://claude.com/claude-code)`。

---

## 不在本 PR（残留与去向）

| 项 | 去向 |
|---|---|
| 关键词研究 / 词库 / 竞品概览 / 技术审计 / AI 可见度 | PR-4 |
| 内容生成 / 事实知识库 / 答案页 / 外链 / 产物中心 | PR-5 |
| `ui/Gauge`（`<progress>` + `data-tone` 规则已在 `workbench.css`，本 PR 无消费者） | PR-4（技术审计） |
| 竞品域名总览 CSV 表头 `domain`；缺口表 `ours === null` 必须渲染「—/未知」不能用原型的「无」 | PR-4（Q28 归属修正，判据在此交接） |
| 真正的「排名变动」：需要关键词排名历史（两次以上 GSC 导入 + 持久化形状变更，要升 `PERSISTED_VERSION`） | 后续 PR（Q17） |
| `conns` 死字段的删除（删除要升 `PERSISTED_VERSION`） | 下一次持久化形状变更（Q31） |
| `visPartial` 的 UI 消费与写盘 debounce | PR-4 |
| 运行租约 / 跨标签运行归属（写盘边界的毫秒级窗口已接受风险） | PR-4 |
| 真实 OAuth 连接 / 断开仍在旧页 `sources`（回调重定向硬编码 `/p/{id}/sources`） | 接真实数据的批次 |
| 生产模式下已认证工作台页的 CSP / 字体 / 动态 chunk 运行时验证（缺生产 fixture） | 需要时另立项（Q19 Step 6 已如实记录为缺口） |
| 示例 GSC 词表对任何行业都一样 | 按行业派生另议；本 PR 用来源标记如实标注 |
| `ArtifactType` 缺 `txt`、CSV 下载 BOM、关键词 CSV 行数上限 | PR-4 / PR-5（PR-2 R17） |
| 集成分支合 main 前要 rebase | PR-3b |
| **顶栏左侧在 390px 下装不下**（T13 实测）：汉堡按钮改用 `h-11 w-11` 后量出 **0x44**——`.wb-reset` 的 `svg { max-width: 100% }` 让按钮的 min-content 宽度为 0，flex 把唯一能压的那一项压到了零。`shrink-0` 修掉了症状，**溢出本身还在**，占地的是项目切换器。注意 `mobile-shell` 那条「390px 无横向溢出」正是**靠把一个控件压成零宽**才满足的——门通过了，理由是错的；现在 T13 的命中区清扫（宽高都 ≥24）会抓住同类复发 | PR-4（布局），判据与证据在此交接 |
| **营销站的 `copyFailed` 与本仓 Q4 口径相反**：`apps/marketing/src/i18n/content-draft-messages.test.tsx:106-109` 用整句 `toBe` 钉死「浏览器拒绝了剪贴板访问，请检查权限后重试。」/ "The browser refused clipboard access…"。同一个 catch 也会在非安全上下文、文档失焦、策略拦截、手势过期时触发，所以那句在多数成因下是假话；而它是**必需型 pin**，任何改诚实的改写都会红（记忆 required-pins-can-mandate-a-lie）。修法要连 pin 的形状一起改：钉指令半句 + 成因词黑名单 | 另一个面、另一批用户，单开一条，不塞进 PR-3（T1b 发现） |
