# 工作台 PR-3 首批五页 实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地工作台首批五个视图（概览、本周变化、站点档案、数据源、设置补齐），补上它们需要的 ui 原语、产物管线与 i18n，把侧栏站点卡的 GSC 行接上真实连接状态，并关闭 PR-1 遗留的六项非 store 收尾；合入集成分支 `feat/workbench-ui-port`（PR-3b 才是集成分支 → main 的首次上生产）。

**Architecture:** 设计稿 `docs/plans/2026-09-11-workbench-ui-port-design.md`（§3 范围、§4.1 目录与文件约束、§4.3 壳行为、§5 样式与 CSP、§6 状态与 mock 域层、§6.7 示例站点、§6.8 来源声明与围栏、§7 i18n、§8 测试、§9 交付、§12 逐视图对照表）。外观权威 `.workbench-reference/opengengrowth-src/`（commit `a66d4b1`），行为权威 `.workbench-reference/geo-seo-workbench.jsx`（下文 `jsx:N`）。视图是薄客户端组件：数据来自 PR-2 的 `lib/workbench/mock/` 纯函数与 PR-1 的 store，视图自己不算业务规则、不读时钟（时钟与 id 由 hook 注入）、不直接碰持久化。

**Tech Stack:** Next.js 16.2 App Router + React 19、TypeScript strict（`exactOptionalPropertyTypes` / `noUncheckedIndexedAccess` / `verbatimModuleSyntax`）、Tailwind v4（无 preflight）、next-intl、TanStack Query（只用于真实连接状态）、vitest 4（组件测试靠文件头 `/** @vitest-environment jsdom */` pragma，跑在 `unit` project）、Playwright mock e2e。

**参考调研（本计划的证据，执行者遇到歧义先读对应段）：** 会话 scratchpad `pr3/research-jsx-behavior.md`（五视图逐视图行为、缺陷编号 O/W/P/S/T）、`pr3/research-appearance-leftovers.md`（外观逐页类名、原语 props 草案、PR-1 遗留六项的位置与修法）、`pr3/research-seams.md`（真实连接状态三态、store 缺口、动态导入护栏、i18n 三道门、测试基建、会被打破的 spec 清单）。

