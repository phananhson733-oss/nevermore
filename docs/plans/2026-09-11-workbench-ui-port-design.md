# app.gengrowth.ai 新工作台 UI 移植设计

日期：2026-09-11
状态：rev6，已过跨模型评审（gpt-6-astra REVISE 15 条 + 自审 8 条，处置见 §14）与三轮 spec 一致性审阅（第三轮 Approved；其建议已采纳）；§13 三项已由 Owner 于 2026-09-11 拍板
基线：`origin/main` f28a1900

## 0. 一句话

把 Owner 在 `phananhson733-oss/opengengrowth` 里做好的新工作台前端（外观）和 `geo-seo-workbench.jsx`（交互行为）分层移植进现有 `apps/web`（Next.js App Router），保留登录、项目作用域、80+ 条 API 路由与数据层；页面先以原型的 mock 数据渲染并全部标「示例数据」，后续逐页接真实 API。

## 1. 两份来源与分工

| 来源 | 是什么 | 在本设计中的角色 |
|---|---|---|
| `opengengrowth`（GitHub，35 文件 / ~5k 行，Vite + Tailwind v4 + React 19） | 同一设计的视觉重做：深色侧栏、`#FAF9F6` 纸底、Plus Jakarta Sans、左输入 / 右输出布局；静态（按钮不响应、`defaultValue`、报告写死） | **外观与页面结构的依据** |
| `geo-seo-workbench (1).jsx`（3221 行单文件，内联 CSS） | 功能原型：开机流程、多站点、⌘K、产物筐抽屉，每个模块「设参数 → 运行（步骤进度）→ 报告（多 tab）→ 存产物 / 复制 / 导出」的 seed 确定性 mock 逻辑 | **交互行为、状态模型、mock 逻辑的依据** |

两份文案基本一致、导航同为 6 组，但**不是可互换的**（评审 F15）：侧栏徽标语义不同、opengengrowth `App.tsx` 有重复分支（`reports` / `settings` 各渲染两次，视为缺陷不视为需求）、审计目标一边可编辑一边只读。§12 的逐视图对照表是两者冲突时的裁决记录，每批页面开工前必须先填完该批的行。

差异裁决：加回 jsx 的「词库」（saved），删掉 opengengrowth 的模板残留 `locations`（及 StatCard / TrafficChart / WorldMapPlaceholder）。

## 2. 已裁决事项（2026-09-11 与 Owner 对齐）

1. 落点：移植进现有 Next.js 应用，不是整体换成 Vite SPA，也不是平行部署。
2. 上线方式：新 UI 上生产成为默认；现有有真实数据的旧页面先保留可达，接真一页删一页。
3. i18n：界面文案走 next-intl（en + zh-CN 同步），mock 内容保持中文留在 mock 层。
4. 方案：分层移植（mock 纯函数 + 按项目分区的 store + 小文件视图），不照抄搬运，不先接真。
5. 技术选择：Tailwind 不引 preflight；侧栏站点卡前三行（域名 / 市场 / GSC）用真数据、第四行审计时间来自本地 mock 并标「示例」；路由冲突按 §4.2 处理。
6. **权威关系**：本设计由 Owner 直接指令，取代仓库 `CLAUDE.md` 与 `nav-model.ts` 所称的「v0.4 四模块客户壳」信息架构。PR-1 同步更新 `CLAUDE.md`（当前权威一行）与 `docs/PROGRESS.md`，记录「客户壳 IA 改为工作台 15 项；API / schema / 规则合同不变」。`authority/implementation-spec-v0.4` 不动——它冻结的是 API / 表 / 规则，不是页面壳。

## 3. 范围

**做**

- 新壳：侧栏（6 组 15 项 + 站点卡 + 徽标）、顶栏（项目切换、⌘K、「示例数据」chip、产物筐、语言、账号；照 opengengrowth `Header.tsx`，**不放**市场 / GSC / GA4 pill：市场与 GSC 在侧栏站点卡，GA4 真实状态只在数据源页）、命令面板、产物筐抽屉、移动端侧栏抽屉。
- 15 个页面：概览、本周变化、关键词研究、词库、竞品概览、技术审计、AI 可见度、站点档案、数据源、外链、内容生成、事实知识库、答案页 / 报告、产物中心、设置。
- mock 域层（纯函数）+ store（reducer + localStorage 持久化）。
- i18n chrome、单测、mock e2e、生产构建 CSP 冒烟。

**不做（另立项）**

- 开机流程（产品信息 → 数据源 → 建立工作台）：现有 `/new-project` + `/context` + `/setup-sources` 继续用；`/new-project` 因此暂时保留旧 `AppShell` 外观，两套 chrome 在这一页交界（有意，开机流程立项时消除）。
- 任何页面接真实 API。
- 删除旧页面（**`settings` 除外**，见 §4.2）、旧 `AppShell`（`/new-project` 仍用）、旧 CSS Modules。
- v0.4 范围外的能力（成员 / 席位 / 套餐 / Billing / API key）：设置页不做这些区块（§13 D2）。

## 4. 壳与路由

### 4.1 目录

