# Task 7 / Task 8 实施级 UX/UI 规格 v2

**唯一 UX/视觉基准**：GenGrowth 客户增长工作台 Artifact **build 14.13**
`/Users/wzb/.codex/visualizations/2026/07/20/019f7ff0-3874-7623-90f3-1ebdea7c313f`（live `http://127.0.0.1:4174/`）
现行实现以 `styles.css` + `client-app.js` + `workspace-data.js` 为准；`app.js` 是 v11 历史运行时，只作反面对照。

**产品实现**：`/Users/wzb/.config/superpowers/worktrees/signalframe-mvp-app/unified-growth-opportunity-v03`（branch `codex/unified-growth-opportunity-v03`）

**上游依据**（本文每条决策都回指到这六份 + 源码）：
- `2026-07-25-gengrowth-artifact-design-system.md` → 简称 **DS**
- `2026-07-25-artifact-execution-reference.md` → **EXEC**
- `2026-07-25-artifact-review-publish-reference.md` → **REV**
- `2026-07-25-app-vs-gengrowth-artifact-drift.md` → **DRIFT**
- `2026-07-25-task78-constraints-v2.md` → **CON**（C-x / H-x 编号）
- `2026-07-25-task78-data-shape-v2.md` → **DATA**（G1–G12 / 坑 A/B/C）

---

## 0. 三条贯穿全文的总裁决（先读这个）

### 裁决 α — **不做「交付就绪度 /100」分数**
artifact 的 `readiness = round(passedGates/requiredGates × 100)`（EXEC §9）在我方会**必然撒谎**：26 条 claim 里 14 条 advisory 规则由 `claimStatus()` 强制返回 `passed`（DATA 坑 A），照抄的分数会长期停在 90–100%，与 `verdict = blocked` 同屏出现，构成直接穿帮。
**替代**：保留 artifact 「大数字 + 上标签下值 + 等分格 border-left」的**版式语汇**，但槽位内容换成 **verdict 三值结论 + 三分计数**（通过 / 未通过 / 未判定）。这是**忠实外推**，不是新发明 —— 三格等分条来自 artifact 的 `.client-recheck-values`（DS §2.4）。

### 裁决 β — **不做「模拟发布 + 模拟回执」**
artifact 的模拟发布是浏览器内状态机（REV §1.2 D），我方 44 张表里没有 releases / approvals / publish_receipts，`ArtifactStatus` 枚举根本到不了 published（DATA G6）。在**真产品**里复制一套假回执 = 造假。
**替代**：Publish 控件采用 CON C-14 的方案 (a) —— **可见但 disabled，把限制写进标签本身**；同时把 artifact 的回执版式用在一件**真实发生的事**上：**评审决策回执**（artifact status draft→ready + revision N 被标记已评审）。回执逐字声明「未发生任何外部发布写入」。

### 裁决 γ — **一律用 `var(--sf-*)` 语义 token，绝不硬编码 artifact 的 hex**
品牌轴（cobalt/Fraunces/Manrope vs green+lime/Source Serif 4/IBM Plex Sans）尚未裁决（DRIFT §4.4，开放问题 O-7）。Task 7/8 全部走 app 的语义层；若 owner 后续裁定以 GenGrowth 为品牌基准，重绑 `:root` 即可整屏跟随，Task 7/8 零改动。
**artifact hex → app token 映射表**见 §1.3，实现时照此换算，**本文所有出现 artifact hex 的地方都同时给出 token 名**。

---

## 1. 复用等级、命名与 token 映射

### 1.1 复用等级定义（全文每条规格必须标注其一）

| 标记 | 含义 | 举证要求 |
|---|---|---|
| **【复用-A】** | artifact 已有该组件/该语汇，结构与数值直接搬 | 给出 artifact 的 class 名 + styles.css / client-app.js 坐标 |
| **【复用-B】** | app 已有等价物（globals.css / ui.module.css / studio.module.css），直接用 | 给出 app 文件 + 行号 |
| **【外推】** | artifact 无此物，但用 artifact 已有语汇组合而成，未引入新视觉概念 | 说明借了哪个语汇 |
| **【新发明】** | 必须新造 | **必须论证 artifact 语汇为什么不够用** |

### 1.2 命名约定

- **禁止把版本号带进产品代码**（DS §6.2）：不出现 `v13-*` / `v14-*` / `client-*`。
- CSS Modules 语义名：`workQueue` / `queueHead` / `queueItem` / `docHead` / `metaStrip` / `docBody` / `qaRail` / `qaVerdict` / `qaGroup` / `qaClaim` / `blocker` / `compare` / `compareBrief` / `compareDraft` / `receipt`。
- 新样式**只加两个文件**：`execution/execution.module.css`（新建，承载筛选条 + meta strip + 对照视图 + 质量栏）与 `studio/studio.module.css`（扩写既有）。**不给 `sf-execution*` / `sf-results*` 补样式** —— 那层壳应删除（DRIFT §3.3）。

### 1.3 artifact hex → app token 换算表（实现时逐一照此替换）

| artifact | 用途 | app token（Task 7/8 必须写这个） |
|---|---|---|
| `--surface #fffdf8` | 卡片底 | `var(--sf-surface)` |
| `--surface-2 #f8f5ee` | 质量栏底 / 内嵌小卡 | `var(--sf-surface-deep)` |
| `--surface-3 #ece8de` | 计数徽标底 | `color-mix(in srgb, var(--sf-surface-deep) 78%, var(--sf-border))` |
| `--line #d9d4c8` | 描边/分隔 | `var(--sf-border)` |
| `--line-strong #beb8aa` | 表单描边 | `var(--sf-border-strong)` |
| `--ink #1c2925` | 主文字 | `var(--sf-fg)` |
| `--ink-soft #35443f` | 次级正文 | `var(--sf-ink-700)` |
| `--muted #6b7772` | 弱化标签 | `var(--sf-muted)` |
| `--green #24564d` | 品牌主色/主按钮 | `var(--sf-accent)` |
| `--teal-soft #d9f1ed` + `#236357` | passed 药丸 | `var(--sf-mint-soft)` + `var(--sf-mint-text)` |
| `--amber-soft #faeccd` + `#835815` | pending 药丸 | `var(--sf-amber-soft)` + `var(--sf-amber-text)` |
| `--coral-soft #fde1d9` + `#9d402e` | failed 标记 | `var(--sf-coral-soft)` + `var(--sf-coral-text)` |
| `#fff0e8` / `#f1cab8` / `#784734` | 阻断块（blocker） | `var(--sf-coral-soft)` / `color-mix(in srgb, var(--sf-coral) 34%, var(--sf-border))` / `var(--sf-coral-text)` |
| `#edf7f2` / `#c9ded5` / `#315a50` | 场景横幅 | `var(--sf-mint-soft)` / `color-mix(in srgb, var(--sf-mint) 30%, var(--sf-border))` / `var(--sf-mint-text)` |
| `#eff8e0` / `#c9df9d` | `.is-proposed` 新版侧 | `var(--sf-mint-soft)` / `color-mix(in srgb, var(--sf-mint) 38%, var(--sf-border))` |
| `#f5f1e9` | 对照左侧（旧/参照侧） | `var(--sf-surface-deep)` |
| `#f5f2ea` | meta strip 底 | `var(--sf-surface-deep)` |
| `#f5f8ee` / `#d3dfb8` | 队列选中态 | `var(--sf-cobalt-soft)` / `color-mix(in srgb, var(--sf-accent) 30%, var(--sf-border))` |
| `#152720` + `#e9f3ee` | 代码块 | `var(--sf-ink-950)` + `#e8ecf1` |
| `.diff-add #b9ec7f` / `.diff-remove #ff9a88` | diff 着色 | `var(--sf-mint-bright)` / `var(--sf-coral)`（暗底上直接用亮值） |
| `--radius 16px` | 面板 | `var(--sf-radius-card)`（14px） |
| `11px` 按钮圆角 | 控件 | `var(--sf-radius-control)`（10px） |
| `--shadow-soft 0 8px 24px rgba(30,49,43,.07)` | 默认卡阴影 | `var(--sf-shadow-sm)` |

### 1.4 字号硬性偏离（**必须偏离 artifact，不是走样**）

`PRD:283`（CON C-12）：正文 ≥16px、表格主内容 ≥15px、只有短标签与次级 metadata 可用 14px、行高 ≥1.5。
app `globals.css:1-8` 亦明文「The Artifact's 6–10px type is deliberately rejected」。

| artifact 值 | 出现处 | Task 7/8 必须用 |
|---|---|---|
| `10px` | `.v13-quality-gate small`、`.client-artifact-meta span`、队列 `small` | **12px** = `var(--sf-text-xs)` |
| `11px` | `.v13-quality-gate strong`、`.v13-quality-facts dt`、blocker `strong` | **14px** = `var(--sf-studio-readable-sm)`（`dt` 可留 12px，属次级 metadata） |
| `12px` | meta strip `strong`、`.v13-quality-facts dd` | **14px**（值文本），标签仍 12px |
| `13px` | 队列 `strong` 标题、`.badge` | **14px** |
| `17px / 1.74` | `.client-document-body p,li` | **保留 17px / 1.74**（已满足 ≥16px）—— 直接复用 |

**连带后果（必须一起改）**：右侧质量栏宽度从 app 现值 `238px`（`studio.module.css:104`）加宽到 **`minmax(268px, 300px)`**；否则 12px→14px 的升号会把「已通过 · 3 项未判定」这类值挤成三行。artifact 基准是 `minmax(250px,285px)`（EXEC §1），我方因字号更大取更宽档，属**忠实外推**。

---

# 第一部分 · Task 7：Execution 内容渲染

## 2. 信息架构

### 2.1 判断：**加，不是重构**（依据 DRIFT §3.3）

三栏已存在于 `StudioClient`：`studio.module.css:104` `.workspace{grid-template-columns:238px minmax(390px,1fr) 238px}` = queue | editor | evidenceRail，与 artifact 的 `client-work-queue | v13-document-body | v13-quality-panel` 一一对应（EXEC §1）。Task 7 的动作是：

1. **删掉 `_execution.tsx` 的外壳层**（`execution/_execution.tsx:119-136`）。理由三条（DRIFT §3.3）：11 个 className 全无 CSS、`<h2>`(:122) 排在 StudioClient `<h1>`(`_studio.tsx:2606`) 之前是**可测的 a11y 回归**、它展示的 Action→Artifact 链路信息在基准里属于 meta strip 与质量栏的内容。`execution/page.tsx` 直接渲染 `StudioClient`（或一个只解析 deep-link 的极薄包装）。
2. **三个内容槽新增**，全部有明确挂载位：
   - `.hero`(`_studio.tsx:2601`) 与 `.workspace`(:2748) 之间 → **类型筛选 tablist**（§4）
   - `.editorHead`(`_studio.tsx:847`) 下方 → **meta strip 四格**（§6）
   - `.evidenceRail`(`_studio.tsx:1114`) 内容整体替换 → **质量栏**（§8）；现状装的是 `actionId`/`findingId` 裸 UUID `<code>`（`_studio.tsx:1150-1190`），**直接给客户看 UUID 是本轮必须清掉的最严重内容缺陷**（DRIFT §6 第 3 条）
3. **不新增主导航**（CON C-1）。`_nav-model.ts` 的 `PRIMARY_NAV_ITEMS` 本轮 diff 必须**零改动**；E2E「恰好四条主导航链接」断言不得变红。类型筛选、并排对照、版本对照全部是 execution 路由内的**二级形态**，合法（CON C-2）。

### 2.2 最终 DOM 骨架

```
main.workspace                                       [既有 app shell]
  ScenarioNotice                                     ← 新增，shell 级常驻（§12.1）
  section#route-content.stage
    header.pageHeader        eyebrow + h1 + p + 右侧 actions        【复用-A】DS §2.1
    section.filterBar[role=tablist]                                【复用-A】EXEC §2
    div#artifact-workspace[role=tabpanel].workspace
      aside.workQueue[panel]                                        【复用-A/B】EXEC §3 + studio .queuePanel
      article.docPanel[panel]
        header.docHead        kicker(类型·Revision N) + badge + h1 + 元行 + actions
        section.metaStrip[aria-label=交付治理信息]   四格            【复用-A】EXEC §4.3
        [div.staleBanner]     旧版评审已失效（条件）                【复用-A】REV §1.2 B
        [div.briefLinkBroken] 本次 draft 未受 brief 引导（条件）     【外推】H-3
        [nav.viewSwitch]      草稿正文 / 对照 Brief（Task 8）        【复用-A】DS §3.2(b)
        div.docGrid
          div.docBody         ← 正文（单栏）或 .compare（并排，Task 8）
          aside.qaRail        ← 质量栏
```

**注意**：与 artifact 一致，外层只有**两栏**（队列 + 文档面板），"三栏观感"来自 `.docGrid` 内部再切一刀（EXEC §1）。这直接决定 sticky：队列与质量栏是**两个独立**的 sticky 容器，不是同一 grid 的兄弟。

### 2.3 栅格数值

| 选择器 | 值 | 来源 |
|---|---|---|
| `.workspace` | `grid-template-columns: minmax(280px,310px) minmax(0,1fr); gap:16px; align-items:start` | 【复用-A】EXEC §1（app 现值 238px 偏窄，随字号升档一并加宽） |
| `.docGrid` | `grid-template-columns: minmax(0,1fr) minmax(268px,300px); align-items:start` | 【外推】artifact `minmax(250,285)` + §1.4 字号偏离 |
| `.workQueue` | `position:sticky; top:var(--sf-sticky-top); max-height:calc(100vh - var(--sf-sticky-top) - 24px); overflow:hidden` | 【复用-A】 |
| `.queueScroll` | `overflow-y:auto; overscroll-behavior:contain; scrollbar-gutter:stable; padding:8px` | 【复用-B】`studio.module.css:143-150` |
| `.qaRail` | `position:sticky; top:var(--sf-sticky-top); max-height:calc(100vh - var(--sf-sticky-top) - 24px); overflow-y:auto` | 【复用-A】 |

**sticky top 统一**（DS §6.2 指出 artifact 的 84/86/88/90 四值是遗留）：新增全局 token
```css
:root { --sf-topbar-h: 72px; --sf-notice-h: 40px;
        --sf-sticky-top: calc(var(--sf-topbar-h) + var(--sf-notice-h) + 12px); }  /* = 124px */
```
所有 sticky 元素与 `scroll-margin-top` 都引用 `--sf-sticky-top`。`--sf-notice-h` 在 ≤760px 改 `56px`（横幅换行）。**实现时以真实 topbar 高度校准这两个值，不要凭本文的 72 写死。**

---

## 3. 页头 hero