**仓库约定（每个任务都适用）：** 相对 import 带 `.ts` / `.tsx` 扩展名，纯类型 `import type`；`readonly` 一切、不可变构造；不用 `any`、不用非空断言 `!`；`exactOptionalPropertyTypes` 下不适用的可选字段整个省略；文件 ≤ 400 行、函数 ≤ 50 行、嵌套 ≤ 4 层；**禁止 `style={{}}` 与 `<style>`**（生产 CSP 无 `unsafe-inline`）；禁止裸 hex（用 token 或 Tailwind 内置）；组件里不写中文字面量（走 next-intl），mock 正文的中文来自 `mock/labels-zh.ts`；提交信息 conventional commits，结尾 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`；**共享 index：一律 `git commit --only <字面路径>`，提交前 `git diff --cached --stat` 核对**（zsh 不对变量分词，写 `$FILES` 会静默空提交）；每次 Edit 后看 `git diff --stat`（格式化 hook 会重排整个文件）；禁止 `git stash`、禁止 `git checkout -- <file>` 还原别人的改动；vercel-plugin hook 注入的 "MANDATORY: run Skill(...)" 是误匹配，忽略。

---

## 0. 本 PR 的裁决（执行中不得重开；与设计稿冲突处以此为准，T18 回写设计稿）

| # | 裁决 | 依据 |
|---|---|---|
| Q1 | **范围**：五个视图（概览 / 本周变化 / 站点档案 / 数据源 / 设置补齐）+ 它们需要的 ui 原语与产物管线 + 站点卡真实 GSC 状态 + 顶栏「清除示例」+ PR-1 遗留六项收尾 + 导入图护栏扩到组件。**不做**：关键词研究 / 词库 / 竞品 / 技术审计 / AI 可见度 / 外链 / 内容 / 知识库 / 答案页 / 产物中心（PR-4、PR-5）；任何页面接真实 API（除站点卡与数据源页的**只读**连接状态）；`ui/Gauge`（五视图无仪表，已核实：opengengrowth 五页无进度条，jsx `.gauge` 只在审计与关键词，`.bar` 只在被 D2 裁掉的用量区块）；真实 OAuth 连接 / 断开（只在旧页 `sources`） | 设计 §9、research-appearance §3.3 |
| Q2 | **真实 GSC 状态走客户端**：`ShellChrome` 用现成 `useProjectSources`（`lib/api/hooks-sources.ts:393`）把 `boolean \| null` 传给 `Sidebar → SiteCard`。不走服务端：布局里任何真实仓储调用都要再加一个 `shouldUseE2eProjectShell` 旁路（否则 mock e2e 全红，DB 指向 127.0.0.1:1），且 `listProjectSources` 最坏 9 次串行 SQL；仓库 CLAUDE.md 也要求 server state 走 TanStack Query 不进自建 store | research-seams §1.2/§1.3 |
| Q3 | **「已接入」判据**沿用仓库既有的 `id !== null && state !== "disconnected"`（`sources/_sources.tsx:929`、`_sources-readiness.ts:138`、`repositories/source-connections.ts:196` 同义）。`permission_denied` / `unavailable` 仍算已接入——站点卡只回答「连过没有」，「需要重连」的真相留给数据源页。**不**用 `sourceHasUsableSnapshot`（那是「有可用数据」，CLAUDE.md：OAuth connected ≠ data available） | research-seams §0 D-b |
| Q4 | **未知一律 `null`**：loading / error / 422 `CONTEXT_INCOMPLETE` / 响应里没有 gsc 槽位 / 未 hydrate → 站点卡显示「—」。**绝不**把 422 或请求失败显示成「未接入」（那是撒谎）。数据源页把 422 渲染成「需先确认产品档案」+ 指向 `/context` | research-seams §0 D-c、记忆 empty-states-must-not-name-a-cause |
| Q5 | **示例数据只有一个入口**：删掉 jsx 数据源页的假 Google 授权（`AUTH_STEPS` jsx:1318「跳转 Google 账号授权 / 校验读取权限 / 拉取最近 28 天数据」）、「连接即注入 `DEMO_GSC`」（jsx:1336）与「填入示例」（jsx:1405）。示例数据一律走概览「载入示例站点」（它置 `demo = true`）。数据源页只有两件事：真实连接状态只读 + 用户自己粘贴 / 上传导入 | jsx 缺陷 S2/S3/S12、设计 §6.7 |
| Q6 | **GSC 行带来源标记**：项目状态加 `gscRowsSource: "sample" \| "user" \| null`（`null` = 没有行），列为**第四项发布前豁免**（保持 `PERSISTED_VERSION = 1`，理由与前三项相同：PR-1/PR-2 从未上线；旧信封缺该键按 R14 判 `invalid` 丢弃，只影响开发期本地数据）。`profileDocMarkdown` 给 GSC 小节固定加的「（示例数据）」改为按标记条件输出——用户自己粘的真实导出不得被标成示例 | jsx 缺陷 P10、PR-2 残留 :1014 |
| Q7 | **`parseGsc` 的 `skipped` 必须露出来**（PR-2 残留 :1023 原记 PR-4，但导入入口在本 PR）：导入结果显示「解析 N 条 / 跳过 M 条」；表头只被部分识别时点名哪些列没认出来（`clicks / impressions / ctr / position` 哪几列为 `null`）。静默丢列正是「手写解析器静默截断」那条教训 | research-jsx §4.3 S4 |
| Q8 | **上传保留、加上限**：上传 CSV 是用户自己的文件（诚实），保留；读取前查 `file.size`（上限 2 MB），解析后行数上限 5000 并提示「已截断，共 N 行」。否则大导出进 state 再进 localStorage 会把存储推到 `quota` | research-jsx §4.3 S5 |
| Q9 | **一个口径的份额**：`formatShare(hits, total)` 从 `store/selectors.ts` 导出，概览提及率卡、本周 tile、侧栏徽标共用（R15：真 0 → `0%`，`0 < pct < 1` → `<1%`，`99 < pct < 100` → `>99%`，其余四舍五入，都按精确份额 `hits*100/total`）。**`selectCounts` 不直接当概览四卡用**——它把真 0 当「不显示」（徽标语义），而概览的「产物 0 件」是已知的真 0 | research-jsx §1.1、设计 §6.3 |
| Q10 | **空态与骨架分开**：`ready === false`（未 hydrate）→ 骨架，不渲 `—`；已 hydrate 但该模块没跑过 → `—` + 空态文案。空态文案不点名单一成因（一个空态多种成因）。概览「空」= 无 `audit` && 无 `lastVis` && 未 `built` && 无 `artifacts`，空态里放「载入示例站点」 | 设计 §4.3/§6.5、记忆 empty-states-must-not-name-a-cause |
| Q11 | **「载入示例」确认条件**：不只看 `gscRows / saved / seeds`（设计 §6.7 的原文不够——`loadDemo` 整体覆盖 17 个字段），而是 `DemoPayload` 的任一字段不等于 `initialProjectState` 的对应值就先确认。新增 `hasDemoOverwrite(state)` selector（可单测），不在视图里内联 | research-jsx §1.3 |
| Q12 | **「清除示例」确认文案**要点明会清掉：GSC 行、词库、产物筐、站点档案（`clearDemo` 回滚 17 个字段，含用户在载入示例之后自己粘的行与存的产物）。只说「GSC 行与词库」是漏说 | `store/reducer.ts:208`、设计 §6.7 |
| Q13 | **`mock/demo.ts` 只能动态 import**：点击处理里 `await import("@/lib/workbench/mock/demo.ts")`；`DEMO_LEVEL` / `DEMO_SEEDS` 来自零依赖的 `mock/demo-constants.ts`，可静态 import。配套把 `client-import-graph.test.ts` 的入口扩到组件，并加一条「视图静态 import demo 会红」的控制用例（否则护栏对视图恒绿） | PR-2 残留 :1018、research-seams §3.3 |
| Q14 | **档案生成不清空旧档案**：jsx 开跑先 `setDoc(null)`（jsx:1180），中途离开按 runToken 丢弃结果后旧档案永久没了（`profileDoc` 无历史）。改为跑的时候不动 `profileDoc`，完成时一次性写入 | research-jsx §3.2 |
| Q15 | **没有 producer 的状态不渲染**：删掉「AI 归纳失败：模型输出不是完整 JSON」（`SiteProfileView.tsx:126`／jsx:1188，`askJSON` 明确不移植）、GA4「403 insufficientPermissions」红框与点名账号（`DataSourcesView.tsx:51`）、「每日 06:00 同步」（`DataSourcesView.tsx:22`，我们没有同步调度）。真实 problem+json 才配渲染错误态 | 记忆 remedy-affordances-need-a-producer、empty-states-must-not-name-a-cause |
| Q16 | **不承诺结果、不叙述没发生的动作**：档案的 `PROF_STEPS`（jsx:1140「抓取首页 / 读取 GSC 品牌词 / 拉取第三方指标」）与副标题（jsx:1212）改为明说「本地生成的示例信号」；本周「加一段结论句通常就能进前十」（jsx:2799）、「边界句被引用率最高」（jsx:2800）、概览「11-30 名的词最容易进前十」（jsx:1109）一律删掉结果承诺与无依据事实；档案「品牌词占比高说明还没吃到需求词流量」（jsx:1274）改条件或删 | 仓库 CLAUDE.md 诚实性硬约束 |
| Q17 | **本周「排名变动」区块改为「临界词（11-30 名）」清单 + 明确空态**：store 里没有关键词排名历史（只有 `auditHistory` / `visHistory`），拿示例数字冒充「变化」是假测量。真正的排名变动需要两次 GSC 导入与持久化形状变更，记入残留表交给后续 PR | research-appearance §6.1、记忆 partial-measurement-renders-as-pass |
| Q18 | **本周卡片取三张**（外观权威；jsx 是六张）：健康分、AI 提及率、临界词数。其余三项（本周产物数、答案页缺口、知识库缺句）进事件流/摘要行，不再单独成卡 | research-appearance §6.2 |
| Q19 | **AI 提及率强调色用 `fuchsia-500`**（侧栏 GEO tone 同色），不用外观稿的 `violet-500`：同一个概念两种颜色会被读成两件事，而侧栏 tone 已落地并有测试（`workbench-nav.ts:74-78`）。记为对外观稿的有意偏离（设计 §10） | research-appearance §3.4 |
| Q20 | **「较上周」改「较上次（{at}）」**：`auditHistory` / `visHistory` 的上一条可能是同一天也可能几个月前，把 `prev.at` 打出来。本周的提及率与事件一律从 `lastVis.results` 算（不用运行中的 `visResults`，否则部分结果冒充完整测量，且会打出「提及率 null%」） | jsx 缺陷 W3/W4 |
| Q21 | **临界词的「去做」统一跳 `keywords`**（jsx 概览跳 keywords、本周跳 content，自相矛盾）；所有跳转用 `<Link>`（`workbenchHref`），不用 `router.push`——按钮驱动的 push 会绕过 Studio 未保存守卫（PR-1 红队 A1） | research-jsx §6.1 |
| Q22 | **枚举与时间**：视图不写中文枚举字面量（`gscStatus === "borderline"`、`countBySeverity().high`），显示查 `workbench.enums.*`；`module` 用 `ModuleId`、`engine: ""` → `"both"`；所有 stamp 是本地墙钟 `YYYY-MM-DD HH:mm`（`mock/time.ts`），不用 ISO；`now` 不在渲染路径读（`useState(() => new Date())` 或 `ready` 后一次性取），否则 SSR/CSR 不一致且每次重渲染都改窗口成员 | R2/R4、jsx 缺陷 W12 |
| Q23 | **产物必须盖章**：四个动作（复制 / 复制给 AI / 导出 / 存入产物筐）用的都是同一份已盖章文本（`stampArtifact(type, body, line)`，`line` 由 hook 从 `workbench.provenance.artifact` 翻出）。jsx 的「复制给 AI」包装句（jsx:972）把产物全文拼进指令句 → 按 R6 改成 `dataSection(fenceBlock(...))` 的 `agentTaskWrapper` | 设计 §6.8、R6 |
| Q24 | **设置页没有「保存设置」按钮**：`notify` 是本地偏好、改动即生效，假的保存按钮是假承诺；通知区块显著标注「偏好只保存在这个浏览器，当前不会发送任何通知」（没有任何发送实现）；D2 裁掉的账户邮箱 / 项目名 / API key（opengengrowth 里那个硬编码 `sk-…` 会同时触发 `pnpm secrets:scan`）/ 成员 / 站点列表 / 集成 / 用量套餐一律不移植 | 设计 §6.2/§13-D2、jsx 缺陷 T1 |
| Q25 | **入场动画不移植**：`animate-in fade-in` 依赖 `tw-animate-css`（PR-1 验收时移除），不为一次淡入加回依赖；只用 Tailwind 内置 keyframes（`animate-pulse` 已有先例），并配 `motion-reduce:animate-none` | research-appearance §1.1 |
| Q26 | **容器宽度**：概览 `max-w-5xl`、本周 `max-w-[1200px]`、两栏页（档案 / 数据源）`max-w-[1600px]`、设置 `max-w-5xl`；**视图根必须自带 padding 且是 `<main>` 的直接子节点并带 `.wb-reset`**，否则 `#main-content:not(:has(> .wb-reset))` 的旧页留白规则反向生效、`legacy-style-parity` 末条红 | research-appearance §1.1 |
| Q27 | **品牌为空不可达**：`client_name` 有 `length(btrim(...)) BETWEEN 1 AND 160` 的 DB CHECK（`packages/db/migrations/0001_init.sql:148`），`withProjectSeed` 每次 hydration 无条件用 `project.clientName` 覆盖 `brand`。因此**不做**「品牌为空就禁用载入示例」这种为不可达状态造的出口；改为概览提及率卡在没有可见度结果时显示未知（真实空态判据），并加一条单测钉住 seeding 无条件覆盖 brand。PR-2 残留「空品牌 0/30」按此关闭 | 记忆 remedy-affordances-need-a-producer |
| Q28 | **竞品两条残留归 PR-4**：CSV 表头 `domain` 会把公司名标成域名、缺口表 `ours === null` 要渲染「—/未知」——两者都是竞品视图的修法（设计 §9 把竞品排在 PR-4），且 mock 里没有竞品 CSV builder（PR-2 R1 把它列为视图私有）。PR-3 只把判据写进残留表交接，不改代码 | PR-2 计划 :1011-:1012 与 §9 冲突的裁决 |
| Q29 | **PR-1 遗留六项在本 PR 关闭**，每项都要有钉住它的测试，且要做「把修法改回去必须红」的变异验证：A 字体与 `workbench.css` 移到项目 layout（连带 `@theme inline` 陷阱）、B 触控目标、C ⌘K 提示对非 macOS 是假话、D Tailwind `source(none)`、E `AppShell` 死 `state:"project"` 变体、F `useGlobalShortcut` 重订阅 | PR-2 残留 :1009 |
| Q30 | **五个视图的框架文案要有 en 无中文断言**：现有 en-locale e2e 只扫 chrome（侧栏 / 站点卡 / 顶栏 / h1 / 旧版链接），不扫视图正文。PR-3 给五个视图的**框架容器**（标题、空态、按钮、区块标题，`data-wb-frame` 标记）加一条同形断言；mock 正文（中文）不在作用域内 | research-seams §4.3 |