```
apps/web/src/
  app/p/[projectId]/
    layout.tsx                 换用 WorkbenchShell（替代 AppShell）；保留 operator 解析、
                               workspace 作用域与外部项目 404 的现有逻辑不动
    overview/                  新概览
    week/ keywords/ keyword-library/ competitors/ audit/ visibility/
    profile/ data-sources/ links/ content/ kb/ answers/ artifacts/ settings/
                               各一个薄 page.tsx，渲染一个 client 视图
    legacy/overview/           旧概览 git mv 搬入：目录内相对 import 不变，两处向上引用（`../_e2e-shell`、`../_problem-display`）各加一级
    growth-map/ execution/ results/ context/ sources/ diagnosis/ plan/
    studio/ report/ setup-sources/
                               原地不动
  components/workbench/
    shell/    WorkbenchShell, ShellChrome, Sidebar, Topbar, CommandPalette, ArtifactDrawer,
              workbench-nav（新导航模型；旧 components/app-shell/nav-model.ts 原地保留，
              旧页与其测试仍用）, useProjectShellEffects
    ui/       PageHead, InPane, OutPane, Field, RunningSteps, DemoChip, Chip,
              Gauge, Tabs, Dialog（焦点管理共用）
    views/<module>/            每模块一目录：主视图 + 输入面板 + 每个报告 tab 各一文件
  lib/workbench/
    mock/     rng, gsc-parse, audit, visibility, keywords, competitors, links, kb,
              content, answers, builders（jsx 的 B.*）, csv, demo
    store/    types, schema（zod）, reducer, selectors, persistence, WorkbenchProvider, hooks
    routes.ts 段名表 + 「旧版页面」映射表
```

约束：视图文件 ≤ 400 行、函数 ≤ 50 行、嵌套 ≤ 4 层；相对 import 带 `.ts` 扩展名；`lib/workbench/mock` 不 import React、不 import `@sf/engine`（客户端不能拉 barrel）；strict TS（`exactOptionalPropertyTypes` / `noUncheckedIndexedAccess`）下移植 jsx 的松散对象要逐个补类型，不用 `any`。

### 4.2 段名冲突

| 段 | 现状 | 处理 |
|---|---|---|
| `overview` | 旧概览页（真数据两卡） | 新概览接管；旧页搬到 `legacy/overview`。根 `page.tsx` 重定向仍指 `/overview`，**但在新概览可用（§9 首个生产发布）之前不合入 main** |
| `sources` | 旧数据源页（真实 GSC OAuth） | **旧页原地不动**。OAuth 回调重定向、`source-connect.ts`、`hooks-sources.ts` 及 ~20 个文件（含需 Postgres 的集成测试）指向它。新数据源页用 `data-sources`；接真时把 OAuth 落点切过来并删旧页 |
| `settings` | 旧设置页（唯一动作：`useDeleteProject`，117 行） | 新设置页接管，旧页删除。PR-1 阶段的新设置页 = 「页面开发中」占位 + §6.6 的真实删除区块；PR-3 补齐通知偏好与数据源区块 |

### 4.3 壳的行为

- **侧栏**：分组和标签走 `workbench.nav.*`；`aria-current="page"` 标当前项；徽标语义按 opengengrowth（外观权威）：技术审计 = 健康分、AI 可见度 = 提及率 `%`、关键词研究 = 候选数、产物中心 = 产物数，其余项按 jsx `counts`（词库、竞品、外链、知识库缺口、数据源行数）；值来自 §6.3 的 selectors；**未 hydrate → 徽标位渲骨架；已 hydrate 但该模块未运行 → 不显示徽标**（不显示 0）；审计运行中（`audit = null`）同样不显示，不回退到 `lastAudit`。侧栏底部 jsx 的「Pro 套餐，N 个站点」改为只显示站点数（`projectOptions.length`）。
- **站点卡**（照 opengengrowth `Sidebar.tsx` 的四行：域名 / 市场 / GSC / 审计）：域名 = `ProjectShellProject.host`；市场 = 主站点 `market_codes[0]`（`ProjectShellProject` 增加 `marketCode` 字段，从 `SiteRow` 取，总是真实存在）；GSC = 真实连接状态（`sources` 的 GSC connection 是否已连接；PR-1 先显示「—」，PR-3 数据源批接上）；审计 = store 里 `lastAudit.at`（本地 mock 结果），有值时紧跟一个「示例」小标，没有则「—」；站点卡不放 GA4 行（照 opengengrowth 四行）。**真实与 mock 分开标注**（评审 F12）：前三行是真数据不标，第四行标「示例」；数据源页里 mock 导入的行数徽标同样带「示例」。
- **顶栏**：复用现有 `ProjectSwitcher`；「＋ 新建站点」→ `/new-project`；「搜索 / 跳转 ⌘K」按钮（打开命令面板，关闭后焦点回到它）；保留 `LocaleSwitch` 与 `signOutAction` 账号菜单；「示例数据」chip（`demo` 为真时显示「示例站点」并带「清除示例」）；「产物筐 N」开抽屉；storage 不可用时的「本次结果不会保存」提示（§6.5）。
- **命令面板 / 产物筐抽屉**：都是 `role="dialog" aria-modal="true"`，有 `aria-labelledby`；打开时焦点进入（面板进搜索框、抽屉进关闭按钮），关闭时焦点回到触发按钮；焦点圈在对话框内（Tab 循环）；背景 `inert`；Esc 关闭；⌘K / Ctrl+K 切换面板。面板列表项是 `role="option"` 的按钮，不是可点 div。
- **移动端侧栏**：`aside` 关闭时 `inert`（不只是 `translate-x`），遮罩可点关闭，开合按钮带 `aria-expanded` / `aria-controls`。
- **旧壳的副作用必须保留**（自审 M1）：`_nav.tsx` 里两个副作用与视觉无关但旧页依赖——`withProjectHistoryPosition`（Studio 取消 Back/Forward 后回退用）和 `_context-navigation-guard`（Context 未保存离开确认）。抽成 `useProjectShellEffects` hook，在新 Sidebar 挂载；`studio-workspace.mock.spec` 与 `product-profile.mock.spec` 作为回归门。
- **90 天 program 进度**（`SidebarProgress` / `program day`）：**明确退役**，不进新壳；`mobile-shell.mock.spec` 相应断言删除；`appShell.program*` 文案键随之删除（en / zh-CN 同删）。
- **「旧版页面 →」**：与旧页重叠的新页面在 `PageHead` 右侧放链接，可多个。完整映射：