| 项 | 规格 | 等级 |
|---|---|---|
| 容器 | `display:flex; align-items:flex-end; justify-content:space-between; gap:30px; margin-bottom:28px`；左块 `max-width:820px` | 【复用-A】DS §2.1 |
| eyebrow | **必须用全局 `.sf-eyebrow`**（`globals.css:172-179`，12px/800/0.12em/uppercase/`--sf-cobalt-text`）。**禁止 fork 第 5 份**（DRIFT X1：现有 4 份实现互不相同） | 【复用-B】 |
| h1 | `font-family:var(--sf-font-display); font-size:clamp(36px,4vw,52px); font-weight:620; letter-spacing:-0.035em; line-height:1.04; margin:0` | 【复用-A】DS §1.3 |
| **h1 降档** | studio 现值 `clamp(38px,4.8vw,64px)`（`studio.module.css:34`）比基准大 ~25%（DRIFT X2）。Task 7 **必须降到 52px 上限** | 【复用-A】 |
| p | `max-width:750px; margin:12px 0 0; color:var(--sf-ink-700); font-size:17px; line-height:1.62` | 【复用-A】 |
| 右侧 actions | `.pageActions{display:flex; gap:9px; align-items:center}`，唯一按钮 `返回增长地图`（secondary，nav 到 growth-map） | 【复用-A】EXEC §2 |

**文案**（artifact 规律：eyebrow = 路由名；h1 = **动词句/结论句**；p = 说明本屏数据范围与边界）：

| key | zh-CN | en |
|---|---|---|
| `studio.eyebrow` | `执行中心` | `Execution` |
| `studio.heroTitle` | `直接查看并处理交付物。` | `Read and act on the deliverables themselves.` |
| `studio.subtitle` | `每个交付物都来自增长地图中已确认的机会。这里直接呈现内容 Brief 正文、English draft 正文、研究来源与质量检查结论；治理信息在右栏与版本历史中可查。` | `Every deliverable traces back to a confirmed opportunity in Growth Map. This screen renders the content brief, the English draft, its research sources, and the quality findings directly; governance metadata stays in the right rail and the revision history.` |

> studio 现有 `heroTitle` = 「把行动变成可以直接交接的工作成果。」语气对，但没说明"直接呈现正文"这个 Task 7 的核心承诺，**替换**。

---

## 4. 类型筛选条 `.filterBar`

### 4.1 结构与样式【复用-A】EXEC §2

```css
.filterBar{ display:flex; gap:18px; align-items:center; justify-content:space-between;
  margin-bottom:16px; padding:11px 13px;
  background:var(--sf-surface); border:1px solid var(--sf-border);
  border-radius:var(--sf-radius-card); box-shadow:var(--sf-shadow-sm); }
.filterTabs{ display:flex; gap:3px; min-width:0; overflow-x:auto; scrollbar-width:thin; }
.filterTab{ flex:0 0 auto; padding:8px 11px; border:0; border-radius:9px;
  background:transparent; color:var(--sf-ink-700);
  font-size:var(--sf-text-xs); font-weight:700; }      /* 12px：短标签，合规 */
.filterTab:hover, .filterTab[aria-selected="true"]{ color:var(--sf-accent-contrast); background:var(--sf-accent); }
.filterCount{ flex:0 0 auto; color:var(--sf-muted); font-size:var(--sf-text-xs); }
```
> hover 与选中同款实心色是 artifact 的**刻意**做法（EXEC §2），照抄。

### 4.2 筛选项 —— **4 类，不是 7 类**（DATA §7 #1）

我方 `ArtifactType` 只有 4 值。artifact 的 7 类是它 mock 数据的产物，加类型 = 7 处重税 + ActionTemplate 改动，本轮不做。

| key | predicate | zh-CN | en |
|---|---|---|---|
| `all` | `() => true` | `全部交付物` | `All deliverables` |
| `blog` | `type === 'english_blog_draft'` | `English Blog` | `English Blog` |
| `brief` | `type === 'content_brief'` | `内容 Brief` | `Content Brief` |
| `metadata` | `type === 'metadata_rewrite'` | `Metadata 重写` | `Metadata rewrite` |
| `ticket` | `type === 'technical_ticket'` | `技术工单` | `Technical ticket` |

**禁止**渲染 enum 字面量 `english_blog_draft` / `content_brief`（CON C-8）。

### 4.3 右侧计数 —— **两个数都必须从实体派生**（EXEC §2）

artifact 是 `共 N 项 · M 个需要你的审核`。我方 M 的定义换成真实语义：**`status === 'ready' && qa.verdict !== 'blocked'`** 的条数（= 可以进人工评审的）。

| zh-CN | en |
|---|---|
| `共 {total} 项 · {review} 项待人工评审` | `{total} deliverables · {review} awaiting human review` |

当 `review === 0` 时显示后半句 `· 暂无待评审项` / `· none awaiting review`，**不隐藏**（隐藏会让人以为界面坏了）。

### 4.4 选中回落（必抄，EXEC §2 结尾）

筛选后立刻 `if (!items.some(i => i.id === selectedId)) setSelectedId(items[0]?.id ?? null)`。切筛选永不出现"选中项不在列表里"的空右栏。

### 4.5 a11y

外层 `role="tablist" aria-label`（zh `按类型筛选交付物` / en `Filter deliverables by type`）；每个按钮 `role="tab" id="tab-artifact-{key}" aria-controls="artifact-workspace" aria-selected`；**roving tabindex**（激活 0，其余 -1）；面板 `role="tabpanel" aria-labelledby="tab-artifact-{key}"`。键盘：`ArrowLeft/Right/Up/Down` 循环、`Home`/`End`；`preventDefault()` → 触发选择 → `rAF` 后 `focus()`（DS §5）。

---

## 5. 队列轨 `.workQueue`

### 5.1 头部【复用-A】EXEC §3

```css
.queueHead{ display:flex; align-items:center; justify-content:space-between;
  padding:18px 18px 13px; border-bottom:1px solid var(--sf-border); }
.queueHead .sf-eyebrow{ margin:0 }              /* 面板内 eyebrow */
.queueTitle{ margin:2px 0 0; font-family:var(--sf-font-display);
  font-size:22px; line-height:1.15; }           /* artifact 23px，取 app 的 --sf-text-xl 邻档 */
.queueBadge{ display:grid; min-width:28px; height:28px; padding:0 8px; place-items:center;
  color:var(--sf-muted); background:color-mix(in srgb,var(--sf-surface-deep) 78%,var(--sf-border));
  border-radius:30px; font-size:var(--sf-text-xs); }
```
文案：eyebrow `执行队列` / `Delivery queue`；h2 `当前交付物` / `Current deliverables`；计数徽标 = `items.length`。
> studio 现有 `queueEyebrow="执行物队列"` / `queueTitle="交付文件"` —— 与基准语气一致，**保留现有 key，只对齐视觉**。

### 5.2 队列条目【复用-A】EXEC §3

```css
.queueItem{ display:grid; grid-template-columns:38px minmax(0,1fr); gap:10px; align-items:start;
  width:100%; padding:12px 10px; margin-bottom:3px; text-align:left;
  background:transparent; border:1px solid transparent; border-radius:11px; cursor:pointer; }
.queueItem:hover, .queueItem[aria-current="true"]{           /* hover 与选中同款，刻意 */
  background:var(--sf-cobalt-soft);
  border-color:color-mix(in srgb,var(--sf-accent) 30%,var(--sf-border)); }
.queueMark{ display:grid; width:36px; height:36px; place-items:center;
  color:var(--sf-accent); background:var(--sf-surface);
  border:1px solid var(--sf-border); border-radius:9px;
  font-size:var(--sf-text-xs); font-weight:800; letter-spacing:.02em; }
.queueType{ display:block; color:var(--sf-accent); font-size:var(--sf-text-xs);
  font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
.queueItemTitle{ display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;
  overflow:hidden; margin-top:3px; font-size:var(--sf-studio-readable-sm); line-height:1.4; }
.queueItemMeta{ display:block; margin:4px 0 7px; color:var(--sf-muted);
  font-size:var(--sf-text-xs); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
```

**类型徽标 mark**（artifact 6 值 → 我方 4 值）：`english_blog_draft→EN`、`content_brief→BR`、`metadata_rewrite→MD`、`technical_ticket→TK`。
> artifact 的 `</>`（code_patch）/ `LP` / `PR` 在我方无对应类型，不实现。

**标题来源**：`Artifact` **没有 title 字段**（DATA §7 #4）→ 用 `Action.title`（经 `actionId` join）。Action 也缺失时显示 `未命名交付物` / `Untitled deliverable`，**不显示 artifact UUID**。

**副行**：`v{currentRevision} · {actionTitle 的 target}`。`currentRevision === 0` 时显示 `尚未生成版本` / `No revision yet`（DATA §1.6：0 = 已认领 artifact 但还没装 revision），**不显示 `v0`**。

**状态药丸**：见 §9.1 状态矩阵。

### 5.3 空态【新发明 → 实为补 artifact 的洞】

artifact 的 `.empty-state` 在 12756 行 CSS 里 **0 条规则**（EXEC §8.2）—— 是裸文本。app 有 `EmptyState` 原语（`ui.module.css:229+`），**用 app 的**【复用-B】。文案照抄 artifact 语气（陈述事实 + 句号，无插画、无「糟糕！」）：

| 场景 | zh-CN | en |
|---|---|---|
| 筛选无结果 | `当前筛选没有交付物。` | `No deliverables match this filter.` |
| 未选中 | `请选择一个交付物。` | `Select a deliverable.` |
| 项目零交付物 | `尚无交付物。在增长地图确认一个机会后，它的交付物会出现在这里。` | `No deliverables yet. Confirm an opportunity in Growth Map and its deliverable will appear here.` |

---

## 6. 中栏文档头 + meta strip

### 6.1 文档头 `.docHead`【复用-A】EXEC §4.1

```css
.docHead{ display:flex; gap:20px; align-items:flex-start; justify-content:space-between;
  padding:28px 30px 23px; border-bottom:1px solid var(--sf-border); }
.docHead > div:first-child{ min-width:0; max-width:750px; }
.docKicker{ display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:8px; }
.docTitle{ margin:0; font-family:var(--sf-font-display);
  font-size:clamp(27px,3vw,37px); font-weight:620; line-height:1.12; }
.docMetaLine{ margin:10px 0 0; color:var(--sf-ink-700); font-size:var(--sf-studio-readable-sm); line-height:1.55; }
.docMetaLine code{ display:inline-block; padding:3px 7px; color:var(--sf-cobalt-text);
  background:var(--sf-cobalt-soft); border-radius:5px; font-size:var(--sf-text-xs);
  font-family:var(--sf-font-mono); }
.docActions{ flex:0 0 auto; display:flex; flex-wrap:nowrap; gap:9px; align-items:center; }
.docActions .button{ min-width:74px; white-space:nowrap; }
```

- **kicker**：`{类型标签} · Revision {n}` + 状态药丸同行。`.sf-eyebrow` 会 uppercase，**源文本不要写大写**（EXEC §4.1）。这条同时满足 CON C-19「文档头必须常驻 Revision N + 状态徽章」。
- **元行**：`{lens 中文} · {opportunityId} · <code>{targetRef}</code>`。lens 缺失回落 `增长机会` / `Growth opportunity`；opportunityId 缺失回落 **`—`**（EXEC §8.1）。
- **`currentRevision === 0`** 时 kicker 写 `{类型} · 尚未生成版本`，**不写 `Revision 0`**。

### 6.2 meta strip 四格【复用-A 版式 / 换语义】

版式原样搬（EXEC §4.3）：
```css
.metaStrip{ display:grid; grid-template-columns:repeat(4,minmax(0,1fr));
  overflow:hidden; margin:0 24px 18px; background:var(--sf-surface-deep);
  border:1px solid var(--sf-border); border-radius:12px; }
.metaCell{ display:grid; gap:5px; min-width:0; padding:11px 12px; border-left:1px solid var(--sf-border); }
.metaCell:first-child{ border-left:0; }
.metaLabel{ color:var(--sf-muted); font-size:var(--sf-text-xs); font-weight:720;
  letter-spacing:.05em; text-transform:uppercase; }
.metaValue{ overflow:hidden; color:var(--sf-fg); font-size:var(--sf-studio-readable-sm);
  line-height:1.35; text-overflow:ellipsis; }
```
> DS §6.2 警告：CSS Modules 下**不要**用 `> div` 这类结构耦合选择器，一律显式 class（已按此写）。

**四格内容 —— 三格换语义**（依据 DATA G5/G2/G9）：

| # | artifact | Task 7 采用 | 值来源 | 缺失回落 | 理由 |
|---|---|---|---|---|---|
| 1 | 关联目标 | **关联目标** / `Linked target` | `GrowthOpportunity.primaryTarget` 类型词 + `targetRef`；`currentOwnedAsset.url` 存在时附 `<code>` | **`—`** | artifact 是 `targetUrlIds[]` 数组，我方单值（G9）。artifact 空数组时显示空白，**我方必须显示 `—`**（EXEC §8.2 洞 2） |
| 2 | 执行动作 | **来源机会** / `Source opportunity` | `GrowthOpportunity.title`（G8，零税） | `未绑定` / `Not linked` | |
| 3 | ~~负责人~~ | **生成方式** / `Generation` | `generationMode` → `模板` / `结构化 LLM`；后附 `· {outputLocale}` | `—` | **负责人在我方 44 张表里完全不存在**（G5）；artifact 侧也是按 type 硬编码的假字典。**渲染一个假负责人是穿帮点** |
| 4 | ~~验收门禁 5/5 个门禁~~ | **自动检查** / `Automated checks` | `{passed} 通过 / {failed} 未通过 / {unevaluated} 未判定` | `尚未评估` / `Not evaluated yet` | 无 required/passed gate 集合（G2）。**必须三分，不能二分**（DATA 坑 B） |

第 4 格与右栏质量结论是**同一组数字的两种表达**，这正是 artifact「中栏数量口径 + 右栏具名项」的双重表达手法（EXEC §13 第 4 条）—— **无抽象 gate 措辞的落点就在这里**（CON C-7/C-8）。

响应式：≤1024 → 2 列（3/4 格加 `border-top`、去 `border-left`）；≤480 → 1 列（全 `border-top`，`:first-child` 去顶边）。

---

## 7. 正文区 `.docBody`

### 7.1 排版基座【复用-A】DS §3.5 / EXEC §5

```css
.docBody{ max-width:none; margin:0; padding:clamp(30px,4vw,52px);
  border-right:1px solid var(--sf-border);
  color:var(--sf-fg); font-size:17px; line-height:1.74; }
.docBody h1,.docBody h2,.docBody h3{ color:var(--sf-fg); font-family:var(--sf-font-display); }
.docBody h1{ max-width:760px; margin:8px 0 22px; font-size:clamp(35px,4.2vw,54px); line-height:1.05; }
.docBody h2{ margin:40px 0 12px; font-size:28px; line-height:1.2; }
.docBody h3{ margin:30px 0 10px; font-size:22px; }
.docBody p,.docBody li{ max-width:780px; }
.docBody p{ margin:0 0 20px; }
.docBody blockquote{ margin:30px 0; padding:20px 25px;
  color:var(--sf-cobalt-text); background:var(--sf-cobalt-soft);
  border-left:5px solid var(--sf-accent);
  font-family:var(--sf-font-display); font-size:25px; line-height:1.4; }
.docBody ol,.docBody ul{ padding-left:22px; }
.docBody code{ padding:2px 5px; background:var(--sf-surface-deep);
  border-radius:5px; font-family:var(--sf-font-mono); font-size:15px; }
```
**这条是 CON C-10 的判据**：正文必须占主视觉，第一段在首屏、≥16px。反例：主区是 `<pre>{JSON.stringify(run)}</pre>` 或字段表格，正文要点开才看得到。