---

## 文件结构

```
apps/web/src/components/workbench/
  ui/                              新增原语（每个一个文件 + 同名 .test.tsx，jsdom pragma）
    InPane.tsx  OutPane.tsx  ArtifactActions.tsx  Field.tsx  Tabs.tsx  Chip.tsx
    RunningSteps.tsx  StatCard.tsx  Delta.tsx  EmptyState.tsx  ConfirmDialog.tsx  Toggle.tsx
    panel.ts                       卡壳/面板壳的共享 class 常量（不抽组件）
  hooks/
    useAddArtifact.ts (+ .test.tsx) id + 本地 stamp + stampArtifact + dispatch(addArtifact)
    useNowStamp.ts (+ .test.tsx)    ready 后一次性取 now（渲染路径不读时钟）
    useShortcutLabel.ts (+ .test.tsx)  ⌘K / Ctrl K（useSyncExternalStore，server snapshot 固定）
  shell/
    Topbar.tsx                     改：「清除示例」按钮 + 确认；⌘K 标签走 useShortcutLabel
    ShellChrome.tsx                改：useProjectSources → gscConnected 三态
    gsc-connection.ts (+ .test.ts) 纯函数：sources + query 状态 → true | false | null
    useGlobalShortcut.ts           改：latest-ref
  views/
    overview/OverviewView.tsx  next-steps.ts  LoadDemoButton.tsx  (+ tests)
    week/WeekView.tsx  week-feed.ts  weekly-report.ts  (+ tests)
    profile/ProfileView.tsx  ProfileInputPane.tsx  ProfileDocTab.tsx  ProfileJsonTab.tsx
             ProfileContextTab.tsx  build-profile-doc.ts  (+ tests)
    data-sources/DataSourcesView.tsx  DataSourcesPanel.tsx  GscImportPane.tsx
             GscRowsTable.tsx  real-connections.ts  (+ tests)
    settings/SettingsView.tsx      改：加通知与数据源摘要，删占位句
             NotifyBlock.tsx  SourcesSummaryBlock.tsx  (+ tests)
apps/web/src/lib/workbench/
  store/schema.ts                  改：gscRowsSource（第四项发布前豁免注释）
  store/types.ts                   改：gscRowsSource
  store/reducer.ts                 改：setGscRows 带 source；导出 DEFAULT_NOTIFY
  store/selectors.ts               改：导出 formatShare；新增 hasDemoOverwrite
  store/client-import-graph.test.ts 改：入口扩到组件 + 控制用例
  mock/builders/agent-task.ts (+ .test.ts)  围栏化的「复制给 AI」包装句
  mock/builders/profile.ts         改：GSC 小节的「（示例数据）」按 source 条件输出
apps/web/src/app/
  layout.tsx                       改：移出字体与 workbench.css
  p/[projectId]/layout.tsx         改：接入字体与 workbench.css
  p/[projectId]/{overview,week,profile,data-sources}/page.tsx  改：渲染真视图
  workbench.css                    改：@theme inline；utilities 加 source(none) + @source
  workbench-css.test.ts            改：断言 layout 归属、inline、source(none)；去空洞断言
apps/web/src/components/app-shell/AppShell.tsx  改：删死 state:"project" 分支
packages/i18n/src/messages/{en,zh-CN}.json      改：workbench.{overview,week,profile,dataSources,settings}.* + shell 新键
apps/web/e2e/
  workbench-pr3-flow.mock.spec.ts  新增：载入示例 → 四卡非空带「示例」→ 清除示例 → 回空态
  workbench-shell.mock.spec.ts     改：h1 文本不变；新增触控目标与 en-无中文（视图框架）断言
  legacy-style-parity.mock.spec.ts 改：加 /new-project 与 /login 的回归用例
docs/plans/2026-09-11-workbench-ui-port-design.md  T18 回写 §4.1/§10/§12/§14
docs/PROGRESS.md                   T18
```

---

## 执行波次与并行约束

- **W1（并行 4）**：T1 i18n 键、T2 ui 原语 A、T3 ui 原语 B、T4 store 共享件。四者文件不相交；**只有 T1 动 `packages/i18n/src/messages/*.json`**（并行改同一 JSON 必冲突，PR-1/PR-2 的教训）。
- **W2（并行 4）**：T5 站点卡真实状态、T12 遗留 A、T13 遗留 B+C、T14 遗留 D。T13 依赖 T2 之后的 `useShortcutLabel`？不依赖：hook 归 T13 自己建。
- **W3（并行 3，再并行 3）**：T6 概览 + T7 顶栏清除示例 + T8 本周 → 然后 T9 档案 + T10 数据源 + T11 设置。T7 与 T6 都碰示例流程但文件不同（`shell/Topbar.tsx` vs `views/overview/*`）；T10 与 T11 共用 `DataSourcesPanel`（T10 建，T11 用），故排前后不并行。
- **W4（串行）**：T15 遗留 E+F → T16 导入图护栏 → T17 e2e → T18 文档 → T19 验证与交付。
- 每任务 1 实现 agent + 1 审阅 agent；审阅在**分离的临时 worktree**（`git worktree add --detach <scratch> <sha>` + 软链 node_modules）里做变异测试，绝不在主工作区留变异。审阅返回 CHANGES_REQUIRED 就回原实现者或新派 fix agent，主会话对每个提交重跑测试核对。

---

## Task 1: i18n 键（唯一动 messages JSON 的任务）

**Files:** Modify `packages/i18n/src/messages/en.json`、`packages/i18n/src/messages/zh-CN.json`；Create `apps/web/src/lib/workbench/views-i18n.test.ts`

- [ ] **Step 1: 先写失败的门禁测试** — 照 `apps/web/src/lib/workbench/enums-i18n.test.ts` 的模板新建 `views-i18n.test.ts`：用 `createTranslator({ onError: throw })` 对五个命名空间的每个键取值，**每个带占位的键都必须传 values 对象**（`t(key)` 不传 values 不会编译 ICU，坏 ICU 只在 dev 现形），并断言取回的字符串不含 `ICU_RESIDUE = /[{}']/` 残留、不含 `workbench.` 路径前缀。键清单在测试里写成字面数组（不是从 JSON 反推，否则恒真）。
- [ ] **Step 2: 跑测试确认红** — `pnpm vitest run --project unit apps/web/src/lib/workbench/views-i18n.test.ts`，预期 red（键不存在）。
- [ ] **Step 3: 加键（两语种同时）** — 追加在 `workbench` 子树末尾（减少与在建 parity 分支的冲突）：
  - `workbench.overview.*`：`subtitle`（ICU `{domain} {brand} {market}`）、`cards.{health,mention,keywords,artifacts}.{label,foot}`（foot 带 ICU 计数）、`cards.empty`（未跑过的「—」旁的一句）、`next.{title,step.*,cta}`、`empty.{title,detail}`、`loadDemo.{button,busy,confirmTitle,confirmBody,confirmOk,cancel}`、`noGsc.{title,detail,cta}`
  - `workbench.week.*`：`subtitle`（ICU `{from} {to}`）、`cards.{health,mention,borderline}.{label,foot}`、`sinceLast`（ICU `{at}`，取代「较上周」）、`feed.{title,count,empty,view}`、`borderlineList.{title,empty,detail}`、`next.{title,step.*}`、`report.{title,save,export}`、`artifactTitle`（ICU `{brand} {from} {to}`）
  - `workbench.profile.*`：`subtitle`、`fields.{url,brand,market,positioning,features,competitors}.{label,meta,placeholder}`、`readonlyNote`、`sources.{crawl,gsc,third}`、`run.{button,rerun,steps.*,note}`、`tabs.{doc,json,ctx}`、`doc.{crawl,gsc,product,icp}`、`metrics.{pages,indexable,traffic,dr,refdomains}`（`pages` 文案写「样本页」、`indexable` 写「可收录」）、`unknown`（「—」的可读文案）、`empty.{title,detail}`、`artifactTitle.{doc,json,ctx}`、`legacyCta`
  - `workbench.dataSources.*`：`subtitle`、`real.{title,gsc,ga4,connected,notConnected,unknown,needProfile,needProfileCta,manageLegacy}`、`import.{title,note,placeholder,parse,clear,clearConfirmTitle,clearConfirmBody,upload,uploadHint,tooLarge,truncated}`、`result.{parsed,skipped,partialHeader}`（ICU 计数 + 列名列表）、`table.{title,count,query,clicks,impressions,position,status,legend,showing,toKeywords}`、`empty.{title,detail}`
  - `workbench.settings.*`（现有两键保留）：`notify.{title,note,weekly,drop,mention,gsc}`（每项 label + description 两键）、`sources.{title,note,cta,legacyCta}`
  - `workbench.shell.*` 新增/改：`clearSampleConfirm.{title,body,ok}`（要点明 GSC 行 / 词库 / 产物筐 / 站点档案，Q12）、`shortcutHint` 改为 ICU `{key}`（Q29-C）、`siteCard.unknownHint`（站点卡「—」的 title 属性，说明「未知」不是「未接入」）