| 新页 | 旧页 |
|---|---|
| 概览 | `legacy/overview` |
| 关键词研究 / 词库 / 竞品概览 | `growth-map` |
| 技术审计 | `growth-map`（`diagnosis/page.tsx` 只是到 growth-map 的兼容重定向，不是可渲染旧页，不单列；2026-09-11 计划审阅第二轮更正） |
| 站点档案 | `context`、`setup-sources` |
| 数据源 | `sources` |
| 内容生成 | `studio`、`execution`（`plan` 会 308 到 execution，不单列） |
| 答案页 / 报告 | `results`（`report` 会 308 到 results，不单列） |
| 本周变化 / AI 可见度 / 外链 / 知识库 / 产物中心 / 设置 | 无 |

旧页在新壳内渲染时侧栏无高亮项；旧页自己的页内导航（`_compatibility-route.ts` 的 plan→execution、report→results 重定向）不动。

- **页标题约定**：`globals.css` 对 `[data-app-page-title]` 有 `font-size: clamp(32px,3vw,48px) !important` 等规则，与设计稿 24px 的 h1 冲突（自审 M2）。新页面用 `data-wb-page-title=""`，每页一个 `<h1>`；`page-title-typography.test.ts` 的清单去掉 `settings/_settings.tsx`、`overview` 改为 `legacy/overview`。skip-to-content 链接与 `#main-content` 保留。

## 5. 样式

- 依赖：`tailwindcss@^4.1`、`@tailwindcss/postcss`、`tw-animate-css`、`clsx`、`tailwind-merge`。接法照 `apps/marketing`。
- 新建 `apps/web/src/app/workbench.css`，由根 `layout.tsx` 在 `globals.css` 之后 import（`@import` 必须位于文件顶部，所以不并进 `globals.css`）：

```css
@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);
@import "tw-animate-css";
@theme { --font-sans: var(--font-wb), "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; /* 色板 token */ }
@layer base { .wb-reset, .wb-reset :where(button, input, select, textarea, h1, h2, h3, p) { /* 最小 reset：box-sizing、margin、font、border、background */ } }
```

- **不引 preflight**。reset 放 `@layer base`，被 `utilities` 层压过（评审 F4）；`box-sizing: border-box` 与 `border-style: solid` 这两条 preflight 默认必须在 reset 里补上，否则 `border` 工具类无效。
- **reset 作用域不包住 `<main>`**（评审 F4 / 自审）：`wb-reset` 只挂在壳的 chrome（侧栏、顶栏、抽屉、面板）和每个新视图的根 `<div>` 上；旧页在 `<main>` 内不带这个类，CSS Modules 像素不变。验证对象不是全页截图（新壳本来就不同）而是**旧页内元素的计算样式**：`e2e/legacy-style-parity.mock.spec.ts`（固定 `colorScheme: "light"`，且是 PR-1 的**第一个** commit，早于 `workbench.css` 与 `data-theme` 落地）在改动前对 `growth-map` 与 `sources`（原定 `context`，其读接口不在 mock 路由表里，快照不稳定；2026-09-11 计划审阅第四轮更正）的 `#main-content` 内 `[data-app-page-title] / h1 / button / p / input / a` 记录与宽度无关的计算样式（字体、颜色、边距、边框、圆角）为基线 JSON；PR-1 之后每次跑都必须与基线逐属性相等。
- 字体：`Plus_Jakarta_Sans` 走 `next/font/google`（构建期自托管，满足 `font-src 'self'`），变量 `--font-wb` 在根 layout 注入；`@theme` 把 `--font-sans` 绑到它，`font-sans` 工具类才真正生效。已验证旧 CSS 不使用 `--font-sans` / `--color-*`，无变量冲突。
- 设计 token 放 `@theme`：`--color-wb-paper #FAF9F6`、`--color-wb-rail #1f1e1c` / `-rail-2 #2a2927` / `-rail-3 #333230`、`--color-wb-seo #1a653b`、`--color-wb-geo #8b5cf6`、`--color-wb-emerald #10b981`；「示例」琥珀用 Tailwind 内置 `amber-50/200/700`（原型即如此）。组件里不写裸 hex。新壳固定浅色（opengengrowth 没有深色版）；根 `layout.tsx` 给 `<html>` 加 `data-theme="light"`，旧 `globals.css` 的 `:root:not([data-theme="light"])` 深色分支因此对全站关闭——否则 OS 深色下旧页会以深色嵌在浅色壳里。这是有意退役 OS 深色跟随。
- **CSP 硬约束**：生产 `style-src 'self' 'nonce-…'`，无 `unsafe-inline`。新代码禁止 `style={{}}` 和 `<style>`；jsx 的 `<style>{CSS}</style>` 与仪表 `style={{width}}` 全部改为编译期 CSS：仪表用 `<progress>`，样式在 `workbench.css` 的 `.wb-reset :where(progress)` 规则里（PR-1 随退役 `SidebarProgress` 一并落地），`ui/Gauge` 组件在 PR-4 首个消费者出现时再建，颜色档用 `data-tone="seo|warn|bad"` 属性选择器。**mock e2e 跑的是 dev CSP（有 `unsafe-inline`），看不见违规**（评审 F5）：PR-1 起每个 PR 跑一次 `next build && next start` 的生产模式冒烟，页面 console 无 CSP violation 才算过。
- 不引 recharts / motion。图标用现有 `lucide-react@^1.25`。