### 7.2 markdown 渲染约束

`draft.contentText` 与 brief 的 `current.content` 都是 markdown 字符串（DATA §1.6 / §2）。
- 渲染器必须**转义 HTML**、禁 raw HTML、禁自动 link 化未知协议。
- 允许元素白名单：`h1-h4 p ul ol li blockquote strong em code pre a table thead tbody tr th td hr`。
- 表格用受控横向容器：`.docBody .tableScroll{overflow-x:auto}`，`table{min-width:640px}`（CON C-12：窄屏不得产生 root overflow）。

### 7.3 per-type 装饰件

artifact 是**按 artifact-ID 硬编码查表**（EXEC §5 路径 B），不可复用；我方必须抽成 per-type 渲染器，结构照抄、内容数据驱动。

**① `english_blog_draft`**（唯一带装饰件的类型）【复用-A】：
```css
.seoTitle{ padding:13px 15px; margin-bottom:20px; background:var(--sf-surface-deep);
  border-left:3px solid var(--sf-mint); border-radius:0 10px 10px 0; }
.seoTitle span{ display:block; color:var(--sf-muted); font-size:var(--sf-text-xs);
  font-weight:750; letter-spacing:.04em; text-transform:uppercase; }
.seoTitle strong{ display:block; margin-top:3px; font-size:var(--sf-studio-readable-sm); }
.byline{ display:flex; gap:10px; align-items:center;
  padding-bottom:22px; margin-bottom:25px; border-bottom:1px solid var(--sf-border); }
.bylineMark{ display:grid; width:36px; height:36px; flex:0 0 auto; place-items:center;
  color:var(--sf-accent-contrast); background:var(--sf-ink-900);
  border-radius:50%; font-size:var(--sf-text-xs); font-weight:800; }
```
- SEO 标题卡文案：`SEO 标题 · {n} 个字符` —— **`n` 必须是 `title.length` 计算值**。artifact 写死 `57 个字符`（实际 65），是现成穿帮点（EXEC §5 ①）。
- byline 文案：artifact 写「Revision N · {k} 条已批准证据」；我方**「已批准」不存在**（DATA §7 #26）→ 改 **`Revision {n} · {k} 条冻结证据`** / `Revision {n} · {k} frozen records`，`k = research.sources.length`。
- 正文最前的语言标注【复用-A】：`.docLabel{color:var(--sf-accent); font-size:var(--sf-text-xs); font-weight:800; letter-spacing:.08em; text-transform:uppercase}`，文案 `English draft · Target market: {locale}` —— **保持英文原样**（CON C-11：正文英文，不互译）。

**② `content_brief`**：`h3` + 结构化字段卡【复用-A】`.briefGrid`
```css
.briefGrid{ display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin:15px 0 25px; }
.briefGrid > div{ padding:14px; background:var(--sf-surface-deep);
  border:1px solid var(--sf-border); border-radius:10px; }
.briefGrid dt{ color:var(--sf-muted); font-size:var(--sf-text-xs); font-weight:800;
  letter-spacing:.04em; text-transform:uppercase; }
.briefGrid dd{ margin:5px 0 0; color:var(--sf-fg);
  font-size:var(--sf-studio-readable-sm); font-weight:650; line-height:1.5; }
```
brief 正文本身按 §7.1 的 markdown 排版渲染（它是 9 段 markdown，DATA §2）。

**③ `technical_ticket`**：`.codeFix`【复用-A】
```css
.codeFix pre{ overflow-x:auto; padding:20px; color:#e8ecf1; background:var(--sf-ink-950);
  border-radius:13px; font:15px/1.7 var(--sf-font-mono); }   /* artifact 13px → 升 15px（§1.4） */
.diffRemove{ color:var(--sf-coral); }
.diffAdd{ color:var(--sf-mint-bright); }
```

**④ `metadata_rewrite`**：`.compare` 左右对照（与 Task 8 共用同一组件，见 §11.1）【复用-A】。

### 7.4 Revision 摘要块（条件，所有类型通用，插在正文最前）【复用-A】

`ArtifactRevision.note` 非空时：
```css
.revisionNote{ display:grid; gap:5px; padding:14px; margin-bottom:18px;
  background:var(--sf-mint-soft); border:1px solid color-mix(in srgb,var(--sf-mint) 30%,var(--sf-border));
  border-radius:11px; }
.revisionNote span,.revisionNote small{ color:var(--sf-muted); font-size:var(--sf-text-xs); }
.revisionNote strong{ color:var(--sf-mint-text); font-size:var(--sf-studio-readable-sm); }
```
文案：`Revision {n} 修订摘要` / `Revision {n} change summary`。

---

## 8. 右侧质量栏 `.qaRail`

> 这一节是 Task 7 最大的**内容替换**：现状 `_studio.tsx:1150-1190` 直接把 `actionId` / `findingId` 的裸 UUID 渲染给客户。

### 8.1 骨架

```
aside.qaRail
  .qaVerdict            结论区（替代 artifact 的「交付就绪度 /100」）
  .qaCounts             三格等分计数条
  section > h3 质量检查  + .qaGroup × 5（可展开）
  [.blocker]            当前不能提交评审
  .qaScopeNote          本轮不检查：…（常驻）
  section > h3 证据与范围 + .qaLink + dl.qaFacts
  section > h3 发布与结果 + p.qaNote（永远是未发布态）
```

```css
.qaRail{ padding:19px; background:var(--sf-surface-deep); }
.qaRail section{ margin-top:18px; }
.qaRail h3{ margin:0 0 8px; font-size:var(--sf-studio-readable-sm); font-family:var(--sf-font-display); }
```

### 8.2 结论区 `.qaVerdict` + 计数条 `.qaCounts`【外推】

**为什么不是【复用-A】**：artifact 的 `.v13-quality-score`（`交付就绪度 100 / 100`，35px serif）在我方必然撒谎（裁决 α）。**外推的依据**：把 artifact 的 `.client-recheck-values`（3 等分格 + `border-left` 分隔 + 上标签下大数字，DS §2.4）搬到这个槽位，视觉语汇完全一致。

```css
.qaVerdict{ display:flex; gap:10px; align-items:center; justify-content:space-between;
  padding-bottom:14px; border-bottom:1px solid var(--sf-border); }
.qaVerdictLabel{ color:var(--sf-muted); font-size:var(--sf-text-xs); }
/* 结论药丸：比常规 StatusPill 大一档，是本栏的视觉锚 */
.qaVerdictPill{ display:inline-flex; align-items:center; min-height:30px; padding:4px 12px;
  border-radius:999px; font-size:var(--sf-studio-readable-sm); font-weight:700; white-space:nowrap; }

.qaCounts{ display:grid; grid-template-columns:repeat(3,minmax(0,1fr));
  overflow:hidden; margin-top:14px; background:var(--sf-surface);
  border:1px solid var(--sf-border); border-radius:12px; }
.qaCountCell{ display:grid; gap:3px; padding:11px 10px; border-left:1px solid var(--sf-border); }
.qaCountCell:first-child{ border-left:0; }
.qaCountCell span{ color:var(--sf-muted); font-size:var(--sf-text-xs); font-weight:720; }
.qaCountCell strong{ font-family:var(--sf-font-display); font-size:21px; font-weight:650;
  line-height:1.05; font-variant-numeric:tabular-nums; }
```

| 槽 | zh-CN | en | 值 |
|---|---|---|---|
| `.qaVerdictLabel` | `自动检查结论` | `Automated verdict` | — |
| `.qaVerdictPill` | 见下表 | | `qa.verdict` |
| `.qaCounts` 三格 | `已通过` / `未通过` / `未判定` | `Passed` / `Failed` / `Not evaluated` | `claims` 按 `status` 计数 |
| 计数条上方小字 | `本轮共 {n} 项检查` | `{n} checks this run` | `claims.length`（恒 26） |

**verdict 药丸配色**（复用 app `StatusPill` 语义，`ui.module.css:132-184`）：

| verdict | zh-CN | en | 视觉 |
|---|---|---|---|
| `passed` | `自动检查已通过 · 待人工评审` | `Automated checks passed · awaiting human review` | `--sf-mint-soft` / `--sf-mint-text` |
| `needs_review` | `需要人工确认` | `Needs human review` | `--sf-amber-soft` / `--sf-amber-text` |
| `blocked` | `有无法核实的引用` | `Unverifiable citations found` | `--sf-coral-soft` / `--sf-coral-text` |
| `qa === null` | `尚未评估` | `Not evaluated yet` | neutral（`--sf-surface-deep` / `--sf-muted`） |

> **`passed` 的文案绝不能只写「已通过」**（CON C-17 / DATA §3.3）：`passed` 只意味着确定性检查全过，**不等于已批准、更不等于可发布**。所以标签必须带 `· 待人工评审` 后缀。
> **`blocked` 的文案绝不能写「失败 / Failed」**（H-2）：它是对**内容**的判断，run 本身 `completed`。见 §9.4。

### 8.3 质量检查分组 `.qaGroup`

**分组方案：按我方真实 `kind` 分 4 组 + 人工审核 = 5 组**（DATA §3.5 建议）。

> **偏离说明（需主 agent 拍板，见开放问题 O-1）**：CON C-9 要求"复用 artifact 已验证的词汇表"（研究证据 / SEO / GEO / 事实核验 / 人工审核）。但我方 QA 的真实分类是 4 个 `kind`，硬套会产生**虚假映射**（artifact 的"研究证据"在我方只能对应 coverage claim，语义不符；而 `rl4/rl5` 属 red_line kind 却是 SEO 性质，跨组会引入一张前端硬编码的 26 条映射表，**必然与 `rule-types.ts` 漂移**）。
> 本规格采用 artifact 的**命名风格**（具名中文、无 gate/check/rule 抽象词）而非**命名字面**，分组严格按契约里已有的 `kind` 字段，零漂移风险。第 5 项 `人工审核` 直接复用 artifact 原词。

| 组 | 来源 | 条数 | zh-CN | en |
|---|---|---|---|---|
| 1 | `kind === 'red_line'` | 9 | `事实红线` | `Fact red lines` |
| 2 | `kind === 'structure'` | 15 | `结构与 SEO` | `Structure & SEO` |
| 3 | `kind === 'citability'` | 1 | `GEO 可引用性` | `GEO citability` |
| 4 | `kind === 'coverage'` | 1 | `Brief 覆盖` | `Brief coverage` |
| 5 | Task 8 本地评审状态 | — | `人工审核` | `Human review` |

组行 DOM 固定为 artifact 的 `24px 圆点 + (small 组名 / strong 状态词 / small 原因)`【复用-A】EXEC §6：

```css
.qaGroup{ border-top:1px solid var(--sf-border); }
.qaGroupHead{ display:grid; grid-template-columns:24px minmax(0,1fr) 16px; gap:9px;
  align-items:center; width:100%; padding:10px 0; text-align:left;
  background:none; border:0; cursor:pointer; }
.qaGroupIcon{ display:grid; width:23px; height:23px; place-items:center;
  border-radius:50%; font-size:var(--sf-text-xs); font-weight:800; }
.qaGroupName{ display:block; color:var(--sf-muted); font-size:var(--sf-text-xs); }
.qaGroupState{ display:block; font-size:var(--sf-studio-readable-sm); font-weight:650; }
.qaGroupReason{ display:block; margin-top:2px; color:var(--sf-muted);
  font-size:var(--sf-text-xs); line-height:1.5; }
.qaGroupArrow{ width:14px; transition:transform .18s ease; }
.qaGroupHead[aria-expanded="true"] .qaGroupArrow{ transform:rotate(90deg); }
```

**四态配色**（artifact 只有二值 `.is-passed` / `.is-pending`；扩到四态是 EXEC §7.2 明写的"Task 7 必须补的洞"，配色沿用 artifact 已有 token → **忠实外推**）：

| 组状态 | 判定 | 图标槽 | zh 状态词 | en | 前景 / 背景 |
|---|---|---|---|---|---|
| `passed` | 有可判项且全 `passed`，无 `unevaluated` | ✓ (13px stroke icon) | `已通过` | `Passed` | `--sf-mint-text` / `--sf-mint-soft` |
| `failed` | ≥1 条 `failed` | `×` 字面量 | `未通过 · {k} 项` | `Failed · {k}` | `--sf-coral-text` / `--sf-coral-soft` |
| `partial` | 有 `passed` 也有 `unevaluated`，无 `failed` | `!` 字面量 | `已通过 · {k} 项未判定` | `Passed · {k} not evaluated` | `--sf-amber-text` / `--sf-amber-soft` |
| `unevaluated` | 全部 `unevaluated` | `—` 字面量 | `未评估` | `Not evaluated` | `--sf-muted` / `color-mix(...surface-deep 78%...)` |

**`.qaGroupReason` 一行原因（10px→12px）**：artifact v14.13 把 v11 的解释行删了，但我方 QA 会有大量未通过/未判定项，只写状态词信息量不够（EXEC §11 结论）。规则：
- `failed` → 取该组第一条 failed claim 的中文规则名 + `等 {k} 项`
- `unevaluated` / `partial` → 取该组第一条 unevaluated claim 的原因归类（见 §9.3 降级表）
- `passed` → 不渲染 reason 行

**展开区 `.qaClaims`**（`<details>` 或受控 `aria-expanded`）：
```css
.qaClaim{ display:grid; gap:4px; padding:9px 0 9px 33px; border-top:1px dashed var(--sf-border); }
.qaClaimName{ font-size:var(--sf-studio-readable-sm); font-weight:650; }
.qaClaimState{ font-size:var(--sf-text-xs); font-weight:700; }
.qaClaimDetail{ margin:0; color:var(--sf-muted); font-size:var(--sf-text-xs); line-height:1.55;
  overflow-wrap:anywhere; }
```
- `.qaClaimName` = **中文规则名**，来自前端维护的 `QA_CLAIM_LABELS`（26 条，key = `claimId`）。未命中回落 `未命名检查项` / `Unnamed check`，**绝不渲染裸 `claimId` / `rl8_unsupported_claim` / `sc9b`**（CON C-8 禁用词表）。必须配一个覆盖率单测（§14 DoD）。
- `.qaClaimDetail` = `claim.detail` **英文原文**，作为可核查证据，前缀中文导语 `判定依据：` / `Basis:`。这是"chrome 中文、证据原文不翻译"的一致处理（CON C-11 的同构延伸）。
- **默认只展开有 `failed` 或 `unevaluated` 的组**；全 passed 的组默认收起。

### 8.4 advisory 常驻脚注【新发明】

**论证 artifact 语汇为什么不够**：artifact 的 mock 数据里不存在"提示级规则永远记为通过"这种情形，因此它没有对应的表达。而我方 26 条里 **14 条 advisory 由 `claimStatus()` 强制返回 `passed`**（DATA 坑 A）—— 不说这件事，"已通过 N 项"就是误导。形式上仍复用 artifact 的 `.v13-quality-note`（10px→12px muted 小字）语汇。

```css
.qaScopeNote{ margin:12px 0 0; padding:10px 12px; color:var(--sf-muted);
  background:var(--sf-surface); border:1px solid var(--sf-border);
  border-radius:10px; font-size:var(--sf-text-xs); line-height:1.55; }
```
文案（合并 H-9 的"覆盖边界"与坑 A 的"advisory 恒通过"）：