- [ ] **Step 4: 跑绿** — `views-i18n.test.ts` 通过；`pnpm vitest run --project unit packages/i18n/src/__tests__/parity.test.ts` 通过（两语种键集合严格相等）。
- [ ] **Step 5: 变异验证** — 删掉 zh-CN 里任一新键 → parity 红；把某个 ICU 键的 `{count}` 写成 `{cnt}` → `views-i18n.test.ts` 红（证明门不是恒绿）。改回。
- [ ] **Step 6: 提交** — `git add packages/i18n/src/messages/en.json packages/i18n/src/messages/zh-CN.json apps/web/src/lib/workbench/views-i18n.test.ts` + `git commit --only <这三个字面路径>`，信息 `feat(i18n): 工作台五个视图的文案键与 ICU 门禁`。

## Task 2: ui 原语 A（展示类）

**Files:** Create `apps/web/src/components/workbench/ui/{panel.ts,Field.tsx,Chip.tsx,Tabs.tsx,Delta.tsx,StatCard.tsx,EmptyState.tsx}` + 每个 `.test.tsx`

props 草案见 research-appearance §3.2（逐个照抄核对）。要点：

- [ ] **Step 1: `panel.ts`** — 卡壳与面板壳的共享 class 常量（`bg-white rounded-xl border border-slate-200 shadow-sm` 等）。不抽组件（三种头部会导致 props 体操）。无 preflight：边框、`border-collapse`、`<hr>` 的 `border-t` 都必须显式写。
- [ ] **Step 2: `Field` / `Chip` / `Tabs`** — `Field{label, meta?, htmlFor, children}`（`htmlFor` 必填，控件要有真实 id）；`Chip{tone: "neutral"|"seo"|"geo"|"warn"|"bad"}`，tone→类映射集中一处；`Tabs` 是 `role="tablist"` + `aria-selected` + 左右方向键，激活态 `bg-wb-ink text-white`。
- [ ] **Step 3: `Delta` / `StatCard` / `EmptyState`** — `Delta{value: number|null, unit?}`：`null` 渲 `null`（不渲 0、不渲「—」由调用方定）；`StatCard{value: string|null, label, foot, delta?, accent?, href?}`，`href` 有则整卡是 `<Link>`（不是 button，Q21）；`accent` 的 `mention` 档用 `fuchsia-500`（Q19）。`EmptyState{title, detail, action?}`，文案不点名单一成因（Q10）。
- [ ] **Step 4: 每个原语一个 jsdom 测试** — 文件头 `/** @vitest-environment jsdom */`，装置照 `views/settings/SettingsView.test.tsx:30-48`（`IS_REACT_ACT_ENVIRONMENT` + `createRoot` + `act` + `NextIntlClientProvider` 真消息）。必测：`Tabs` 的方向键与 `aria-selected`；`StatCard` 的 `value === null` 渲「—」且**不**渲 0；`Delta` 三个符号分支；`Chip` 每个 tone 的类；无任何 `style` 属性（断言 `el.getAttribute("style") === null`）。
- [ ] **Step 5: 变异验证** — 把 `StatCard` 的 `value ?? "—"` 改成 `value ?? 0` 必须红；把 `Chip` 的 tone 映射删一档必须红。
- [ ] **Step 6: 提交** — `feat(workbench): ui 展示原语（Field/Chip/Tabs/Delta/StatCard/EmptyState）`。

## Task 3: ui 原语 B（面板与交互类）

**Files:** Create `apps/web/src/components/workbench/ui/{InPane.tsx,OutPane.tsx,ArtifactActions.tsx,RunningSteps.tsx,ConfirmDialog.tsx,Toggle.tsx}` + 每个 `.test.tsx`

- [ ] **Step 1: `InPane` / `OutPane`** — `InPane{title, note?, children, foot?}`；`OutPane{title, tabs?, tab?, onTab?, running?, runSteps?, runAt?, empty, artifact?, onSave?, extraFoot?, children}`：body 是「running → 步骤动画」「有内容 → children」「否则 → empty」的状态机；`tabs.length > 1` 才渲 tabs（用 T2 的 `Tabs`）。
- [ ] **Step 2: `ArtifactActions`（与 OutPane 分开）** — 复制 / 复制给 AI / 导出 / 存入产物筐；**四个动作用的都是同一份已盖章文本**（Q23）；复制失败要有兜底提示；导出走 `lib/workbench/download.ts`（PR-1 已有），扩展名按 `type`；1.3s flash 提示用 state 不用 CSS 动画。
- [ ] **Step 3: `RunningSteps{steps, at, label}`** — done/now/pending 三态；容器 `aria-live="polite"`（运行状态对读屏器可见）；`now` 圆点 `animate-pulse motion-reduce:animate-none`（内置 keyframes，Q25）。
- [ ] **Step 4: `ConfirmDialog`** — 基于现有 `ui/Dialog.tsx`（焦点陷阱 + `#wb-app` inert 引用计数），`{open,onClose,onConfirm,title,description,confirmLabel,cancelLabel,tone?}`。**不要**改 `DeleteProjectSection` 去用它（它自带两步内联确认，且 e2e 钉着 `data-wb-real-action` 恰好 1 个）。
- [ ] **Step 5: `Toggle{checked,onChange,label,description?}`** — 真 `<input type="checkbox">` 或 `role="switch" aria-checked` 的 button；命中区 ≥24px（与 Q29-B 同一判据）。
- [ ] **Step 6: jsdom 测试 + 变异** — `OutPane` 三态各一条；`ArtifactActions` 断言四个动作拿到的文本**逐字相同且含盖章行**（把某一个动作改成用未盖章正文必须红）；`ConfirmDialog` 的 Esc / 取消 / 确认三条；`Toggle` 的 `aria-checked` 与键盘。
- [ ] **Step 7: 提交** — `feat(workbench): ui 面板与交互原语（InPane/OutPane/ArtifactActions/RunningSteps/ConfirmDialog/Toggle）`。

## Task 4: store 共享件与产物管线

**Files:** Modify `apps/web/src/lib/workbench/store/{types.ts,schema.ts,reducer.ts,selectors.ts}`；Create `apps/web/src/components/workbench/hooks/{useAddArtifact.ts,useNowStamp.ts}` + tests；Create `apps/web/src/lib/workbench/mock/builders/agent-task.ts` + test；Modify `apps/web/src/lib/workbench/mock/builders/profile.ts`