## 6. 状态与 mock 域层

### 6.1 项目状态 `WorkbenchProjectState`（按 projectId 分区）

```
profile        { url, brand, positioning, features, competitors, market }
profileDoc     { crawl: CrawlSignals|null, gsc: GscSignals|null, third: CrawlSignals|null, ai: AiDoc{summary, icp[], value_props[], diff[], pillars[], facts[], tone}, at } | null
conns          { GSC: boolean, GA4: boolean }   ← 仅 mock 侧的「导入」状态，与真实连接状态分开
gscRows        解析后的 GSC 行（用户粘贴或示例）
seeds          关键词种子（多行文本）
built          是否已建关键词矩阵
saved          词库 [{ q, addedAt, source }]
audit          当前审计报告 | null；auditHistory ≤ 12；lastAudit | null
visResults     可见度结果 []；visHistory ≤ 12；lastVis | null
compData       竞品数据 | null
plans          答案页方案 []
targets        外链目标 []
kb             事实知识库 | null
artifacts      产物 [{ id, at, module, type, engine, title, content, filename? }]，上限 50
notify         通知偏好 { weekly, drop, mention, gsc }（原 jsx `ws.notify`，本地 mock；默认 { true, true, false, true }）
demo           boolean，是否已载入示例站点（§6.7）
```

### 6.2 工作区状态（评审 F10，§13 D2 已裁决）

jsx 的 `ws`（`plan / apiKey / members / notify / usage`）是工作区级、非项目级，且成员 / 套餐 / API key / 用量都在仓库 `CLAUDE.md` 的 v0.4 范围外。**不建工作区 store**：设置页只有三个区块——通知偏好（并入项目状态 `notify`，本地 mock）、数据源（读真实连接状态 + mock 导入）、删除站点（§6.6）。jsx 设置页的站点列表（含各站产物计数）也裁掉：站点切换只在顶栏 `ProjectSwitcher` 与命令面板。侧栏底部 jsx 的「Pro 套餐，N 个站点」改为只显示站点数（`projectOptions.length`）。

### 6.3 派生 selectors（评审 F8）

不入库、从状态计算，放 `store/selectors.ts`，每个都有单测：

- `seedList(state)`：`seeds` 按换行 / 逗号切分去空。
- `keywordRows(state)`：`buildRows(seedList, profile, gscRows)`；输入完整列出，`useMemo` 依赖与之一致。
- `gatedRows(state)`：`built ? keywordRows : []`。概览、本周变化、AI 可见度、关键词研究用 gated；词库、内容生成、竞品用 ungated（照 jsx）。
- `picked(state)`：`saved.map(x => x.q)`。
- `counts(state, keywordRowCount)`：§4.3 的徽标值；`null` 表示不显示，不用 0 顶替；`audit = null`（未跑或运行中）→ `null`。`keywordRowCount` = `built ? gatedRows.length : null`（gate 在注入函数内做），而 `buildRows` / `keywordRows` / `gatedRows` 都在 PR-2——PR-1 的 `WorkbenchProvider` 接受可选的 `deriveKeywordRowCount(state): number | null`；PR-2 在 **client 模块**（`ShellChrome` 或 provider 自身）import 真实函数传入——server `layout.tsx` 不能给 client 组件传函数 prop；之前徽标为 `null`。AI 可见度徽标读 `visResults`（同 jsx `counts`）：`visStart` 清空后徽标消失、`visProgress` 中间态随之变化，运行中不回退到 `lastVis`，与审计一致。

### 6.4 reducer 转换（评审 F6 / F9）

纯函数、不可变更新；**时钟与 id 由 action 携带**（`now`、`id` 在 hook 层生成），reducer 不读 `Date` / `Math.random`。