| zh-CN | en |
|---|---|
| `本轮 {n} 项检查中有 {a} 项为提示级：它们即使命中也记为通过，不参与上面的结论。本轮不检查：与外部内容的重复度、超出项目数据的外部事实、品牌语气。` | `{a} of the {n} checks in this run are advisory: they are recorded as passed even when they match, and do not affect the verdict above. Not checked this run: duplication against external content, facts outside project data, brand voice.` |

> **禁止**写成「未来可扩展」「后续版本支持」（CON H-9 明令：不要掩饰性表述）。

### 8.5 阻断块 `.blocker`【复用-A】

仅当 `verdict === 'blocked'`（我方语义比 artifact 的 `missingGates` 更精确）：
```css
.blocker{ padding:11px 12px; margin-top:12px; color:var(--sf-coral-text);
  background:var(--sf-coral-soft);
  border:1px solid color-mix(in srgb,var(--sf-coral) 34%,var(--sf-border));
  border-radius:9px; }
.blocker strong{ display:block; font-size:var(--sf-studio-readable-sm); }
.blocker p{ margin:3px 0 0; font-size:var(--sf-text-xs); line-height:1.55; }
.blocker ul{ margin:6px 0 0; padding-left:18px; font-size:var(--sf-text-xs); line-height:1.55; }
```
**内容与文案见 §9.4（blocked 专章）。**

### 8.6 证据与范围 `.qaFacts`【复用-A 版式 / 换语义】

```css
.qaLink{ display:grid; grid-template-columns:minmax(0,1fr) 14px; width:100%;
  padding:9px 0; text-align:left; background:none; border:0;
  border-top:1px solid var(--sf-border); cursor:pointer; }
.qaLink span{ display:block; color:var(--sf-muted); font-size:var(--sf-text-xs); }
.qaLink strong{ display:block; color:var(--sf-fg);
  font-size:var(--sf-studio-readable-sm); line-height:1.45; }
.qaLink svg{ grid-column:2; grid-row:1/3; align-self:center; width:13px; color:var(--sf-accent); }

.qaFacts > div{ display:grid; grid-template-columns:112px minmax(0,1fr); gap:12px;
  padding:9px 0; border-top:1px solid var(--sf-border); }
.qaFacts dt{ margin:0; color:var(--sf-muted); font-size:var(--sf-text-xs); }
.qaFacts dd{ margin:0; overflow-wrap:anywhere;
  font-size:var(--sf-studio-readable-sm); font-weight:650; line-height:1.45; }
```

| artifact dt | Task 7 dt (zh / en) | 值 | 缺失 | 依据 |
|---|---|---|---|---|
| 来源机会（`.qaLink`） | `来源机会` / `Source opportunity` | `GrowthOpportunity.title`，可跳 growth-map | `—` | G8，零税 |
| 目标 URLs | `目标` / `Target` | `{primaryTarget} {targetRef}` | `—` | G9：单值不是数组 |
| 证据 | `诊断证据` / `Diagnostic evidence` | `{evidenceSummary.length} 条` | `—` | G10，比 artifact 硬（每条可展开溯源） |
| 客户连接 | `冻结身份` / `Frozen records` | `{research.sources.length} 条` | `—` | **不能叫「可引用来源」**（DATA §4.3） |
| — | **`外部可引用来源`** / `External citable sources` | 恒 **`0 条（本轮未做外部检索）`** / `0 (no external retrieval this run)` | — | 【外推】DATA §4.3 唯一诚实写法 |
| 系统证据 | `已连接的数据源` / `Connected data sources` | `listProjectSources` 的 provider 名，`·` 连接 | `本项目暂无已连接来源` | G7：**项目级，不是交付物级**，措辞必须改 |
| — | `冻结输入指纹` / `Frozen input hash` | `contentHash.slice(0,12)` + `…`，`<code>` 包 | — | 【外推】治理元数据，允许出现在侧栏但不上主视觉（CON C-10） |

`外部可引用来源 = 0` 那一行下方挂 limitations 原文（`research.limitations[0]`），用 `.qaNote` 小字。

### 8.7 发布与结果段【复用-A 版式 / 内容永远是未发布态】

我方**永远**没有 release（裁决 β），所以这段恒定渲染占位说明，**不渲染任何"发布版本 / 回滚引用"字段**（造这些字段就是造假）。

```css
.qaNote{ margin:0; color:var(--sf-muted); font-size:var(--sf-text-xs); line-height:1.55; }
```

| zh-CN | en |
|---|---|
| `本产品阶段不做外部发布。评审通过只产生一个已评审的 Revision，不写入任何 CMS、Git 或第三方发布目标。效果追踪只观察技术条件是否被修复，不推断流量、排名或转化。` | `This stage performs no external publishing. Passing review produces a reviewed revision only; nothing is written to any CMS, Git, or third-party publishing target. Results only observe whether the technical condition was fixed — never traffic, rank, or conversion.` |

> 后半句同时兑现 CON H-11（Results 侧不得有 lift 声称）与 C-17（approval ≠ publication）。

---

## 9. 状态矩阵（**本规格最关键的一节**）

### 9.1 交付物状态药丸（队列 + 文档头 kicker）

我方 `ArtifactStatus` = `generating | draft | ready | failed | archived`（DATA §7 #3），**没有 review / approved / published / blocked**。artifact 的 6 个状态词不能照搬。

| status | zh-CN | en | tone（`StatusPill`） | 说明 |
|---|---|---|---|---|
| `generating` | `生成中` | `Generating` | `info` | 与 `phase` 联动，见 §9.2 |
| `draft` | `草稿` | `Draft` | `neutral` | |
| `ready` | `已评审 · 未发布` | `Reviewed · not published` | `success` | **绝不写「已发布」「已上线」**（CON C-16/C-17）。`ready` 在 Task 8 后语义是"人工评审通过" |
| `failed` | `生成失败` | `Generation failed` | `danger` | 指 artifact 生成失败，**不是 QA blocked** |
| `archived` | `已归档` | `Archived` | `neutral` | |

**app 有 danger tone 而 artifact 没有红色药丸**（DS §2.6）。裁决：`failed` 用 danger（它确实是故障）；**`blocked` 绝不用 danger**（它不是故障，见 §9.4）。

### 9.2 run 的 `phase × status` —— 两个都要显示

`phase`（跑到哪了）与 `status`（这次 run 成没成）**必须同屏**，只显示一个会误导；`status=partial` + `phase=complete` 是合法组合（DATA §1.2）。

渲染位置：文档头 kicker 的第三个 chip（在类型 + Revision 之后）。

| phase | zh-CN | en | 视觉 |
|---|---|---|---|
| `queued` | `已排队` | `Queued` | neutral 药丸 |
| `research` | `研究组装中` | `Assembling research` | info + 2px 进度条 |
| `draft` | `草稿生成中` | `Drafting` | info + 进度条 |
| `qa` | `质量检查中` | `Running checks` | info + 进度条 |
| `complete` | 不渲染 phase chip（用 status 药丸代替） | — | — |
| `failed` | `本次运行失败` | `Run failed` | danger |

`status ∈ {partial}` 时**额外**渲染一个 warning 药丸：`部分完成` / `Partially completed`，并在正文上方加一条 `.briefLinkBroken` 同款提示块说明哪一段缺失（`research` / `draft` / `qa` 中哪个为 null）。

**加载态**：`phase ∈ {queued, research, draft, qa}` 时 —— 队列条目正常渲染、文档头正常渲染、**正文区**显示 app 的 `Spinner` + 阶段文案 + `本次冻结输入指纹 {hash前12}`。**不显示骨架屏假内容**（假骨架 = 视觉上的"看起来有内容"）。质量栏此时 `qa === null`，结论药丸显示 `尚未评估`，计数条三格全 `—`。

**错误态**：`phase === 'failed'` 或请求 5xx —— 复用 §11.5 的 blocked 回执形态（`操作已阻断` 标题 + 具名原因 + 「没有创建记录，也没有改变状态」），**不是** toast，**不是**空白页。`status === 'failed'` 时正文区显示：`本次运行没有产出草稿。冻结输入与研究来源仍可查看。` + 保留质量栏的"证据与范围"段（它来自 research，可能已存在）。

### 9.3 QA verdict × claim status × 降级情形 —— 完整矩阵

**verdict 三值 → 用户看到什么 / 能做什么**：

| verdict | 结论药丸 | 正文 | 评审控件（Task 8） | 阻断块 | 用户可做 | 用户不可做 |
|---|---|---|---|---|---|---|
| `passed` | `自动检查已通过 · 待人工评审`（mint） | 完整渲染 | **启用** | 不显示 | 通过评审 / 需要补充 / 退回 | — |
| `needs_review` | `需要人工确认`（amber） | 完整渲染 | **启用**，但"通过评审"需**勾选确认**（`.checkRow`） | 不显示；改在质量栏顶部加一行 `.qaScopeNote` 同款 amber 提示 | 三态全可用 | — |
| `blocked` | `有无法核实的引用`（coral） | **完整渲染**（正文本身是证据） | **"通过评审"禁用**；"需要补充"/"退回"仍启用 | 显示（§9.4） | 需要补充 / 退回 / 创建新 Revision | 通过评审 |
| `null` | `尚未评估`（neutral） | 视 phase 而定 | 全部禁用 | 不显示 | 等待 / 取消 run | 任何评审动作 |

**claim `status` 三值**（DATA §3.1）：
- `passed` — 判过且通过 **或** 该规则是 advisory（见 §8.4 脚注）
- `failed` — 判过且违反，且非 advisory
- `unevaluated` — 没能判。**永不当作通过**（H-4）

### 9.3.1 四种降级情形 —— 每种给"用户看到什么"

| # | 降级 | 触发 | 位置 | zh-CN | en | 视觉 | 可做 / 不可做 |
|---|---|---|---|---|---|---|---|
| **D1** | **outline 提取失败 = draft 未受 brief 引导** | coverage claim `failed` 且 detail 含 brief 无 `## ` 标题；`research.limitations` 含大写 `FAILED` 长句（DATA §4.4） | **与正文同级、不可折叠**，插在 meta strip 之下 / 视图切换之上；并排模式下**跨两栏** | `本次 draft 未受 brief 引导` · `未能从 content brief 中提取到主题清单（brief 正文里没有 ## 小标题），本次生成没有使用 brief 的覆盖要求。左右两栏之间没有因果关系，请逐条人工比对。` | `This draft was not guided by the brief` · `No topic outline could be extracted from the content brief (its body carries no ## headings), so the brief's coverage requirements were not used during generation. The two panes are not causally linked — compare them manually.` | `.briefLinkBroken`（= `.staleBanner` 同款暖橙块，见 §11.3） | 可做：全部评审动作；不可做：把"对照 Brief"当作覆盖证明 |
| **D2** | **非英文 locale 未评估** | `outputLocale` 非 `en-*`；大量 claim `unevaluated` | 质量栏组行的 `.qaGroupReason` + 展开区每条 claim | `未评估 · 该语言未启用确定性分词，本轮未评估` | `Not evaluated · deterministic segmentation is not enabled for this language` | 组状态 `unevaluated`（muted/sunken）；**绝不是绿勾** | 可做：需要补充 / 退回；**"通过评审"需勾选确认**（verdict 必 ≥ needs_review） |
| **D3** | **pack 只有身份、没有指标** | 恒定（`limitations[1]`） | 质量栏 `证据与范围` 段 + brief 上下文的关键词/竞品列表 | 指标列显示 **`—`**；列尾脚注 `本轮只冻结了观测对象的身份，没有读取任何搜索需求量或生成式引用指标。` | `—`；`Only observation identities were frozen this run; no search demand or generative citation metric was read.` | `—` = em dash，`color:var(--sf-muted)`；**列不隐藏** | 不可做：显示 0；不可做：隐藏该列（隐藏会让人以为没有这个维度） |
| **D4** | **0 可引用外部来源（by construction）** | 恒定（`limitations[0]`） | 质量栏 `外部可引用来源` 行 + blocked 阻断块 | `0 条（本轮未做外部检索）` + 原文 `本 pack 只承载第一方冻结的 SignalFrame 记录；没有检索或评级任何外部来源。` | `0 (no external retrieval this run)` + verbatim limitation | `.qaFacts dd` + `.qaNote` | 见 §9.4 |

**D3 的额外要求**（H-7）：brief / cluster 上下文里的 page assignment 必须显示**四值**（`existing_page` / `new_asset` / `mixed` / `unassigned`），**不得折叠成"待定"**；并在质量栏 `Brief 覆盖` 组的 reason 行写：`本次基于 {N} 个关键词，其中 {M} 个的页面映射尚未确认。` / `Based on {N} keywords; {M} carry an unconfirmed page mapping.`

**H-8（search / generative 分离）**：brief 上下文里 SearchQuery 与 GenerativeQuery 必须是**两个分区、两套指标标签**，**绝不求和**为"总需求量"。沿用 artifact 的信号徽标语汇（DS §2.6）：`S` = `--sf-cobalt-soft`/`--sf-cobalt-text`，`G` = `--sf-violet-soft`/`--sf-violet-text`。

### 9.4 **blocked 专章** —— 它是常见状态，不是故障

**产品事实**（CON H-2 / DATA §4.3）：Slice 2 的 research pack 可引用外部来源数 = **0，by construction**。任何带外部引用的 draft **必然** blocked；`passed` 要求一篇完全不引用外部来源的草稿。**blocked 会是最常见的 QA 结果。**

**设计目标**：读起来是「系统尽责地拦住了无法核实的引用」，不是「工具坏了」。

**六条硬规则**：
1. **正文照常完整渲染**（正文本身就是评审证据）。**绝不**用空状态/错误页替换正文。
2. **绝不用 danger 红色药丸、绝不用 ⚠/✕ 大图标、绝不出现「失败 / Failed / 错误 / Error / 请重试」字样。**
3. 阻断块用**暖橙**（`--sf-coral-soft` 底 + `--sf-coral-text` 字），与 artifact 的 `.v13-quality-blocker` 同款 —— artifact 刻意不给阻断用红色（DS §2.6）。
4. 标题写"当前不能…"（陈述当前状态），**不写"…失败"**（陈述结果判决）。
5. 必须给**逐条具名原因**（我方比 artifact 强：artifact 只有 `仍需通过：研究证据、人工审核` 这种抽象罗列，我方有每条 blocking claim 的行级 detail）。
6. 必须给**下一步**（不能只说不行）。

**阻断块完整文案**：

```
[strong]  当前不能通过评审
[p]       草稿里有 {k} 处引用无法在本轮冻结的研究记录中核实。
          这不是运行失败 —— 本次运行已完成，草稿与研究记录都已铸出并可查阅。
[ul]      · {blocking claim 中文名}：{detail 的中文导语摘要}
          · …（最多 3 条，超出显示"另有 N 处，展开质量检查查看"）
[p.small] 原因：本轮研究证据只由项目内已确认的数据组装，不做外部检索，
          因此草稿中引用的外部来源无法被核实。这是本轮范围的边界，不是缺陷。
[p.small] 下一步：可以「需要补充」把它退回补证据，或「创建新 Revision」删掉无法核实的引用后重新检查。
```