- [ ] **Step 1: 先写失败测试** — ①`selectors.test.ts` 加 `hasDemoOverwrite`：17 个 `DemoPayload` 字段逐个改一次都必须为 true，全等初始值为 false（Q11，**逐字段** 17 条用例，不是抽样）；②`formatShare` 从外部 import 成功（Q9）；③`schema.test.ts` 加 `gscRowsSource` 的往返与「旧信封缺该键 → invalid」（Q6）；④`reducer.test.ts` 加 `setGscRows` 带 source（`"user"` / `"sample"`）与清空回 `null`。
- [ ] **Step 2: 跑红** — 逐个字面路径跑 vitest，确认每条都红（基线有数字，不是静默 0 匹配）。
- [ ] **Step 3: 实现 store 侧** — `types.ts` 加 `gscRowsSource: GscRowsSource`（`"sample" | "user" | null`）；`schema.ts` 同步并在字段上写**第四项发布前豁免**注释（保持 `PERSISTED_VERSION = 1`，写明理由与「上线后同类改动必须升版本」）；`reducer.ts` 的 `setGscRows` 带 `source`、`loadDemo` 置 `"sample"`、`clearDemo` 回 `null`，并导出 `DEFAULT_NOTIFY`；`selectors.ts` 导出 `formatShare` 与新增 `hasDemoOverwrite`。
- [ ] **Step 4: hooks** — `useAddArtifact()`：`id = crypto.randomUUID()`、`at = formatLocalStamp(new Date())`、`content = stampArtifact(type, body, t("artifact", { at }))`、`dispatch(addArtifact)`；返回的对象要能同时给 `ArtifactActions` 的四个动作用（同一份文本）。`useNowStamp()`：`ready` 后一次性取 `now`，渲染路径不读时钟（Q22）。两个 hook 各一条 jsdom 测试。
- [ ] **Step 5: `agentTaskWrapper`** — 「复制给 AI」的包装句：指令句不插值任何用户字段，产物全文只出现在 `dataSection(fenceBlock(body))` 里（R6）。测试跑 `splitFences` 的敌意输入组（照 `mock/builders/*.test.ts` 现有 prompt builder 的同一组输入）。
- [ ] **Step 6: `profileDocMarkdown` 条件标注** — GSC 小节的「（示例数据）」改为按 `gscRowsSource === "sample"` 输出（Q6）；signature 加参数，更新既有测试；加一条「user 来源不带示例标」的用例。
- [ ] **Step 7: 全绿 + 变异** — 把 `hasDemoOverwrite` 少比一个字段必须红；把 `gscRowsSource` 从 schema 删掉必须红。
- [ ] **Step 8: 提交** — 分两个提交：`feat(workbench): store 共享件（gscRowsSource、hasDemoOverwrite、formatShare 导出）`、`feat(workbench): 产物管线 hook 与围栏化 AI 包装句`。

## Task 5: 站点卡接真实 GSC 连接状态

**Files:** Create `apps/web/src/components/workbench/shell/gsc-connection.ts` + `.test.ts`；Modify `shell/ShellChrome.tsx`、`shell/WorkbenchShell.tsx`、`shell/SiteCard.tsx`（仅 title 提示）、`shell/{Sidebar,ShellChrome,SiteCard}.test.tsx`

- [ ] **Step 1: 纯函数先行** — `gscConnectionState({ sources, isLoading, isError })` → `true | false | null`，判据按 Q3/Q4。测试覆盖：9 个 `SourceState` 逐个（`hooks-sources.ts:49-58` 的全集，**逐个列出不抽样**）、`id === null`、没有 gsc 槽位、loading、error、422。
- [ ] **Step 2: 跑红再实现**。
- [ ] **Step 3: 接线** — `ShellChrome`（client）用 `useProjectSources(projectId)`（`@/lib/api/hooks-sources`，未从 barrel 导出，直接 import），把结果喂给 `gscConnectionState`，传 `Sidebar → SiteCard`；`WorkbenchShell` 不再传 `gscConnected`（server 组件拿不到，Q2），`SidebarSite` 的注释同步更新。**降级要求**：`legacy-style-parity.mock.spec.ts` 不装 mock API，请求会 500 → 必须渲染成 `null`（「—」）且不抛错、不挂 Suspense 空转。
- [ ] **Step 4: 三个 fixture 测试** — `Sidebar/ShellChrome/SiteCard.test.tsx` 的 `SITE` fixture 去掉 `gscConnected`；`ShellChrome` 测试要套 `QueryClientProvider`。`SiteCard` 的「—」加 `title` 说明「未知」不是「未接入」（Q4 的文案键）。
- [ ] **Step 5: 变异** — 把 `permission_denied` 从「已接入」挪到 `false` 必须红（判据有钉子）；把 error 分支改成返回 `false` 必须红。
- [ ] **Step 6: 提交** — `feat(workbench): 侧栏站点卡接真实 GSC 连接状态（三态，未知不等于未接入）`。

## Task 6: 概览视图 + 载入示例站点

**Files:** Create `apps/web/src/components/workbench/views/overview/{OverviewView.tsx,next-steps.ts,LoadDemoButton.tsx}` + tests；Modify `apps/web/src/app/p/[projectId]/overview/page.tsx`
**依赖：** T1（文案）、T2/T3（原语）、T4（hooks/selectors）

- [ ] **Step 1: `next-steps.ts` 先写测试再实现** — 纯函数 `overviewNextSteps(input)` → 有序步骤数组（id + ICU 参数 + 目标路由）。逻辑照 jsx:1104-1110，但删掉结果承诺（Q16）、临界词跳 `keywords`（Q21）、全空兜底条件要加上 audit/visResults 判空（jsx 的兜底在「有 rows 但什么都没跑」时也会出现）。
- [ ] **Step 2: 四卡取值** — 健康分 `state.audit?.score`；提及率 `formatShare`（Q9，没有结果 → `null`，Q27）；候选数 `keywordRowCount`（gated，provider memo）；产物 `artifacts.length`（**0 照显示**，Q9）。脚注「N 条来自 GSC」要数 `rows.filter(r => r.source === "gsc")`（不是 `gscRows.length`，jsx 缺陷 O5）；`state.demo` 为真时脚注带「示例」（PR-2 残留 :1017）。
- [ ] **Step 3: 空态与骨架** — Q10 的两档；空态里放 `LoadDemoButton`。
- [ ] **Step 4: `LoadDemoButton`** — 点击：`hasDemoOverwrite(state)` 为真先开 `ConfirmDialog`（Q11）→ 确认后 `await import("@/lib/workbench/mock/demo.ts")`（Q13）→ `makeDemoSite(state.profile, DEMO_LEVEL, [...DEMO_SEEDS], { now, provenanceLine })` → `dispatch(loadDemo)`。要有 pending 闸（`useRef` + disabled）防连点两次 dispatch。
- [ ] **Step 5: 页面接线** — `overview/page.tsx` 渲染 `OverviewView`，**不得残留 `page="..."` 字面量**（`routes.fs.test.ts:55-71` 文本级断言）；视图根按 Q26。
- [ ] **Step 6: jsdom 测试** — 四卡的四种状态（骨架 / 未跑 / 跑过 / 示例）；`next-steps` 的每条分支；载入示例：无覆盖时不弹确认、有覆盖时弹、确认后 dispatch 一次（连点两次只 dispatch 一次）；断言视图内无 `style` 属性。
- [ ] **Step 7: 变异** — 把「产物 0 件」改成走 `selectCounts`（null）必须红；把动态 import 改成静态 import 必须让 T16 的护栏红（T16 之后回归验证）。
- [ ] **Step 8: 提交** — `feat(workbench): 概览视图与载入示例站点`。

## Task 7: 顶栏「清除示例」按钮

**Files:** Modify `apps/web/src/components/workbench/shell/Topbar.tsx` + `Topbar.test.tsx`
**依赖：** T1、T3（ConfirmDialog）

- [ ] **Step 1: 测试先行** — `demo === false` 时无按钮；`true` 时有按钮；点击开确认；确认文案**包含**「GSC 行 / 词库 / 产物筐 / 站点档案」四项（按整句断言，不按子串数字，记忆 number-substring-pins-are-dead-pins）；确认后 dispatch `clearDemo` 一次。
- [ ] **Step 2: 实现** — 按钮挂在 `DemoChip` 旁，文案 `shell.clearSample`；确认用 `ConfirmDialog`（Q12）。**不得**新增第二个 `role="status"`（e2e 钉着顶栏唯一 status）；移动端命中区 ≥44px（Q29-B 同批口径）。
- [ ] **Step 3: 跑 `Topbar.test.tsx` 与 `ShellChrome.test.tsx`** 全绿；变异：删掉确认文案里的「产物筐」必须红。
- [ ] **Step 4: 提交** — `feat(workbench): 顶栏清除示例按钮与确认`。