- `auditStart`：`audit = null`，`lastAudit` 不变（运行中仍可看上次）。
- `auditComplete(report)`：若 `lastAudit` 存在则 `auditHistory = [...history, lastAudit].slice(-12)`；`audit = lastAudit = report`。历史不含当前报告（视图的 delta 计算依赖这一点）。
- `auditCancel`：运行被丢弃（切页 / 切项目 / 重跑）时派发，`audit = lastAudit`（回到上次报告，不留空）。
- `visStart`：`visResults = []`。
- `visCancel`：`visResults = lastVis?.results ?? []`。
- `visProgress(results)`：`visResults = results`，不动 `lastVis` / `visHistory`（jsx 边跑边 push 的中间态）。
- `visComplete(results, at)`：若 `lastVis` 存在则归档入 `visHistory`（≤ 12）；`visResults = results`；`lastVis = { at, results }`。（jsx 用「从空变非空」判定同一件事；拆成两个 action 后判定不再依赖前态。）
- 其余：`patchProfile`、`setProfileDoc`、`setConns`、`setGscRows`、`setSeeds`、`setBuilt`、`setSaved`（写 `saved`；按词保留已有 `addedAt` / `source`）、`setCompData`、`setPlans`、`setTargets`、`setKb`、`setNotify`、`addArtifact`（前插，超 50 丢最旧）、`removeArtifact`、`clearArtifacts`、`loadDemo(payload)`——payload 由 PR-2 的 `makeDemoSite` 产出，**逐字段写入**：`conns, gscRows, seeds, built, saved, audit, auditHistory, lastAudit, visResults, visHistory, lastVis, compData, plans, targets, kb, artifacts`，并置 `demo = true`；**不写** `profile`（六个字段全部保留，示例文本里的品牌名用真实 `profile.brand` 生成）、`profileDoc` 只写 `crawl / gsc / third` 三个信号，`ai` 用 `DEMO_AI` 但 `summary / facts` 里的「GenGrowth」由 `makeDemoSite` 替换为真实 brand、`notify` 不动、`clearDemo`（与 `loadDemo` 对称：只把它写过的 16 个字段回初始值并置 `demo = false`，**不动** `profile` 与 `notify`）、`reset`（全量回 §6.7 初始值，只在真实删除项目等场景用）。
- **hydration 归一化**：运行中刷新 / 切项目会把 `audit = null`、`visResults = []` 持久化下来而没人派发 cancel；provider 读盘后先过 `normalizeInterrupted(state)`：`audit === null && lastAudit` → `audit = lastAudit`；`visResults.length === 0 && lastVis` → `visResults = lastVis.results`。纯函数，有单测。
- **运行归属**：每次运行持有 `{ projectId, runToken }`；完成时若 provider 的 projectId 或当前 runToken 已变（切项目、重跑、离开页面），结果丢弃。步骤动画不跨路由存活。

### 6.5 持久化与 hydration（评审 F6 / F7 / F14）

- `persistence.ts` 接受注入的 `Storage` 接口（单测传假对象）。键：`gg.workbench.v1.<projectId>`，只此一种。
- 读：`try/catch` 包住 `getItem`（隐私模式会抛）；JSON 解析后过 zod schema（`store/schema.ts`），版本不符或形状不对整体丢弃回默认；**storage 不可用时进入 volatile 模式**，内存可用、不写盘，顶栏提示「本次结果不会保存」。
- 写：`try/catch`；`QuotaExceededError` 时提示并停止写入（不裁剪用户数据）。
- 时序：`WorkbenchProvider` 以 `key={projectId}` 挂载，切项目必重挂；挂载后读盘 → `ready = true`；**`ready` 之前不写盘、侧栏徽标与视图都渲骨架**。
- 多标签：监听 `storage` 事件，同键变化时以磁盘为准重载（最后写入者赢，不合并）。
- 清理：真实删除项目成功后删该键；`signOutAction` 前清 `gg.workbench.*`（同一浏览器换账号不串数据）。
- 隐私：用户在 mock 页输入的内容（粘贴的 GSC 导出、档案文本、种子词）是用户数据，不因周围是 mock 而降级；只存本地、不上传、登出即清。

### 6.6 真实删除项目（评审 F11）

新设置页的「删除站点」只对**当前项目**生效，绑定 `projectId`，复用现有 `useDeleteProject` 与 `projectSettings.delete.*` 文案（含错误态、确认态）；区块视觉上与 mock 区块区分（无「示例数据」chip，标「真实操作」）；成功后清本地键、`router.replace("/")`、`router.refresh()`（根路由已处理「无项目 → /new-project」）；jsx 的「只剩一个站点时禁删」不实现（现有产品允许删到零）。

### 6.7 初始值与示例站点（自审 M4，§13 D1 已裁决）

新项目只灌真实字段：`profile.url`（host）、`profile.brand`（clientName）、`profile.market`（主站点 `market_codes[0]`，创建项目时必填，总是存在）。这三项是真实项目的镜像：provider 每次挂载都用 `ProjectShellProject` 覆盖它们（持久化里的旧值不算数），站点档案页对这三项只读，只允许编辑 `positioning / features / competitors`。`positioning / features / competitors / profileDoc` 一律为空——jsx 的 `DEMO_PROFILE` 描述的是 GenGrowth 自己，灌给别人的项目就是撒谎。空态由各页的 empty 文案承接。

**「载入示例站点」**：概览空态处一个显式按钮，调用 jsx 的 `makeDemoSite(profile, level, seeds)`——`level = "full"`、`seeds` = jsx `DEMO_SITES` 第一档的四个演示种子词（这两个常量抽到 `mock/demo.ts` 作 `DEMO_LEVEL` / `DEMO_SEEDS`，`DEMO_SITES` 本身不移植）——生成整套演示结果（审计、可见度、关键词、竞品、外链、知识库、产物、历史），一次 `loadDemo` action **整体覆盖**当前项目的模块结果字段并置 `demo = true`；若当前状态已有用户输入（`gscRows` / `saved` / `seeds` 非空）先弹确认。`demo` 为真时顶栏「示例数据」chip 变为「示例站点」并带「清除示例」按钮，点击后确认再 `clearDemo`（只清示例写过的模块结果与 `gscRows / seeds / saved / conns`，确认框写明「会清掉当前的 GSC 行与词库」；用户的档案编辑与通知偏好保留）。示例结果的 `profile.url / brand / market` 仍是真实项目的，只有模块结果是演示的；不会无提示自动灌入。

### 6.8 导出与产物的来源声明（评审 F12）

- 每个产物 `content` 顶部固定一行来源声明（随 locale）：「示例数据：本地生成的演示结果，非实测；生成于 <at>」；CSV 加注释行 `# sample-data`。复制、下载、抽屉预览都带。
- 交给 AI 的 prompt 构造器（`B.fixTask` 等）：用户可控字段（技术栈、档案文本、GSC 行）作为围栏数据块序列化，不拼进指令句。
- 报告文案不出现「已实测」「已修复」等未发生的动作。