| slot | en |
|---|---|
| strong | `Cannot pass review yet` |
| p | `{k} citation(s) in this draft cannot be verified against the research records frozen for this run. This is not a run failure — the run completed, and both the draft and the research records were produced and are available to read.` |
| p.small (原因) | `Why: this run's research evidence is assembled only from data already confirmed inside the project, with no external retrieval. External sources cited in the draft therefore cannot be verified. This is the boundary of this run's scope, not a defect.` |
| p.small (下一步) | `Next: send it back with "Needs more evidence", or create a new revision with the unverifiable citations removed and re-run the checks.` |

**同时**：队列条目在 blocked 时**不加任何额外红点/警告标**（避免队列看起来像一片故障）；只有文档头 kicker 加一个 coral 药丸 `有无法核实的引用` / `Unverifiable citations`。

**反例清单（禁止）**：
- ❌ 红色 `QA Failed` 空状态、正文不渲染
- ❌ 「质量检查失败，请重试」
- ❌ 把 blocked 的 draft 从队列里隐藏
- ❌ 把 run 的 `status` 显示成 `failed`（它是 `completed`）
- ❌ 用 advisory 项把 12 条提示全渲染成黄色警告，淹没真正的 blocking（H-10）

### 9.5 三档 severity 的三种视觉（H-6 / H-10）

| severity | 出现处 | 视觉 | 是否进阻断原因列表 | 是否禁用控件 |
|---|---|---|---|---|
| `blocking`（3 条：`rl8` / `rl12` / `sc9b`） | 阻断块 + 组行 `failed` | coral | ✅ | ✅ 禁用"通过评审" |
| `review`（8 条） | 组行 `failed`，不进阻断块 | amber | ❌ | ❌ 但"通过评审"需勾选确认 |
| `advisory`（14 条） | 只在展开区列出，**组行不因它变色** | muted 灰 | ❌ | ❌ |

> **过度阻断同样是不诚实**（H-10 原话）：它让用户以为有硬性问题。advisory 绝不着色为警告。
> ⚠️ severity 当前**不在契约里**（DATA 坑 A）→ 见开放问题 **O-2**。若不加契约字段，一期只能按 `kind` + 硬编码 3 条 blocking claimId 白名单实现（3 条是闭集，漂移风险远低于 26 条全表）。

### 9.6 缺失数据统一规则（H-5）

| 情形 | 显示 | 禁止 |
|---|---|---|
| 单个标量缺失 | **`—`**（em dash，`var(--sf-muted)`） | `0`、`N/A`、空白 |
| 未连接外部服务 | `未连接` / `Not connected` | `0` |
| 有连接但无数据 | `数据不足` / `Insufficient data` | `0`、`暂无数据`（可被误读为"数据为零"） |
| 采集中 | `采集中` / `Collecting` | 骨架屏假数字 |
| 数组为空 | `—`（**不是空字符串**）。artifact 在 `targetUrlIds` 为空时输出空白，是它的洞（EXEC §8.2） | 空白 |
| ID 无法解析成名字 | `未命名{对象}` / `Unnamed {object}` | **回落成裸 UUID**（artifact 的 `urlName()` 会漏内部 id，是穿帮点） |

---

# 第二部分 · Task 8：side-by-side 人工评审 + Publish

## 10. Task 8 的对照对象（先定义清楚）

CON C-21 明确：并排两侧 = **content_brief 正文 ↔ english_blog_draft 正文**（判断 draft 是否兑现 brief 的覆盖清单）；research sources + QA claims 走第三栏。

**明确排除**（C-21 反例）：
- ❌ `Revision N-1 ↔ Revision N` 的 diff —— 那是版本历史，不是评审
- ❌ QA claims 只给总分不给逐条定位

**artifact 缺口**（REV §2.3）：artifact **没有** brief↔draft 并排评审界面（它俩是队列里两条独立条目）。所以本节大量是**【外推】**，但外推的每一块都用 artifact 已有语汇：`.client-copy-review`（当前版本 vs 提议版本，`styles.css:10519`）+ `.v13-document-grid`（正文 + 质量侧栏）。

---

## 11. Task 8 详细规格

### 11.1 并排布局 `.compare`【外推，语汇来自 `.client-copy-review`】

**视图切换**（并排不是常驻，见下方论证）：在 `.metaStrip` 之下、`.docGrid` 之上放一个中分段控件【复用-A】DS §3.2(b)：
```css
.viewSwitch{ display:flex; gap:6px; padding:10px 24px;
  background:color-mix(in srgb,var(--sf-surface-deep) 88%,var(--sf-border));
  border-bottom:1px solid var(--sf-border); }
.viewSwitchBtn{ min-height:40px; padding:8px 15px; border:0; border-radius:10px;
  background:transparent; color:var(--sf-ink-700);
  font-size:var(--sf-studio-readable-sm); font-weight:750; }
.viewSwitchBtn:hover, .viewSwitchBtn[aria-selected="true"]{
  color:var(--sf-fg); background:var(--sf-surface); box-shadow:var(--sf-shadow-sm); }
.viewSwitchBtn span{ display:grid; min-width:23px; height:23px; padding:0 5px; place-items:center;
  background:color-mix(in srgb,var(--sf-surface-deep) 78%,var(--sf-border));
  border-radius:50px; font-size:var(--sf-text-xs); }   /* 计数徽标 */
```
两项：`草稿正文` / `Draft only` · `对照 Brief` / `Compare with brief`。
**默认值**：`artifactType === 'english_blog_draft'` 且 brief 可解析 → 默认 `对照 Brief`（Task 8 的核心是 side-by-side）；其余类型不渲染 viewSwitch。

**为什么并排不是常驻**：1440 宽度下 sidebar 252 + 队列 310 + brief + draft + 质量栏 300 会把两栏正文各压到 ~250px，正文 780px 阅读栏宽（§7.1）完全不成立。**解决办法直接复用 artifact 已有的响应式形态，不新发明**：并排模式激活时，**队列轨塌成顶部横向滑轨**（artifact ≤1024 的形态，EXEC §10）：
```css
.workspace[data-compare="on"]{ grid-template-columns:minmax(0,1fr); }
.workspace[data-compare="on"] .workQueue{ position:static; max-height:none; }
.workspace[data-compare="on"] .queueScroll{ display:flex; gap:7px;
  overflow-x:auto; overflow-y:hidden; padding:10px; }
.workspace[data-compare="on"] .queueItem{ flex:0 0 250px; min-height:104px; }
```
腾出的宽度给 `.compare`：
```css
.compare{ display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); }
.comparePane{ min-width:0; padding:clamp(26px,3vw,40px); }
.compareBrief{ background:var(--sf-surface-deep); border-right:1px solid var(--sf-border); }
.compareDraft{ background:var(--sf-surface); }
.compareLabel{ display:flex; gap:8px; align-items:center;
  margin-bottom:14px; padding-bottom:10px; border-bottom:1px solid var(--sf-border);
  color:var(--sf-muted); font-size:var(--sf-text-xs); font-weight:800;
  letter-spacing:.06em; text-transform:uppercase; }
@media (max-width:1200px){ .compare{ grid-template-columns:minmax(0,1fr); }
  .compareBrief{ border-right:0; border-bottom:1px solid var(--sf-border); } }
```
- 左栏 = **参照侧**（brief），中性 `--sf-surface-deep`（对应 artifact `#f5f1e9`）
- 右栏 = **被评审侧**（draft），`--sf-surface`。**注意**：artifact 的 `.is-proposed` 用浅绿高亮"提议侧"，我方**不用绿底** —— 绿在我方语义里是 passed，给未评审的 draft 涂绿会暗示"已通过"。这是**必要偏离**，理由记入 §12.3 反例表。
- 标签文案：`内容 Brief · Revision {n}（冻结版）` / `Content brief · revision {n} (frozen)` ； `English draft · Revision {n}` 。
  > brief 必须标注**冻结版**：读的是 `source.contentBriefRevision` 那一版，不是 live 版（DATA §2）。
- 两栏正文都用 §7.1 的排版基座；`p,li{max-width:none}`（并排下不再限 780px，改由列宽限制）。
- **滚动同步**：不做。两份文档结构不同，同步滚动会造成假对齐。各自独立滚动，`.comparePane{max-height:calc(100vh - var(--sf-sticky-top) - 120px); overflow-y:auto; overscroll-behavior:contain}`。

**覆盖标注（Task 8 的评审价值所在）**【外推】：
coverage claim 的 `detail` **逐字列出未覆盖的主题原文**（带引号，DATA §3.2）。在 brief 栏内，对每个被判定未覆盖的 section heading 加一个行尾标记：
```css
.coverageMiss{ display:inline-flex; align-items:center; gap:4px; margin-left:8px;
  padding:2px 8px; border-radius:999px;
  color:var(--sf-coral-text); background:var(--sf-coral-soft);
  font-size:var(--sf-text-xs); font-weight:700; vertical-align:middle; }
```
文案 `草稿未覆盖` / `Not covered in draft`。**匹配方式**：字符串精确匹配 detail 里带引号的原文；匹配不到时**不标注**（宁可漏标也不错标）。当 coverage claim 为 `unevaluated`（D2 非英文）时，brief 栏顶部加一行 `.qaScopeNote` 同款提示：`本轮未做覆盖判定（{原因}），左右两栏的对应关系需要人工判断。`

### 11.2 评审绑定 current revision（CON C-19）

**三处常驻表达**：
1. 文档头 kicker：`{类型} · Revision {n}` + 状态药丸（§6.1）—— 恒显
2. 质量栏顶部 verdict 药丸下方一行小字：`结论对应 Revision {qa.evaluatedRevision}` / `Verdict applies to revision {qa.evaluatedRevision}`
3. **关键**：当 `qa.evaluatedRevision !== artifact.currentRevision` 时，**质量结论全部标记为过期**：
   - verdict 药丸变 neutral，文案改 `结论已过期（针对 Revision {evaluatedRevision}）` / `Verdict is stale (evaluated revision {evaluatedRevision})`
   - 三格计数条整体降透明度 `opacity:.55` 并加 `title`/`aria-describedby`
   - 阻断块与组行**保留显示**（历史事实），但整个 `质量检查` section 上方加 `.staleBanner`
   - **"通过评审"控件禁用**，原因写 `当前 Revision {n} 还没有跑过自动检查。`

**评审提交必须携带 revision**：`PATCH updateProjectArtifact` 带 `baseRevision`（DATA §2）。**409 `STALE_REVISION` 的 UI 处理见 §11.5。**

### 11.3 编辑使旧评审失效（CON C-20）

我方的"编辑"= 保存新 revision（`PATCH` 建新 revision，studio 已有 `saveRevision`）。**精确交互序列 —— 四处必须同时变，缺一处就是 bug**：

1. `currentRevision` +1
2. artifact `status` 从 `ready` 退回 `draft`
3. 质量栏 `人工审核` 组从 `已通过` 退回 `等待人工确认`；其余四组标记为**结论已过期**（§11.2 第 3 条）
4. 文档头下方出现 `.staleBanner` 常驻横幅

```css
.staleBanner{ display:grid; gap:4px; padding:12px 14px; margin:0 24px 18px;
  color:var(--sf-coral-text); background:var(--sf-coral-soft);
  border:1px solid color-mix(in srgb,var(--sf-coral) 30%,var(--sf-border));
  border-radius:11px; }
.staleBanner strong{ font-size:var(--sf-studio-readable-sm); }
.staleBanner span{ font-size:var(--sf-text-xs); line-height:1.5; }
```
文案【复用-A 句式】REV §1.2 B：

| zh-CN | en |
|---|---|
| **`旧版评审已失效`** — `Revision {n} 修改了客户可见内容，需要对新版本重新完成人工评审。之前的评审记录与自动检查结论都保留为只读历史，不会被覆盖。` | **`Previous review no longer applies`** — `Revision {n} changed customer-visible content, so the new revision needs a fresh human review. The earlier review note and automated verdict are kept as read-only history and are not overwritten.` |

**同时**：评审历史入口（`版本历史` 按钮）在有失效记录时改名 —— artifact 的做法是 `查看模拟回执` → `查看历史模拟回执`（REV §1.1，"最省成本的一个表达点"）。我方对应：`版本历史` → **`版本历史（含已失效评审）`** / `Revision history (includes superseded reviews)`。

**保存前的预告**（artifact 的 `.client-run-preview` 三格，REV §1.2 B）【复用-A】：保存新 revision 的确认 Modal 里放三格：
| 格 | 值 |
|---|---|
| `新版本` / `New revision` | `Revision {n+1}` |
| `当前状态` / `Current status` | 状态标签 |
| **`评审状态`** / `Review status` | `hadReview ? '保存后失效' : '仍需评审'` / `Will be superseded` : `Still needs review` |

### 11.4 评审决策控件（三态，CON C-22）

位置：文档头 `.docActions`（与 artifact 一致，REV §1.1），**不在质量栏、不在页面底部**。

| 按钮 | zh-CN | en | 变体 | 出现条件 | 禁用条件 |
|---|---|---|---|---|---|
| 1 | `版本历史` | `Revision history` | secondary | 恒显 | — |
| 2 | `保存新 Revision` | `Save new revision` | secondary | `status ∈ {draft, ready}` | 无未保存编辑时禁用 |
| 3 | `需要补充` | `Needs more evidence` | secondary | `qa !== null` | `qa === null` |
| 4 | `退回草稿` | `Send back to draft` | secondary | `status === 'ready'` | — |
| 5 | **`通过评审`** | **`Pass review`** | primary | `qa !== null && status === 'draft'` | 见下 |
| 6 | **`发布到 CMS · 本阶段不可用`** | **`Publish to CMS · unavailable at this stage`** | secondary + `disabled` | **恒显**（§11.6） | 恒禁用 |
| 7 | `查看评审回执` | `View review receipt` | secondary | 该 artifact 有已记录的评审 | — |

**"通过评审"禁用条件与就地原因**（H-6：禁用必须**在控件附近**给出原因，**不只在侧栏**，**不靠 tooltip**）：

```css
.actionBlock{ display:flex; flex-direction:column; gap:5px; align-items:stretch; }
.actionReason{ max-width:26ch; color:var(--sf-coral-text); font-size:var(--sf-text-xs); line-height:1.45; }
.actionReason[data-tone="neutral"]{ color:var(--sf-muted); }
```

| 禁用原因 | zh-CN 就地说明 | en |
|---|---|---|
| `verdict === 'blocked'` | `草稿里有 {k} 处引用无法核实，先补证据或改稿。` | `{k} citation(s) cannot be verified — add evidence or revise first.` |
| `qa.evaluatedRevision !== currentRevision` | `当前 Revision {n} 还没有跑过自动检查。` | `Revision {n} has not been checked yet.` |
| `qa === null` | `自动检查还没有结论。` | `No automated verdict yet.` |
| 有未保存编辑 | `请先保存或丢弃编辑。` | `Save or discard your edits first.` |

> `disabled` 按钮的 a11y：用原生 `disabled` + `aria-describedby` 指向 `.actionReason` 的 id。**不要**用 `aria-disabled` + 可聚焦的假禁用（会让屏幕阅读器用户点了没反应）。