## Task 8: 本周变化视图

**Files:** Create `views/week/{WeekView.tsx,week-feed.ts,weekly-report.ts}` + tests；Modify `app/p/[projectId]/week/page.tsx`
**依赖：** T1-T4

- [ ] **Step 1: `week-feed.ts` 测试先行** — `weekFeed(state, now)`：事件来自 `lastAudit` / `lastVis` / `profileDoc` / `kb` / 每件 artifact，过 `withinDays(at, 7, now)`，按 `at` 倒序；`artifactsWithinDays` 在这里实现。口径修正：提及率与事件一律从 `lastVis.results`（Q20）；KB 缺口用 `kbGapCount`（与侧栏徽标同口径，jsx 只数空 statement 会不一致）；「较上次（{at}）」带出 `prev.at`（Q20）；`module` 用 `ModuleId` 查 `workbench.enums.module`（Q22）。
- [ ] **Step 2: 三卡 + 临界词清单** — 三卡按 Q18；右栏按 Q17 改成临界词清单 + 明确空态（**不得**出现任何「排名变动」数字）。
- [ ] **Step 3: `weekly-report.ts`** — 周报 md：`## 数字 / 修掉了什么 / 新出现的问题 / 本周动作 / 下周`；行首插值过 `docText`（产物标题里有用户种子词）；`stampArtifact("md", body, line)` 盖章；`module: "week"`、`engine: "both"`、`filename: "weekly.md"`；文案删掉 jsx 的排名承诺与「被引用率最高」（Q16）、「修复任务已经在产物里」改按 `artifacts.some(...)` 分支（jsx 缺陷 W7）、「N 个提问没提到你」改按平台口径（W11）。
- [ ] **Step 4: 页面级空态** — 全空时不渲六个 0，并且**禁用「存周报」**（否则产出一份全「未跑」的周报，W18）。
- [ ] **Step 5: jsdom 测试 + 变异** — feed 的窗口边界（恰好 7 天、未来时间被排除）；全空空态；周报文本包含盖章行且不含「实测 / 已修复 / 进前十」（按整句钉，删掉某条禁词断言必须红）。
- [ ] **Step 6: 提交** — `feat(workbench): 本周变化视图与周报产物`。

## Task 9: 站点档案视图

**Files:** Create `views/profile/{ProfileView.tsx,ProfileInputPane.tsx,ProfileDocTab.tsx,ProfileJsonTab.tsx,ProfileContextTab.tsx,build-profile-doc.ts}` + tests；Modify `app/p/[projectId]/profile/page.tsx`
**依赖：** T1-T4

- [ ] **Step 1: `build-profile-doc.ts` 测试先行** — `buildProfileDoc({ profile, gscRows, lastAudit, srcs, at })` → `ProfileDoc`：`crawl = crawlSignals(profile, "crawl", observed)`（有 `lastAudit` 时传 observed，让档案与审计同源，jsx 缺陷 P6）、`third = crawlSignals(profile, "third")`（**不得复用 crawl 对象**，P4）、`gsc = gscSignals(profile, gscRows)`、`ai = demoAiDoc(profile)`、`at = formatLocalStamp(now)`（不是 ISO，P3）。
- [ ] **Step 2: 输入面板** — `url / brand / market` 只读文本（不是 input、不是带「中文」选项的 select，P12）；`positioning / features / competitors` 受控 + `patchProfile`；「生成来源」三个 chip 开关（**删掉 `ai` 开关**：`ProfileDoc.ai` 非空且没有 LLM，P2/Q15）；步骤文案改为明说本地生成（Q16），逻辑不绑下标。
- [ ] **Step 3: 运行归属与不清空** — 生成时不动 `profileDoc`，完成时一次性写（Q14）；runToken + projectId 归属（切页/切项目丢弃结果）。
- [ ] **Step 4: 三个 tab** — `profileDocMarkdown` / `profileJson` / `profileContextPrompt`（PR-2 已落地）；四个动作走 `ArtifactActions`（盖章，Q23）。
- [ ] **Step 5: 空值与文案** — `GscSignals` 四个计数与 `LinkTarget` 同为可空：用 `countText` 口径显示「—」，**不得渲染出「 / 」这种半句**（P7）；「收录约」改「可收录约」、页数写「样本页」（P5/P6）；删掉「AI 归纳失败」橙框（Q15）与无条件结论句（Q16）。
- [ ] **Step 6: jsdom 测试 + 变异** — 只读三项不可编辑；`third` 为 null 时整列缺席（不渲 0）；生成中旧档案仍在；把「完成时一次性写」改回「开跑先清空」必须红。
- [ ] **Step 7: 提交** — `feat(workbench): 站点档案视图`。

## Task 10: 数据源视图

**Files:** Create `views/data-sources/{DataSourcesView.tsx,DataSourcesPanel.tsx,GscImportPane.tsx,GscRowsTable.tsx,real-connections.ts}` + tests；Modify `app/p/[projectId]/data-sources/page.tsx`
**依赖：** T1-T5（复用 T5 的 `gsc-connection.ts` 判据）

- [ ] **Step 1: `real-connections.ts` 测试先行** — 把 `useProjectSources` 的响应映射成只读展示模型：GSC / GA4 各自的 `connected | notConnected | unknown` + `state` + 最新 snapshot 的 `availability / capturedAt / rowCount / limitation`。422 → 「需先确认产品档案」+ `/context` 链接（Q4）。**不含**任何 connect/disconnect 动作（Q1）。
- [ ] **Step 2: 真实与示例分区** — 上半「真实连接」（只读，带「真实数据」语义标注 + 指向旧页 `sources` 的链接）、下半「示例导入」（mock，带 `DemoChip`）。删掉「每日 06:00 同步」与 GA4 403 红框（Q15）；GA4 区块要明说当前没有模块使用 GA4 数据（jsx 缺陷 S10）。
- [ ] **Step 3: 导入面板** — 粘贴 + 上传两条路径（**没有**假授权动画、**没有**「填入示例」，Q5）；`parseGsc` → `setGscRows(rows, "user")`；结果显示「解析 N 条 / 跳过 M 条」与部分识别的列名（Q7）；上传查 `file.size` ≤ 2 MB、行数 ≤ 5000 并提示截断（Q8）；「清空」要确认（jsx 无确认，S6）。
- [ ] **Step 4: 行表** — 前 60 行 + 「显示前 60 / 共 N」（S8）；`clicks/impressions/ctr/position` 可空 → 「—」；状态 chip 查 `workbench.enums.gscStatus`，`unknown` 用中性 chip 并在摘要里显示「N 条无排名」（不能让无排名的行在摘要里消失，S7）；行数徽标按 `gscRowsSource === "sample"` 带「示例」（Q6）。
- [ ] **Step 5: `DataSourcesPanel`** — 数据源页与设置页共用的只读摘要块（T11 消费），抽成独立文件（S14）。
- [ ] **Step 6: jsdom 测试 + 变异** — skipped 的三条（0 跳过 / 有跳过 / 部分识别列名）；超大文件与超行数；示例与真实两块的标注互不串（把 `gscRowsSource` 判定改成恒 `sample` 必须红）。
- [ ] **Step 7: 提交** — `feat(workbench): 数据源视图（真实连接只读 + 用户导入）`。

## Task 11: 设置页补齐

**Files:** Create `views/settings/{NotifyBlock.tsx,SourcesSummaryBlock.tsx}` + tests；Modify `views/settings/SettingsView.tsx` + `SettingsView.test.tsx`
**依赖：** T1、T3（Toggle）、T4（DEFAULT_NOTIFY）、T10（DataSourcesPanel）

- [ ] **Step 1: 测试先行** — 四个开关的 `aria-checked` 与 dispatch（`setNotify` 收整份，要 `{...state.notify, weekly: next}`）；未 hydrate 时 disabled 或骨架（**不得**渲成「全关」）；页面 `[data-wb-real-action]` 仍**恰好 1 个**（e2e 同口径，Q1/D-d）；没有「保存设置」按钮（Q24）。
- [ ] **Step 2: `NotifyBlock`** — 四个 `Toggle` + 区块级「偏好只保存在这个浏览器，当前不会发送任何通知」（Q24）+ `DemoChip`；删掉 jsx 的「发到 {members[0].email}」与「工作区级」说法。
- [ ] **Step 3: `SourcesSummaryBlock`** — 只读摘要 + 「去数据源页」与旧页两个链接（Q1/D-d），不放 OAuth 动作。
- [ ] **Step 4: 删占位句** — `SettingsView` 去掉 `inProgressNoLegacy` 一句，保留 `DeleteProjectSection` 原样（不要改它的文案与确认流程，e2e 钉着按钮名）。
- [ ] **Step 5: 变异** — 把「不会发送任何通知」这句删掉必须红（记忆 consent-copy-goes-unpinned：破坏性/承诺性文案每句都要做删除变异）。
- [ ] **Step 6: 提交** — `feat(workbench): 设置页通知偏好与数据源摘要`。