### 6.9 mock 模块清单（来自 jsx）

`hashOf / rngOf`、`toCSV / esc`、`slugify / domainOf`、`parseJSON / parseGSC / gscStatus / classify`、`sitePages`、`FIND_LIB / runAudit`、`kwMetrics / serpTop`、`PLATFORMS / mockVisibility / localPromptSet / PROMPT_KINDS`、`LINK_POOL / mockLinks / LINK_TYPES`、`PATTERNS / AI_PATTERNS / opportunity / buildRows`、`GEO_RULES`、`B.*`、`ASSETS / fallbackOutline`、`KB_CATS / seedKB`、`fallbackPlan`、`COST`、`domainStats / keywordGap`、`daysAgo / withinDays`、`crawlSignals / gscSignals`。`makeDemoSite / demoGSC / DEMO_AI` 供 §6.7 的「载入示例站点」使用；`DEMO_SITES`（两个写死站点）不移植。

## 7. i18n（评审 F13）

- `workbench` 命名空间：`nav.groups.*`、`nav.items.*`、`shell.*`、`common.*`、`<module>.{title, subtitle, params.*, tabs.*, empty.*, steps.*, actions.*}`、`provenance.*`（§6.8 的声明句）。
- **枚举不用中文字面量**：严重度 `high | mid | low`、引擎 `seo | geo | both`、GSC 状态 `ranked | borderline | gap | unknown`、产物类型 `csv | prompt | md | json`，显示时查 `workbench.enums.*`。jsx 里 `sev === "高"` 这类比较全部改成 id。
- 带数字的动态文案走 ICU：`tabs.history: "History ({count})"`；产物标题 `audit.artifactTitle: "Audit report {score}"`。消息里避免裸 `{` `'`（ICU 语法字符）。
- 英文用户会看到英文 chrome + 中文 mock 内容：「示例数据」chip 的 title 说明「示例内容当前仅中文」。翻译句里不拼中文 mock 片段——mock 自由文本只作为独立块渲染。
- 除 key parity 外，`workbench-shell.mock.spec` 设 `sf_ui_locale=en` cookie（locale 只由这个 cookie 决定，默认 zh-CN）跑一遍，断言 chrome 里没有中文字符、没有 `workbench.` 形式的漏译路径（next-intl 缺 key 渲染路径不抛错）。
- `projectSettings.delete.*` 两语种保留；`appShell.program*` 两语种删除。

## 8. 测试

- **单测**（vitest `unit`，node 环境；组件不可渲染）：mock 函数（同 seed 同输出、分数区间、CSV 转义、`parseGSC`、`classify`）；selectors（§6.3 每个）；reducer（§6.4 每个转换：两次连跑、运行中重置、中间态不归档、历史封顶）；persistence（注入假 Storage：回环、版本 / 形状不符丢弃、getItem 抛错 → volatile、setItem 配额 → 停写）；routes / nav-model。
- **mock e2e**（Playwright，保留项目 id 夹具，dev-only 的 `_e2e-shell.ts` 门不放宽）：
  - `workbench-shell.mock.spec.ts`（PR-1）：15 项导航可达且 `<h1 data-wb-page-title>` 正确；`aria-current`；⌘K 跳转与焦点回退；抽屉焦点圈与 Esc；移动端侧栏 `inert`；旧版链接落到旧页；设 `sf_ui_locale=en` cookie 后 chrome 无中文字符、无 `workbench.` 漏译路径；壳内无 `style` 属性与 `<style>` 元素（CSP 代理断言）；真实删除项目（mock API 兑现 DELETE）后 localStorage 键被清。
  - `workbench-lifecycle.mock.spec.ts`（PR-4，随审计流落地）：审计运行 → 报告 → 五个 tab → 存产物 → 徽标变化 → 刷新仍在 → 运行中切页结果被丢弃。切项目隔离不做 e2e（`_e2e-shell.ts` 只放行一个保留 id），由 `key={projectId}` 重挂 + persistence 键前缀单测保证。
  - 每批一条模块流。
  - **旧页样式回归**：`legacy-style-parity.mock.spec.ts`，口径见 §5（计算样式基线，非截图）。
  - PR-3 的模块流：载入示例站点 → 概览四卡非空且带「示例」→ 清除示例（确认）→ 回空态。
- **生产模式冒烟**：`pnpm --filter @sf/web build && next start`，用 Playwright 打开壳与一个模块页，断言 console 无 `Content Security Policy` 违规。
- **受影响旧 spec 全量盘点**（评审 F14）：PR-1 第一件事是列出 `e2e/*.spec.ts` 中引用 `data-app-shell*`、`Project sections` 导航、`/overview`、`/settings`、program 进度的每一处，逐条标「改指向 legacy / 改选择器 / 删除」。已知至少：`critical-flows`、`a11y`、`mobile-shell`、`overview-read-model`、`frontend-error-states`、`complete-four-module-workbench`、`page-title-typography.test`、`_nav.test`、`layout.test`、`settings/_settings.test`。
- **覆盖率门**（自审 M5）：根 `vitest run --coverage` 有 80% 阈值；PR-1 先跑一次看新增 TSX 是否被计入。若计入，为 `components/workbench/**` 建 jsdom 组件测试项目，不改阈值、不加 exclude 掩盖。
- 每个 PR：`pnpm typecheck`、`pnpm lint`、`pnpm test`、相关 mock e2e、生产冒烟。