**`needs_review` 时的勾选确认**（CON C-22）：点"通过评审"打开确认 Modal，内含必勾 `.checkRow`：
`我已逐条查看 {k} 项需要人工确认的检查结果，并确认可以通过。` / `I have reviewed all {k} findings that require human confirmation and confirm this can pass.`

### 11.5 Modal / Drawer 与回执

**Overlay 通用规格全部【复用-A】**（REV §4，DS §3.8）：单一 `overlayFrame(title, subtitle, body, {drawer, wide, footer})` 工厂；modal `min(640px,100%)`、wide `min(900px,100%)`、drawer `min(690px, calc(100% - 20px))` 右滑 `20px 0 0 20px`；scrim `rgba(10,25,21,.56)` + `backdrop-filter:blur(5px)` 且**是 `<button>` 不是 `<div>`**；≤760px 全变 bottom sheet（`align-items:flex-end; padding:0; border-radius:20px 20px 0 0; max-height:92vh`，footer `padding:12px 18px max(12px, env(safe-area-inset-bottom))`）；≤480 footer `column-reverse` + 按钮全宽。

**用 drawer 还是 modal**（DS §3.8 规则，照抄）：drawer = 只读详情/证据/历史；modal = 决策与表单。
→ `版本历史` = **drawer**；`通过评审` / `需要补充` / `保存新 Revision` = **modal**；`Revision 只读快照` = **wide modal**；`回执` = **modal**。

**确认 Modal 四段式 body**【复用-A】REV §8 第 2 项：
1. `.confirmObject`（绿底确认块）：`<strong>{标题}</strong><span>Revision {n} · {targetRef}</span>` ← **这是"你正在评审哪一个 Revision"的绑定表达**
2. `.checkRow` 必勾 checkbox
3. `<textarea name="note" required>` 评审备注（写进 `ArtifactRevision.note`）
4. `.decisionImpact` 影响预览：`通过评审后 该 Revision 会被标记为已评审，评审备注与时间写入版本记录。不会写入任何 CMS、Git 或第三方发布目标。`

> **表单跨容器提交**：footer 按钮用 `type="submit" form="review-pass-form"`（artifact 一致做法，DS §3.14）。React 下确保 `id` 唯一且 SSR/CSR 一致。

**回执 `.receipt`**【复用-A】REV §5：
```css
.receipt{ text-align:center; }
.receiptCheck{ display:grid; width:58px; height:58px; margin:0 auto 14px; place-items:center;
  color:var(--sf-mint-text); background:var(--sf-mint-soft); border-radius:50%; }
.receiptCheck svg{ width:28px; height:28px; }
.receiptCheck[data-kind="blocked"]{ color:var(--sf-amber-text); background:var(--sf-amber-soft);
  font-size:28px; font-weight:800; }                 /* 内容为 "!" 字面量 */
.receipt h3{ margin:0; font-family:var(--sf-font-display); font-size:24px; }
.receipt > p{ max-width:500px; margin:7px auto 0; color:var(--sf-ink-700);
  font-size:var(--sf-studio-readable-sm); line-height:1.6; }
.receipt dl{ display:grid; gap:8px; margin:24px 0; text-align:left; }   /* 容器居中，键值左对齐 */
.receipt dl > div{ display:grid; grid-template-columns:150px 1fr; gap:15px;
  padding:11px 0; border-top:1px solid var(--sf-border); }
.receipt dt{ color:var(--sf-muted); font-size:var(--sf-text-xs); font-weight:700; }
.receipt dd{ margin:0; font-size:var(--sf-studio-readable-sm); font-weight:650; }
@media (max-width:480px){ .receipt dl > div{ grid-template-columns:1fr; gap:2px; } }
```

**评审回执字段范式**（描述**真实发生的事**，裁决 β）：

| dt (zh / en) | dd |
|---|---|
| `回执编号` / `Receipt ID` | `RCP-REVIEW-{revisionId 后 8 位}` |
| `交付物` / `Deliverable` | Action 标题 |
| `评审版本` / `Reviewed revision` | `Revision {n}` |
| `冻结输入指纹` / `Frozen input hash` | `<code>{contentHash.slice(0,16)}…</code>` |
| `自动检查结论` / `Automated verdict` | verdict 中文词 + `（{p} 通过 / {f} 未通过 / {u} 未判定）` |
| `评审时间` / `Reviewed at` | 本地化时间；缺失 `—` |
| **`外部发布写入`** / **`External publishing write`** | **`未发生`** / **`None`** |

> 最后一行是 artifact 的手法：**把否定断言变成表格里的一个事实**（REV §6 L3-10）。

回执正文：
| zh-CN | en |
|---|---|
| `Revision {n} 已标记为已评审。评审备注与时间已写入版本记录。没有发生任何 CMS、Git 或第三方发布写入。` | `Revision {n} is marked as reviewed. The review note and timestamp are recorded on the revision. No CMS, Git, or third-party publishing write occurred.` |

回执底部 `.button--full`：`打开来源机会` / `Open source opportunity`。**没有"复制链接"按钮**（我方不生成任何可分享 URL）。footer 单个 primary：`完成` / `Done`。

**blocked 回执**（一等公民，REV §5 / CON H-12）—— 用于 **409 `STALE_REVISION`**、run failed、任何被拒绝的动作：
| slot | zh-CN | en |
|---|---|---|
| 标题 | `操作已阻断` | `Action blocked` |
| 徽 | `.receiptCheck[data-kind=blocked]` = amber `!` | |
| 409 正文 | `这个交付物已经产生了新的 Revision（当前 Revision {n}）。本次评审基于 Revision {m}，没有被记录，也没有改变任何状态。请查看新版本后重新评审。` | `This deliverable already has a newer revision (currently revision {n}). Your review targeted revision {m}; it was not recorded and nothing changed. Review the new revision instead.` |
| dl | `尝试的操作` / `目标版本` / `当前版本` / **`已发生的变更`** = **`无`** | `Attempted action` / `Target revision` / `Current revision` / `Changes made` = `None` |

> **绝不静默重试、绝不用最新 revision 自动重放**（CON C-19 反例）。

**版本历史 Drawer**【复用-A】REV §1.2 E：
- 标题 `交付物版本历史` / `Revision history`，**副标题 `追加式不可变记录` / `Append-only, immutable`**
- 每条一个按钮，三列 grid（`auto minmax(0,1fr) auto`）：`[badge] Revision {n} · {note 首行}` / `{时间} · {评审状态}` / `[→]`
- badge：`当前 Revision`（success）/ `历史 Revision`（neutral）/ **`评审已失效`（amber）**
- 排序：revision 降序
- 底部 `.honestyNote`：`每个 Revision 都保存正文、冻结输入指纹与当时的自动检查结论；历史版本不可覆盖。` / `Every revision keeps its body, frozen input hash, and the automated verdict at the time; history is never overwritten.`
- **⚠️ 数据缺口**：**没有 `listArtifactRevisions` operation**（DATA §7 #7）。一期只能列出「当前版 + 本次 run 冻结版」两点。→ 开放问题 **O-3**。

### 11.6 Publish 控件 —— 确切形态

**用户看到什么**：
```
[ 发布到 CMS · 本阶段不可用 ]   ← secondary button, disabled, 恒显示
  本阶段不连接任何 CMS、Git 或第三方发布目标。
  评审通过只产生一个已评审的 Revision。
```
```css
.publishBlock{ display:flex; flex-direction:column; gap:5px; }
.publishNote{ max-width:30ch; color:var(--sf-muted); font-size:var(--sf-text-xs); line-height:1.45; }
```
按钮 `disabled` + `aria-describedby="publish-note"`；`.button:disabled{opacity:.62; cursor:default}`【复用-A】DS §3.11。

| slot | zh-CN | en |
|---|---|---|
| label | `发布到 CMS · 本阶段不可用` | `Publish to CMS · unavailable at this stage` |
| note | `本阶段不连接任何 CMS、Git 或第三方发布目标。评审通过只产生一个已评审的 Revision。` | `This stage connects to no CMS, Git, or third-party publishing target. Passing review produces a reviewed revision only.` |

**这就是吸收 artifact「把限制写进控件文案本身」方法论的落点**（REV §6 L2）：artifact 写 `模拟分享`，我方写 `· 本阶段不可用`。**区别**：artifact 有一个可点的模拟动作，我方没有，所以我方的诚实形态是 disabled 而不是"模拟"。

**点了发生什么**：什么都不会发生 —— 按钮是原生 `disabled`，**不可聚焦、不可点击、不触发任何请求**。

**绝不能发生什么**（CON C-16，逐条）：
1. ❌ 成功 toast / snackbar / 「已发布 ✓」—— **无论文案多含糊**
2. ❌ artifact `status` 被写成 `published`；`draft`/`ready` 被显示为已发布
3. ❌ 任何对外 HTTP 写请求。E2E 断言 `exportRequests == []` 且无 published 状态
4. ❌ 生成一个**看起来能点开的真实 URL**（artifact 用 `local-artifact://` 不可解析协议；我方**连假 URL 都不生成**）
5. ❌ `if (process.env.ENABLE_PUBLISH)` 这类靠环境变量关着的真实分支（CON C-18）
6. ❌ 用成功 toast 覆盖失败/部分成功

**是否需要"发布回执占位"**：不需要单独的占位卡。质量栏的「发布与结果」段（§8.7）已经承担这个说明，重复放会稀释。

---

## 12. 诚实性设计专章

### 12.1 常驻场景横幅 `.scenarioNotice`【复用-A】

**位置**：shell 级，`topbar` 之下、`#route-content` 之上，**每一屏都常驻**，`role="note"`，**不可关闭**（不是 toast、不是 tooltip、不是"关于"页）。

```css
.scenarioNotice{ display:flex; gap:10px; align-items:center; min-height:40px;
  padding:8px clamp(20px,2.7vw,42px);
  color:var(--sf-mint-text); background:var(--sf-mint-soft);
  border-bottom:1px solid color-mix(in srgb,var(--sf-mint) 30%,var(--sf-border));
  font-size:var(--sf-text-xs); line-height:1.45; }
.scenarioNotice strong{ flex:0 0 auto; color:var(--sf-mint-text);
  font-size:var(--sf-text-xs); font-weight:800; letter-spacing:.02em; }
@media (max-width:760px){ .scenarioNotice{ display:grid; gap:2px; padding:8px 16px; } }
```
> 语气是**淡绿中性说明色**，不是警告黄/红（DS §2.2）—— 诚实不等于警报。

**文案按我方真实情况改写**（CON H-1 明确要求"按实际情况改写"，不照抄 RelayOps 场景）：

| zh-CN | en |
|---|---|
| **`本轮范围`** `本轮的研究证据只从项目内已确认的数据组装，不做外部检索；不连接任何内容管理系统、Git 或第三方发布目标。评审结论只写入交付物的版本记录。` | **`Scope of this stage`** `Research evidence in this stage is assembled only from data already confirmed inside the project, with no external retrieval. No CMS, Git, or third-party publishing target is connected. Review outcomes are written to the deliverable's revision record only.` |

i18n key：`appShell.scenarioNotice.label` / `appShell.scenarioNotice.body`（全局 shell 构件 → `appShell` namespace，DRIFT §5.3）。

### 12.2 三种手段的分工（吸收 artifact 的完整武器库，REV §6）

| 层 | 手段 | 我方落点 |
|---|---|---|
| **L1 常驻结构**（零点击成本） | 全屏横幅 | §12.1 |
| | 侧栏页脚 | `.sidebarFootnote`：`冻结输入 · {contentHash 前 8} · {createdAt 日期}` |
| **L2 控件文案本身**（点之前就知道） | 按钮标签内嵌限制 | `发布到 CMS · 本阶段不可用`；`版本历史（含已失效评审）` |
| | 状态词内嵌限制 | `ready` → **`已评审 · 未发布`**（不是「就绪」，不是「已发布」） |
| | 结论词内嵌限制 | verdict `passed` → **`自动检查已通过 · 待人工评审`** |
| **L3 确认前告知** | `.honestyNote` 薄荷绿块 | 每个决策 Modal 首行 |
| | 结构化事实 dl 里的否定行 | 回执 `外部发布写入 → 未发生` |
| | 必勾 checkbox 文案 | `我已逐条查看…并确认可以通过。` |
| **L4 结果兜底** | blocked 回执一等公民 | §11.5 |
| | 显式否定 message | `没有创建记录，也没有改变状态。` |
| **L5 技术保证**（不只靠文案） | 提交时二次校验 | 前端 disabled 只是 UI；提交 handler 必须**重算** verdict/revision 守卫，不合格走 blocked 回执且**零写入** |
| | 复制失败不假装成功 | 若有复制动作：`navigator.clipboard` 缺失/reject → 按钮改 `复制失败，请手动复制` |
| | 缺失数据不写 0 | §9.6 |

```css
.honestyNote{ padding:12px 14px; margin:0 0 16px;
  color:var(--sf-ink-700); background:var(--sf-mint-soft);
  border:1px solid color-mix(in srgb,var(--sf-mint) 28%,var(--sf-border));
  border-radius:11px; font-size:var(--sf-studio-readable-sm); line-height:1.6; }
.honestyNote strong{ color:var(--sf-mint-text); }
```

### 12.3 正例 / 反例对照表（**这张表是审稿判据**）

| # | 场景 | ✅ 正例 | ❌ 反例（算美化/隐藏，禁止） |
|---|---|---|---|
| 1 | QA blocked | 正文完整渲染 + 暖橙块「当前不能通过评审」+ 逐条具名原因 + 「这不是运行失败」+ 下一步 | 红色 `QA Failed` 空状态；「质量检查失败，请重试」；把 blocked 项从队列隐藏 |
| 2 | advisory 恒 passed | 计数条如实显示 + 常驻脚注说明「{a} 项为提示级，命中也记为通过」 | 只显示「已通过 23 项」；把 advisory 混进"通过"不加说明 |
| 3 | `evaluable:false` | 第三态 `未评估` + 中文原因 + **不计入通过数** | 渲染成绿勾；静默省略该项（用户以为只有 3 项检查）；计入分子 |
| 4 | outline 提取失败 | 与正文同级、**不可折叠**的横幅 + 并排两栏之间显式标注因果断裂 | 只写进 limitations 折叠区；UI 上看不出 draft 与 brief 无关 |
| 5 | pack 无指标 | 指标列显示 `—` + 列尾脚注说明只冻结了身份 | 填 0；隐藏该列；写「暂无数据」（可读成"数据为零"） |
| 6 | 0 外部来源 | `外部可引用来源：0 条（本轮未做外部检索）` + 挂 limitation 原文 | 用 `sources.length`（内部 UUID 计数）冒充「可引用来源 N 条」 |
| 7 | 就绪度分数 | 三分计数 `9 通过 / 3 未通过 / 14 未判定` | `交付就绪度 92/100`（advisory 恒 passed 会让它长期虚高） |
| 8 | Publish | disabled 按钮 + 标签内嵌「本阶段不可用」+ 就地说明 | 按钮写「发布」，disabled 但不说为什么；点击后才弹「这是演示」 |
| 9 | 评审通过 | 回执 modal + `外部发布写入 → 未发生` | 绿色成功 toast「已发布」；状态显示「已上线」 |
| 10 | 409 冲突 | blocked 回执 + `已发生的变更 → 无` | console 报错、界面无变化；用最新 revision 自动重放 |
| 11 | 负责人 | 换成真实存在的 `生成方式 · {locale}` | 渲染一个按类型硬编码的假负责人 |
| 12 | 无法解析的 ID | `未命名交付物` | 回落成裸 UUID `art-8f29-…` |
| 13 | draft 底色 | 中性 `--sf-surface` | 用 `.is-proposed` 浅绿底（绿在我方 = passed，会暗示"已通过"） |
| 14 | QA 覆盖边界 | 「本轮不检查：与外部内容的重复度、超出项目数据的外部事实、品牌语气」 | 「5 项质量检查全部通过」；「未来可扩展」 |
| 15 | 效果预估 | 完全不出现 | brief 卡片显示「预计月流量 +2.4K」；「预计带来 +12% 自然流量」 |
| 16 | 规则标识 | `断言缺少可核实出处` | `RL8-SF: blocked` / `SC9b-SF: passed` |