## Task 12: PR-1 遗留 A（字体与 workbench.css 挂到项目 layout）

**Files:** Modify `apps/web/src/app/layout.tsx`、`apps/web/src/app/p/[projectId]/layout.tsx`、`apps/web/src/app/workbench.css`、`apps/web/src/app/workbench-css.test.ts`；Modify `apps/web/e2e/legacy-style-parity.mock.spec.ts`

- [ ] **Step 1: 先修空洞测试** — `workbench-css.test.ts:37` 只断言 `--font-sans: var(--font-wb…)` 的字面存在，对 `@theme` vs `@theme inline` 不敏感 → 先把它改成能区分的断言（红），再动实现。
- [ ] **Step 2: 移动** — `import "./workbench.css"` 与 `Plus_Jakarta_Sans` 实例移到 `p/[projectId]/layout.tsx`，字体变量类挂在项目 layout 返回的最外层元素上。
- [ ] **Step 3: `@theme inline`** — `@theme` 在 `:root` 就完成变量替换，变量类离开 `<html>` 后 `font-sans` 会**静默**退回 fallback；改 `@theme inline`（或在包裹元素上重声明 `--font-sans`）。
- [ ] **Step 4: 断点逐条比对** — `workbench.css:73-91` 的 `#main-content:not(:has(> .wb-reset))` 两档断点分支 vs `app-shell.module.css:450+` 的媒体查询，逐属性核对后再下「无计算样式变化」的结论（调研只核了主规则）。
- [ ] **Step 5: 测试** — `workbench-css.test.ts` 改成「项目 layout 引入、根 layout 不引」；新增 e2e：壳内元素 computed `font-family` 含 `Plus Jakarta`（jsdom 证明不了）、`/login` 不下载工作台 CSS chunk 与字体 preload、`/new-project` 的 `#main-content` padding-left 与 max-width 不变（单独一条 test，不塞进基线 JSON）。
- [ ] **Step 6: 变异** — 把 `@theme inline` 改回 `@theme` 必须红；把 CSS import 挪回根 layout 必须红。
- [ ] **Step 7: 提交** — `fix(workbench): 字体与工作台 CSS 只挂项目 layout（@theme inline 防静默回退）`。

## Task 13: PR-1 遗留 B（触控目标）与 C（⌘K 提示）

**Files:** Modify `shell/ArtifactDrawer.tsx`、`shell/Topbar.tsx`、`shell/SignOutButton.tsx`；Create `hooks/useShortcutLabel.ts` + test；Modify `packages/i18n` 的 `shortcutHint` 消费点（键由 T1 改）；Modify `apps/web/e2e/workbench-shell.mock.spec.ts`

- [ ] **Step 1: 触控** — `ArtifactDrawer.tsx:159-181` 三个文字按钮加 `-m-1 p-1`（命中区 ≥24px，视觉不变）；`:136-139` 关闭按钮 `p-1`→`p-1.5`；移动端（`max-md:`）汉堡、产物筐、清除示例提到 44px；桌面尺寸不动（外观权威）。
- [ ] **Step 2: 触控的门** — 现有 axe 只跑到 `wcag21aa`，`target-size` 属 `wcag22aa` → **这条检查现在是瞎的**。在 `workbench-shell.mock.spec.ts` 遍历壳内 `button, a[href]` 量 `boundingBox()` 断言两边 ≥24（移动端那几个 ≥44 单独钉）。
- [ ] **Step 3: ⌘K** — `useShortcutLabel()` 用 `useSyncExternalStore`（server snapshot 固定为 `⌘K`，避免 hydration mismatch），平台判定 `navigator.userAgentData?.platform ?? navigator.platform`；`<kbd>` 与侧栏脚注共用同一 label；`shortcutHint` 走 T1 的 ICU `{key}`。
- [ ] **Step 4: 测试 + 变异** — 两条 jsdom（伪造 mac / 非 mac，**钉整句**插值结果，不钉 `"K"` 子串）；把 label 改回硬编码 `⌘K` 必须红；把某个按钮的 `-m-1 p-1` 删掉必须让 Step 2 的 e2e 红。
- [ ] **Step 5: 提交** — 两个提交：`fix(workbench): 抽屉与移动端触控目标`、`fix(workbench): 快捷键提示按平台显示`。

## Task 14: PR-1 遗留 D（Tailwind `source(none)`）

**Files:** Modify `apps/web/src/app/workbench.css`、`apps/web/src/app/workbench-css.test.ts`；Create `apps/web/src/app/tailwind-source-scope.test.ts`

- [ ] **Step 1: 实现** — `@import "tailwindcss/utilities.css" layer(utilities) source(none);` + `@source "../components/workbench";`。
- [ ] **Step 2: 不靠文件清单的护栏** — 新测试遍历 `apps/web/src/**/*.tsx`（排除 test），把 `className` 字面量里的 Tailwind 形态 token 提出来，若某文件有这类 token 而目录不在 `@source` 覆盖范围内则红（记忆：护栏别自己列文件清单，要遍历目录）。
- [ ] **Step 3: 证明扫描没被整体关掉** — 在 T19 的生产冒烟里对构建出的 CSS grep 一个**只**在 `components/workbench` 出现的 utility（记忆：派生式护栏可能恒真）。
- [ ] **Step 4: 旧页回归** — 改动前后各跑一次 `legacy-style-parity.mock.spec.ts`，并人工看一眼 `/new-project` 与 `/login`（该基线只采样 2 屏 × 5-6 元素，它的绿不是证明）。
- [ ] **Step 5: 提交** — `perf(workbench): Tailwind 扫描范围收到 components/workbench`。

## Task 15: PR-1 遗留 E（AppShell 死变体）与 F（useGlobalShortcut 重订阅）

**Files:** Modify `components/app-shell/AppShell.tsx`；Modify `shell/useGlobalShortcut.ts` + `useGlobalShortcut.test.tsx`

- [ ] **Step 1: E** — 删 `state:"project"` 分支与只服务它的两个 prop（`sidebarPanel` / `settingsHref`）；保留 `state` 属性本身（`data-app-shell-state` 被 `e2e/new-project-shell.mock.spec.ts:33` 断言）；**不要**连带删 `app-shell.module.css` 的 `.sidebarUtility`（disabled 按钮还在用）。`pnpm typecheck` 是主要门；跑 `new-project-shell.mock.spec.ts`。
- [ ] **Step 2: F** — latest-ref：`const ref = useRef(handlers); ref.current = handlers;` + effect 依赖 `[]`，内部读 `ref.current`。
- [ ] **Step 3: F 的测试 + 变异** — 宿主组件用**内联** handlers 重渲染 3 次，`addEventListener("keydown")` 只调用一次，且第 3 次渲染的 handler 能收到事件；**把依赖改回 `[handlers]` 必须红**（现有测试用模块级常量对象绕过了这个契约，是空洞的）。
- [ ] **Step 4: 提交** — 两个提交：`refactor(app-shell): 删除无消费者的 project 变体`、`fix(workbench): 全局快捷键改 latest-ref 不再重订阅`。

## Task 16: 导入图护栏扩到组件

**Files:** Modify `apps/web/src/lib/workbench/store/client-import-graph.test.ts`

- [ ] **Step 1: 扩入口** — `CLIENT_ENTRIES` 加入五个视图根 + `ShellChrome`（walker 已支持 `@/` 别名与 `.tsx`；对无法解析的本地 specifier 会抛错，加入前确认相对 import 都带扩展名）。
- [ ] **Step 2: 控制用例** — 加一条「视图静态 import `mock/demo.ts` 会红」的 positive control（临时 fixture 或直接断言 `isClientForbidden` 命中链），否则护栏对视图恒绿。
- [ ] **Step 3: 跑全绿 + 变异** — 把 T6 的动态 import 临时改成静态必须红，改回。
- [ ] **Step 4: 提交** — `test(workbench): 客户端导入图护栏覆盖视图入口`。