## 9. 交付（评审 F1；§13 D3 已确认）

| PR | 内容 | 合入 |
|---|---|---|
| PR-1 地基 | Tailwind + 字体 + token；**store 全套**（types / schema / reducer / selectors / persistence / provider / hooks + 单测，壳要读它）；shell 全部文件（`WorkbenchShell / ShellChrome / Sidebar / Topbar / CommandPalette / ArtifactDrawer / workbench-nav / useProjectShellEffects`）+ `ui/{Dialog, PageHead, DemoChip, LegacyLinks}`；15 条路由（未实现页显示「页面开发中」+ 旧版链接）；overview 搬 legacy（含 `../` import 修正）；settings = 占位 + 真实删除；`ProjectShellProject.marketCode`；i18n chrome；spec 盘点与修复；`proxy.ts` / `_compatibility-route.ts` 复核；CLAUDE.md / PROGRESS 更新 | 集成分支 `feat/workbench-ui-port` |
| PR-2 mock 域层 | `lib/workbench/mock/*`（jsx 纯函数移植 + 单测）+ `keywordRows` / `gatedRows` selector + 把 `deriveKeywordRowCount` 接进 provider | 集成分支（只与 PR-1 的 `types.ts` 有类型依赖：PR-1 先定类型，PR-2 按类型实现；PR-2 的 provider 接线一行在 PR-1 合入后再补） |
| PR-3 | 概览（含「载入示例站点」）、本周变化、站点档案、数据源、设置（补齐通知与数据源区块） | 集成分支 |
| PR-3b | 集成分支 → main（独立 PR，独立评审） | **首次上生产** |
| PR-4 | 关键词研究、词库、竞品概览、技术审计、AI 可见度 | main |
| PR-5 | 内容生成、事实知识库、答案页 / 报告、外链、产物中心 | main |

理由：根路由落在 `/overview`，PR-1 单独上生产会让每个登录用户先看到一张占位页；首个生产版本至少要有概览可用。PR-4 / PR-5 期间未实现页的「页面开发中」占位来自 opengengrowth 自身的 fallback 设计。

每个 PR 单独跨模型评审后合并。

## 10. 相对设计稿的有意偏离

- 顶栏多了账号菜单与语言切换。
- 站点切换用现有 `ProjectSwitcher`，不是 `<select>`。
- 侧栏站点卡前三行是真数据，第四行审计时间是本地 mock 并标「示例」；真实连接状态与 mock 行数分开标注。
- 无 recharts / motion；无 `locations`；不含开机流程；不含 90 天 program 进度。
- 审计目标 URL 只读（是真实项目 host，照 jsx 而非 opengengrowth）。
- 命令面板、抽屉、移动端侧栏补齐 dialog 语义与焦点管理。
- 产物与导出带来源声明。

## 11. 风险

- 旧页面进入新壳后内容区宽度 / 内边距与旧 `AppShell` 不同，观感有轻微变化；可接受，reset 是否越界由计算样式基线把关。
- localStorage 只在本浏览器；换设备 mock 结果不同步；隐私模式下退化为 volatile。
- `fix/i18n-parity-*` 等在建分支同时改 messages JSON；`workbench` 命名空间追加在文件末尾，合并前 rebase。
- `.wb-reset` 若写宽会波及旧页——计算样式基线把关。
- 全站钉 `data-theme="light"` 后，登录页与 `/new-project` 在 OS 深色下也变浅色；这是接受的一致性代价。

## 12. 逐视图对照表（opengengrowth × jsx）

每批开工前补齐该批行；冲突时先看 §1 的分工，再看这里的裁决。「—」= 开工前复核确认无冲突，不是占位。

| 视图 | 路由 | 外观来源 | 行为来源 | 已知冲突与裁决 |
|---|---|---|---|---|
| 概览 | `overview` | DashboardView | HomeView | opengengrowth 卡片值（56 / 35% / 12 / 7）= 健康分 / 提及率 / 候选数 / 产物数，从 selectors 取；未运行显示空态而非写死数字 |
| 本周变化 | `week` | WeeklyView | WeekView | 7 天窗口用 `withinDays`；无历史时空态 |
| 关键词研究 | `keywords` | KeywordsView | KeywordsView | 徽标 = 候选数（gated rows） |
| 词库 | `keyword-library` | 新做（照 opengengrowth 风格） | SavedView | — |
| 竞品概览 | `competitors` | CompetitorsView | CompetitorsView | — |
| 技术审计 | `audit` | TechnicalAuditView | AuditView | 目标 URL 只读；tab id 统一 `report / pages / csv / task / history`（opengengrowth 的 `tasks` 改 `task`）；徽标 = 健康分 |
| AI 可见度 | `visibility` | AIVisibilityView | VisibilityView | 徽标 = 提及率 `%` |
| 站点档案 | `profile` | SiteProfileView | ProfileView | jsx 的 `reboot`（重走开机）改为链接到 `/context`；`url / brand / market` 只读（真实镜像，§6.7） |
| 数据源 | `data-sources` | DataSourcesView | SourcesView | 真实连接状态只读展示；mock 的「授权」步骤动画只作用于 mock `conns` |
| 外链 | `links` | BacklinksView | LinksView | — |
| 内容生成 | `content` | ContentGenerationView | ContentView | — |
| 事实知识库 | `kb` | KnowledgeBaseView | KBView | — |
| 答案页 / 报告 | `answers` | AnswersReportsView（App.tsx 里 `reports` 分支重复，取 AnswersReportsView，弃 ReportsView） | AssetsView | — |
| 产物中心 | `artifacts` | ArtifactsView | ArtifactsView | 上限 50 |
| 设置 | `settings` | SettingsView（App.tsx 重复分支视为缺陷） | SettingsView | 真实删除见 §6.6；套餐 / API key / 成员 / 用量四块裁掉（D2），只留通知、数据源、删除站点 |