### 12.4 禁用词表（客户可见的标签/标题/按钮上一律禁止）

`gate` / `Gate` / `门禁`（单独用）· `rule` / `RL8` / `SC9b` / 规则 ID · `check`/`checks` 作一等名词 · `artifact_type` / `english_blog_draft` / `content_brief` 等 enum 字面量 · `verdict` / `passed` / `blocked` 裸英文 · `projection` / `revision snapshot` / `content_hash` / `frozen inputs` 作主视觉标签 · `evaluable:false` 裸字段 · `stage` / `slide` / `phase`（作为面向客户的名词）。
**替代词全部在本文各节的文案表里，实现时从 `lib/labels` 常量取，不允许实现 agent 自由发挥措辞**（DS §6.1 最后一行）。

---

## 13. 响应式与无障碍

### 13.1 断点与三栏塌缩

统一采用 **1280 / 1024 / 960 / 760 / 480** 五档（对齐 app studio 现有的 1280/960/560 + artifact 的 1024/760/480，取并集后收敛）。

| 断点 | 变化 |
|---|---|
| **≤1280** | `.docGrid` 右栏收成固定 `272px`；`.compare` 保持两列 |
| **≤1200** | `.compare` → 单列（brief 在上、draft 在下，`compareBrief` 换 `border-bottom`）【复用-A】REV §2.1 |
| **≤1024** | **主塌缩点**：`.workspace` 与 `.docGrid` 全部 `grid-template-columns:1fr`；队列与质量栏 `position:static; max-height:none`；`.queueScroll` 变**横向滑轨**（`display:flex; gap:7px; overflow-x:auto; overflow-y:hidden; padding:10px`，item `flex:0 0 250px; min-height:104px`）；`.docBody{border-right:0}`；`.qaRail` 变 `display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:0 24px; border-top:1px solid var(--sf-border)`，`.qaVerdict` 与 `.qaCounts` `grid-column:1/-1`；`.metaStrip` 4→2 列 |
| **≤960** | `.pageHeader` 变 block；`.queueScroll` 可选 2 列 grid（`max-height:340px`） |
| **≤760** | `.filterBar{display:block; padding:8px}`，计数换行；`.queueHead` 隐藏（artifact 同）；`.docHead{display:grid; padding:22px 20px 18px}`，actions 全宽换行；`.docBody{padding:26px 20px 34px}`，正文 17→16px、h1 37px、h2 25px；`.qaRail{grid-template-columns:1fr; padding:20px}`；`.metaStrip` 1 列（`border-left`→`border-top`）；所有 overlay 变 **bottom sheet**（含 `env(safe-area-inset-bottom)`）；`.scenarioNotice` 变 grid 两行 |
| **≤480** | `.qaFacts > div{grid-template-columns:1fr; gap:2px}`；`.receipt dl > div` 单列；`.docActions .button{flex:1}`；overlay footer `column-reverse` + 按钮全宽 |

**硬指标**（CON C-12）：**1440 / 1024 / 768 / 390 四个视口无 root overflow**。所有宽内容（并排两栏、代码块、markdown 表格）必须在**自己的** `overflow-x:auto` 容器里滚，`body` 绝不横向滚动。

### 13.2 对比度

- 新增配色必须过既有 `components/ui/color-contrast.test.ts`【复用-B】DRIFT §4.3。
- 硬性下限：正文与状态词 **4.5:1**；12px 微标签 **4.5:1**（不吃 large-text 豁免，因为它不是 large text）；disabled 控件 `opacity:.62` 后仍需 **3:1**（若不达标，改用 `--sf-muted` 前景 + `--sf-surface-deep` 底，而不是靠 opacity）。
- 状态**绝不只靠颜色**：四态质量组行同时用**图标字符**（✓ / × / ! / —）+ **状态词**，颜色是第三重冗余。

### 13.3 键盘可达性与焦点管理【复用-A】DS §5

| 项 | 规格 |
|---|---|
| Skip link | `<a class="skip-link" href="#route-content">跳到主要内容</a>` 为 `<body>` 首节点；`transform:translateY(-150%)` → `:focus{translateY(0)}` |
| 主内容锚点 | `#route-content` 带 `tabindex="-1"`；每次路由/筛选切换后 `rAF` 内 `.focus()` |
| 全局焦点环 | **只用 `globals.css:185-189` 的 `:focus-visible`**，新组件不得自写 outline【复用-B】 |
| 筛选 tablist | roving tabindex + `ArrowLeft/Right/Up/Down`（循环）+ `Home`/`End`；`preventDefault()` → 触发 → `rAF` 后 `focus()` |
| 队列条目 | 原生 `<button>`；`aria-current="true"` 标记选中；选中后焦点分流：>1024 焦点留在被点条目 `focus({preventScroll:true})`；≤1024 焦点移到 `.docPanel`（`tabindex="-1"`）+ `scrollIntoView`（reduce-motion 时 `behavior:'auto'`） |
| 质量组展开 | `<button aria-expanded aria-controls>`；`Enter`/`Space` 切换；箭头 `transform:rotate(90deg)`，`transition:.18s ease` |
| 视图切换 | `role="tablist"` 同筛选条 |
| Overlay | `role="dialog" aria-modal="true" aria-labelledby="overlay-title"`；打开保存 `lastFocus` → `rAF` 后聚焦首个 `[data-autofocus] / input / select / textarea / button(非关闭键)`；`Escape` 关闭；关闭后焦点**归还** `lastFocus` |
| 焦点陷阱 | 手写 Tab 循环：`button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]`，首尾环绕 |
| 背景惰性化 | overlay 打开时 sidebar / scrim / `<main>` 三处同时 `inert aria-hidden="true"`；`<body>` 加 `overflow:hidden` |
| 图标 | 全部 `aria-hidden="true"`；纯图标按钮必带 `aria-label` |
| 语义分区 | `<aside>` 队列与质量栏、`<article>` 文档面板、`<section aria-label="交付治理信息">` meta strip、`<section aria-label="质量检查">` |
| 减少动效 | `globals.css:201-208` 已全局兜底【复用-B】；**JS 侧同步**：`matchMedia('(prefers-reduced-motion: reduce)')` 决定 `scrollIntoView` 用 `auto` 还是 `smooth` |
| 图标规范 | 内联 SVG，`viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"`。**stroke-width 1.8 是识别特征，不要用 2 或 1.5**（DS §3.12） |

---

## 14. i18n

### 14.1 硬规则

1. **中文侧的诚实性措辞照抄 artifact 已验证的表达**（DRIFT §5.3），但**场景描述必须按我方真实情况改写**（CON H-1）—— 不要写 RelayOps 的横幅原文。
2. **英文侧沿用「具名而非抽象」风格**，`unavailable / not evaluated / not published` 必须留在 **label 内**，不得挪到 tooltip 或点击后的弹窗。
3. **新增 key 必须 en.json 与 zh-CN.json 同一次提交同步**，否则 `packages/i18n/src/__tests__/parity.test.ts` 红（DRIFT §5.1）。
4. `zh-CN` 下 `globals.css:91-93` 会把 `--sf-font-display` 换成无衬线 CJK → **中文界面没有衬线标题**。artifact 的 serif hero 气质在中文下会丢失。→ 开放问题 **O-7**（品牌轴裁决时一并处理，例如把 `Noto Serif SC` 加进 CJK 衬线变体）。**Task 7/8 不擅自改这条。**

### 14.2 namespace 归属

| 内容 | namespace | 说明 |
|---|---|---|
| 场景横幅 | `appShell.scenarioNotice.*` | 全局 shell 构件 |
| 侧栏页脚 | `appShell.frozenFootnote` | |
| 执行中心页头、筛选、队列、文档头、meta strip、正文装饰件 | `studio.*`（扩写既有 ≈80 key） | **不开新 namespace**（DRIFT §5.2） |
| 质量栏（结论 / 计数 / 5 组 / 26 条 claim 名 / 脚注 / 阻断块） | `studio.qa.*` | |
| 并排对照 | `studio.compare.*` | |
| 评审决策、失效横幅、回执、版本历史 | `studio.review.*` | |
| Publish 控件 | `studio.publish.*` | |
| 降级提示（D1–D4） | `studio.degraded.*` | |

**`execution.*` 命名空间的处置**（9 个 key）：删掉 `_execution.tsx` 后 `chainTitle` / `chainLead` / `emptyTitle` / `emptyBody` / `actionLabel` / `artifactPending` 失去消费者 → **清理**；`deliverableLabel` / `revisionLabel` / `artifactType.*` **迁进 `studio`** 复用。清理与迁移必须与 `parity.test.ts` 同一次提交。

### 14.3 新 key 清单（骨架 —— 实现时按本文各节文案表填全）

```
appShell.scenarioNotice.label / .body
appShell.frozenFootnote
studio.filter.all / .blog / .brief / .metadata / .ticket
studio.filter.ariaLabel / .count / .countNone
studio.meta.linkedTarget / .sourceOpportunity / .generation / .automatedChecks
studio.meta.notLinked / .notEvaluatedYet / .dash
studio.phase.queued / .research / .draft / .qa / .failed / .partial
studio.artifactStatus.generating / .draft / .reviewedNotPublished / .failed / .archived
studio.qa.verdictLabel / .verdict.passed / .verdict.needsReview / .verdict.blocked / .verdict.none
studio.qa.verdictRevision / .verdictStale
studio.qa.countsTitle / .counts.passed / .counts.failed / .counts.unevaluated
studio.qa.sectionChecks / .sectionEvidence / .sectionPublish
studio.qa.group.redLine / .structure / .citability / .coverage / .humanReview
studio.qa.state.passed / .failed / .partial / .unevaluated
studio.qa.claimLabels.*            (26 条，key = claimId)
studio.qa.claimBasis
studio.qa.scopeNote
studio.qa.blocker.title / .body / .why / .next / .more
studio.qa.facts.sourceOpportunity / .target / .diagnosticEvidence / .frozenRecords
studio.qa.facts.externalCitable / .externalCitableValue / .connectedSources / .frozenHash
studio.qa.publishNote
studio.compare.switchDraft / .switchCompare
studio.compare.briefLabel / .draftLabel / .coverageMiss / .coverageUnevaluated
studio.degraded.briefLinkBroken.title / .body
studio.degraded.localeNotEvaluated
studio.degraded.identityOnly
studio.degraded.noExternalSources
studio.review.pass / .needsEvidence / .sendBack / .history / .historyWithSuperseded
studio.review.disabled.blocked / .staleVerdict / .noVerdict / .unsavedEdits
studio.review.confirm.title / .checkbox / .noteLabel / .impact
studio.review.stale.title / .body
studio.review.preview.newRevision / .currentStatus / .reviewStatus / .willBeSuperseded / .stillNeedsReview
studio.review.receipt.title / .body / .id / .deliverable / .revision / .hash
studio.review.receipt.verdict / .reviewedAt / .externalWrite / .externalWriteNone
studio.review.blockedReceipt.title / .staleBody / .attempted / .changesMade / .changesNone
studio.review.historyTitle / .historySubtitle / .badgeCurrent / .badgeHistorical / .badgeSuperseded / .historyNote
studio.publish.label / .note
```

---

## 15. 契约影响裁决建议（**全部标为「需主 agent 拍板」**）

> 基线（DATA §5.3 已核实）：**47 operations / 9 async / 44 tables / 11 rules**；`openapi/mvp.yaml` 与 `authority/implementation-spec-v0.3/openapi.yaml` 当前 sha256 完全一致。
> **加字段 ≠ 加 operation**：加字段只触发 7 处中的 **4 处**（①②③④ 的 sha256 + `packages/contracts/src/zod/*`），计数 47/9/44/11 **全部不变**；加 operation 触发全部 7 处 + 计数变化。
> 验证：`pnpm contracts:check` no diff + `pnpm verify:authority` / `verify:spec` / `implementation:check`。

### 提案 P1 — `listContentShadowRuns`（**加 operation**）

- **问题**：执行中心打开时，**无法从任何既有 API 得知"这个 Action 有哪些 shadow run"**（DATA G12）。只有 `createContentShadowRun`(POST) 与 `getContentShadowRun`(GET by id)；`getProjectWorkspaceView` 四个 view 都不含 content_shadow；`Artifact.activeRun` 终态后即为 null。
- **不加的后果**：只能靠本会话内 localStorage 记住 `flowShadowRunId` —— **刷新即丢、跨设备不可见**，与本产品的诚实性主张直接冲突（用户看到的东西取决于他有没有刷新过页面）。
- **完整税清单**：① `openapi/mvp.yaml` ② `authority/implementation-spec-v0.3/openapi.yaml` ③ `packages/contracts/src/generated/openapi.ts`（重生成）④ `scripts/spec-v0.3-lock.json`（`apiOperations` **数组 +1** + `authorityFiles`/`implementationFiles` sha256 手工刷新）⑤ `scripts/verify-implementation.mjs`（`EXPECTED_OPENAPI_OPERATIONS`）⑥ `authority/…/scripts/verify-spec.mjs`（`EXPECTED_*_COUNT` +1）⑦ `authority/…/MVP-IMPLEMENTATION-SPEC.md`（`<!-- API_OPERATIONS -->` 块）+ `packages/contracts/src/zod/content-shadow.ts` + 新路由实现 + 服务层查询。**计数 47→48**，async 仍 9（非 async GET），tables 44 不变。
- **推荐**：**加**。这是 DATA §8 认定的唯一"不加 operation 就做不好"的项。
- **不加时的一期兜底**：从 `listProjectArtifacts?type=english_blog_draft` 拿草稿正文与 revision（能渲染正文），**但拿不到 research / qa / limitations** —— 即质量栏、诚实性 limitations、blocked 阻断块**全部无法渲染**。**这等于 Task 7 的核心价值（正文 + sources + QA）只剩三分之一。**

### 提案 P2 — `ContentShadowQaClaim` 增加 `severity`（**加字段，轻税**）