## Task 17: mock e2e 与受影响 spec

**Files:** Create `apps/web/e2e/workbench-pr3-flow.mock.spec.ts`；Modify `apps/web/e2e/workbench-shell.mock.spec.ts`、`apps/web/e2e/mobile-shell.mock.spec.ts`（如需）、`apps/web/e2e/frontend-error-states.mock.spec.ts`（如需）

- [ ] **Step 1: 模块流** — 载入示例站点 →（确认框视条件）→ 概览四卡非空且带「示例」→ 顶栏「清除示例」→ 确认 → 回空态（设计 §8）。
- [ ] **Step 2: 逐条核对既有断言**（清单见 research-seams §5.3）：h1 文本严格相等（五个视图的标题必须与 `nav.items.*` 一字不差）；`/overview` 的 `[data-wb-badge]` 计数 0（新概览**不得**自动灌示例）；顶栏唯一 `role="status"`；`[data-app-shell]` 内 0 个 `[style]` / `<style>`；Dialog 根恰好 1 个；`/settings` 的 `[data-wb-real-action]` 恰好 1 个；`legacy-style-parity` 的 `/overview` paddingLeft 为 `0px` 且该 spec **不装 mock API**（视图必须优雅降级）；`mobile-shell` 的 390px 无横向溢出 + `progressbar` 计数 0（概览不得放 `<progress>`）；`routes.fs.test.ts` 不得残留 `page="..."`。
- [ ] **Step 3: Q30 的 en 无中文断言** — 五个视图的框架容器（`data-wb-frame`）在 `sf_ui_locale=en` 下无中文字符、无 `workbench.` 路径；mock 正文不在作用域。
- [ ] **Step 4: 跑法** — 单条 `pnpm test:e2e:mock e2e/<file>`（不带 `--`）；端口 3200 固定、`reuseExistingServer: false`，要并行另跑一套就 `E2E_MOCK_PORT=3201`。
- [ ] **Step 5: 提交** — `test(workbench): PR-3 模块流与受影响 spec 更新`。

## Task 18: 文档同步

**Files:** Modify `docs/plans/2026-09-11-workbench-ui-port-design.md`、`docs/plans/2026-09-13-workbench-pr2-mock-domain.md`（只改残留表的归属行）、`docs/PROGRESS.md`、本计划末尾残留表

- [ ] **Step 1: 设计稿** — §4.1 原语清单补 `StatCard / Delta / EmptyState / ConfirmDialog / Toggle`（并注明 `Gauge` 仍留 PR-4）；§10 有意偏离补 Q19（提及率用 fuchsia）与「入场动画不移植」；§12 逐视图表补 Q17（本周排名变动改临界词清单）、Q18（三张卡）、Q5（数据源只有真实只读 + 用户导入）、Q6（GSC 行来源标记）；§6.5 补第四项发布前豁免；§14 追加 PR-3 评审处置段。
- [ ] **Step 2: PR-2 计划残留表** — :1011/:1012 两行归属改 PR-4（Q28），:1020 一行按 Q27 关闭并写明依据（DB CHECK + seeding），:1017/:1018/:1019/:1023 标记为「PR-3 已处理」。
- [ ] **Step 3: PROGRESS.md** — 加 PR-3 段：范围、五个视图、遗留六项已关闭、验证数字（T19 回填）、未上生产（PR-3b 才合 main）。
- [ ] **Step 4: 本计划残留表** — 逐条写「不在本 PR」的项与去向。
- [ ] **Step 5: 提交** — `docs(workbench): 设计稿与进度同步 PR-3 裁决`。

## Task 19: 验证与交付

- [ ] **Step 1: 静态四项** — `pnpm typecheck`、`pnpm lint`、`pnpm typecheck:e2e`、`pnpm lint:e2e`（各 exit 0）。
- [ ] **Step 2: 全量单测** — `pnpm test`；只允许 `apps/marketing/e2e/geo-kb-v2-fixtures.test.ts` 的 4 个基线失败，其余 0 红。
- [ ] **Step 3: 覆盖率** — `pnpm vitest run --coverage`；`lib/workbench/**` 与 `components/workbench/**` 都要 ≥80%（新视图 TSX 会计入；PR-1 就因此补过 10 个测试文件）。低于 80% 的文件逐个列出并补测，不加 exclude。
- [ ] **Step 4: 构建与纯度** — `pnpm --filter @sf/web build`；grep 确认 `lib/workbench/mock` 无 `Date.now` / `Math.random` / React / next-intl / `@sf/*`；grep 确认 `components/workbench` 无 `style={{` 与 `<style`；grep 确认无裸 hex。
- [ ] **Step 5: mock e2e** — `workbench-pr3-flow`、`workbench-shell`、`legacy-style-parity`、`mobile-shell`、`critical-flows`、`frontend-error-states`、`new-project-shell` 全绿。
- [ ] **Step 6: 生产 CSP 冒烟** — `pnpm --filter @sf/web build` 后 `pnpm --filter @sf/web exec next start --port 3300`（占位环境变量，生产模式 `SUPABASE_URL` 必须是 https），打开 `/login` 与一个工作台页：CSP 头无 `unsafe-inline`、脚本与样式带 nonce、console 无 CSP 违规；顺带验证 T14 的扫描范围（grep 构建 CSS 里只属于 `components/workbench` 的 utility）与动态 import 的 chunk 在 Turbopack 生产构建下正常（mock e2e 跑的是 `dev --webpack`，看不见这两件事）。
- [ ] **Step 7: 跨模型评审** — gpt-6-astra reasoning high，按面拆（每面一个攻击面 + ≤4 个上下文文件，diff 落成文件，明令不要广泛 grep；被调函数的定义文件必须在清单里）。建议三面：①诚实性（概览 / 本周 / 档案的文案与空态）②真实与示例的分区（站点卡三态、数据源、gscRowsSource 的所有读点）③a11y 与 CSP（原语的焦点/aria、触控、无 inline style）。判据是 verdict 行；必须读它标 unresolved 的段落。逐条裁决并回写设计稿 §14。
- [ ] **Step 8: 交付** — `git branch --show-current` = `feat/workbench-pr3-first-views`；`git push -u origin feat/workbench-pr3-first-views:feat/workbench-pr3-first-views`；`git rev-parse origin/feat/workbench-pr3-first-views` == HEAD；`gh pr create --base feat/workbench-ui-port`，描述含范围、Q1-Q30 摘要、验证数字（在最终 HEAD 上跑的）、遗留六项的关闭证据、评审处置、残留表；结尾 `🤖 Generated with [Claude Code](https://claude.com/claude-code)`。

---

## 不在本 PR（残留与去向）

| 项 | 去向 |
|---|---|
| 关键词研究 / 词库 / 竞品概览 / 技术审计 / AI 可见度 | PR-4 |
| 内容生成 / 事实知识库 / 答案页 / 外链 / 产物中心 | PR-5 |
| `ui/Gauge`（`<progress>` + `data-tone` 规则已在 `workbench.css`，PR-3 无消费者） | PR-4（技术审计） |
| 竞品域名总览 CSV 表头 `domain` 会把公司名标成域名；缺口表 `ours === null` 必须渲染「—/未知」不能用原型的「无」 | PR-4（Q28 归属修正；判据在此交接） |
| 真正的「排名变动」区块：需要关键词排名历史（两次以上 GSC 导入 + 持久化形状变更，要升 `PERSISTED_VERSION`） | 后续 PR（Q17） |
| `visPartial` 的 UI 消费与写盘 debounce | PR-4（可见度视图） |
| 运行租约 / 跨标签运行归属（写盘边界的毫秒级窗口已接受风险） | PR-4 |
| 真实 OAuth 连接 / 断开仍在旧页 `sources`（回调重定向硬编码 `/p/{id}/sources`） | 接真实数据的批次 |
| 示例 GSC 词表（`DEMO_GSC_TEXT` / `DEMO_SEEDS`）对任何行业都一样 | 按行业派生另议；本 PR 用 `gscRowsSource` 标注示例来源 |
| `ArtifactType` 缺 `txt`（`llms.txt` 下载名会变 `llms.md`）、CSV 下载 BOM、关键词 CSV 行数上限 | PR-4 / PR-5（PR-2 R17） |
| 集成分支合 main 前要 rebase（origin/main 已前进） | PR-3b |