## 13. Owner 裁决（2026-09-11）

- **D1 新项目的初始内容 → (b)**：从空开始，概览提供显式「载入示例站点」按钮灌入 jsx `makeDemoSite` 的演示结果并全站标「示例」，可一键清除；不无提示自动灌入。落地见 §6.7。
- **D2 设置页的工作区区块 → (a)**：套餐 / API key / 成员 / 用量从设置页裁掉（仓库 `CLAUDE.md` 明列为 v0.4 范围外；mock 也是承诺），只留通知偏好、数据源、删除站点。落地见 §6.2。
- **D3 首次上生产的节点 → 确认**：PR-1/2/3 走集成分支 `feat/workbench-ui-port`，PR-3 合入 main 才上生产，取代之前「PR-1 合并即上生产」。落地见 §9。

## 14. 评审处置记录（2026-09-11）

gpt-6-astra（reasoning high，103k token）VERDICT: REVISE，15 条；自审 8 条。

| 编号 | 结论 | 处置 |
|---|---|---|
| F1 PR-1 先于依赖上生产 | 成立 | §9 集成分支，D3 |
| F2 legacy 映射漏 execution / program 退役未言明 | 成立 | §4.3 映射表补全，program 明确退役 |
| F3 a11y 缺 dialog 语义与焦点管理 | 成立 | §4.3 |
| F4 reset 越界到旧页 / 未分层 / 字体未绑定 | 成立（自审同时发现） | §5 |
| F5 CSP 只管仪表、dev 测试看不见违规 | 成立 | §5 生产冒烟 |
| F6 hydration 未定义切项目与异步归属 | 成立 | §6.4 runToken、§6.5 key 重挂 |
| F7 持久化的丢失 / 隐私 / 配额 / 多标签 | 成立 | §6.5 |
| F8 缺派生 selectors 合同 | 成立 | §6.3 |
| F9 setVis 与 setAudit 语义不同 | 成立 | §6.4 逐转换写明 |
| F10 工作区状态无模型 | 成立 | §6.2，D2 |
| F11 真实删除嵌在 mock 里无合同 | 成立 | §6.6 |
| F12 导出无来源声明 / 真假状态混标 | 成立 | §6.8、§4.3 |
| F13 中文枚举与动态 tab 跨越 chrome 边界 | 成立 | §7 |
| F14 spec 盘点不全、node 单测证明不了浏览器行为 | 成立 | §8 |
| F15 两份原型并非可互换 | 成立 | §1、§12 对照表 |
| M1 `_nav.tsx` 的 history / 未保存守卫副作用会丢 | 自审 | §4.3 `useProjectShellEffects` |
| M2 `[data-app-page-title]` 的 `!important` 与 24px h1 冲突 | 自审 | §4.3 `data-wb-page-title` |
| M3 站点卡「真数据」里市场字段投影里没有 | 自审 | §4.3 `ProjectShellProject.marketCode` 从主站点 `market_codes[0]` 取，总是存在 |
| M4 DEMO 默认会把 GenGrowth 的事实灌给别人的项目 | 自审 | §6.7，D1 |
| M5 覆盖率门可能被无单测的 TSX 拉红 | 自审 | §8 |
| M6 messages JSON 与在建 parity 分支冲突 | 自审 | §11 |
| M7 `/new-project` 仍是旧壳 | 自审 | §3 写明有意 |
| M8 v0.4 范围外能力出现在 mock 设置页 | 自审（读仓库 CLAUDE.md） | D2 |

spec 一致性审阅（Claude 子代理，只读设计稿）8 条改写残留：§3/§4.2 删 settings 矛盾、§6.1 漏 `notify`/`demo`、§6.5 残留 workspace 键、§6.2 站点列表归属、截图比对对象、PR-1/PR-2 的 store 依赖与 settings 阶段形态、顶栏 pill 与站点卡重复、未 hydrate 徽标表现——已全部修入 rev4；建议项亦已采纳。第二轮复审 5 条（§8 截图口径、`loadDemo` 覆盖集合、关键词徽标 gate、站点卡 GA4 行、审计行标注）与建议（M3 陈旧记录、`workbench.css` 独立文件、legacy 搬迁措辞、shell 文件清单、⌘K 按钮、侧栏站点数、`auditCancel` / `visCancel`、profile 三项只读镜像、PR-3 模块流、深色模式处置、§12 表头）已修入 rev5。第三轮 Approved，其建议（函数 prop 的 server/client 边界、`clearDemo` 对称清理、hydration 归一化、`profileDoc` 形状、可见度徽标来源、PR-1 范围补 ui 原语、legacy 表去掉会重定向的 `plan` / `report`、基线 spec 固定浅色且为首个 commit）已修入 rev6。

codex 标为「MISSING」的六项：权威关系（§2.6）、server/client 边界（§4.1）、每批验收案例（§8 每批一条模块流；PR 评审逐条）、`proxy.ts` / `_compatibility-route.ts` / 搬迁 import 的实现检查（PR-1 任务）、settings 文案去留（§7）、索引（无需改，`X-Robots-Tag: noindex` 已全站生效）。