- **问题**：`severity` 只存在于 `@sf/flow-shadow` 包内（`QA_RULE_SEVERITY`），不出网。UI 想区分 blocking / review / advisory 三档视觉（CON H-6/H-10 明确要求）就只能前端硬编码一份 26 条映射表，**必然与 `rule-types.ts` 漂移**，且漂移后果重（把 blocking 显示成 advisory）。
- **税**：4 处（①②③④ 的 sha256）+ `packages/contracts/src/zod/content-shadow.ts`。**计数零变化、DB 零变化、worker 零变化**（severity 在服务层投影时从 `QA_RULE_SEVERITY` 查表填入，纯 read 拓宽）。
- **推荐**：**加**。
- **不加时的一期兜底**：只硬编码 **3 条 blocking claimId**（`content-shadow.qa.rl8_unsupported_claim` / `…rl12_citation_integrity` / `…sc9b_sources_resolve_to_pack`）—— 它是**闭集**（产品决策才能扩，DATA §3.2），漂移风险远低于 26 条全表；advisory 与 review 合并显示为同一档。**代价**：14 条 advisory 会与 8 条 review 同视觉，H-10「advisory 不得渲染成 gating」只能靠"不进阻断列表"这一条兜底。

### 提案 P3 — `ContentShadowResearch` 增加 `briefOutline`（**加字段，轻税**）

- **问题**：Task 8 的并排对照要显示 brief 承诺的主题清单与 page assignment 四值（CON H-7）。outline 已在 `flow_shadow_research_packs.pack` jsonb 里（`briefSections` / `targetKeywords` / `pageAssignment`），但 **API 只投影了 pack 的 4 个字段，丢掉了其余 8 个**（DATA §5.1）。
- **为什么不能前端重算**：`extractContentBriefOutline` 含 `CONTENT_BRIEF_SECTIONS` 归并、控制字符清洗、`redactText`、512/12/120/50 四道 cap。前端重算 = 复制一份安全关键逻辑，**且必然与冻结值漂移** —— 冻结的意义就是"审计者不必重跑提取器"（DATA §5.2 (c)）。
- **税**：同 P2，4 处，计数/DB/worker 零变化（纯 read 投影拓宽）。
- **推荐**：**加**，但**优先级低于 P1/P2** —— 可放到 Task 8 落地时再加。
- **不加时的一期兜底**：coverage claim 的 `detail` **逐字列出未覆盖主题的原文**（带引号），limitations 带 N/M 截断计数（DATA §5.2 (d)）。够讲清"brief 承诺了什么、草稿漏了什么"，拿不到完整清单和 `pageAssignment` 四值 → **H-7 只能部分兑现**（能说"M 个映射未确认"，不能逐条展示四值）。

### 提案 P4 — `listArtifactRevisions`（**加 operation**）

- **问题**：`getProjectArtifact?revision=N` 可逐版读，但**没有列出全部 revision 的 operation**（DATA §7 #7）→ 版本历史 Drawer 只能列"当前版 + 本次 run 冻结版"两点。
- **税**：完整 7 处，计数 47→48（若与 P1 同批则 47→49）。
- **推荐**：**本轮不加**。artifact 的版本历史是 demo 的追加式内存快照；我方 Task 8 的核心价值在 brief↔draft 并排与失效表达，两点版本历史已足够承载 C-19/C-20。留作 Slice 3。

### 提案 P5 — 修 `QA_PENDING_LIMITATION` 文案（**零契约税，但建议在 Task 7 开工前先做**）

- **问题**：`packages/flow-shadow/src/research/research-pack.ts:40-41` 的常量原文「SEO/GEO red-line, structure and citability judgement is not implemented yet; the draft requires human review.」在 `buildResearchPack` 里**无条件追加**（:173）。Task 6 已经把这套判断实现了。
- **后果**：Task 7 若照实渲染 limitations（我们**必须**照实渲染，这是 H-1/H-5 的核心），会在 26 条 QA claim 旁边显示"QA 还没实现" —— **这是一个自己制造的穿帮点**。
- **税**：改一个常量，零契约税；只影响新 run（老 run 的 pack jsonb 是 append-only 快照）。
- **推荐**：**先修**。建议新文案：`Automated SEO/GEO red-line, structure and citability checks ran on this draft; a human review is still required before the revision can pass.`

---

## 16. 实施顺序与验收清单

### 16.1 顺序

**阶段 0（前置，任何 UI 代码之前）**
1. P5 修 limitation 常量（若批准）
2. 新增全局 token：`--sf-sticky-top` / `--sf-topbar-h` / `--sf-notice-h`
3. `ScenarioNotice` 组件 + `appShell.scenarioNotice.*` i18n（en/zh 同提交）
4. **删三份私有 eyebrow**（overview/growth-map/sources），全屏统一 `.sf-eyebrow`（DRIFT §6 第 4 条，成本极低、立刻拉齐观感）
5. 新增 `EmptyState` 用法规范 + `Icon` 的 `stroke-width:1.8` 校正

**阶段 1（Task 7 主体）**
6. 删 `_execution.tsx` 外壳；`execution/page.tsx` 直接挂 `StudioClient`；清理 `execution.*` i18n
7. `.filterBar` tablist（含 roving tabindex + 选中回落）
8. 队列轨对齐（mark / 两行截断 / 状态药丸 / 空态）
9. `.docHead` + `.metaStrip` 四格（**第 3、4 格换语义**）
10. `.docBody` 排版基座 + markdown 渲染器 + per-type 装饰件
11. `.qaRail` 全量替换（结论 + 三格计数 + 5 组四态 + 展开 claim + 阻断块 + scopeNote + facts + publishNote）
12. 降级 D1–D4 的四条提示
13. 响应式 1024 / 760 两档 → 480 收尾

**阶段 2（Task 8）**
14. `.viewSwitch` + `.compare` 并排（含队列塌成横滑）
15. 覆盖标注 `.coverageMiss`
16. Overlay 工厂（modal/drawer/sheet + 焦点陷阱 + inert + Esc + 归还）
17. 评审三态控件 + 就地禁用原因
18. 确认 Modal 四段式 + 保存前三格预告
19. `.staleBanner` 失效四联动
20. 评审回执 + blocked 回执（409）
21. 版本历史 Drawer（两点版）
22. Publish disabled 控件 + note

### 16.2 Task 7 DoD（可 E2E 断言）

**结构**
- [ ] `PRIMARY_NAV_ITEMS` diff 为空；「恰好四条主导航链接」E2E 绿
- [ ] `execution` 路由内 `<h1>` 恰好 1 个，且**没有任何 `<h2>` 出现在它之前**（当前是 a11y 回归）
- [ ] 全仓 `grep -rn 'sf-execution' apps packages` = 0 命中
- [ ] `.filterBar` 有 `role="tablist"`，5 个 `role="tab"`，roving tabindex（激活 0 其余 -1），面板 `role="tabpanel"`

**内容**
- [ ] 选中一个 `english_blog_draft` 后，**正文第一段在 1440×900 首屏可见**，`font-size ≥ 16px`，`line-height ≥ 1.5`
- [ ] `.metaStrip` 恰好 4 格；第 4 格文本匹配 `/\d+ 通过 \/ \d+ 未通过 \/ \d+ 未判定/`
- [ ] `.qaRail` 内 **不出现任何 UUID 形状字符串**（`/[0-9a-f]{8}-[0-9a-f]{4}-/` 断言为 0 命中），`contentHash` 除外且必须截断到 ≤16 字符
- [ ] `.qaRail` 内不出现 `gate` / `rule` / `RL8` / `SC9b` / `check` 作独立词（正则断言）
- [ ] `.qaRail` 内不出现 `english_blog_draft` / `content_brief` / `technical_ticket` / `metadata_rewrite` 字面量
- [ ] 质量组恰好 5 个；每组同时有**图标字符 + 状态词**（不只靠颜色）
- [ ] `.qaScopeNote` 文本含 advisory 条数与"本轮不检查"三项
- [ ] `外部可引用来源` 行的值恒为 `0 条（本轮未做外部检索）`

**状态**
- [ ] `verdict === 'blocked'` 的固定夹具下：正文完整渲染（`.docBody` 内 `<p>` 数 > 0）；出现 `.blocker`；**页面不含 `失败`/`Failed`/`错误`/`Error`/`重试` 任一字样**；队列条目仍可见
- [ ] `unevaluated` claim 的组：状态词是 `未评估`，**不计入"已通过"计数**
- [ ] `phase ∈ {queued,research,draft,qa}`：正文区是 Spinner + 阶段文案，**不是骨架屏假内容**；结论药丸 `尚未评估`；三格全 `—`
- [ ] `currentRevision === 0`：显示 `尚未生成版本`，**页面不出现 `v0` / `Revision 0`**
- [ ] 任一缺失标量渲染为 `—`；**全页不出现用 `0` 顶替缺失值**的单元格

**响应式 / a11y**
- [ ] 1440 / 1024 / 768 / 390 四视口 `document.scrollingElement.scrollWidth <= clientWidth`
- [ ] ≤1024：`.qaRail` 两列横铺、队列横向滑轨
- [ ] Tab 键在筛选条内 roving；方向键循环；`Home`/`End` 生效
- [ ] `prefers-reduced-motion` 下无 `scroll-behavior:smooth`
- [ ] axe 扫描 0 critical / 0 serious

### 16.3 Task 8 DoD（可 E2E 断言）

- [ ] `对照 Brief` 视图下 `.compare` 有恰好两个 `.comparePane`；左栏标签含 `冻结版`/`frozen`；1200px 以下变单列且无 root overflow
- [ ] draft 栏底色**不是** mint 系（断言 computed background 不等于 `--sf-mint-soft`）
- [ ] 文档头 kicker 常驻 `Revision {n}`；质量栏含 `结论对应 Revision {m}`
- [ ] `qa.evaluatedRevision !== currentRevision` 夹具：verdict 药丸变 neutral 且文案含 `已过期`；`通过评审` 为原生 `disabled` 且 `aria-describedby` 指向的文本含 `还没有跑过自动检查`
- [ ] `verdict === 'blocked'`：`通过评审` `disabled`，**且其相邻 `.actionReason` 文本非空**（断言禁用原因就地可见，不在 tooltip 里）；`需要补充` / `退回草稿` **仍可点**
- [ ] `verdict === 'needs_review'`：`通过评审` 可点；点击后 Modal 内有 `required` checkbox，未勾选时提交被 `reportValidity()` 拦下且**不打开回执**
- [ ] 保存新 revision 后**四处同时变**：revision +1、status→`draft`、`人工审核` 组→`等待人工确认`、`.staleBanner` 出现（一条 E2E 断言四项，缺一则红）
- [ ] 评审回执 dl 含 `外部发布写入` → 值为 `未发生` / `None`
- [ ] 409 `STALE_REVISION` 夹具：出现 blocked 回执，标题 `操作已阻断`，dl 含 `已发生的变更 → 无`；**artifact 状态未改变**
- [ ] Publish 按钮：`disabled === true`、label 含 `本阶段不可用`、相邻 note 非空、`tabIndex === -1`（原生 disabled）
- [ ] **全流程网络断言**：`exportRequests == []`；无任何非 `GET`/`PATCH artifacts` 的写请求；无 artifact status 变为 `published`
- [ ] **全流程 toast 断言**：完成一次评审后，页面内**不存在** `role="status"`/`role="alert"` 的成功提示（回执 modal 是唯一反馈）
- [ ] Overlay：`Escape` 关闭、焦点归还触发元素、背景三处 `inert`、Tab 首尾环绕
- [ ] ≤760：overlay 是 bottom sheet（`border-radius: 20px 20px 0 0`）

---

## 17. 给主 agent 的开放问题（需拍板）

| # | 问题 | 推荐 |
|---|---|---|
| **O-1** | 质量检查分组：按我方 4 个 `kind` + 人工审核（`事实红线` / `结构与 SEO` / `GEO 可引用性` / `Brief 覆盖` / `人工审核`），还是硬套 artifact 的五项（研究证据 / SEO / GEO / 事实核验 / 人工审核，CON C-9 原文要求）？ | **按 kind 分组**。硬套会产生虚假映射（"研究证据"在我方只能对应 coverage claim）且需要一张 26 条前端映射表，必然与 `rule-types.ts` 漂移。采用 artifact 的**命名风格**而非**命名字面**，第 5 项 `人工审核` 保留原词。 |
| **O-2** | P1 `listContentShadowRuns`（完整 7 处税，47→48 operations，async 仍 9）批不批？ | **批**。不加则刷新页面后 research/QA/limitations 全丢，质量栏与诚实性表达无法渲染 —— Task 7 的核心价值只剩三分之一。 |
| **O-3** | P2 `ContentShadowQaClaim.severity`（4 处轻税，计数/DB/worker 零变化）批不批？ | **批**。不加则只能硬编码 3 条 blocking 白名单，advisory 与 review 同视觉，H-10 只能部分兑现。 |
| **O-4** | P3 `ContentShadowResearch.briefOutline`（4 处轻税）批不批？何时？ | **批，但放到 Task 8 落地时**。Task 7 一期用 coverage claim 的 detail 兜底即可。 |
| **O-5** | P5 先修 `QA_PENDING_LIMITATION` 常量（零契约税）？ | **修，且在 Task 7 开工前**。否则界面会在 26 条 QA 结果旁显示"QA 还没实现"。 |
| **O-6** | Publish 采用 CON C-14 的 (a) disabled 还是 (b) simulated？ | **(a) disabled**。我方没有 releases 表、没有 publish op；做 (b) 需要伪造本地 receipt 对象 —— 在**真产品**里造假回执，风险远高于收益（DATA G6 明确反对）。artifact 的"模拟"手法作为**方法论**吸收（限制写进标签），不作为**实现**照抄。 |
| **O-7** | 品牌轴（cobalt/Fraunces/Manrope vs GenGrowth 的 green+lime/Source Serif 4/IBM Plex Sans）何时裁决？连带 `growth-map.module.css:1-10` 的私有 `--gm-*`、以及 zh-CN 下无衬线标题的 serif hero 气质丢失。 | **本轮不动，作为独立"品牌轴对齐"任务**。Task 7/8 全部走 `var(--sf-*)` 语义层（裁决 γ），裁决后重绑 `:root` 即整屏跟随，Task 7/8 零改动。 |
| **O-8** | `ArtifactStatus.ready` 的客户可见文案定为 `已评审 · 未发布`（而非 studio 现有的 `就绪`）—— 需确认这不与其它屏（plan/report）的 `ready` 语义冲突。 | **改**。`就绪` 会被读成"可以上线了"，与 C-17（approval ≠ publication）冲突。若其它屏依赖 `studio.status.ready`，新增 `studio.artifactStatus.reviewedNotPublished` 独立 key，不改旧 key。 |
| **O-9** | 版本历史一期只有两点（当前版 + 本次 run 冻结版），是否可接受？ | **可接受**。P4 `listArtifactRevisions` 留 Slice 3。C-19/C-20 的核心表达（Revision 绑定 + 失效横幅 + 失效 badge）两点已足够承载。 |
| **O-10** | `.docBody` 正文 17px / 行高 1.74 / `max-width:780px` 是直接复用 artifact 值，但 app `--sf-text-*` 阶梯里没有 17px。是否新增 `--sf-text-read: 17px` token？ | **新增 token**。避免又一处硬编码 px（DRIFT X3 的 growth-map 就是这么烂掉的）。同时新增 `--sf-read-measure: 780px`。 |
