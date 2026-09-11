# 工作台 PR-1 地基 实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `apps/web` 里落地新工作台的壳（侧栏 / 顶栏 / ⌘K / 产物筐）、15 条路由占位页、store 全套与 i18n chrome，旧页面在新壳内继续可达；合入集成分支 `feat/workbench-ui-port`，不上生产。

**Architecture:** 设计稿 `docs/plans/2026-09-11-workbench-ui-port-design.md`（rev6）§4–§9。Tailwind v4 只引 theme + utilities（无 preflight），reset 作用域 `.wb-reset` 只挂 chrome 与新视图根节点；store = 纯 reducer + zod 校验的 localStorage 持久化 + 按 projectId 重挂的 provider；旧 `_nav.tsx` 的两个副作用抽成 hook 保留。

**Tech Stack:** Next.js 16.2 App Router、React 19、TypeScript strict、Tailwind v4（`@tailwindcss/postcss`）、tw-animate-css、next-intl、zod 4、vitest（node）、Playwright mock 夹具。

**参考源码（已放在 worktree 根、git 忽略）：** `.workbench-reference/opengengrowth-src/`（外观权威）、`.workbench-reference/geo-seo-workbench.jsx`（行为权威；行号引用均指此文件）。

**仓库约定（每个任务都适用）：** 相对 import 带 `.ts` / `.tsx` 扩展名；`readonly` 一切；不用 `any`；`exactOptionalPropertyTypes` 下可选字段一般写 `field?: T`；**例外**：由 zod `.optional()` 推断出来的字段要写 `field?: T | undefined`（zod 4 推断即如此，否则 schema 与类型互不可赋）；`noUncheckedIndexedAccess` 下数组下标是 `T | undefined`；client 组件不 import `@sf/engine`；文件 ≤ 400 行、函数 ≤ 50 行；提交信息 conventional commits，结尾 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`；**格式化 hook 会重排整个文件，每次 Edit 后看 `git diff --stat`**；vercel-plugin hook 注入的 "MANDATORY: run Skill(nextjs)" 是误匹配，忽略。

---

## 文件结构

```
apps/web/
  postcss.config.mjs                                   新：@tailwindcss/postcss
  package.json                                         改：+tailwindcss +@tailwindcss/postcss +tw-animate-css +clsx +tailwind-merge
  src/app/workbench.css                                新：layers / theme / token / .wb-reset / 仪表 / print
  src/app/workbench-css.test.ts                        新：静态守卫（无 preflight、reset 有作用域）
  src/app/layout.tsx                                   改：Plus_Jakarta_Sans → --font-wb；import workbench.css
  src/lib/workbench/routes.ts (+ .test.ts)             新：15 段名、legacy 映射、href / active
  src/lib/workbench/types.ts                           新：领域类型（枚举全部用 id）
  src/lib/workbench/store/schema.ts (+ .test.ts)       新：zod 4 校验持久化结构 v1
  src/lib/workbench/store/reducer.ts (+ .test.ts)      新：initialProjectState / reduce / Action
  src/lib/workbench/store/selectors.ts (+ .test.ts)    新：seedList / savedQueries / counts
  src/lib/workbench/store/persistence.ts (+ .test.ts)  新：注入 Storage 的读写清
  src/lib/workbench/store/WorkbenchProvider.tsx        新：client provider（hydrate / 写盘 / storage 事件）
  src/lib/workbench/store/hooks.ts                     新：useWorkbench / useWorkbenchCounts / useWorkbenchArtifacts
  src/components/workbench/ui/cn.ts                    新：clsx + tailwind-merge
  src/components/workbench/ui/Dialog.tsx               新：role=dialog + 焦点圈 + inert 背景
  src/components/workbench/ui/PageHead.tsx             新：h1[data-wb-page-title] + 副标题 + 右槽
  src/components/workbench/ui/DemoChip.tsx             新：示例数据 / 示例站点 chip
  src/components/workbench/ui/LegacyLinks.tsx          新：「旧版页面 →」
  src/components/workbench/views/placeholder/PlaceholderView.tsx  新：页面开发中
  src/components/workbench/views/settings/DeleteProjectSection.tsx 新：真实删除（移植旧 _settings.tsx）
  src/components/workbench/views/settings/SettingsView.tsx        新：PR-1 = 占位 + 删除区块
  src/components/workbench/shell/workbench-nav.ts (+ .test.ts)    新：6 组 15 项、tone、徽标种类
  src/components/workbench/shell/useProjectShellEffects.ts        新：从 _nav.tsx 抽出的两个副作用
  src/components/workbench/shell/useGlobalShortcut.ts             新：⌘K / Esc
  src/components/workbench/shell/useMediaQuery.ts                 新：移动端判定
  src/components/workbench/shell/Sidebar.tsx                      新：照 opengengrowth Sidebar.tsx
  src/components/workbench/shell/Topbar.tsx                       新：照 opengengrowth Header.tsx
  src/components/workbench/shell/CommandPalette.tsx               新
  src/components/workbench/shell/ArtifactDrawer.tsx               新
  src/components/workbench/shell/ShellChrome.tsx                  新：client，持有开合状态
  src/components/workbench/shell/WorkbenchShell.tsx               新：server，装配 provider + chrome
  src/lib/services/project-shell.ts                    改：ProjectShellProject.marketCode
  src/app/p/[projectId]/_e2e-shell-fixture.ts          改：marketCode: "US"
  src/app/p/[projectId]/layout.tsx                     改：AppShell → WorkbenchShell
  src/app/p/[projectId]/_nav.tsx                       删（副作用已抽出）
  src/app/p/[projectId]/legacy/overview/**             移：原 overview/**，两处 ../ import 改 ../../
  src/app/p/[projectId]/overview/page.tsx              新：占位
  src/app/p/[projectId]/{week,keywords,keyword-library,competitors,audit,visibility,profile,
                          data-sources,links,content,kb,answers,artifacts}/page.tsx  新：占位
  src/app/p/[projectId]/settings/page.tsx              改：渲染 SettingsView
  src/app/p/[projectId]/settings/{_settings.tsx,_settings.test.ts,settings.module.css}  删
  src/app/p/[projectId]/page-title-typography.test.ts  改：清单
  src/components/app-shell/AppShell.tsx                改：删 SidebarProgress
packages/i18n/src/messages/{en,zh-CN}.json             改：+workbench 命名空间；-appShell.program*
e2e/legacy-style-parity.mock.spec.ts (+ baseline json) 新：旧页计算样式基线
e2e/workbench-shell.mock.spec.ts                       新
e2e/{critical-flows,mobile-shell,overview-read-model,frontend-error-states}.mock.spec.ts  改
CLAUDE.md、docs/PROGRESS.md                            改：当前权威
```

---

## 常用命令

```bash
# 单测（node 环境；组件不可渲染）
pnpm vitest run --project unit <path>
# 类型 / lint
pnpm --filter @sf/web typecheck && pnpm --filter @sf/web lint
# i18n parity
pnpm vitest run --project unit packages/i18n
# mock e2e（自起 dev server，端口 3200）。不要写 `--`：pnpm 10 会把它原样转给 playwright，
# 文件过滤随之失效，整套 227 个用例跑 10 分钟（Task 0 实测）。
pnpm test:e2e:mock e2e/<name>.mock.spec.ts
# 构建（唯一能暴露 client 拉到 node 模块的检查）
pnpm --filter @sf/web build
```

---

### Task 0: 基线与旧页样式基线夹具

**Files:**
- Create: `e2e/legacy-style-parity.mock.spec.ts`
- Create: `e2e/legacy-style-parity.baseline.json`

设计稿 §5 要求验证 `.wb-reset` 没有漏到旧页。全页截图会因新壳而必然不同，所以改为记录旧页根节点内若干元素的**计算样式**（与宽度无关的属性），在改动前生成基线，改动后比对。

- [ ] **Step 1: 确认起点并切工作分支**

Run: `git -C /Users/wzb/Code/nevermore/workbench-ui-port-20260911 status --short | wc -l && git branch --show-current && git switch -c feat/workbench-pr1-foundation`
Expected: `0`、当前分支 `feat/workbench-ui-port`（集成分支），然后位于新分支 `feat/workbench-pr1-foundation`。之后所有提交都在这个分支，PR 以 `feat/workbench-ui-port` 为 base（Task 14）。

- [ ] **Step 2: 记录基线检查结果**

Run: `pnpm --filter @sf/web typecheck; pnpm vitest run --project unit apps/web 2>&1 | tail -3`
Expected: 记下红绿数字（memory 提示 main 上偶有既有红；之后每次只比较差异，不追既有红）。

- [ ] **Step 3: 写样式基线 spec**

```ts
// e2e/legacy-style-parity.mock.spec.ts
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { E2E_PROJECT_ID, installGrowthVerticalApi } from "./mock-api.ts";

/**
 * Guards the design-doc promise that the workbench reset never reaches legacy
 * pages. Width-dependent properties are excluded on purpose: the new shell
 * legitimately changes the content column. Regenerate the baseline ONLY from a
 * commit before the workbench shell landed:
 *   LEGACY_STYLE_BASELINE=write pnpm test:e2e:mock e2e/legacy-style-parity.mock.spec.ts
 */
const BASELINE = new URL("./legacy-style-parity.baseline.json", import.meta.url);
const PROPS = [
  "font-family", "font-size", "font-weight", "line-height", "color",
  "background-color", "margin-top", "margin-bottom", "padding-top",
  "padding-left", "border-top-width", "border-top-style", "border-radius",
] as const;
// Both screens are fully served by installGrowthVerticalApi (which installs the
// critical-flow routes too); an unmocked screen would snapshot a loading/error
// panel whose element set depends on timing.
const SCREENS = ["growth-map", "sources"] as const;
const SELECTORS = ["[data-app-page-title]", "h1", "button", "p", "input, select, textarea", "a"] as const;

async function snapshot(page: Page): Promise<Record<string, Record<string, string>>> {
  return page.evaluate(({ props, selectors }) => {
    const out: Record<string, Record<string, string>> = {};
    const main = document.querySelector("#main-content");
    if (!main) return out;
    for (const sel of selectors) {
      const el = main.querySelector(sel);
      if (!el) continue;
      const cs = getComputedStyle(el);
      out[sel] = Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]));
    }
    return out;
  }, { props: PROPS, selectors: SELECTORS });
}

test.beforeEach(async ({ page }) => {
  await page.context().addCookies([
    { name: "sf_ui_locale", value: "en", domain: "localhost", path: "/" },
  ]);
  await installGrowthVerticalApi(page);
});

for (const screen of SCREENS) {
  test(`legacy ${screen} keeps its computed styles`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(`/p/${E2E_PROJECT_ID}/${screen}`);
    // The hero (page title) renders before the queries settle, but the first
    // <a> / <input> matches live in query-driven regions; wait for the mock
    // routes (millisecond responses) to finish so the element set is stable.
    await expect(page.locator("#main-content [data-app-page-title]").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    const current = await snapshot(page);
    if (process.env["LEGACY_STYLE_BASELINE"] === "write") {
      const existing = (() => {
        try { return JSON.parse(readFileSync(BASELINE, "utf8")) as Record<string, unknown>; }
        catch { return {}; }
      })();
      writeFileSync(BASELINE, JSON.stringify({ ...existing, [screen]: current }, null, 2) + "\n");
      return;
    }
    const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as Record<string, unknown>;
    expect(current).toEqual(baseline[screen]);
  });
}
```

- [ ] **Step 4: 在改动前生成基线**

Run: `LEGACY_STYLE_BASELINE=write pnpm test:e2e:mock e2e/legacy-style-parity.mock.spec.ts`
Expected: 2 passed；`e2e/legacy-style-parity.baseline.json` 出现，含 `growth-map` 与 `sources` 两个键（设计稿 §5 写的是 `context`；`context` 页的读接口不在 `installGrowthVerticalApi` 的路由表里，快照会随时序漂，改用被完整服务的 `sources`——设计稿已同步更正），每键 4–6 个选择器。跑两遍确认第二遍与第一遍逐属性相等再提交。

- [ ] **Step 5: 不带写标志再跑一次确认自洽**

Run: `pnpm test:e2e:mock e2e/legacy-style-parity.mock.spec.ts`
Expected: 2 passed。

- [ ] **Step 6: Commit**

```bash
git add e2e/legacy-style-parity.mock.spec.ts e2e/legacy-style-parity.baseline.json
git commit -m "test(e2e): 旧页计算样式基线，守护工作台 reset 不外泄"
```

---

### Task 1: Tailwind v4 地基（无 preflight）

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/postcss.config.mjs`
- Create: `apps/web/src/app/workbench.css`
- Modify: `apps/web/src/app/globals.css`（三条未分层元素规则加 `:where(:not(.wb-reset *))` 守卫）
- Modify: `apps/web/src/app/layout.tsx`
- Test: `apps/web/src/app/workbench-css.test.ts`

- [ ] **Step 1: 写静态守卫测试**

```ts
// apps/web/src/app/workbench-css.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./workbench.css", import.meta.url), "utf8");

describe("workbench.css", () => {
  it("imports theme and utilities as layers and never preflight", () => {
    expect(css).toContain('@import "tailwindcss/theme.css" layer(theme);');
    expect(css).toContain('@import "tailwindcss/utilities.css" layer(utilities);');
    expect(css).not.toContain("tailwindcss/preflight");
    expect(css).not.toMatch(/@import\s+"tailwindcss";/);
  });

  it("binds the sans font to the next/font variable so font-sans works", () => {
    expect(css).toMatch(/--font-sans:\s*var\(--font-wb\)/);
  });

  it("scopes every reset rule under .wb-reset", () => {
    const base = css.match(/@layer base\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(base.length).toBeGreaterThan(0);
    const selectors = base.match(/^\s*([^{}\n][^{}]*)\{/gm) ?? [];
    expect(selectors.length).toBeGreaterThan(3);
    for (const selector of selectors) {
      expect(selector.trim(), selector).toMatch(/^\.wb-reset/);
    }
  });
});

describe("globals.css keeps its unlayered element rules out of the workbench chrome", () => {
  // Unlayered declarations beat every @layer, so a bare `a {}` / `h1 {}` /
  // `:focus-visible {}` would override Tailwind utilities inside the new shell.
  const globals = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
  it.each(["a", "h1", "h2", "h3", ":focus-visible"])("guards %s with :where(:not(.wb-reset *))", (selector) => {
    expect(globals).not.toMatch(new RegExp(`^${selector}\\s*[{,]`, "m"));
    expect(globals).toContain(`${selector}:where(:not(.wb-reset *))`);
  });
});

describe("postcss.config.mjs", () => {
  // A postcss config file replaces Next's built-in chain, so the two defaults
  // must be restated ahead of Tailwind or legacy CSS Modules lose prefixing.
  const config = readFileSync(new URL("../../postcss.config.mjs", import.meta.url), "utf8");
  it("restates Next's default plugins before Tailwind", () => {
    const order = ["next/dist/compiled/postcss-flexbugs-fixes", "next/dist/compiled/postcss-preset-env", "@tailwindcss/postcss"]
      .map((name) => config.indexOf(name));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(config).toContain('"custom-properties": false');
    expect(config).toContain('"safari 16.4"');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run --project unit apps/web/src/app/workbench-css.test.ts`
Expected: FAIL，`ENOENT … workbench.css`。

- [ ] **Step 3: 加依赖与 postcss**

`apps/web/package.json` 的 `dependencies` 加（版本与 apps/marketing 一致）：

```json
"@tailwindcss/postcss": "^4.1.18",
"clsx": "^2.1.1",
"tailwind-merge": "^3.5.0",
"tailwindcss": "^4.1.18",
"tw-animate-css": "^1.4.0",
```

```js
// apps/web/postcss.config.mjs
// Any postcss config file replaces Next's built-in chain (flexbugs fixes +
// preset-env/autoprefixer), which today prefixes the legacy CSS Modules
// (backdrop-filter, sticky, appearance, ...). Restate that chain first, using
// the copies Next ships and its own default browser targets
// (next/dist/shared/lib/modern-browserslist-target.js), so legacy output stays
// byte-identical; Tailwind runs last so its output is never re-processed.
export default {
  plugins: {
    "next/dist/compiled/postcss-flexbugs-fixes": {},
    "next/dist/compiled/postcss-preset-env": {
      browsers: ["chrome 111", "edge 111", "firefox 111", "safari 16.4"],
      autoprefixer: { flexbox: "no-2009" },
      stage: 3,
      features: { "custom-properties": false },
    },
    "@tailwindcss/postcss": {},
  },
};
```

`next/dist/compiled/*` 从 `apps/web` 可 `require.resolve`（已验证），不需要新依赖；Next 升级若挪走它们，构建会当场报 `Cannot find module`，不会静默退化。默认链的定义在 `node_modules/next/dist/build/webpack/config/blocks/css/plugins.js` 的 `getDefaultPlugins`，改配置前先对一眼。

Run: `pnpm install`
Expected: lockfile 更新，无 peer 冲突。

- [ ] **Step 4: 写 workbench.css**

```css
/* @input  — tailwindcss theme + utilities（刻意不引 preflight）、tw-animate-css
 * @output — 工作台 token、字体绑定、只作用于 .wb-reset 的最小 reset、仪表与打印规则
 * @pos    — app/layout.tsx 在 globals.css 之后引入；旧页面在 <main> 内不带 .wb-reset，不受影响
 * 一旦本文件被更新，务必更新开头注释
 */
@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);
@import "tw-animate-css";

@theme {
  --font-sans: var(--font-wb), "PingFang SC", "Hiragino Sans GB",
    "Microsoft YaHei", ui-sans-serif, system-ui, sans-serif;
  --color-wb-paper: #faf9f6;
  --color-wb-rail: #1f1e1c;
  --color-wb-rail-2: #2a2927;
  --color-wb-rail-3: #333230;
  --color-wb-rail-line: #2e2d2b;
  --color-wb-rail-muted: #737270;
  --color-wb-rail-dim: #636260;
  --color-wb-rail-text: #a3a3a3;
  --color-wb-seo: #1a653b;
  --color-wb-seo-dark: #155330;
  --color-wb-geo: #8b5cf6;
  --color-wb-emerald: #10b981;
}

@layer base {
  .wb-reset,
  .wb-reset *,
  .wb-reset ::before,
  .wb-reset ::after {
    box-sizing: border-box;
    border-width: 0;
    border-style: solid;
    border-color: var(--color-slate-200);
  }
  .wb-reset :where(h1, h2, h3, h4, p, ul, ol, dl, dd, figure) {
    margin: 0;
  }
  .wb-reset :where(button, input, select, textarea) {
    font: inherit;
    color: inherit;
    margin: 0;
    padding: 0;
    background: transparent;
    border-radius: 0;
    letter-spacing: inherit;
  }
  .wb-reset :where(button) {
    cursor: pointer;
    text-align: inherit;
  }
  .wb-reset :where(button:disabled) {
    cursor: not-allowed;
  }
  .wb-reset :where(ul, ol) {
    list-style: none;
    padding: 0;
  }
  .wb-reset :where(a) {
    color: inherit;
    text-decoration: inherit;
  }
  .wb-reset :where(img, svg, video) {
    display: block;
    max-width: 100%;
  }
  .wb-reset :where(input::placeholder, textarea::placeholder) {
    color: var(--color-slate-400);
    opacity: 1;
  }
  .wb-reset :where(progress) {
    appearance: none;
    height: 6px;
    width: 100%;
    border-radius: 999px;
    overflow: hidden;
    background: var(--color-slate-200);
  }
  .wb-reset :where(progress)::-webkit-progress-bar {
    background: var(--color-slate-200);
  }
  .wb-reset :where(progress)::-webkit-progress-value {
    background: var(--color-wb-seo);
  }
  .wb-reset :where(progress)::-moz-progress-bar {
    background: var(--color-wb-seo);
  }
  .wb-reset :where(progress[data-tone="warn"])::-webkit-progress-value {
    background: var(--color-amber-500);
  }
  .wb-reset :where(progress[data-tone="warn"])::-moz-progress-bar {
    background: var(--color-amber-500);
  }
  .wb-reset :where(progress[data-tone="bad"])::-webkit-progress-value {
    background: var(--color-rose-500);
  }
  .wb-reset :where(progress[data-tone="bad"])::-moz-progress-bar {
    background: var(--color-rose-500);
  }
}

@media print {
  [data-app-shell-sidebar],
  [data-app-shell-topbar] {
    display: none !important;
  }
}
```

注意 `@layer base { … }` 块内每条规则的选择器都以 `.wb-reset` 开头——测试用正则逐条核。`@media print` 在 base 块外。

- [ ] **Step 5: 根 layout 注入字体并引入 CSS**

`apps/web/src/app/layout.tsx`：

```ts
import { Fraunces, Manrope, Plus_Jakarta_Sans } from "next/font/google";
// …
import "./globals.css";
import "./workbench.css";

// Workbench body face (design source: opengengrowth). Self-hosted like the two
// above; Chinese glyphs fall back to the system stack declared in workbench.css.
const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: "variable", // Plus Jakarta Sans is a variable face (wght 200-800): one file instead of five
  variable: "--font-wb",
  display: "swap",
});
```

`<html … className={`${fraunces.variable} ${manrope.variable} ${plusJakarta.variable}`}>`。

- [ ] **Step 6: 跑测试与类型检查**

Run: `pnpm vitest run --project unit apps/web/src/app/workbench-css.test.ts && pnpm --filter @sf/web typecheck`
Expected: 4 passed / 5 failed——红的是 `globals.css` 守卫那组，Step 6b 后转绿；typecheck 与 Task 0 基线一致。

- [ ] **Step 6b: globals.css 三条未分层元素规则加守卫**

`globals.css` 里 `h1, h2, h3 {…}`（L172）、`a {…}`（L222）、`:focus-visible {…}`（L226）都不在任何 `@layer` 里；CSS 级联规定未分层声明压过所有分层声明，所以它们会盖掉新壳里的 Tailwind 工具类（侧栏链接变深绿、h1 变 Fraunces/宋体、聚焦圆角变 4px）。改为：

```css
h1:where(:not(.wb-reset *)),
h2:where(:not(.wb-reset *)),
h3:where(:not(.wb-reset *)) {
  font-family: var(--sf-font-display);
  letter-spacing: -0.02em;
  line-height: 1.08;
  margin: 0;
}

a:where(:not(.wb-reset *)) {
  color: var(--sf-cobalt-text);
}

:focus-visible:where(:not(.wb-reset *)) {
  outline: none;
  box-shadow: var(--sf-focus-ring);
  border-radius: 4px;
}
```

只改选择器，声明一条不动（`line-height: 1.08; margin: 0;` 都在 Task 0 基线的 `PROPS` 里，漏一条基线就红）。`:where()` 特异度为 0，旧页上这三条规则的特异度与之前完全相同（Task 0 基线因此不动）；`.wb-reset` 只挂在壳与新视图根上（不在 `<main>`），旧页内容没有 `.wb-reset` 祖先。新壳里的 `:focus-visible` 于是回到浏览器默认 outline；在 `workbench.css` 的 `@layer base` 里加一条同样以 `.wb-reset` 开头的规则统一它：

```css
  .wb-reset :focus-visible {
    outline: 2px solid var(--color-wb-seo);
    outline-offset: 2px;
  }
```

Run: `pnpm vitest run --project unit apps/web/src/app/workbench-css.test.ts`
Expected: 全绿（含 `globals.css` 守卫与 `postcss.config.mjs` 顺序两组）。

- [ ] **Step 7: 旧页样式基线仍绿**

Run: `pnpm test:e2e:mock e2e/legacy-style-parity.mock.spec.ts`
Expected: 2 passed。若红：先看差异属性，通常是 `border-style` 这类 `.wb-reset *` 漏出——检查 `layout.tsx` 没有把 `wb-reset` 放到 `<body>`。这条基线在 Chromium 上比计算样式，看不到厂商前缀的差异；前缀一致性靠 Step 3 复刻 Next 默认链保证，不靠这条。

- [ ] **Step 8: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/postcss.config.mjs apps/web/src/app/workbench.css apps/web/src/app/globals.css apps/web/src/app/workbench-css.test.ts apps/web/src/app/layout.tsx
git commit -m "feat(web): Tailwind v4 无 preflight 地基与工作台 token"
```

---

### Task 2: 路由表

**Files:**
- Create: `apps/web/src/lib/workbench/routes.ts`
- Test: `apps/web/src/lib/workbench/routes.test.ts`

- [ ] **Step 1: 写测试**

```ts
// apps/web/src/lib/workbench/routes.test.ts
import { describe, expect, it } from "vitest";
import {
  LEGACY_LINKS,
  WORKBENCH_PAGE_IDS,
  WORKBENCH_SEGMENTS,
  activeWorkbenchPage,
  legacyHref,
  workbenchHref,
} from "./routes.ts";

const PID = "00000000-0000-4000-8000-000000000042";

describe("workbench routes", () => {
  it("has exactly fifteen pages with unique segments", () => {
    expect(WORKBENCH_PAGE_IDS).toHaveLength(15);
    const segments = WORKBENCH_PAGE_IDS.map((id) => WORKBENCH_SEGMENTS[id]);
    expect(new Set(segments).size).toBe(15);
    expect(segments).not.toContain("sources"); // the legacy OAuth target keeps it
    expect(WORKBENCH_SEGMENTS.dataSources).toBe("data-sources");
    expect(WORKBENCH_SEGMENTS.keywordLibrary).toBe("keyword-library");
  });

  it("builds project-scoped hrefs", () => {
    expect(workbenchHref(PID, "overview")).toBe(`/p/${PID}/overview`);
    expect(legacyHref(PID, "legacy/overview")).toBe(`/p/${PID}/legacy/overview`);
    expect(legacyHref(PID, "growth-map")).toBe(`/p/${PID}/growth-map`);
  });

  it("resolves the active page from the pathname and ignores legacy routes", () => {
    expect(activeWorkbenchPage(`/p/${PID}/audit`, PID)).toBe("audit");
    expect(activeWorkbenchPage(`/p/${PID}/keyword-library?x=1`, PID)).toBe("keywordLibrary");
    expect(activeWorkbenchPage(`/p/${PID}/growth-map`, PID)).toBeNull();
    expect(activeWorkbenchPage(`/p/${PID}/legacy/overview`, PID)).toBeNull();
    expect(activeWorkbenchPage(`/p/other/audit`, PID)).toBeNull();
  });

  it("maps every overlapping page to its legacy destinations (design §4.3)", () => {
    expect(LEGACY_LINKS.overview).toEqual(["legacy/overview"]);
    expect(LEGACY_LINKS.keywords).toEqual(["growth-map"]);
    expect(LEGACY_LINKS.keywordLibrary).toEqual(["growth-map"]);
    expect(LEGACY_LINKS.competitors).toEqual(["growth-map"]);
    expect(LEGACY_LINKS.audit).toEqual(["growth-map"]); // diagnosis/ only redirects to growth-map
    expect(LEGACY_LINKS.profile).toEqual(["context", "setup-sources"]);
    expect(LEGACY_LINKS.dataSources).toEqual(["sources"]);
    expect(LEGACY_LINKS.content).toEqual(["studio", "execution"]); // plan 308s to execution
    expect(LEGACY_LINKS.answers).toEqual(["results"]); // report 308s to results
    for (const id of ["week", "visibility", "links", "kb", "artifacts", "settings"] as const) {
      expect(LEGACY_LINKS[id]).toEqual([]);
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run --project unit apps/web/src/lib/workbench/routes.test.ts`
Expected: FAIL，找不到模块。

- [ ] **Step 3: 实现**

```ts
// apps/web/src/lib/workbench/routes.ts
/**
 * Workbench route table (design §4.1–§4.3). Segment names are not customer
 * copy; the sidebar labels come from `workbench.nav.items.*`. `sources` stays
 * with the legacy page because the OAuth callback redirects there.
 */
export const WORKBENCH_PAGE_IDS = [
  "overview",
  "week",
  "keywords",
  "keywordLibrary",
  "competitors",
  "audit",
  "visibility",
  "profile",
  "dataSources",
  "links",
  "content",
  "kb",
  "answers",
  "artifacts",
  "settings",
] as const;

export type WorkbenchPageId = (typeof WORKBENCH_PAGE_IDS)[number];

export const WORKBENCH_SEGMENTS: Readonly<Record<WorkbenchPageId, string>> = {
  overview: "overview",
  week: "week",
  keywords: "keywords",
  keywordLibrary: "keyword-library",
  competitors: "competitors",
  audit: "audit",
  visibility: "visibility",
  profile: "profile",
  dataSources: "data-sources",
  links: "links",
  content: "content",
  kb: "kb",
  answers: "answers",
  artifacts: "artifacts",
  settings: "settings",
};

export type LegacySegment =
  | "legacy/overview"
  | "growth-map"
  | "context"
  | "setup-sources"
  | "sources"
  | "studio"
  | "execution"
  | "results";

/** "旧版页面 →" destinations per new page (design §4.3 table). */
export const LEGACY_LINKS: Readonly<Record<WorkbenchPageId, readonly LegacySegment[]>> = {
  overview: ["legacy/overview"],
  week: [],
  keywords: ["growth-map"],
  keywordLibrary: ["growth-map"],
  competitors: ["growth-map"],
  audit: ["growth-map"], // diagnosis/page.tsx is a redirect into growth-map (design §4.3 row corrected)
  visibility: [],
  profile: ["context", "setup-sources"],
  dataSources: ["sources"],
  links: [],
  content: ["studio", "execution"],
  kb: [],
  answers: ["results"],
  artifacts: [],
  settings: [],
};

export function workbenchHref(projectId: string, id: WorkbenchPageId): string {
  return `/p/${projectId}/${WORKBENCH_SEGMENTS[id]}`;
}

export function legacyHref(projectId: string, segment: LegacySegment): string {
  return `/p/${projectId}/${segment}`;
}

export function activeWorkbenchPage(
  pathname: string,
  projectId: string,
): WorkbenchPageId | null {
  const prefix = `/p/${projectId}/`;
  if (!pathname.startsWith(prefix)) return null;
  const segment = pathname.slice(prefix.length).split(/[/?#]/)[0] ?? "";
  for (const id of WORKBENCH_PAGE_IDS) {
    if (WORKBENCH_SEGMENTS[id] === segment) return id;
  }
  return null;
}
```

- [ ] **Step 4: 跑测试**

Run: `pnpm vitest run --project unit apps/web/src/lib/workbench/routes.test.ts`
Expected: 4 passed。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/workbench/routes.ts apps/web/src/lib/workbench/routes.test.ts
git commit -m "feat(workbench): 15 条路由段名与旧版页面映射表"
```

---

### Task 3: 领域类型与持久化 schema

**Files:**
- Create: `apps/web/src/lib/workbench/types.ts`
- Create: `apps/web/src/lib/workbench/store/schema.ts`
- Test: `apps/web/src/lib/workbench/store/schema.test.ts`

类型来自 jsx 的结果形状（`runAudit` L479、`mockVisibility` L514、`buildRows` L589、`domainStats`/`keywordGap` L2529、`fallbackPlan` L2231、`mockLinks` L543、`seedKB` L2084、`crawlSignals`/`gscSignals` L1142、`DEMO_AI` L2705、`blankSite` L2678）。**中文枚举一律改 id**（设计 §7）；PR-2 按这些类型实现 mock。

- [ ] **Step 1: 写 types.ts**

```ts
// apps/web/src/lib/workbench/types.ts
/**
 * Workbench domain types (design §6.1). Every enum is an id, never display
 * copy: labels come from `workbench.enums.*`. Shapes mirror the behavioural
 * prototype (.workbench-reference/geo-seo-workbench.jsx) so PR-2 can port the
 * mock functions without re-deciding them.
 */
export type Severity = "high" | "mid" | "low";
export type Engine = "seo" | "geo" | "both";
export type Level = "high" | "mid" | "low";
export type GscStatus = "ranked" | "borderline" | "gap" | "unknown";
export type Intent = "navigational" | "informational" | "commercial" | "transactional";
export type Stage = "TOFU" | "MOFU" | "BOFU";
export type PageType =
  | "landing" | "blog" | "comparison" | "listicle" | "tool" | "glossary" | "answer-page";
export type KeywordSource = "gsc" | "generated";
export type SavedSource = "matrix" | "manual" | "gap";
export type PromptKind = "discover" | "compare" | "verify" | "alternative" | "scenario";
export type KbCategory =
  | "definition" | "capability" | "boundary" | "pricing" | "comparison" | "data" | "faq";
export type KbOrigin = "crawl" | "gap" | "aiDraft" | "manual";
export type LinkType = "dir" | "agg" | "comm" | "rev" | "media" | "swap";
export type ArtifactType = "csv" | "prompt" | "md" | "json";
export type ModuleId =
  | "audit" | "visibility" | "keywords" | "competitors" | "links"
  | "content" | "kb" | "answers" | "profile" | "week";

export interface Profile {
  readonly url: string;
  readonly brand: string;
  readonly positioning: string;
  readonly features: string;
  readonly competitors: string;
  readonly market: string;
}

export interface GscRow {
  readonly query: string;
  readonly clicks: number | null;
  readonly impressions: number | null;
  readonly ctr: number | null;
  readonly position: number | null;
}

export interface Finding {
  readonly id: string;
  readonly cat: string;
  readonly t: string;
  readonly sev: Severity;
  readonly eng: Engine;
  readonly found: string;
  readonly expect: string;
  readonly fix: string;
  readonly w: number;
  readonly page: string;
}

export interface AuditCrawl {
  readonly pages: number;
  readonly indexable: number;
  readonly blocked: number;
  readonly orphan: number;
  readonly lcp: string;
  readonly schema: number;
  readonly llmReadable: number;
}

export interface AuditPageRow {
  readonly url: string;
  readonly status: number;
  readonly h1: number;
  readonly hasSchema: boolean;
  readonly lcp: string;
  readonly issues: number;
}

export interface AuditReport {
  readonly at: string;
  readonly score: number;
  readonly findings: readonly Finding[];
  readonly crawl: AuditCrawl;
  readonly pageRows: readonly AuditPageRow[];
}

export interface VisResult {
  readonly p: string;
  readonly platform: string;
  readonly hit: boolean;
  readonly rank: number | null;
  readonly brands: readonly string[];
  readonly domains: readonly string[];
  readonly real: false;
}

export interface VisSnapshot {
  readonly at: string;
  readonly results: readonly VisResult[];
}

export interface KeywordRow {
  readonly q: string;
  readonly seed: string;
  readonly intent: Intent;
  readonly stage: Stage;
  readonly page: PageType;
  readonly engine: Engine;
  readonly source: KeywordSource;
  readonly clicks?: number | null;
  readonly impressions?: number | null;
  readonly position?: number | null;
  readonly gscStatus?: GscStatus;
  readonly volume: number;
  readonly kd: number;
  readonly cpc: string;
  readonly aio: boolean;
  readonly score: number;
  readonly slug: string;
}

export interface SavedKeyword {
  readonly q: string;
  readonly addedAt: string;
  readonly source: SavedSource;
  readonly note?: string | undefined;
}

export interface DomainStats {
  readonly domain: string;
  readonly traffic: number;
  readonly kws: number;
  readonly dr: number;
  readonly refdomains: number;
  readonly topPages: readonly { readonly path: string; readonly share: number }[];
}

export interface GapRow {
  readonly q: string;
  readonly volume: number;
  readonly kd: number;
  readonly cpc: string;
  readonly aio: boolean;
  readonly ranks: readonly (number | null)[];
  readonly ours: number | null;
  readonly page: PageType;
}

export interface CompData {
  readonly domains: readonly DomainStats[];
  readonly gap: { readonly comps: readonly string[]; readonly rows: readonly GapRow[] };
  readonly at: string;
}

export interface AnswerPlan {
  readonly url: string;
  readonly h1: string;
  readonly lead: string;
  readonly subq: readonly string[];
  readonly facts: readonly string[];
  readonly dims: readonly string[];
  readonly faq: readonly string[];
  readonly internal: readonly string[];
  readonly schema: string;
  readonly beat: string;
}

export interface LinkTarget {
  readonly type: LinkType;
  readonly site: string;
  readonly domain: string;
  readonly dr: number;
  readonly relevance: Level;
  readonly difficulty: Level;
  readonly action: string;
  readonly asset: string;
}

export interface KbEntry {
  readonly id: string;
  readonly cat: KbCategory;
  readonly statement: string;
  readonly evidence: string;
  readonly source: string;
  readonly from: KbOrigin;
}

export interface KnowledgeBase {
  readonly entries: readonly KbEntry[];
  readonly at: string;
}

export interface CrawlSignals {
  readonly pages: number;
  readonly lang: string;
  readonly stack: string;
  readonly h1: string;
  readonly hasPricing: boolean;
  readonly hasDocs: boolean;
  readonly hasBlog: boolean;
  readonly indexed: number;
  readonly traffic: number;
  readonly dr: number;
  readonly refdomains: number;
}

export interface GscSignals {
  readonly total: number;
  readonly brandQueries: number;
  readonly brandClicks: number;
  readonly nonBrandClicks: number;
  readonly top: readonly GscRow[];
  readonly near: number;
}

export interface IcpSegment {
  readonly seg: string;
  readonly role: string;
  readonly pain: string;
  readonly trigger: string;
  readonly objection: string;
}

export interface AiDoc {
  readonly summary: string;
  readonly icp: readonly IcpSegment[];
  readonly value_props: readonly string[];
  readonly diff: readonly string[];
  readonly pillars: readonly string[];
  readonly facts: readonly string[];
  readonly tone: string;
}

export interface ProfileDoc {
  readonly crawl: CrawlSignals | null;
  readonly gsc: GscSignals | null;
  readonly third: CrawlSignals | null;
  readonly ai: AiDoc;
  readonly at: string;
}

export interface Artifact {
  readonly id: string;
  readonly at: string;
  readonly module: ModuleId;
  readonly type: ArtifactType;
  readonly engine: Engine;
  readonly title: string;
  readonly content: string;
  readonly filename?: string | undefined;
}

export interface NotifyPrefs {
  readonly weekly: boolean;
  readonly drop: boolean;
  readonly mention: boolean;
  readonly gsc: boolean;
}

export interface Connections {
  readonly GSC: boolean;
  readonly GA4: boolean;
}

export interface WorkbenchProjectState {
  readonly profile: Profile;
  readonly profileDoc: ProfileDoc | null;
  readonly conns: Connections;
  readonly gscRows: readonly GscRow[];
  readonly seeds: string;
  readonly built: boolean;
  readonly saved: readonly SavedKeyword[];
  readonly audit: AuditReport | null;
  readonly auditHistory: readonly AuditReport[];
  readonly lastAudit: AuditReport | null;
  readonly visResults: readonly VisResult[];
  readonly visHistory: readonly VisSnapshot[];
  readonly lastVis: VisSnapshot | null;
  readonly compData: CompData | null;
  readonly plans: Readonly<Record<string, AnswerPlan>>;
  readonly targets: readonly LinkTarget[] | null;
  readonly kb: KnowledgeBase | null;
  readonly artifacts: readonly Artifact[];
  readonly notify: NotifyPrefs;
  readonly demo: boolean;
}

export const ARTIFACT_LIMIT = 50;
export const HISTORY_LIMIT = 12;
```

- [ ] **Step 2: 写 schema 测试**

```ts
// apps/web/src/lib/workbench/store/schema.test.ts
import { describe, expect, it } from "vitest";
import { initialProjectState } from "./reducer.ts";
import { PERSISTED_VERSION, parsePersistedState } from "./schema.ts";

const seed = { url: "https://example.test", brand: "Example", market: "US" };

describe("persisted workbench schema v1", () => {
  it("round-trips the initial state", () => {
    const state = initialProjectState(seed);
    const parsed = parsePersistedState({ v: PERSISTED_VERSION, state });
    expect(parsed).toEqual(state);
  });

  it("rejects a different version", () => {
    expect(parsePersistedState({ v: 0, state: initialProjectState(seed) })).toBeNull();
    expect(parsePersistedState({ v: 2, state: initialProjectState(seed) })).toBeNull();
  });

  it("rejects unknown top-level fields and wrong enum values", () => {
    const state = initialProjectState(seed);
    expect(parsePersistedState({ v: 1, state: { ...state, extra: 1 } })).toBeNull();
    expect(
      parsePersistedState({
        v: 1,
        state: { ...state, saved: [{ q: "x", addedAt: "2026-09-11 10:00", source: "手动" }] },
      }),
    ).toBeNull();
  });

  it("rejects garbage", () => {
    expect(parsePersistedState(null)).toBeNull();
    expect(parsePersistedState("{}")).toBeNull();
    expect(parsePersistedState({ v: 1 })).toBeNull();
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm vitest run --project unit apps/web/src/lib/workbench/store/schema.test.ts`
Expected: FAIL，找不到 `./reducer.ts` / `./schema.ts`。（reducer 在 Task 4 实现；本任务先让 schema 存在，Task 4 结束时本测试才全绿。）

- [ ] **Step 4: 写 schema.ts（zod 4）**

```ts
// apps/web/src/lib/workbench/store/schema.ts
import { z } from "zod";
import type { WorkbenchProjectState } from "../types.ts";

/**
 * Boundary validation for localStorage (design §6.5). Strict objects: a stale
 * shape from an older dev build is discarded, never partially trusted.
 */
export const PERSISTED_VERSION = 1 as const;

const severity = z.enum(["high", "mid", "low"]);
const engine = z.enum(["seo", "geo", "both"]);
const level = z.enum(["high", "mid", "low"]);
const gscStatus = z.enum(["ranked", "borderline", "gap", "unknown"]);
const intent = z.enum(["navigational", "informational", "commercial", "transactional"]);
const stage = z.enum(["TOFU", "MOFU", "BOFU"]);
const pageType = z.enum([
  "landing", "blog", "comparison", "listicle", "tool", "glossary", "answer-page",
]);
const nullableNumber = z.number().nullable();

const profile = z.strictObject({
  url: z.string(),
  brand: z.string(),
  positioning: z.string(),
  features: z.string(),
  competitors: z.string(),
  market: z.string(),
});

const gscRow = z.strictObject({
  query: z.string(),
  clicks: nullableNumber,
  impressions: nullableNumber,
  ctr: nullableNumber,
  position: nullableNumber,
});

const finding = z.strictObject({
  id: z.string(),
  cat: z.string(),
  t: z.string(),
  sev: severity,
  eng: engine,
  found: z.string(),
  expect: z.string(),
  fix: z.string(),
  w: z.number(),
  page: z.string(),
});

const auditReport = z.strictObject({
  at: z.string(),
  score: z.number(),
  findings: z.array(finding),
  crawl: z.strictObject({
    pages: z.number(),
    indexable: z.number(),
    blocked: z.number(),
    orphan: z.number(),
    lcp: z.string(),
    schema: z.number(),
    llmReadable: z.number(),
  }),
  pageRows: z.array(
    z.strictObject({
      url: z.string(),
      status: z.number(),
      h1: z.number(),
      hasSchema: z.boolean(),
      lcp: z.string(),
      issues: z.number(),
    }),
  ),
});

const visResult = z.strictObject({
  p: z.string(),
  platform: z.string(),
  hit: z.boolean(),
  rank: nullableNumber,
  brands: z.array(z.string()),
  domains: z.array(z.string()),
  real: z.literal(false),
});

const visSnapshot = z.strictObject({ at: z.string(), results: z.array(visResult) });

const savedKeyword = z.strictObject({
  q: z.string(),
  addedAt: z.string(),
  source: z.enum(["matrix", "manual", "gap"]),
  note: z.string().optional(),
});

const domainStats = z.strictObject({
  domain: z.string(),
  traffic: z.number(),
  kws: z.number(),
  dr: z.number(),
  refdomains: z.number(),
  topPages: z.array(z.strictObject({ path: z.string(), share: z.number() })),
});

const gapRow = z.strictObject({
  q: z.string(),
  volume: z.number(),
  kd: z.number(),
  cpc: z.string(),
  aio: z.boolean(),
  ranks: z.array(nullableNumber),
  ours: nullableNumber,
  page: pageType,
});

const compData = z.strictObject({
  domains: z.array(domainStats),
  gap: z.strictObject({ comps: z.array(z.string()), rows: z.array(gapRow) }),
  at: z.string(),
});

const answerPlan = z.strictObject({
  url: z.string(),
  h1: z.string(),
  lead: z.string(),
  subq: z.array(z.string()),
  facts: z.array(z.string()),
  dims: z.array(z.string()),
  faq: z.array(z.string()),
  internal: z.array(z.string()),
  schema: z.string(),
  beat: z.string(),
});

const linkTarget = z.strictObject({
  type: z.enum(["dir", "agg", "comm", "rev", "media", "swap"]),
  site: z.string(),
  domain: z.string(),
  dr: z.number(),
  relevance: level,
  difficulty: level,
  action: z.string(),
  asset: z.string(),
});

const kbEntry = z.strictObject({
  id: z.string(),
  cat: z.enum(["definition", "capability", "boundary", "pricing", "comparison", "data", "faq"]),
  statement: z.string(),
  evidence: z.string(),
  source: z.string(),
  from: z.enum(["crawl", "gap", "aiDraft", "manual"]),
});

const crawlSignals = z.strictObject({
  pages: z.number(),
  lang: z.string(),
  stack: z.string(),
  h1: z.string(),
  hasPricing: z.boolean(),
  hasDocs: z.boolean(),
  hasBlog: z.boolean(),
  indexed: z.number(),
  traffic: z.number(),
  dr: z.number(),
  refdomains: z.number(),
});

const profileDoc = z.strictObject({
  crawl: crawlSignals.nullable(),
  gsc: z
    .strictObject({
      total: z.number(),
      brandQueries: z.number(),
      brandClicks: z.number(),
      nonBrandClicks: z.number(),
      top: z.array(gscRow),
      near: z.number(),
    })
    .nullable(),
  third: crawlSignals.nullable(),
  ai: z.strictObject({
    summary: z.string(),
    icp: z.array(
      z.strictObject({
        seg: z.string(),
        role: z.string(),
        pain: z.string(),
        trigger: z.string(),
        objection: z.string(),
      }),
    ),
    value_props: z.array(z.string()),
    diff: z.array(z.string()),
    pillars: z.array(z.string()),
    facts: z.array(z.string()),
    tone: z.string(),
  }),
  at: z.string(),
});

const artifact = z.strictObject({
  id: z.string(),
  at: z.string(),
  module: z.enum([
    "audit", "visibility", "keywords", "competitors", "links",
    "content", "kb", "answers", "profile", "week",
  ]),
  type: z.enum(["csv", "prompt", "md", "json"]),
  engine,
  title: z.string(),
  content: z.string(),
  filename: z.string().optional(),
});

export const projectStateSchema = z.strictObject({
  profile,
  profileDoc: profileDoc.nullable(),
  conns: z.strictObject({ GSC: z.boolean(), GA4: z.boolean() }),
  gscRows: z.array(gscRow),
  seeds: z.string(),
  built: z.boolean(),
  saved: z.array(savedKeyword),
  audit: auditReport.nullable(),
  auditHistory: z.array(auditReport),
  lastAudit: auditReport.nullable(),
  visResults: z.array(visResult),
  visHistory: z.array(visSnapshot),
  lastVis: visSnapshot.nullable(),
  compData: compData.nullable(),
  plans: z.record(z.string(), answerPlan),
  targets: z.array(linkTarget).nullable(),
  kb: z.strictObject({ entries: z.array(kbEntry), at: z.string() }).nullable(),
  artifacts: z.array(artifact),
  notify: z.strictObject({
    weekly: z.boolean(),
    drop: z.boolean(),
    mention: z.boolean(),
    gsc: z.boolean(),
  }),
  demo: z.boolean(),
});

const persistedSchema = z.strictObject({
  v: z.literal(PERSISTED_VERSION),
  state: projectStateSchema,
});

// Drift guard, one direction only: what the schema accepts must be a valid
// domain state (mutable zod arrays assign to the readonly domain arrays; the
// reverse does not type-check and is not needed).
type SchemaState = z.infer<typeof projectStateSchema>;
const _schemaIsDomainState: WorkbenchProjectState = null as unknown as SchemaState;
void _schemaIsDomainState;

export function parsePersistedState(raw: unknown): WorkbenchProjectState | null {
  const result = persistedSchema.safeParse(raw);
  return result.success ? result.data.state : null;
}
```

`note` / `filename` 在 `types.ts` 里必须是 `?: string | undefined`（见头部约定例外），否则 `parsePersistedState` 的返回和漂移守卫都编译不过。

- [ ] **Step 5: 类型检查**

Run: `pnpm --filter @sf/web typecheck`
Expected: 只剩 `schema.test.ts` 找不到 `./reducer.ts`（Task 4 解决）；无其他新错误。

- [ ] **Step 6: 不单独提交**

本任务与 Task 4 合为一个 commit（Task 4 Step 6），避免带红测试的提交。

---

### Task 4: reducer 与初始状态

**Files:**
- Modify: `apps/web/src/lib/workbench/types.ts`（追加 `DemoPayload`）
- Create: `apps/web/src/lib/workbench/store/reducer.ts`
- Test: `apps/web/src/lib/workbench/store/reducer.test.ts`

设计 §6.4：时钟与 id 由 action 携带；`auditComplete` 把上一份 `lastAudit` 归档、历史不含当前；`visProgress` 不归档、`visComplete` 归档；`auditCancel` / `visCancel` 回到上次；`loadDemo` 逐字段写入且不碰 `profile` / `notify`；`reset` 回初始值。

- [ ] **Step 1: 在 types.ts 末尾追加 DemoPayload**

```ts
/** What `makeDemoSite` (PR-2) produces and `loadDemo` writes — never `profile` or `notify` (design §6.4). */
export type DemoPayload = Pick<
  WorkbenchProjectState,
  | "conns" | "gscRows" | "seeds" | "built" | "saved"
  | "audit" | "auditHistory" | "lastAudit"
  | "visResults" | "visHistory" | "lastVis"
  | "compData" | "plans" | "targets" | "kb" | "artifacts" | "profileDoc"
>;
```

- [ ] **Step 2: 写测试**

```ts
// apps/web/src/lib/workbench/store/reducer.test.ts
import { describe, expect, it } from "vitest";
import type { Artifact, AuditReport, DemoPayload, VisResult } from "../types.ts";
import { ARTIFACT_LIMIT, HISTORY_LIMIT } from "../types.ts";
import { initialProjectState, normalizeInterrupted, reduce } from "./reducer.ts";

const seed = { url: "https://example.test", brand: "Example", market: "US" };

function report(at: string, score = 50): AuditReport {
  return {
    at, score, findings: [],
    crawl: { pages: 1, indexable: 1, blocked: 0, orphan: 0, lcp: "2.0", schema: 10, llmReadable: 50 },
    pageRows: [],
  };
}
function vis(p: string): VisResult {
  return { p, platform: "ChatGPT", hit: false, rank: null, brands: [], domains: [], real: false };
}
function artifact(id: string): Artifact {
  return { id, at: "2026-09-11 10:00", module: "audit", type: "md", engine: "seo", title: id, content: "x" };
}

describe("initialProjectState", () => {
  it("mirrors only url, brand and market from the real project", () => {
    const s = initialProjectState(seed);
    expect(s.profile).toEqual({ ...seed, positioning: "", features: "", competitors: "" });
    expect(s.audit).toBeNull();
    expect(s.artifacts).toEqual([]);
    expect(s.demo).toBe(false);
    expect(s.notify).toEqual({ weekly: true, drop: true, mention: false, gsc: true });
  });
});

describe("audit transitions", () => {
  it("archives the previous report on complete and keeps history free of the current one", () => {
    let s = initialProjectState(seed);
    s = reduce(s, { type: "auditComplete", report: report("2026-09-01 10:00") });
    expect(s.auditHistory).toEqual([]);
    expect(s.lastAudit?.at).toBe("2026-09-01 10:00");
    s = reduce(s, { type: "auditStart" });
    expect(s.audit).toBeNull();
    expect(s.lastAudit?.at).toBe("2026-09-01 10:00");
    s = reduce(s, { type: "auditComplete", report: report("2026-09-08 10:00") });
    expect(s.auditHistory.map((r) => r.at)).toEqual(["2026-09-01 10:00"]);
    expect(s.audit?.at).toBe("2026-09-08 10:00");
  });

  it("caps history at HISTORY_LIMIT, dropping the oldest", () => {
    let s = initialProjectState(seed);
    for (let i = 0; i < HISTORY_LIMIT + 3; i += 1) {
      s = reduce(s, { type: "auditComplete", report: report(`2026-01-${String(i + 1).padStart(2, "0")} 00:00`) });
    }
    expect(s.auditHistory).toHaveLength(HISTORY_LIMIT);
    expect(s.auditHistory[0]?.at).toBe("2026-01-03 00:00");
  });

  it("cancel restores the last report", () => {
    let s = reduce(initialProjectState(seed), { type: "auditComplete", report: report("a") });
    s = reduce(s, { type: "auditStart" });
    s = reduce(s, { type: "auditCancel" });
    expect(s.audit?.at).toBe("a");
  });
});

describe("visibility transitions", () => {
  it("progress does not archive, complete does", () => {
    let s = reduce(initialProjectState(seed), { type: "visComplete", results: [vis("q1")], at: "t1" });
    expect(s.visHistory).toEqual([]);
    s = reduce(s, { type: "visStart" });
    expect(s.visResults).toEqual([]);
    s = reduce(s, { type: "visProgress", results: [vis("q2")] });
    expect(s.visHistory).toEqual([]);
    expect(s.lastVis?.at).toBe("t1");
    s = reduce(s, { type: "visComplete", results: [vis("q2"), vis("q3")], at: "t2" });
    expect(s.visHistory.map((h) => h.at)).toEqual(["t1"]);
    expect(s.lastVis?.at).toBe("t2");
    expect(s.visResults).toHaveLength(2);
  });

  it("cancel restores the last snapshot or empties", () => {
    let s = reduce(initialProjectState(seed), { type: "visStart" });
    s = reduce(s, { type: "visProgress", results: [vis("x")] });
    expect(reduce(s, { type: "visCancel" }).visResults).toEqual([]);
    s = reduce(s, { type: "visComplete", results: [vis("x")], at: "t" });
    s = reduce(s, { type: "visStart" });
    expect(reduce(s, { type: "visCancel" }).visResults).toEqual([vis("x")]);
  });
});

describe("saved keywords", () => {
  it("keeps addedAt and source for words already saved", () => {
    let s = reduce(initialProjectState(seed), {
      type: "setSaved",
      saved: [{ q: "a", addedAt: "t0", source: "manual" }],
    });
    s = reduce(s, {
      type: "setSaved",
      saved: [{ q: "a", addedAt: "t9", source: "matrix" }, { q: "b", addedAt: "t1", source: "matrix" }],
    });
    expect(s.saved).toEqual([
      { q: "a", addedAt: "t0", source: "manual" },
      { q: "b", addedAt: "t1", source: "matrix" },
    ]);
  });
});

describe("artifacts", () => {
  it("prepends and caps at ARTIFACT_LIMIT", () => {
    let s = initialProjectState(seed);
    for (let i = 0; i < ARTIFACT_LIMIT + 2; i += 1) {
      s = reduce(s, { type: "addArtifact", artifact: artifact(`a${i}`) });
    }
    expect(s.artifacts).toHaveLength(ARTIFACT_LIMIT);
    expect(s.artifacts[0]?.id).toBe(`a${ARTIFACT_LIMIT + 1}`);
    expect(s.artifacts.at(-1)?.id).toBe("a2");
  });

  it("removes one and clears all", () => {
    let s = reduce(initialProjectState(seed), { type: "addArtifact", artifact: artifact("a") });
    s = reduce(s, { type: "addArtifact", artifact: artifact("b") });
    expect(reduce(s, { type: "removeArtifact", id: "a" }).artifacts.map((x) => x.id)).toEqual(["b"]);
    expect(reduce(s, { type: "clearArtifacts" }).artifacts).toEqual([]);
  });
});

describe("demo", () => {
  const payload: DemoPayload = {
    conns: { GSC: true, GA4: true }, gscRows: [], seeds: "a\nb", built: true, saved: [],
    audit: report("d"), auditHistory: [], lastAudit: report("d"),
    visResults: [vis("q")], visHistory: [], lastVis: { at: "d", results: [vis("q")] },
    compData: null, plans: {}, targets: null, kb: null, artifacts: [artifact("demo")], profileDoc: null,
  };

  it("loadDemo writes the payload fields, flags demo, and never touches profile or notify", () => {
    let s = reduce(initialProjectState(seed), {
      type: "patchProfile", patch: { positioning: "mine" },
    });
    s = reduce(s, { type: "setNotify", notify: { weekly: false, drop: false, mention: false, gsc: false } });
    s = reduce(s, { type: "loadDemo", payload });
    expect(s.demo).toBe(true);
    expect(s.seeds).toBe("a\nb");
    expect(s.audit?.at).toBe("d");
    expect(s.profile.positioning).toBe("mine");
    expect(s.notify.weekly).toBe(false);
  });

  it("clearDemo is symmetric to loadDemo and keeps profile edits and notify", () => {
    let s = reduce(initialProjectState(seed), { type: "patchProfile", patch: { features: "a, b" } });
    s = reduce(s, { type: "loadDemo", payload });
    s = reduce(s, { type: "clearDemo" });
    expect(s).toEqual({ ...initialProjectState(seed), profile: { ...initialProjectState(seed).profile, features: "a, b" } });
    expect(s.demo).toBe(false);
  });

  it("reset returns to the initial state for the same seed", () => {
    let s = reduce(initialProjectState(seed), { type: "loadDemo", payload });
    s = reduce(s, { type: "reset", seed });
    expect(s).toEqual(initialProjectState(seed));
  });

  it("loadPersisted replaces the whole state", () => {
    const other = { ...initialProjectState(seed), seeds: "persisted" };
    expect(reduce(initialProjectState(seed), { type: "loadPersisted", state: other })).toBe(other);
  });
});

describe("normalizeInterrupted", () => {
  it("restores the last audit and visibility snapshot after an interrupted run", () => {
    let s = reduce(initialProjectState(seed), { type: "auditComplete", report: report("a") });
    s = reduce(s, { type: "visComplete", results: [vis("v")], at: "t" });
    s = reduce(s, { type: "auditStart" });
    s = reduce(s, { type: "visStart" });
    const normalized = normalizeInterrupted(s);
    expect(normalized.audit?.at).toBe("a");
    expect(normalized.visResults).toEqual([vis("v")]);
  });
  it("is the identity when nothing was interrupted", () => {
    const s = initialProjectState(seed);
    expect(normalizeInterrupted(s)).toBe(s);
  });
});

describe("immutability", () => {
  it("never mutates the previous state object", () => {
    const before = initialProjectState(seed);
    const frozen = Object.freeze(before);
    const after = reduce(frozen, { type: "addArtifact", artifact: artifact("z") });
    expect(after).not.toBe(before);
    expect(before.artifacts).toEqual([]);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm vitest run --project unit apps/web/src/lib/workbench/store/reducer.test.ts`
Expected: FAIL，找不到 `./reducer.ts`。

- [ ] **Step 4: 实现 reducer.ts**

```ts
// apps/web/src/lib/workbench/store/reducer.ts
import {
  ARTIFACT_LIMIT,
  HISTORY_LIMIT,
  type Artifact,
  type AuditReport,
  type Connections,
  type DemoPayload,
  type GscRow,
  type KnowledgeBase,
  type LinkTarget,
  type NotifyPrefs,
  type Profile,
  type ProfileDoc,
  type SavedKeyword,
  type VisResult,
  type WorkbenchProjectState,
  type CompData,
  type AnswerPlan,
} from "../types.ts";

/** Fields mirrored from the real project (design §6.7). Never edited by mock pages. */
export interface ProjectSeed {
  readonly url: string;
  readonly brand: string;
  readonly market: string;
}

export type WorkbenchAction =
  | { readonly type: "patchProfile"; readonly patch: Partial<Pick<Profile, "positioning" | "features" | "competitors">> }
  | { readonly type: "setProfileDoc"; readonly doc: ProfileDoc | null }
  | { readonly type: "setConns"; readonly conns: Connections }
  | { readonly type: "setGscRows"; readonly rows: readonly GscRow[] }
  | { readonly type: "setSeeds"; readonly seeds: string }
  | { readonly type: "setBuilt"; readonly built: boolean }
  | { readonly type: "setSaved"; readonly saved: readonly SavedKeyword[] }
  | { readonly type: "setCompData"; readonly data: CompData | null }
  | { readonly type: "setPlans"; readonly plans: Readonly<Record<string, AnswerPlan>> }
  | { readonly type: "setTargets"; readonly targets: readonly LinkTarget[] | null }
  | { readonly type: "setKb"; readonly kb: KnowledgeBase | null }
  | { readonly type: "setNotify"; readonly notify: NotifyPrefs }
  | { readonly type: "auditStart" }
  | { readonly type: "auditComplete"; readonly report: AuditReport }
  | { readonly type: "auditCancel" }
  | { readonly type: "visStart" }
  | { readonly type: "visProgress"; readonly results: readonly VisResult[] }
  | { readonly type: "visComplete"; readonly results: readonly VisResult[]; readonly at: string }
  | { readonly type: "visCancel" }
  | { readonly type: "addArtifact"; readonly artifact: Artifact }
  | { readonly type: "removeArtifact"; readonly id: string }
  | { readonly type: "clearArtifacts" }
  | { readonly type: "loadDemo"; readonly payload: DemoPayload }
  | { readonly type: "clearDemo" }
  | { readonly type: "loadPersisted"; readonly state: WorkbenchProjectState }
  | { readonly type: "reset"; readonly seed: ProjectSeed };

const DEFAULT_NOTIFY: NotifyPrefs = { weekly: true, drop: true, mention: false, gsc: true };

export function initialProjectState(seed: ProjectSeed): WorkbenchProjectState {
  return {
    profile: { url: seed.url, brand: seed.brand, market: seed.market, positioning: "", features: "", competitors: "" },
    profileDoc: null,
    conns: { GSC: false, GA4: false },
    gscRows: [],
    seeds: "",
    built: false,
    saved: [],
    audit: null,
    auditHistory: [],
    lastAudit: null,
    visResults: [],
    visHistory: [],
    lastVis: null,
    compData: null,
    plans: {},
    targets: null,
    kb: null,
    artifacts: [],
    notify: DEFAULT_NOTIFY,
    demo: false,
  };
}

/** Re-apply the real project mirror after hydration (design §6.7). */
export function withProjectSeed(state: WorkbenchProjectState, seed: ProjectSeed): WorkbenchProjectState {
  return { ...state, profile: { ...state.profile, url: seed.url, brand: seed.brand, market: seed.market } };
}

function archive<T>(history: readonly T[], item: T | null): readonly T[] {
  if (item === null) return history;
  return [...history, item].slice(-HISTORY_LIMIT);
}

function mergeSaved(previous: readonly SavedKeyword[], next: readonly SavedKeyword[]): readonly SavedKeyword[] {
  return next.map((entry) => previous.find((p) => p.q === entry.q) ?? entry);
}

export function reduce(state: WorkbenchProjectState, action: WorkbenchAction): WorkbenchProjectState {
  switch (action.type) {
    case "patchProfile":
      return { ...state, profile: { ...state.profile, ...action.patch } };
    case "setProfileDoc":
      return { ...state, profileDoc: action.doc };
    case "setConns":
      return { ...state, conns: action.conns };
    case "setGscRows":
      return { ...state, gscRows: action.rows };
    case "setSeeds":
      return { ...state, seeds: action.seeds };
    case "setBuilt":
      return { ...state, built: action.built };
    case "setSaved":
      return { ...state, saved: mergeSaved(state.saved, action.saved) };
    case "setCompData":
      return { ...state, compData: action.data };
    case "setPlans":
      return { ...state, plans: action.plans };
    case "setTargets":
      return { ...state, targets: action.targets };
    case "setKb":
      return { ...state, kb: action.kb };
    case "setNotify":
      return { ...state, notify: action.notify };
    case "auditStart":
      return { ...state, audit: null };
    case "auditComplete":
      return {
        ...state,
        audit: action.report,
        lastAudit: action.report,
        auditHistory: archive(state.auditHistory, state.lastAudit),
      };
    case "auditCancel":
      return { ...state, audit: state.lastAudit };
    case "visStart":
      return { ...state, visResults: [] };
    case "visProgress":
      return { ...state, visResults: action.results };
    case "visComplete":
      return {
        ...state,
        visResults: action.results,
        lastVis: { at: action.at, results: action.results },
        visHistory: archive(state.visHistory, state.lastVis),
      };
    case "visCancel":
      return { ...state, visResults: state.lastVis?.results ?? [] };
    case "addArtifact":
      return { ...state, artifacts: [action.artifact, ...state.artifacts].slice(0, ARTIFACT_LIMIT) };
    case "removeArtifact":
      return { ...state, artifacts: state.artifacts.filter((a) => a.id !== action.id) };
    case "clearArtifacts":
      return { ...state, artifacts: [] };
    case "loadDemo":
      return { ...state, ...action.payload, demo: true };
    case "clearDemo": {
      const blank = initialProjectState({ url: state.profile.url, brand: state.profile.brand, market: state.profile.market });
      return { ...state, ...demoFields(blank), demo: false };
    }
    case "loadPersisted":
      return action.state;
    case "reset":
      return initialProjectState(action.seed);
  }
}

/** The exact field set `loadDemo` writes, so `clearDemo` can undo it symmetrically. */
function demoFields(s: WorkbenchProjectState): DemoPayload {
  return {
    conns: s.conns, gscRows: s.gscRows, seeds: s.seeds, built: s.built, saved: s.saved,
    audit: s.audit, auditHistory: s.auditHistory, lastAudit: s.lastAudit,
    visResults: s.visResults, visHistory: s.visHistory, lastVis: s.lastVis,
    compData: s.compData, plans: s.plans, targets: s.targets, kb: s.kb, artifacts: s.artifacts, profileDoc: s.profileDoc,
  };
}

/** After hydration: an interrupted run persisted `audit = null` / `visResults = []` (design §6.4). */
export function normalizeInterrupted(state: WorkbenchProjectState): WorkbenchProjectState {
  const audit = state.audit === null && state.lastAudit ? state.lastAudit : state.audit;
  const visResults = state.visResults.length === 0 && state.lastVis ? state.lastVis.results : state.visResults;
  if (audit === state.audit && visResults === state.visResults) return state;
  return { ...state, audit, visResults };
}
```

`reduce` 超过 50 行是 switch 的固有形态；若 lint 有函数长度规则则把 audit / vis 两组抽成 `reduceAudit` / `reduceVis`。

- [ ] **Step 5: 跑 reducer 与 schema 测试**

Run: `pnpm vitest run --project unit apps/web/src/lib/workbench/store`
Expected: reducer 16 passed、schema 4 passed。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/workbench/types.ts apps/web/src/lib/workbench/store/schema.ts apps/web/src/lib/workbench/store/schema.test.ts apps/web/src/lib/workbench/store/reducer.ts apps/web/src/lib/workbench/store/reducer.test.ts
git commit -m "feat(workbench): 领域类型、持久化 schema v1、reducer 与初始状态"
```

---

### Task 5: selectors

**Files:**
- Create: `apps/web/src/lib/workbench/store/selectors.ts`
- Test: `apps/web/src/lib/workbench/store/selectors.test.ts`

`keywordRows` / `gatedRows` 需要 `buildRows`，落 PR-2；本任务只做不依赖 mock 的派生。

- [ ] **Step 1: 写测试**

```ts
// apps/web/src/lib/workbench/store/selectors.test.ts
import { describe, expect, it } from "vitest";
import { initialProjectState, reduce } from "./reducer.ts";
import { savedQueries, seedList, selectCounts } from "./selectors.ts";

const seed = { url: "https://example.test", brand: "Example", market: "US" };
const base = initialProjectState(seed);

describe("seedList", () => {
  it("splits on newlines and commas, trims, drops blanks", () => {
    expect(seedList({ ...base, seeds: " a ,b\n\nc,\n" })).toEqual(["a", "b", "c"]);
    expect(seedList(base)).toEqual([]);
  });
});

describe("savedQueries", () => {
  it("returns the saved words in order", () => {
    const s = reduce(base, { type: "setSaved", saved: [{ q: "b", addedAt: "t", source: "manual" }, { q: "a", addedAt: "t", source: "gap" }] });
    expect(savedQueries(s)).toEqual(["b", "a"]);
  });
});

describe("selectCounts", () => {
  it("is all null on a fresh project (never zero)", () => {
    expect(selectCounts(base, null)).toEqual({
      audit: null, visibility: null, keywords: null, keywordLibrary: null,
      competitors: null, links: null, kb: null, artifacts: null, dataSources: null,
    });
  });

  it("reads the opengengrowth badge semantics", () => {
    let s = reduce(base, {
      type: "auditComplete",
      report: { at: "t", score: 56, findings: [], crawl: { pages: 1, indexable: 1, blocked: 0, orphan: 0, lcp: "1", schema: 1, llmReadable: 1 }, pageRows: [] },
    });
    s = reduce(s, {
      type: "visComplete", at: "t",
      results: [
        { p: "a", platform: "x", hit: true, rank: 1, brands: [], domains: [], real: false },
        { p: "b", platform: "x", hit: false, rank: null, brands: [], domains: [], real: false },
        { p: "c", platform: "x", hit: false, rank: null, brands: [], domains: [], real: false },
      ],
    });
    s = reduce(s, { type: "addArtifact", artifact: { id: "1", at: "t", module: "audit", type: "md", engine: "seo", title: "t", content: "" } });
    s = reduce(s, { type: "setSaved", saved: [{ q: "k", addedAt: "t", source: "manual" }] });
    s = reduce(s, { type: "setGscRows", rows: [{ query: "q", clicks: 1, impressions: 1, ctr: 1, position: 1 }] });
    s = reduce(s, { type: "setKb", kb: { at: "t", entries: [
      { id: "1", cat: "pricing", statement: "", evidence: "", source: "", from: "gap" },
      { id: "2", cat: "capability", statement: "has", evidence: "", source: "", from: "crawl" },
    ] } });
    const counts = selectCounts(s, 12);
    expect(counts.audit).toBe("56");
    expect(counts.visibility).toBe("33%");
    expect(counts.keywords).toBe("12");
    expect(counts.artifacts).toBe("1");
    expect(counts.keywordLibrary).toBe("1");
    expect(counts.dataSources).toBe("1");
    expect(counts.kb).toBe("1");
    expect(counts.competitors).toBeNull();
    expect(counts.links).toBeNull();
  });

  it("hides the audit badge while a run is in flight", () => {
    let s = reduce(base, {
      type: "auditComplete",
      report: { at: "t", score: 56, findings: [], crawl: { pages: 1, indexable: 1, blocked: 0, orphan: 0, lcp: "1", schema: 1, llmReadable: 1 }, pageRows: [] },
    });
    s = reduce(s, { type: "auditStart" });
    expect(selectCounts(s, null).audit).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run --project unit apps/web/src/lib/workbench/store/selectors.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
// apps/web/src/lib/workbench/store/selectors.ts
import type { WorkbenchProjectState } from "../types.ts";

export function seedList(state: WorkbenchProjectState): readonly string[] {
  return state.seeds
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function savedQueries(state: WorkbenchProjectState): readonly string[] {
  return state.saved.map((entry) => entry.q);
}

/** Sidebar badge values (design §4.3). `null` = no badge; zero is never shown. */
export interface WorkbenchCounts {
  readonly audit: string | null;
  readonly visibility: string | null;
  readonly keywords: string | null;
  readonly keywordLibrary: string | null;
  readonly competitors: string | null;
  readonly links: string | null;
  readonly kb: string | null;
  readonly artifacts: string | null;
  readonly dataSources: string | null;
}

function countOrNull(n: number): string | null {
  return n > 0 ? String(n) : null;
}

export function selectCounts(
  state: WorkbenchProjectState,
  keywordRowCount: number | null,
): WorkbenchCounts {
  const hits = state.visResults.filter((r) => r.hit).length;
  const total = state.visResults.length;
  return {
    audit: state.audit ? String(state.audit.score) : null,
    visibility: total > 0 ? `${Math.round((hits / total) * 100)}%` : null,
    keywords: keywordRowCount === null ? null : countOrNull(keywordRowCount),
    keywordLibrary: countOrNull(state.saved.length),
    competitors: state.compData ? countOrNull(state.compData.gap.rows.length) : null,
    links: state.targets ? countOrNull(state.targets.length) : null,
    kb: state.kb ? countOrNull(state.kb.entries.filter((e) => e.statement.trim() === "").length) : null,
    artifacts: countOrNull(state.artifacts.length),
    dataSources: countOrNull(state.gscRows.length),
  };
}
```

- [ ] **Step 4: 跑测试**

Run: `pnpm vitest run --project unit apps/web/src/lib/workbench/store/selectors.test.ts`
Expected: 5 passed。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/workbench/store/selectors.ts apps/web/src/lib/workbench/store/selectors.test.ts
git commit -m "feat(workbench): 侧栏徽标与种子词 selectors"
```

---

### Task 6: 持久化（注入 Storage）

**Files:**
- Create: `apps/web/src/lib/workbench/store/persistence.ts`
- Test: `apps/web/src/lib/workbench/store/persistence.test.ts`

- [ ] **Step 1: 写测试**

```ts
// apps/web/src/lib/workbench/store/persistence.test.ts
import { describe, expect, it } from "vitest";
import { initialProjectState } from "./reducer.ts";
import {
  clearAllWorkbenchState,
  clearProjectState,
  readProjectState,
  storageKey,
  writeProjectState,
} from "./persistence.ts";

const seed = { url: "https://example.test", brand: "Example", market: "US" };
const PID = "00000000-0000-4000-8000-000000000042";

function fakeStorage(initial: Record<string, string> = {}): Storage & { readonly map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => { map.delete(k); },
    setItem: (k, v) => { map.set(k, v); },
  };
}

describe("persistence", () => {
  it("uses a versioned, project-scoped key", () => {
    expect(storageKey(PID)).toBe(`gg.workbench.v1.${PID}`);
  });

  it("round-trips a state", () => {
    const storage = fakeStorage();
    const state = initialProjectState(seed);
    expect(writeProjectState(storage, PID, state)).toBe("ok");
    expect(readProjectState(storage, PID)).toEqual({ status: "ok", state });
  });

  it("reports empty when nothing is stored", () => {
    expect(readProjectState(fakeStorage(), PID)).toEqual({ status: "empty", state: null });
  });

  it("discards invalid JSON, wrong version and wrong shape", () => {
    expect(readProjectState(fakeStorage({ [storageKey(PID)]: "{nope" }), PID).status).toBe("invalid");
    expect(readProjectState(fakeStorage({ [storageKey(PID)]: JSON.stringify({ v: 9, state: {} }) }), PID).status).toBe("invalid");
    expect(readProjectState(fakeStorage({ [storageKey(PID)]: JSON.stringify({ v: 1, state: { demo: true } }) }), PID).status).toBe("invalid");
  });

  it("reports unavailable when storage throws on read or write", () => {
    const throwing = {
      ...fakeStorage(),
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => { throw new Error("SecurityError"); },
    } as unknown as Storage;
    expect(readProjectState(throwing, PID).status).toBe("unavailable");
    expect(writeProjectState(throwing, PID, initialProjectState(seed))).toBe("unavailable");
  });

  it("reports quota when setItem throws a QuotaExceededError", () => {
    const quota = {
      ...fakeStorage(),
      setItem: () => { const e = new Error("full"); e.name = "QuotaExceededError"; throw e; },
    } as unknown as Storage;
    expect(writeProjectState(quota, PID, initialProjectState(seed))).toBe("quota");
  });

  it("clears one project or every workbench key, leaving other keys alone", () => {
    const storage = fakeStorage({ other: "1" });
    writeProjectState(storage, PID, initialProjectState(seed));
    writeProjectState(storage, "p2", initialProjectState(seed));
    clearProjectState(storage, PID);
    expect(storage.map.has(storageKey(PID))).toBe(false);
    expect(storage.map.has(storageKey("p2"))).toBe(true);
    clearAllWorkbenchState(storage);
    expect([...storage.map.keys()]).toEqual(["other"]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run --project unit apps/web/src/lib/workbench/store/persistence.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
// apps/web/src/lib/workbench/store/persistence.ts
import type { WorkbenchProjectState } from "../types.ts";
import { PERSISTED_VERSION, parsePersistedState } from "./schema.ts";

/**
 * localStorage boundary (design §6.5). Storage is injected so the node unit
 * suite can drive it; the provider passes `window.localStorage`.
 */
const PREFIX = `gg.workbench.v${PERSISTED_VERSION}.`;

export function storageKey(projectId: string): string {
  return `${PREFIX}${projectId}`;
}

export type ReadStatus = "ok" | "empty" | "invalid" | "unavailable";
export type WriteStatus = "ok" | "quota" | "unavailable";

export function readProjectState(
  storage: Storage,
  projectId: string,
): { readonly status: ReadStatus; readonly state: WorkbenchProjectState | null } {
  let raw: string | null;
  try {
    raw = storage.getItem(storageKey(projectId));
  } catch {
    return { status: "unavailable", state: null };
  }
  if (raw === null) return { status: "empty", state: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "invalid", state: null };
  }
  const state = parsePersistedState(parsed);
  return state ? { status: "ok", state } : { status: "invalid", state: null };
}

export function writeProjectState(
  storage: Storage,
  projectId: string,
  state: WorkbenchProjectState,
): WriteStatus {
  try {
    storage.setItem(storageKey(projectId), JSON.stringify({ v: PERSISTED_VERSION, state }));
    return "ok";
  } catch (error) {
    return error instanceof Error && error.name === "QuotaExceededError" ? "quota" : "unavailable";
  }
}

export function clearProjectState(storage: Storage, projectId: string): void {
  try {
    storage.removeItem(storageKey(projectId));
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

export function clearAllWorkbenchState(storage: Storage): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key !== null && key.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // Storage unavailable: there is nothing persisted to clear.
  }
}
```

- [ ] **Step 4: 跑测试**

Run: `pnpm vitest run --project unit apps/web/src/lib/workbench/store/persistence.test.ts`
Expected: 7 passed。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/workbench/store/persistence.ts apps/web/src/lib/workbench/store/persistence.test.ts
git commit -m "feat(workbench): 注入式 localStorage 持久化"
```

---

### Task 7: WorkbenchProvider 与 hooks

**Files:**
- Create: `apps/web/src/lib/workbench/store/WorkbenchProvider.tsx`
- Create: `apps/web/src/lib/workbench/store/hooks.ts`

node 单测渲染不了组件；行为由 Task 12 的 e2e 覆盖（刷新仍在、删除项目后键清除）。

- [ ] **Step 1: 写 provider**

```tsx
// apps/web/src/lib/workbench/store/WorkbenchProvider.tsx
"use client";

import {
  createContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
} from "react";
import type { WorkbenchProjectState } from "../types.ts";
import {
  clearProjectState,
  readProjectState,
  storageKey,
  writeProjectState,
  type WriteStatus,
} from "./persistence.ts";
import {
  initialProjectState,
  normalizeInterrupted,
  reduce,
  withProjectSeed,
  type ProjectSeed,
  type WorkbenchAction,
} from "./reducer.ts";

export type StorageMode = "ok" | "volatile" | "quota";

export interface WorkbenchContextValue {
  readonly projectId: string;
  readonly state: WorkbenchProjectState;
  readonly dispatch: Dispatch<WorkbenchAction>;
  /** False until localStorage has been read; views render skeletons meanwhile. */
  readonly ready: boolean;
  readonly storageMode: StorageMode;
  readonly keywordRowCount: number | null;
  readonly forgetProject: () => void;
}

export const WorkbenchContext = createContext<WorkbenchContextValue | null>(null);

function localStorageOrNull(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Per-project mock state (design §6.5). Mount with `key={projectId}` so a
 * project switch remounts and re-hydrates; writes are suppressed until the
 * first read completes so an SSR-shaped initial state never overwrites disk.
 */
export function WorkbenchProvider({
  projectId,
  seed,
  deriveKeywordRowCount,
  children,
}: {
  readonly projectId: string;
  readonly seed: ProjectSeed;
  readonly deriveKeywordRowCount?: (state: WorkbenchProjectState) => number | null;
  readonly children: ReactNode;
}) {
  const [state, dispatch] = useReducer(reduce, seed, initialProjectState);
  const [ready, setReady] = useState(false);
  const [storageMode, setStorageMode] = useState<StorageMode>("ok");
  const storageRef = useRef<Storage | null>(null);

  function hydrate(): void {
    const storage = storageRef.current;
    if (!storage) {
      setStorageMode("volatile");
      return;
    }
    const read = readProjectState(storage, projectId);
    if (read.status === "unavailable") setStorageMode("volatile");
    if (read.state) {
      dispatch({ type: "loadPersisted", state: withProjectSeed(normalizeInterrupted(read.state), seed) });
    }
  }

  useEffect(() => {
    storageRef.current = localStorageOrNull();
    hydrate();
    setReady(true);
    // The seed is a server-rendered mirror; it cannot change without remount.
    // (No react-hooks eslint plugin in this repo, so no disable comment: one
    // would fail lint with "Definition for rule ... was not found".)
  }, [projectId]);

  useEffect(() => {
    if (!ready) return;
    const storage = storageRef.current;
    // Stop writing entirely once storage is volatile or full (design §6.5).
    if (!storage || storageMode !== "ok") return;
    const status: WriteStatus = writeProjectState(storage, projectId, state);
    if (status === "quota") setStorageMode("quota");
    if (status === "unavailable") setStorageMode("volatile");
  }, [state, ready, projectId, storageMode]);

  useEffect(() => {
    function onStorage(event: StorageEvent): void {
      if (event.key !== storageKey(projectId) || !storageRef.current) return;
      const read = readProjectState(storageRef.current, projectId);
      if (read.state) {
        dispatch({ type: "loadPersisted", state: withProjectSeed(normalizeInterrupted(read.state), seed) });
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [projectId, seed]);

  const value = useMemo<WorkbenchContextValue>(
    () => ({
      projectId,
      state,
      dispatch,
      ready,
      storageMode,
      keywordRowCount: deriveKeywordRowCount ? deriveKeywordRowCount(state) : null,
      forgetProject: () => {
        if (storageRef.current) clearProjectState(storageRef.current, projectId);
      },
    }),
    [projectId, state, ready, storageMode, deriveKeywordRowCount],
  );

  return <WorkbenchContext.Provider value={value}>{children}</WorkbenchContext.Provider>;
}
```

以上即最终版：读盘结果先过 `normalizeInterrupted` 再 `withProjectSeed`；`storageMode` 一旦不是 `ok` 就不再写盘。

- [ ] **Step 2: 写 hooks**

```ts
// apps/web/src/lib/workbench/store/hooks.ts
"use client";

import { useContext } from "react";
import type { Artifact } from "../types.ts";
import { selectCounts, type WorkbenchCounts } from "./selectors.ts";
import { WorkbenchContext, type WorkbenchContextValue } from "./WorkbenchProvider.tsx";

export function useWorkbench(): WorkbenchContextValue {
  const value = useContext(WorkbenchContext);
  if (!value) throw new Error("useWorkbench must be used inside WorkbenchProvider");
  return value;
}

/** `null` before hydration so the sidebar can render skeleton badge slots. */
export function useWorkbenchCounts(): WorkbenchCounts | null {
  const { state, ready, keywordRowCount } = useWorkbench();
  return ready ? selectCounts(state, keywordRowCount) : null;
}

export function useWorkbenchArtifacts(): readonly Artifact[] {
  return useWorkbench().state.artifacts;
}
```

- [ ] **Step 3: 类型检查 + reducer 测试**

Run: `pnpm --filter @sf/web typecheck && pnpm vitest run --project unit apps/web/src/lib/workbench`
Expected: 无新错误；全部通过。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/workbench/store
git commit -m "feat(workbench): WorkbenchProvider 与 hooks（按项目重挂、hydrate 后写盘）"
```

---

### Task 8: i18n `workbench` 命名空间

**Files:**
- Modify: `packages/i18n/src/messages/en.json`
- Modify: `packages/i18n/src/messages/zh-CN.json`

在两个文件的**末尾**追加顶层 `workbench` 键（减少与在建 parity 分支冲突）。不要在消息里用 `'` 或 `{` 之外的花括号（ICU 语法字符）。`appShell.programTitle / programDay / programProgress` 三键在 Task 11 删 `SidebarProgress` 时一并删除。

- [ ] **Step 1: en.json 追加**

```json
"workbench": {
  "nav": {
    "label": "Workbench sections",
    "groups": {
      "workspace": "Workspace",
      "research": "Research",
      "diagnosis": "Diagnosis",
      "site": "Site",
      "output": "Output",
      "space": "Tools"
    },
    "items": {
      "overview": "Overview",
      "week": "This week",
      "keywords": "Keyword research",
      "keywordLibrary": "Keyword library",
      "competitors": "Competitor overview",
      "audit": "Technical audit",
      "visibility": "AI visibility",
      "profile": "Site profile",
      "dataSources": "Data sources",
      "links": "Backlinks",
      "content": "Content generation",
      "kb": "Fact knowledge base",
      "answers": "Answer pages / reports",
      "artifacts": "Artifact center",
      "settings": "Settings"
    }
  },
  "shell": {
    "tagline": "GEO / SEO workbench",
    "siteCard": {
      "market": "Market",
      "gsc": "GSC",
      "audit": "Audit",
      "connected": "Connected",
      "notConnected": "Not connected",
      "none": "—"
    },
    "openMenu": "Open navigation",
    "closeMenu": "Close navigation",
    "search": "Search / jump",
    "artifacts": "Artifacts {count}",
    "newSite": "New site",
    "sites": "{count} sites",
    "shortcutHint": "Press ⌘K to jump",
    "sampleData": "Sample data",
    "sampleSite": "Sample site",
    "clearSample": "Clear sample",
    "sampleTitle": "Sample content is currently Chinese-only",
    "volatile": "Results will not be saved in this browser",
    "quota": "Browser storage is full; new results are not being saved",
    "legacy": "Legacy page",
    "inProgress": "Page in progress",
    "inProgressDetail": "This module lands in a later batch. The legacy page keeps working meanwhile.",
    "footerNote": "Numbers marked sample data are generated locally.",
    "footerDetail": "The real version runs server-side crawling and APIs.",
    "palette": {
      "title": "Search and jump",
      "placeholder": "Type a section or project",
      "sections": "Sections",
      "projects": "Projects",
      "newProject": "New site",
      "empty": "No matches"
    },
    "drawer": {
      "title": "Artifacts",
      "empty": "Nothing saved yet",
      "emptyDetail": "Save a report or task from any module and it appears here.",
      "copy": "Copy",
      "copied": "Copied",
      "download": "Download",
      "remove": "Remove",
      "clear": "Clear all",
      "close": "Close"
    }
  },
  "settings": {
    "realAction": "Real action"
  }
}
```

- [ ] **Step 2: zh-CN.json 追加（文案来自 opengengrowth Sidebar / Header）**

```json
"workbench": {
  "nav": {
    "label": "工作台导航",
    "groups": {
      "workspace": "工作台",
      "research": "研究",
      "diagnosis": "诊断",
      "site": "站点",
      "output": "产出",
      "space": "工作区"
    },
    "items": {
      "overview": "概览",
      "week": "本周变化",
      "keywords": "关键词研究",
      "keywordLibrary": "词库",
      "competitors": "竞品概览",
      "audit": "技术审计",
      "visibility": "AI 可见度",
      "profile": "站点档案",
      "dataSources": "数据源",
      "links": "外链",
      "content": "内容生成",
      "kb": "事实知识库",
      "answers": "答案页 / 报告",
      "artifacts": "产物中心",
      "settings": "设置"
    }
  },
  "shell": {
    "tagline": "GEO / SEO 工作台",
    "siteCard": {
      "market": "市场",
      "gsc": "GSC",
      "audit": "审计",
      "connected": "已接入",
      "notConnected": "未接",
      "none": "—"
    },
    "openMenu": "打开导航",
    "closeMenu": "关闭导航",
    "search": "搜索 / 跳转",
    "artifacts": "产物筐 {count}",
    "newSite": "新建站点",
    "sites": "{count} 个站点",
    "shortcutHint": "按 ⌘K 快速跳转",
    "sampleData": "示例数据",
    "sampleSite": "示例站点",
    "clearSample": "清除示例",
    "sampleTitle": "示例内容目前仅有中文",
    "volatile": "本次结果不会保存在此浏览器",
    "quota": "浏览器存储已满，新结果不再保存",
    "legacy": "旧版页面",
    "inProgress": "页面开发中",
    "inProgressDetail": "这个模块在后续批次落地，旧版页面照常可用。",
    "footerNote": "标「示例数据」的数字为本地生成。",
    "footerDetail": "真实版本走服务端抓取与 API。",
    "palette": {
      "title": "搜索与跳转",
      "placeholder": "输入模块或站点名",
      "sections": "模块",
      "projects": "站点",
      "newProject": "新建站点",
      "empty": "没有匹配项"
    },
    "drawer": {
      "title": "产物筐",
      "empty": "还没有产物",
      "emptyDetail": "在任一模块里存入报告或任务，会出现在这里。",
      "copy": "复制",
      "copied": "已复制",
      "download": "下载",
      "remove": "删除",
      "clear": "清空",
      "close": "关闭"
    }
  },
  "settings": {
    "realAction": "真实操作"
  }
}
```

- [ ] **Step 3: parity 与 JSON 合法性**

Run: `pnpm vitest run --project unit packages/i18n`
Expected: 全绿（含 key parity）。

- [ ] **Step 4: Commit**

```bash
git add packages/i18n/src/messages/en.json packages/i18n/src/messages/zh-CN.json
git commit -m "feat(i18n): 工作台 chrome 文案（en / zh-CN）"
```

---

### Task 9: UI 原语

**Files:**
- Create: `apps/web/src/components/workbench/ui/cn.ts`
- Create: `apps/web/src/components/workbench/ui/focus-order.ts`
- Create: `apps/web/src/components/workbench/ui/Dialog.tsx`
- Create: `apps/web/src/components/workbench/ui/PageHead.tsx`
- Create: `apps/web/src/components/workbench/ui/DemoChip.tsx`
- Create: `apps/web/src/components/workbench/ui/LegacyLinks.tsx`
- Create: `apps/web/src/components/workbench/views/placeholder/PlaceholderView.tsx`
- Test: `apps/web/src/components/workbench/ui/focus-order.test.ts`（纯函数）

Tailwind 类直接照 opengengrowth；颜色只用 token（`bg-wb-paper`、`text-wb-seo` 等由 `@theme` 生成）或 Tailwind 内置刻度。**任何组件不得写 `style={{}}`。**

- [ ] **Step 1: cn.ts**

```ts
// apps/web/src/components/workbench/ui/cn.ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind-aware class combiner (clsx + tailwind-merge). Legacy code keeps `cx`. */
export function cn(...inputs: readonly ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 2: 焦点圈纯函数 + 测试**

```ts
// apps/web/src/components/workbench/ui/focus-order.ts
/** Which element receives focus on Tab / Shift+Tab inside a trap (design §4.3). */
export function nextTrapIndex(
  count: number,
  activeIndex: number,
  backwards: boolean,
): number {
  if (count === 0) return -1;
  if (activeIndex < 0) return backwards ? count - 1 : 0;
  if (backwards) return activeIndex === 0 ? count - 1 : activeIndex - 1;
  return activeIndex === count - 1 ? 0 : activeIndex + 1;
}

export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
```

```ts
// apps/web/src/components/workbench/ui/focus-order.test.ts
import { describe, expect, it } from "vitest";
import { nextTrapIndex } from "./focus-order.ts";

describe("nextTrapIndex", () => {
  it("wraps forward and backward", () => {
    expect(nextTrapIndex(3, 2, false)).toBe(0);
    expect(nextTrapIndex(3, 0, true)).toBe(2);
    expect(nextTrapIndex(3, 1, false)).toBe(2);
  });
  it("enters from outside at the correct end", () => {
    expect(nextTrapIndex(3, -1, false)).toBe(0);
    expect(nextTrapIndex(3, -1, true)).toBe(2);
  });
  it("returns -1 when nothing is focusable", () => {
    expect(nextTrapIndex(0, 0, false)).toBe(-1);
  });
});
```

Run: `pnpm vitest run --project unit apps/web/src/components/workbench/ui/focus-order.test.ts`
Expected: 先 FAIL（无模块），实现后 3 passed。

- [ ] **Step 3: Dialog.tsx**

```tsx
// apps/web/src/components/workbench/ui/Dialog.tsx
"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { cn } from "./cn.ts";
import { FOCUSABLE, nextTrapIndex } from "./focus-order.ts";

/**
 * Accessible modal (design §4.3): role=dialog + aria-modal, focus moves in on
 * open, is trapped while open, and returns to the opener on close. The app root
 * (`#wb-app`) is made inert so the background is unreachable by keyboard and AT.
 */
export function Dialog({
  open,
  onClose,
  labelledBy,
  initialFocus,
  returnFocusTo,
  className,
  children,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly labelledBy: string;
  readonly initialFocus?: RefObject<HTMLElement | null>;
  /** Preferred focus target on close; falls back to whatever was focused on open. */
  readonly returnFocusTo?: RefObject<HTMLElement | null>;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement;
    const root = document.getElementById("wb-app");
    root?.setAttribute("inert", "");
    const target = initialFocus?.current ?? panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus();
    return () => {
      // Order matters: focus() on a node inside an inert subtree is a no-op,
      // so inert comes off first. Next's layout-router focuses the changed
      // segment after navigation, so activeElement-on-open is only a fallback.
      root?.removeAttribute("inert");
      const target = returnFocusTo?.current ?? openerRef.current;
      if (target instanceof HTMLElement) target.focus();
    };
  }, [open, initialFocus, returnFocusTo]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const active = items.indexOf(document.activeElement as HTMLElement);
    const next = nextTrapIndex(items.length, active, event.shiftKey);
    if (next === -1) return;
    event.preventDefault();
    items[next]?.focus();
  }

  if (!open) return null;
  return (
    <div className="wb-reset fixed inset-0 z-50 font-sans text-slate-900">
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        className="absolute inset-0 bg-slate-900/50"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onKeyDown={onKeyDown}
        className={cn("absolute bg-white shadow-xl outline-none", className)}
      >
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: PageHead.tsx / DemoChip.tsx / LegacyLinks.tsx**

```tsx
// apps/web/src/components/workbench/ui/DemoChip.tsx
"use client";

import { useTranslations } from "next-intl";

export function DemoChip({ demo = false }: { readonly demo?: boolean }) {
  const t = useTranslations("workbench.shell");
  return (
    <span
      title={t("sampleTitle")}
      className="inline-flex h-[26px] items-center rounded border border-amber-200/60 bg-amber-50 px-2 text-xs font-medium text-amber-700"
    >
      {demo ? t("sampleSite") : t("sampleData")}
    </span>
  );
}
```

```tsx
// apps/web/src/components/workbench/ui/LegacyLinks.tsx
"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { legacyHref, type LegacySegment } from "@/lib/workbench/routes";

/** "旧版页面 →" affordance (design §4.3). One link per legacy destination. */
/** Legacy segment → existing `nav.*` label key, so the link reads as a page name, not a path. */
const LEGACY_LABEL_KEY: Readonly<Record<LegacySegment, string>> = {
  "legacy/overview": "overview",
  "growth-map": "growthMap",
  context: "context",
  "setup-sources": "sourceSetup",
  sources: "sources",
  studio: "studio",
  execution: "execution",
  results: "results",
};

export function LegacyLinks({
  projectId,
  segments,
}: {
  readonly projectId: string;
  readonly segments: readonly LegacySegment[];
}) {
  const t = useTranslations("workbench.shell");
  const tNav = useTranslations("nav");
  if (segments.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-2">
      {segments.map((segment) => (
        <Link
          key={segment}
          href={legacyHref(projectId, segment)}
          data-wb-legacy-link={segment}
          className="text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline"
        >
          {t("legacy")} · {tNav(LEGACY_LABEL_KEY[segment])} →
        </Link>
      ))}
    </span>
  );
}
```

```tsx
// apps/web/src/components/workbench/ui/PageHead.tsx
import type { ReactNode } from "react";

/**
 * Page header contract: exactly one <h1 data-wb-page-title> per page. The
 * legacy `data-app-page-title` attribute is NOT used here on purpose — its
 * global !important rule forces 32–48px, the design is 24px.
 */
export function PageHead({
  title,
  subtitle,
  aside,
}: {
  readonly title: string;
  readonly subtitle?: string;
  readonly aside?: ReactNode;
}) {
  return (
    <div className="mb-8">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 data-wb-page-title="" className="text-2xl font-bold tracking-tight text-slate-900">
          {title}
        </h1>
        {aside ? <div className="flex items-center gap-2">{aside}</div> : null}
      </div>
      {subtitle ? <p className="max-w-3xl text-[13px] text-slate-500">{subtitle}</p> : null}
    </div>
  );
}
```

- [ ] **Step 5: PlaceholderView.tsx（PR-1 的 14 个页面都用它）**

```tsx
// apps/web/src/components/workbench/views/placeholder/PlaceholderView.tsx
"use client";

import { useTranslations } from "next-intl";
import { LEGACY_LINKS, type WorkbenchPageId } from "@/lib/workbench/routes";
import { DemoChip } from "../../ui/DemoChip.tsx";
import { LegacyLinks } from "../../ui/LegacyLinks.tsx";
import { PageHead } from "../../ui/PageHead.tsx";

export function PlaceholderView({
  projectId,
  page,
}: {
  readonly projectId: string;
  readonly page: WorkbenchPageId;
}) {
  const tNav = useTranslations("workbench.nav.items");
  const tShell = useTranslations("workbench.shell");
  return (
    <div className="wb-reset mx-auto min-h-full max-w-5xl p-6 font-sans text-slate-900 md:p-10">
      <PageHead
        title={tNav(page)}
        aside={
          <>
            <LegacyLinks projectId={projectId} segments={LEGACY_LINKS[page]} />
            <DemoChip />
          </>
        }
      />
      <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white text-center">
        <h2 className="mb-2 text-lg font-semibold text-slate-600">{tShell("inProgress")}</h2>
        <p className="max-w-md text-sm text-slate-400">{tShell("inProgressDetail")}</p>
      </div>
    </div>
  );
}
```

`@/lib/workbench/routes` 这种别名 import 在本仓库不带扩展名（与 `@/components/ui` 用法一致）；同目录 / 相对 import 带扩展名。

- [ ] **Step 6: 类型检查**

Run: `pnpm --filter @sf/web typecheck && pnpm vitest run --project unit apps/web/src/components/workbench`
Expected: 无错误；focus-order 3 passed。

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/workbench
git commit -m "feat(workbench): Dialog / PageHead / DemoChip / LegacyLinks / 占位视图"
```

---

### Task 10: 壳（导航模型、副作用 hook、Sidebar、Topbar、面板、抽屉、装配）

**Files:**
- Create: `apps/web/src/components/workbench/shell/workbench-nav.ts` (+ `.test.ts`)
- Create: `apps/web/src/components/workbench/shell/useProjectShellEffects.ts`
- Create: `apps/web/src/components/workbench/shell/useGlobalShortcut.ts`
- Create: `apps/web/src/components/workbench/shell/useMediaQuery.ts`
- Create: `apps/web/src/components/workbench/shell/Sidebar.tsx`
- Create: `apps/web/src/components/workbench/shell/Topbar.tsx`
- Create: `apps/web/src/components/workbench/shell/CommandPalette.tsx`
- Create: `apps/web/src/components/workbench/shell/ArtifactDrawer.tsx`
- Create: `apps/web/src/components/workbench/shell/ShellChrome.tsx`
- Create: `apps/web/src/components/workbench/shell/WorkbenchShell.tsx`
- Create: `apps/web/src/components/workbench/shell/SignOutButton.tsx`
- Create: `apps/web/src/lib/workbench/download.ts`

外观来源：`.workbench-reference/opengengrowth-src/components/Sidebar.tsx`、`Header.tsx`、`App.tsx`。行为来源：jsx L3086–3221（root）、L2485–2526（Drawer）、L3040–3085（Palette）。约束：`#wb-app` 是被 `inert` 的根，两个 Dialog 必须渲染在它**外面**；`wb-reset` 只挂 `aside`、`header`、Dialog 与新视图根节点，**不挂** `#wb-app` 或 `<main>`。

- [ ] **Step 1: 导航模型 + 测试**

```ts
// apps/web/src/components/workbench/shell/workbench-nav.ts
import type { WorkbenchPageId } from "../../../lib/workbench/routes.ts";
import type { WorkbenchCounts } from "../../../lib/workbench/store/selectors.ts";

export type NavTone = "neutral" | "seo" | "geo";
export type NavGroupId = "workspace" | "research" | "diagnosis" | "site" | "output" | "space";

export interface NavItem {
  readonly id: WorkbenchPageId;
  readonly tone: NavTone;
  /** Which `WorkbenchCounts` field feeds the badge; null = never badged. */
  readonly badge: keyof WorkbenchCounts | null;
}

export interface NavGroup {
  readonly id: NavGroupId;
  readonly items: readonly NavItem[];
}

/** Six groups, fifteen items — order and tones from the jsx NAV (L310–316). */
export const WORKBENCH_NAV: readonly NavGroup[] = [
  { id: "workspace", items: [
    { id: "overview", tone: "neutral", badge: null },
    { id: "week", tone: "neutral", badge: null },
  ] },
  { id: "research", items: [
    { id: "keywords", tone: "seo", badge: "keywords" },
    { id: "keywordLibrary", tone: "seo", badge: "keywordLibrary" },
    { id: "competitors", tone: "seo", badge: "competitors" },
  ] },
  { id: "diagnosis", items: [
    { id: "audit", tone: "seo", badge: "audit" },
    { id: "visibility", tone: "geo", badge: "visibility" },
  ] },
  { id: "site", items: [
    { id: "profile", tone: "neutral", badge: null },
    { id: "dataSources", tone: "neutral", badge: "dataSources" },
    { id: "links", tone: "seo", badge: "links" },
  ] },
  { id: "output", items: [
    { id: "content", tone: "seo", badge: null },
    { id: "kb", tone: "geo", badge: "kb" },
    { id: "answers", tone: "geo", badge: null },
  ] },
  { id: "space", items: [
    { id: "artifacts", tone: "neutral", badge: "artifacts" },
    { id: "settings", tone: "neutral", badge: null },
  ] },
];

export const TONE_DOT: Readonly<Record<NavTone, string>> = {
  neutral: "bg-zinc-500",
  seo: "bg-emerald-500",
  geo: "bg-fuchsia-500",
};
```

```ts
// apps/web/src/components/workbench/shell/workbench-nav.test.ts
import { describe, expect, it } from "vitest";
import { WORKBENCH_PAGE_IDS } from "../../../lib/workbench/routes.ts";
import { WORKBENCH_NAV } from "./workbench-nav.ts";

describe("WORKBENCH_NAV", () => {
  it("lists every route exactly once across six groups", () => {
    const ids = WORKBENCH_NAV.flatMap((g) => g.items.map((i) => i.id));
    expect(WORKBENCH_NAV).toHaveLength(6);
    expect([...ids].sort()).toEqual([...WORKBENCH_PAGE_IDS].sort());
  });
  it("badges only fields selectCounts produces", () => {
    const badged = WORKBENCH_NAV.flatMap((g) => g.items).filter((i) => i.badge !== null).map((i) => i.badge);
    expect(badged).toEqual(["keywords", "keywordLibrary", "competitors", "audit", "visibility", "dataSources", "links", "kb", "artifacts"]);
  });
});
```

Run: `pnpm vitest run --project unit apps/web/src/components/workbench/shell`
Expected: 2 passed。

- [ ] **Step 2: 三个 hook**

```ts
// apps/web/src/components/workbench/shell/useProjectShellEffects.ts
"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, type MouseEvent } from "react";
import {
  hasUnsavedContextChanges,
  shouldConfirmContextNavigation,
} from "@/app/p/[projectId]/_context-navigation-guard";
import {
  projectHistoryPosition,
  withProjectHistoryPosition,
} from "@/app/p/[projectId]/_project-history-position";

/**
 * The two behaviours the retired `_nav.tsx` carried besides rendering
 * (design §4.3): a history position on every project-shell entry (Studio
 * reverses a cancelled Back/Forward with it) and the Context unsaved-changes
 * confirm. Both must keep running under the workbench shell.
 */
export function useProjectShellEffects(): {
  readonly confirmNavigation: (event: MouseEvent<HTMLAnchorElement>, current: boolean) => void;
} {
  const tContext = useTranslations("context");
  const pathname = usePathname();
  const historyPositionRef = useRef<number | null>(null);
  const historyPathRef = useRef<string | null>(null);

  useEffect(() => {
    const existing = projectHistoryPosition(window.history.state);
    const previousPath = historyPathRef.current;
    if (previousPath === pathname) return;
    if (existing !== null && (previousPath === null || existing !== historyPositionRef.current)) {
      historyPositionRef.current = existing;
      historyPathRef.current = pathname;
      return;
    }
    const next = (historyPositionRef.current ?? -1) + 1;
    window.history.replaceState(withProjectHistoryPosition(window.history.state, next), "");
    historyPositionRef.current = next;
    historyPathRef.current = pathname;
  }, [pathname]);

  function confirmNavigation(event: MouseEvent<HTMLAnchorElement>, current: boolean): void {
    const modified = event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
    const dirty = hasUnsavedContextChanges();
    if (!shouldConfirmContextNavigation({ dirty, current, button: event.button, modified })) return;
    if (!window.confirm(tContext("leaveWarning"))) event.preventDefault();
  }

  return { confirmNavigation };
}
```

复制 `_nav.tsx` L60–102 时逐行对照，不要「顺手改进」——这段逻辑有 Studio 的 e2e 盯着。`@/app/p/[projectId]/…` 的别名 import 若 eslint 不允许，改为相对路径 `../../../app/p/[projectId]/_context-navigation-guard.ts`。

```ts
// apps/web/src/components/workbench/shell/useGlobalShortcut.ts
"use client";

import { useEffect } from "react";

/** ⌘K / Ctrl+K toggles the palette; Escape closes whatever is open (jsx L22–29). */
export function useGlobalShortcut(handlers: {
  readonly onTogglePalette: () => void;
  readonly onEscape: () => void;
}): void {
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        handlers.onTogglePalette();
      } else if (event.key === "Escape") {
        handlers.onEscape();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlers]);
}
```

```ts
// apps/web/src/components/workbench/shell/useMediaQuery.ts
"use client";

import { useEffect, useState } from "react";

/** False on the server and first paint; updates after mount. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = (): void => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}
```

```ts
// apps/web/src/lib/workbench/download.ts
/** Blob download for artifacts (jsx L326). Client only. */
export function downloadText(name: string, text: string, mime = "text/plain;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 3: Sidebar.tsx（照 opengengrowth Sidebar.tsx L86–142）**

```tsx
// apps/web/src/components/workbench/shell/Sidebar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { activeWorkbenchPage, workbenchHref } from "@/lib/workbench/routes";
import { useWorkbench, useWorkbenchCounts } from "@/lib/workbench/store/hooks";
import { cn } from "../ui/cn.ts";
import { TONE_DOT, WORKBENCH_NAV } from "./workbench-nav.ts";
import { useProjectShellEffects } from "./useProjectShellEffects.ts";

export interface SidebarSite {
  readonly host: string;
  readonly marketCode: string | null;
  /** null = not wired yet (PR-3 reads sources readiness). */
  readonly gscConnected: boolean | null;
}

export function Sidebar({
  projectId,
  site,
  siteCount,
  open,
  mobile,
  id,
}: {
  readonly projectId: string;
  readonly site: SidebarSite;
  readonly siteCount: number;
  readonly open: boolean;
  readonly mobile: boolean;
  readonly id: string;
}) {
  const t = useTranslations("workbench");
  const pathname = usePathname();
  const active = activeWorkbenchPage(pathname, projectId);
  const counts = useWorkbenchCounts();
  const { state, ready } = useWorkbench();
  const { confirmNavigation } = useProjectShellEffects();

  return (
    <aside
      id={id}
      data-app-shell-sidebar=""
      inert={mobile && !open}
      className={cn(
        "wb-reset fixed left-0 top-0 z-30 flex min-h-screen w-64 flex-col overflow-y-auto border-r border-wb-rail-line bg-wb-rail font-sans text-wb-rail-text transition-transform duration-300 ease-in-out md:translate-x-0",
        open ? "translate-x-0" : "-translate-x-full",
      )}
    >
      <div className="flex min-h-full flex-col p-4 pt-5">
        <div className="mb-6 flex items-center gap-3 px-1" data-wb-brand="">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-white text-sm font-bold text-zinc-900 shadow-sm" aria-hidden="true">GG</div>
          <div>
            <div className="text-sm font-semibold leading-tight text-zinc-100">GenGrowth</div>
            <div className="mt-0.5 text-xs text-zinc-500">{t("shell.tagline")}</div>
          </div>
        </div>

        <div className="mb-6 rounded-xl border border-wb-rail-3/50 bg-wb-rail-2 p-3.5 text-sm" data-wb-site-card="">
          <div className="mb-3 text-xs font-medium text-zinc-200">{site.host}</div>
          <dl className="grid grid-cols-[40px_1fr] gap-y-1.5 text-xs">
            <dt className="text-[#807f7d]">{t("shell.siteCard.market")}</dt>
            <dd className="text-zinc-300">{site.marketCode ?? t("shell.siteCard.none")}</dd>
            <dt className="text-[#807f7d]">{t("shell.siteCard.gsc")}</dt>
            <dd className="text-zinc-300">
              {site.gscConnected === null ? t("shell.siteCard.none") : site.gscConnected ? t("shell.siteCard.connected") : t("shell.siteCard.notConnected")}
            </dd>
            <dt className="text-[#807f7d]">{t("shell.siteCard.audit")}</dt>
            <dd className="text-zinc-300">
              {ready && state.lastAudit ? (
                <>
                  {state.lastAudit.at.slice(5)}
                  <span className="ml-1 text-[10px] text-amber-400/80">{t("shell.sampleData")}</span>
                </>
              ) : t("shell.siteCard.none")}
            </dd>
          </dl>
        </div>

        <nav aria-label={t("nav.label")} className="flex-1 space-y-5 pb-6">
          {WORKBENCH_NAV.map((group) => (
            <div key={group.id}>
              <h4 className="mb-1.5 px-2.5 text-[11px] font-medium text-wb-rail-muted">{t(`nav.groups.${group.id}`)}</h4>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive = active === item.id;
                  const badge = item.badge === null ? null : counts === null ? "loading" : counts[item.badge];
                  return (
                    <Link
                      key={item.id}
                      href={workbenchHref(projectId, item.id)}
                      aria-current={isActive ? "page" : undefined}
                      data-wb-nav={item.id}
                      onClick={(event) => confirmNavigation(event, isActive)}
                      className={cn(
                        "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-[13px] transition-colors",
                        isActive ? "bg-wb-rail-3 text-zinc-100" : "text-wb-rail-text hover:bg-wb-rail-2 hover:text-zinc-200",
                      )}
                    >
                      <span className="flex items-center gap-3">
                        <span className={cn("h-1.5 w-1.5 rounded-full opacity-80", TONE_DOT[item.tone])} aria-hidden="true" />
                        <span>{t(`nav.items.${item.id}`)}</span>
                      </span>
                      {badge === "loading" ? (
                        <span className="h-3 w-5 animate-pulse rounded bg-wb-rail-3" aria-hidden="true" />
                      ) : badge ? (
                        <span className="text-[11px] font-medium text-wb-rail-muted" data-wb-badge={item.id}>{badge}</span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="mt-4 border-t border-wb-rail-3/50 px-2 pt-4 text-[11px] leading-relaxed text-wb-rail-muted">
          <span className="block font-medium">{t("shell.sites", { count: siteCount })} · {t("shell.shortcutHint")}</span>
          <span className="mt-1 block text-[10px] text-wb-rail-dim">{t("shell.footerNote")}<br />{t("shell.footerDetail")}</span>
        </div>
      </div>
    </aside>
  );
}
```

`#807f7d` 是 opengengrowth 的字面色；按 §5 规则加进 `@theme` 作 `--color-wb-rail-label` 再用 `text-wb-rail-label`，不要留裸 hex。文件若超 200 行，把站点卡抽成 `SiteCard.tsx`。

- [ ] **Step 4: Topbar.tsx（照 opengengrowth Header.tsx）**

```tsx
// apps/web/src/components/workbench/shell/Topbar.tsx
"use client";

import { Menu, Search } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode, RefObject } from "react";
import { useWorkbench, useWorkbenchArtifacts } from "@/lib/workbench/store/hooks";
import { DemoChip } from "../ui/DemoChip.tsx";

export function Topbar({
  projectControl,
  accountControl,
  onMenu,
  onPalette,
  onDrawer,
  paletteButtonRef,
  drawerButtonRef,
  sidebarId,
  sidebarOpen,
}: {
  readonly projectControl: ReactNode;
  readonly accountControl: ReactNode;
  readonly onMenu: () => void;
  readonly onPalette: () => void;
  readonly onDrawer: () => void;
  readonly paletteButtonRef: RefObject<HTMLButtonElement | null>;
  readonly drawerButtonRef: RefObject<HTMLButtonElement | null>;
  readonly sidebarId: string;
  readonly sidebarOpen: boolean;
}) {
  const t = useTranslations("workbench.shell");
  const { state, storageMode, ready } = useWorkbench();
  const artifacts = useWorkbenchArtifacts();
  return (
    <header
      data-app-shell-topbar=""
      className="wb-reset sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-slate-200/80 bg-wb-paper px-4 font-sans text-slate-900"
    >
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onMenu}
          aria-label={sidebarOpen ? t("closeMenu") : t("openMenu")}
          aria-expanded={sidebarOpen}
          aria-controls={sidebarId}
          className="mr-1 rounded-md p-1.5 text-slate-500 hover:bg-slate-200/50 hover:text-slate-700 md:hidden"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
        {projectControl}
        <Link href="/new-project" className="hidden text-xs font-medium text-slate-500 hover:text-slate-900 sm:inline">
          + {t("newSite")}
        </Link>
        <button
          ref={paletteButtonRef}
          type="button"
          onClick={onPalette}
          className="ml-2 hidden w-64 items-center gap-2 rounded-md border border-slate-200 bg-white py-1.5 pl-2.5 pr-1.5 text-xs text-slate-400 hover:border-slate-300 md:flex"
        >
          <Search className="h-4 w-4" aria-hidden="true" />
          <span className="flex-1 text-left">{t("search")}</span>
          <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 text-[10px] font-medium text-slate-400">⌘K</kbd>
        </button>
      </div>
      <div className="flex items-center gap-3">
        {ready && storageMode !== "ok" ? (
          <span role="status" className="hidden text-xs text-amber-700 lg:inline">
            {storageMode === "quota" ? t("quota") : t("volatile")}
          </span>
        ) : null}
        <DemoChip demo={ready && state.demo} />
        <button
          ref={drawerButtonRef}
          type="button"
          onClick={onDrawer}
          data-wb-drawer-button=""
          className="h-[26px] rounded bg-[#222222] px-3 text-xs font-medium text-white shadow-sm transition-colors hover:bg-black"
        >
          {t("artifacts", { count: ready ? artifacts.length : 0 })}
        </button>
        {accountControl}
      </div>
    </header>
  );
}
```

`bg-[#222222]` 同样进 `@theme`（`--color-wb-ink`）。

- [ ] **Step 5: CommandPalette.tsx（jsx L3040–3085）**

```tsx
// apps/web/src/components/workbench/shell/CommandPalette.tsx
"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import type { ProjectShellOption } from "@/lib/services/project-shell";
import { workbenchHref } from "@/lib/workbench/routes";
import { cn } from "../ui/cn.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { WORKBENCH_NAV } from "./workbench-nav.ts";

interface PaletteEntry {
  readonly key: string;
  readonly group: "sections" | "projects" | "newProject";
  readonly label: string;
  readonly href: string;
}

export function CommandPalette({
  open,
  onClose,
  projectId,
  projectOptions,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly returnFocusTo: RefObject<HTMLElement | null>;
  readonly projectId: string;
  readonly projectOptions: readonly ProjectShellOption[];
}) {
  const t = useTranslations("workbench");
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const entries = useMemo<readonly PaletteEntry[]>(() => {
    const sections = WORKBENCH_NAV.flatMap((g) => g.items).map((item) => ({
      key: `s:${item.id}`, group: "sections" as const,
      label: t(`nav.items.${item.id}`), href: workbenchHref(projectId, item.id),
    }));
    const projects = projectOptions.map((p) => ({
      key: `p:${p.id}`, group: "projects" as const, label: p.label, href: workbenchHref(p.id, "overview"),
    }));
    const all = [...sections, ...projects, { key: "new", group: "newProject" as const, label: t("shell.palette.newProject"), href: "/new-project" }];
    const q = query.trim().toLowerCase();
    return q ? all.filter((e) => e.label.toLowerCase().includes(q)) : all;
  }, [query, projectId, projectOptions, t]);

  function go(entry: PaletteEntry | undefined): void {
    if (!entry) return;
    onClose();
    router.push(entry.href);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((i) => Math.min(i + 1, entries.length - 1)); }
    if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
    if (event.key === "Enter") { event.preventDefault(); go(entries[activeIndex]); }
  }

  return (
    <Dialog open={open} onClose={onClose} labelledBy="wb-palette-title" initialFocus={inputRef} returnFocusTo={returnFocusTo}
      className="left-1/2 top-24 w-[min(560px,92vw)] -translate-x-1/2 overflow-hidden rounded-xl border border-slate-200">
      <h2 id="wb-palette-title" className="sr-only">{t("shell.palette.title")}</h2>
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
        onKeyDown={onKeyDown}
        placeholder={t("shell.palette.placeholder")}
        aria-controls="wb-palette-list"
        aria-activedescendant={entries[activeIndex] ? `wb-palette-${entries[activeIndex].key}` : undefined}
        className="w-full border-b border-slate-200 px-4 py-3 text-sm outline-none"
      />
      <div id="wb-palette-list" role="listbox" aria-label={t("shell.palette.title")} className="max-h-80 overflow-y-auto py-1">
        {entries.length === 0 ? <p className="px-4 py-3 text-sm text-slate-400">{t("shell.palette.empty")}</p> : null}
        {entries.map((entry, index) => (
          <button
            key={entry.key}
            id={`wb-palette-${entry.key}`}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => go(entry)}
            className={cn("flex w-full items-center justify-between px-4 py-2 text-left text-sm", index === activeIndex ? "bg-slate-100" : "hover:bg-slate-50")}
          >
            <span>{entry.label}</span>
            <span className="text-[11px] text-slate-400">{t(`shell.palette.${entry.group}`)}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}
```

- [ ] **Step 6: ArtifactDrawer.tsx（jsx L2485–2526）**

```tsx
// apps/web/src/components/workbench/shell/ArtifactDrawer.tsx
"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState, type RefObject } from "react";
import { downloadText } from "@/lib/workbench/download";
import { useWorkbench } from "@/lib/workbench/store/hooks";
import type { ArtifactType } from "@/lib/workbench/types";
import { Dialog } from "../ui/Dialog.tsx";

const MIME: Readonly<Record<ArtifactType, string>> = {
  csv: "text/csv;charset=utf-8", md: "text/markdown;charset=utf-8",
  json: "application/json;charset=utf-8", prompt: "text/plain;charset=utf-8",
};

export function ArtifactDrawer({
  open,
  onClose,
  returnFocusTo,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly returnFocusTo: RefObject<HTMLElement | null>;
}) {
  const t = useTranslations("workbench.shell.drawer");
  const { state, dispatch } = useWorkbench();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(id: string, content: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(id);
    } catch {
      window.prompt(t("copy"), content);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} labelledBy="wb-drawer-title" initialFocus={closeRef} returnFocusTo={returnFocusTo}
      className="right-0 top-0 flex h-full w-[min(480px,100vw)] flex-col border-l border-slate-200">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 id="wb-drawer-title" className="text-sm font-semibold">{t("title")} · {state.artifacts.length}</h2>
        <div className="flex items-center gap-2">
          {state.artifacts.length > 0 ? (
            <button type="button" onClick={() => dispatch({ type: "clearArtifacts" })} className="text-xs text-slate-500 hover:text-slate-900">{t("clear")}</button>
          ) : null}
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t("close")} className="rounded p-1 hover:bg-slate-100">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {state.artifacts.length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-sm font-medium text-slate-600">{t("empty")}</p>
            <p className="mt-1 text-xs text-slate-400">{t("emptyDetail")}</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {state.artifacts.map((a) => (
              <li key={a.id} className="px-4 py-3" data-wb-artifact={a.id}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{a.title}</span>
                  <span className="font-mono text-[11px] text-slate-400">{a.at}</span>
                </div>
                <div className="mt-2 flex gap-3 text-xs">
                  <button type="button" onClick={() => void copy(a.id, a.content)} className="text-slate-600 hover:text-slate-900">{copied === a.id ? t("copied") : t("copy")}</button>
                  <button type="button" onClick={() => downloadText(a.filename ?? `${a.title}.txt`, a.content, MIME[a.type])} className="text-slate-600 hover:text-slate-900">{t("download")}</button>
                  <button type="button" onClick={() => dispatch({ type: "removeArtifact", id: a.id })} className="text-rose-600 hover:text-rose-800">{t("remove")}</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
```

产物内容的「示例数据」来源声明由生产者（PR-3+ 的 `addArtifact` 调用方）写进 `content` 顶部（§6.8），抽屉只展示。

- [ ] **Step 7: ShellChrome.tsx + WorkbenchShell.tsx**

```tsx
// apps/web/src/components/workbench/shell/ShellChrome.tsx
"use client";

import { useTranslations } from "next-intl";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import type { ProjectShellOption } from "@/lib/services/project-shell";
import { ArtifactDrawer } from "./ArtifactDrawer.tsx";
import { CommandPalette } from "./CommandPalette.tsx";
import { Sidebar, type SidebarSite } from "./Sidebar.tsx";
import { Topbar } from "./Topbar.tsx";
import { useGlobalShortcut } from "./useGlobalShortcut.ts";
import { useMediaQuery } from "./useMediaQuery.ts";

const SIDEBAR_ID = "wb-sidebar";

export function ShellChrome({
  projectId, site, projectOptions, projectControl, accountControl, children,
}: {
  readonly projectId: string;
  readonly site: SidebarSite;
  readonly projectOptions: readonly ProjectShellOption[];
  readonly projectControl: ReactNode;
  readonly accountControl: ReactNode;
  readonly children: ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const paletteButtonRef = useRef<HTMLButtonElement>(null);
  const drawerButtonRef = useRef<HTMLButtonElement>(null);
  const mobile = useMediaQuery("(max-width: 767px)");
  const t = useTranslations("workbench.shell");

  const closeAll = useCallback(() => { setPaletteOpen(false); setDrawerOpen(false); setSidebarOpen(false); }, []);
  const handlers = useMemo(() => ({
    onTogglePalette: () => setPaletteOpen((p) => !p),
    onEscape: closeAll,
  }), [closeAll]);
  useGlobalShortcut(handlers);

  return (
    <>
      {/* No font/color here: they inherit into <main> and would change legacy pages (Task 0 baseline). */}
      <div id="wb-app" data-app-shell="" className="flex min-h-screen bg-wb-paper">
        {sidebarOpen ? (
          <button type="button" aria-label={t("closeMenu")} tabIndex={-1} className="fixed inset-0 z-20 border-0 bg-slate-900/50 md:hidden" onClick={() => setSidebarOpen(false)} />
        ) : null}
        <Sidebar id={SIDEBAR_ID} projectId={projectId} site={site} siteCount={projectOptions.length} open={sidebarOpen} mobile={mobile} />
        <div className="flex min-h-screen min-w-0 flex-1 flex-col md:ml-64">
          <Topbar
            projectControl={projectControl}
            accountControl={accountControl}
            onMenu={() => setSidebarOpen((o) => !o)}
            onPalette={() => setPaletteOpen(true)}
            onDrawer={() => setDrawerOpen(true)}
            paletteButtonRef={paletteButtonRef}
            drawerButtonRef={drawerButtonRef}
            sidebarId={SIDEBAR_ID}
            sidebarOpen={sidebarOpen}
          />
          <main id="main-content" className="flex-1">{children}</main>
        </div>
      </div>
      <CommandPalette returnFocusTo={paletteButtonRef} open={paletteOpen} onClose={() => setPaletteOpen(false)} projectId={projectId} projectOptions={projectOptions} />
      <ArtifactDrawer returnFocusTo={drawerButtonRef} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
}
```

焦点回退只能由 `Dialog` 的 effect cleanup 做：`onClose` 里同步调 `ref.current?.focus()` 时 `#wb-app` 还带着 `inert`（cleanup 要到 commit 才摘掉），对 inert 子树 focus 是 no-op。而 Next 的 layout-router 在导航后会主动 focus 变更段的 DOM 节点，⌘K 跳转后再开再关时 `document.activeElement` 记录的就不是按钮了。所以 `ShellChrome` 把两个按钮 ref 作为 `returnFocusTo` 传给 `CommandPalette` / `ArtifactDrawer`（它们原样转给 `Dialog`），`onClose` 保持纯 `setXOpen(false)`。

```tsx
// apps/web/src/components/workbench/shell/WorkbenchShell.tsx
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { signOutAction } from "@/lib/auth/actions";
import { LocaleSwitch } from "@/components/ui";
import type { ProjectShellProjection } from "@/lib/services/project-shell";
import { WorkbenchProvider } from "@/lib/workbench/store/WorkbenchProvider";
import { ShellChrome } from "./ShellChrome.tsx";
import { SignOutButton } from "./SignOutButton.tsx";

/**
 * Server assembly of the workbench shell (design §4.1). Owns everything that
 * needs the server: translations for the skip link, the sign-out server action,
 * and the real project mirror handed to the per-project store.
 */
export async function WorkbenchShell({
  shell,
  projectControl,
  children,
}: {
  readonly shell: ProjectShellProjection;
  readonly projectControl: ReactNode;
  readonly children: ReactNode;
}) {
  const tShell = await getTranslations("appShell");
  const tNav = await getTranslations("nav");
  const project = shell.currentProject;
  const accountControl = (
    <div className="flex items-center gap-2">
      <LocaleSwitch aria-label={tShell("localeSwitch")} />
      <SignOutButton action={signOutAction} label={tNav("logout")} />
    </div>
  );
  return (
    <WorkbenchProvider
      key={project.id}
      projectId={project.id}
      seed={{ url: project.host, brand: project.clientName, market: project.marketCode ?? "" }}
    >
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        {tShell("skipToContent")}
      </a>
      <ShellChrome
        projectId={project.id}
        site={{ host: project.host, marketCode: project.marketCode, gscConnected: null }}
        projectOptions={shell.projectOptions}
        projectControl={projectControl}
        accountControl={accountControl}
      >
        {children}
      </ShellChrome>
    </WorkbenchProvider>
  );
}
```

`project.marketCode` 由 Task 11 加进 `ProjectShellProject`。`LocaleSwitch` 若是 client 组件、且 `@/components/ui` barrel 拉进了 server-only 模块，改为直接 import `@/components/ui/LocaleSwitch`。

- [ ] **Step 8: SignOutButton.tsx（设计 §6.5：登出前清 `gg.workbench.*`）**

```tsx
// apps/web/src/components/workbench/shell/SignOutButton.tsx
"use client";

import { clearAllWorkbenchState } from "@/lib/workbench/store/persistence";

/** Server action arrives as a prop (serializable); the storage sweep must run in the browser. */
export function SignOutButton({
  action,
  label,
}: {
  readonly action: () => Promise<void>;
  readonly label: string;
}) {
  return (
    <form
      action={action}
      onSubmit={() => {
        try {
          clearAllWorkbenchState(window.localStorage);
        } catch {
          // Storage unavailable: nothing persisted to clear.
        }
      }}
    >
      <button type="submit" aria-label={label} title={label}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
        GG
      </button>
    </form>
  );
}
```

`signOutAction` 的真实签名以 `@/lib/auth/actions` 为准；若它带参数或返回类型不同，按其类型调整 `action` prop。

- [ ] **Step 9: 类型检查 + 单测**

Run: `pnpm --filter @sf/web typecheck && pnpm vitest run --project unit apps/web/src/components/workbench`
Expected: 仅剩 `marketCode` 不存在于 `ProjectShellProject` 的错误（Task 11 解决）。

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/components/workbench/shell apps/web/src/lib/workbench/download.ts apps/web/src/app/workbench.css
git commit -m "feat(workbench): 侧栏 / 顶栏 / 命令面板 / 产物筐抽屉与壳装配"
```

---

### Task 11: 路由与 layout 切换

**Files:**
- Modify: `apps/web/src/lib/services/project-shell.ts`
- Modify: `apps/web/src/app/p/[projectId]/_e2e-shell-fixture.ts`
- Move: `apps/web/src/app/p/[projectId]/overview/**` → `apps/web/src/app/p/[projectId]/legacy/overview/**`
- Create: 15 个 `apps/web/src/app/p/[projectId]/<segment>/page.tsx`
- Create: `apps/web/src/components/workbench/views/settings/DeleteProjectSection.tsx`、`SettingsView.tsx`
- Delete: `apps/web/src/app/p/[projectId]/settings/{_settings.tsx,_settings.test.ts,settings.module.css}`、`apps/web/src/app/p/[projectId]/_nav.tsx`
- Modify: `apps/web/src/app/p/[projectId]/layout.tsx`、`apps/web/src/app/layout.tsx`、`apps/web/src/components/app-shell/AppShell.tsx`、`apps/web/src/app/p/[projectId]/page-title-typography.test.ts`、两份 messages

- [ ] **Step 1: `ProjectShellProject.marketCode`**

`project-shell.ts` L19–26 加 `readonly marketCode: string | null;`；L175 `shellProject` 加 `marketCode: site.market_codes[0] ?? null,`；`_e2e-shell-fixture.ts` 的 `currentProject` 加 `marketCode: "US",`。`apps/web/src/lib/services/__tests__/project-shell.test.ts` 里构造 `ProjectShellProject` 字面量的地方补 `marketCode`，并在「returns accessible project options…」用例里加一条断言：`expect(shell.currentProject.marketCode).toBe(<夹具站点的 market_codes[0]>)`。

Run: `pnpm --filter @sf/web typecheck && pnpm vitest run --project unit apps/web/src/lib/services/__tests__/project-shell.test.ts`
Expected: Task 10 遗留的 `marketCode` 错误消失；project-shell 单测全绿（含新断言）。

- [ ] **Step 2: 搬 overview 到 legacy**

```bash
cd apps/web/src/app/p/\[projectId\]
mkdir -p legacy && git mv overview legacy/overview
grep -rn '"\.\./_' legacy/overview
```

把打印出的三处改为再向上一级：`from "../_e2e-shell"` → `"../../_e2e-shell"`、`from "../_problem-display"` → `"../../_problem-display"`，以及 `page.test.ts` L21 的 `vi.mock("../_e2e-shell", …)` → `vi.mock("../../_e2e-shell", …)`（它不是 `from`，漏改后 mock 指向不存在的模块，真实 `shouldUseE2eProjectShell` 会跑，「preserves the browser-backed database-free E2E harness」用例红）。`page-title-typography.test.ts` 清单里 `./overview/_overview.tsx` → `./legacy/overview/_overview.tsx`，删掉 `./settings/_settings.tsx` 一行。

Run: `pnpm vitest run --project unit "apps/web/src/app/p/\[projectId\]/legacy" "apps/web/src/app/p/\[projectId\]/page-title-typography.test.ts"`
Expected: 全绿。

- [ ] **Step 3: 15 个页面文件**

每个段一份，只换 `page` 与函数名（`overview` 也用占位，PR-3 替换）：

```tsx
// apps/web/src/app/p/[projectId]/audit/page.tsx
import { PlaceholderView } from "@/components/workbench/views/placeholder/PlaceholderView";

export default async function AuditPage({
  params,
}: {
  readonly params: Promise<{ readonly projectId: string }>;
}) {
  const { projectId } = await params;
  return <PlaceholderView projectId={projectId} page="audit" />;
}
```

段名 ↔ page：`overview/overview`、`week/week`、`keywords/keywords`、`keyword-library/keywordLibrary`、`competitors/competitors`、`audit/audit`、`visibility/visibility`、`profile/profile`、`data-sources/dataSources`、`links/links`、`content/content`、`kb/kb`、`answers/answers`、`artifacts/artifacts`。`settings` 见下一步。

- [ ] **Step 4: 设置页 = 占位 + 真实删除**

删除旧三文件后：

```tsx
// apps/web/src/components/workbench/views/settings/DeleteProjectSection.tsx
"use client";

import { AlertTriangle, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useDeleteProject } from "@/lib/api";
import { useWorkbench } from "@/lib/workbench/store/hooks";
import { cn } from "../../ui/cn.ts";

/**
 * The one real action on the settings page (design §6.6). Moved verbatim in
 * behaviour from the retired `settings/_settings.tsx`: two explicit steps,
 * localized copy only, replace to "/" and refresh on success. Adds: clears the
 * project's workbench localStorage key.
 */
export function DeleteProjectSection({ projectId }: { readonly projectId: string }) {
  const t = useTranslations("projectSettings");
  const tWb = useTranslations("workbench.settings");
  const router = useRouter();
  const { forgetProject } = useWorkbench();
  const deleteProject = useDeleteProject(projectId);
  const [confirming, setConfirming] = useState(false);

  async function confirmDelete(): Promise<void> {
    try {
      await deleteProject.mutateAsync();
      forgetProject();
      router.replace("/");
      router.refresh();
    } catch {
      // The mutation keeps its typed error; only localized copy is shown.
    }
  }

  const button = "rounded-lg border px-4 py-1.5 text-[13px] font-medium transition-colors";
  return (
    <section aria-labelledby="delete-product-title" className="rounded-xl border border-rose-200 bg-white p-6 shadow-sm" data-wb-real-action="">
      <div className="mb-3 flex items-center gap-2">
        <Trash2 size={18} aria-hidden="true" className="text-rose-600" />
        <span className="rounded border border-rose-200 bg-rose-50 px-2 text-[11px] font-medium text-rose-700">{tWb("realAction")}</span>
        <span className="text-[11px] font-medium uppercase text-slate-400">{t("dangerZone")}</span>
      </div>
      <h2 id="delete-product-title" className="text-[15px] font-semibold">{t("delete.title")}</h2>
      <p className="mt-1 text-[13px] text-slate-500">{t("delete.description")}</p>
      <p className="mt-1 text-[12px] text-slate-400">{t("delete.retention")}</p>
      {deleteProject.isError ? <p role="alert" className="mt-3 text-[13px] text-rose-700">{t("delete.error")}</p> : null}
      {confirming ? (
        <div role="group" aria-label={t("delete.confirmTitle")} className="mt-4 flex flex-wrap items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4">
          <AlertTriangle size={18} aria-hidden="true" className="mt-0.5 text-rose-600" />
          <div className="flex-1">
            <strong className="text-[13px]">{t("delete.confirmTitle")}</strong>
            <p className="text-[12px] text-slate-600">{t("delete.confirmDescription")}</p>
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={deleteProject.isPending} onClick={() => { deleteProject.reset(); setConfirming(false); }} className={cn(button, "border-slate-200 bg-white text-slate-700 hover:bg-slate-50")}>{t("delete.cancel")}</button>
            <button type="button" disabled={deleteProject.isPending} onClick={() => void confirmDelete()} className={cn(button, "border-rose-600 bg-rose-600 text-white hover:bg-rose-700")}>{deleteProject.isPending ? t("delete.deleting") : t("delete.confirmAction")}</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => { deleteProject.reset(); setConfirming(true); }} className={cn(button, "mt-4 border-rose-200 bg-white text-rose-700 hover:bg-rose-50")}>{t("delete.action")}</button>
      )}
    </section>
  );
}
```

```tsx
// apps/web/src/components/workbench/views/settings/SettingsView.tsx
"use client";

import { useTranslations } from "next-intl";
import { DemoChip } from "../../ui/DemoChip.tsx";
import { PageHead } from "../../ui/PageHead.tsx";
import { DeleteProjectSection } from "./DeleteProjectSection.tsx";

/** PR-1 form (design §4.2): placeholder note + the real delete block. PR-3 adds notify + data sources. */
export function SettingsView({ projectId }: { readonly projectId: string }) {
  const tNav = useTranslations("workbench.nav.items");
  const tShell = useTranslations("workbench.shell");
  return (
    <div className="wb-reset mx-auto min-h-full max-w-5xl p-6 font-sans text-slate-900 md:p-10">
      <PageHead title={tNav("settings")} aside={<DemoChip />} />
      <p className="mb-6 text-[13px] text-slate-500">{tShell("inProgressDetail")}</p>
      <DeleteProjectSection projectId={projectId} />
    </div>
  );
}
```

```tsx
// apps/web/src/app/p/[projectId]/settings/page.tsx
import { SettingsView } from "@/components/workbench/views/settings/SettingsView";

export default async function SettingsPage({
  params,
}: {
  readonly params: Promise<{ readonly projectId: string }>;
}) {
  const { projectId } = await params;
  return <SettingsView projectId={projectId} />;
}
```

旧 `_settings.test.ts` 的三条断言（两步删除、仅活跃项目暴露设置、双语保留说明）：第一条由 Task 12 的 e2e 覆盖；第二条随旧壳退役；第三条 parity 已守。删除即可。

- [ ] **Step 5: 项目 layout 换壳**

```tsx
// apps/web/src/app/p/[projectId]/layout.tsx
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { WorkbenchShell } from "@/components/workbench/shell/WorkbenchShell";
import { getOperatorContext } from "@/lib/auth/session";
import { getProjectShell, type ProjectShellProjection } from "@/lib/services/project-shell";
import { ProjectSwitcher } from "./_project-switcher.tsx";

/**
 * Project shell (design §4.1). Server component: resolves the operator + project
 * (404, never 403, for a foreign or absent project so existence never leaks),
 * then frames every project page — new workbench pages and the retained legacy
 * pages alike — with the workbench chrome.
 */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  let shell: ProjectShellProjection | null = null;
  if (process.env.NODE_ENV === "development") {
    const { loadE2eProjectShell } = await import("./_e2e-shell.ts");
    shell = await loadE2eProjectShell(process.env, projectId);
  }
  if (!shell) {
    const operator = await getOperatorContext();
    if (!operator) notFound();
    shell = await getProjectShell({ workspaceId: operator.workspaceId }, projectId);
  }
  if (!shell) notFound();

  return (
    <WorkbenchShell
      shell={shell}
      projectControl={<ProjectSwitcher projectId={shell.currentProject.id} options={shell.projectOptions} />}
    >
      {children}
    </WorkbenchShell>
  );
}
```

然后：删 `_nav.tsx`；`AppShell.tsx` 删 `SidebarProgress` 函数、`components/app-shell/index.ts` 的 barrel 里删 `SidebarProgress` 导出、`app-shell.module.css` 里删 `.program*` 规则；两份 messages 删 `appShell.programTitle / programDay / programProgress`；根 `layout.tsx` 的 `<html>` 加 `data-theme="light"`（设计 §5 / §11）。

- [ ] **Step 5b: 复核 `proxy.ts` 与 `_compatibility-route.ts`（设计 §9 PR-1 明列）**

已核实的事实（实施时再对一眼行号，写进 PR 描述）：

- `apps/web/src/proxy.ts`：鉴权与 CSP 按前缀放行（`/api/`、`PUBLIC_PAGES`、`PUBLIC_FILES`），不枚举项目段名——15 个新段与 `legacy/overview` 不需要登记。
- `apps/web/src/app/p/[projectId]/_compatibility-route.ts`：只做 `plan → execution`、`report → results`、`diagnosis → growth-map` 的查询参数翻译；不碰 `overview` / `settings`。
- `diagnosis/page.tsx` **不是可渲染旧页**：它无条件 `redirect(growthMapCompatibilityRoute(...))`。设计稿 §4.3 表把「技术审计 → diagnosis」当成旧页是事实错误，Task 2 已把 `LEGACY_LINKS.audit` 定为 `["growth-map"]`，`LegacySegment` 不含 `"diagnosis"`；设计稿该行同步改为 `growth-map`，并在 PR 描述「相对设计稿的偏离」里写明。

- [ ] **Step 6: 类型、lint、单测、parity**

Run: `pnpm --filter @sf/web typecheck && pnpm --filter @sf/web lint && pnpm vitest run --project unit apps/web packages/i18n`
Expected: 全绿。`_nav.test.ts` 仍绿（它测的是保留的 `nav-model.ts`）；`apps/web/src/app/layout.test.ts` 仍绿（它读的是保留的 `AppShell.tsx` 品牌图）；`legacy/overview/page.test.ts` 若按路径断言需改为 legacy 路径。

- [ ] **Step 7: 冒烟：起 dev，肉眼过一遍**

裸 `SF_E2E_MOCK_API=true` 起不到壳：`shouldUseE2eProjectShell` 还要求 `APP_ORIGIN` 是 loopback，未登录访问 `/p/**` 要 `SF_DEV_AUTH=true`。镜像 `playwright.mock.config.ts` 的 `webServer.env`（DATABASE_URL 用它那个永不连通的 tripwire 值、SUPABASE_* / 各 bucket 用 `e2e-local-only` 占位）：

Run: `APP_ORIGIN=http://127.0.0.1:3000 SF_DEV_AUTH=true SF_E2E_MOCK_API=true DATABASE_URL='postgresql://e2e:e2e@127.0.0.1:1/e2e_never_connect' SUPABASE_URL=http://127.0.0.1:1 SUPABASE_ANON_KEY=e2e-local-only SUPABASE_SERVICE_ROLE_KEY=e2e-local-only CREDENTIAL_ENCRYPTION_KEY=$(head -c 32 /dev/zero | base64) GOOGLE_OAUTH_CLIENT_ID=e2e-local-only GOOGLE_OAUTH_CLIENT_SECRET=e2e-local-only DATAFORSEO_ENABLED=false RAW_IMPORT_BUCKET=e2e-local-only EXPORT_BUCKET=e2e-local-only SF_BLOB_BACKEND=local SF_BLOB_DIR="${SCRATCHPAD:-$TMPDIR}/wb-blobs" pnpm --filter @sf/web dev --webpack` 后打开 `http://127.0.0.1:3000/p/00000000-0000-4000-8000-000000000042/overview`
Expected: 深色侧栏 15 项、站点卡 `example.test / US / — / —`、顶栏项目切换 + ⌘K + 示例数据 + 产物筐 0；点「技术审计」到占位页并有「旧版页面 · 增长地图 →」（`LEGACY_LINKS.audit` 指 `growth-map`）；旧页在新壳内的样子不在这里看——裸 dev 下 `/api/mvp/**` 没有 Playwright 的 mock 路由，旧页会拿到问题态；用 `pnpm test:e2e:mock --headed e2e/legacy-style-parity.mock.spec.ts` 肉眼看 growth-map / sources；⌘K 打开面板、Esc 关闭、焦点回到按钮；专门看一眼顶栏里的 `ProjectSwitcher` / `LocaleSwitch`——它们的 CSS Module 只覆盖自己声明过的属性，原生 `<select>` 没显式设 border 的话会被 `.wb-reset *` 的 `border-width: 0` 抹掉边框，需要时在其模块里补 `border`。

- [ ] **Step 8: Commit**

```bash
git add -A apps/web/src/app apps/web/src/components apps/web/src/lib/services/project-shell.ts packages/i18n
git commit -m "feat(web): 项目壳切换为工作台，15 条路由占位，旧概览搬 legacy，设置页接真实删除"
```

（`git add -A` 只限这几个路径；提交前 `git status` 确认没有带进 `.workbench-reference/`——它在 exclude 里，正常不会出现。）

---

### Task 12: spec 盘点、修复与新壳 spec

**Files:**
- Create: `e2e/workbench-shell.mock.spec.ts`
- Modify: `e2e/critical-flows.mock.spec.ts`、`e2e/mobile-shell.mock.spec.ts`、`e2e/overview-read-model.mock.spec.ts`、`e2e/frontend-error-states.mock.spec.ts`，以及盘点出的其他文件

- [ ] **Step 1: 盘点**

```bash
grep -nE 'data-app-shell|Project sections|program|/overview"|/overview`|"Settings"|getByRole\("link", \{ name: "(Overview|Growth Map|Execution|Results)"' e2e/*.spec.ts 'apps/web/src/app/p/[projectId]/'*.test.ts apps/web/src/app/layout.test.ts apps/web/src/components/app-shell/*.test.ts > "${SCRATCHPAD:-$TMPDIR}/wb-spec-inventory.txt"; wc -l "${SCRATCHPAD:-$TMPDIR}/wb-spec-inventory.txt"
```

（`SCRATCHPAD` 设为会话 scratchpad 目录；盘点结果不进仓库。）

逐行标处置：`改指向 legacy` / `改选择器` / `删除`。已知处置：

| 文件 | 处置 |
|---|---|
| `critical-flows.mock.spec.ts` L137–140 | 选择器改为 `[data-app-shell-sidebar] [data-wb-brand]`（品牌区不再用 `aria-label`——generic 元素带 aria-label 会被 axe 判 serious） |
| `critical-flows.mock.spec.ts` L143–197 | 重写：15 项导航 + 语言切换改变导航标签；数据源部分改为 `page.goto(legacy/overview)` 后再点「管理数据连接」 |
| `critical-flows.mock.spec.ts` L968–969 | 不改（print 隐藏由 `workbench.css` 保证） |
| `a11y.spec.ts` L262–263 | 不改；axe 若报新壳问题按报告修 |
| `mobile-shell.mock.spec.ts` | 重写：390px 下 `aside` 有 `inert`、菜单按钮 `aria-expanded` 切换、program 进度断言删除、Settings 链接为 `data-wb-nav="settings"` |
| `overview-read-model.mock.spec.ts` | `openOverview` 的 `goto` 改 `/legacy/overview`；chrome 本地化断言若指向旧顶栏则改为侧栏导航标签 |
| `frontend-error-states.mock.spec.ts` L1675 | `Project sections` → `Workbench sections`，若点的是旧四项之一改 `page.goto` |
| `complete-four-module-workbench.mock.spec.ts` 等按旧导航点击的 | 导航点击改 `page.goto`，页面内断言不动 |

- [ ] **Step 2: critical-flows 导航测试替换稿**

```ts
test("workbench navigation exposes all fifteen sections and localizes", async ({ page }) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/overview`);
  const nav = page.getByRole("navigation", { name: "Workbench sections" });
  const segments = [
    "overview", "week", "keywords", "keyword-library", "competitors", "audit", "visibility",
    "profile", "data-sources", "links", "content", "kb", "answers", "artifacts", "settings",
  ];
  await expect(nav.getByRole("link")).toHaveCount(segments.length);
  for (const segment of segments) {
    await expect(nav.locator(`a[href="/p/${E2E_PROJECT_ID}/${segment}"]`)).toHaveCount(1);
  }
  await expect(nav.getByRole("link", { name: "Overview", exact: true })).toHaveAttribute("aria-current", "page");

  const urlBefore = page.url();
  await page.getByRole("button", { name: "简体中文" }).click();
  await expect(page.getByRole("navigation", { name: "工作台导航" }).getByRole("link", { name: "概览", exact: true })).toBeVisible();
  expect(page.url()).toBe(urlBefore);

  await page.goto(`/p/${E2E_PROJECT_ID}/legacy/overview`);
  await page.getByRole("link", { name: "管理数据连接" }).click();
  await expect(page.getByRole("heading", { name: "数据来源" })).toBeVisible();
});
```

- [ ] **Step 3: 新壳 spec**

```ts
// e2e/workbench-shell.mock.spec.ts
import { expect, test } from "@playwright/test";
import { E2E_PROJECT_ID, installCriticalFlowApi } from "./mock-api.ts";

const PAGES: readonly (readonly [string, string])[] = [
  ["overview", "Overview"], ["week", "This week"], ["keywords", "Keyword research"],
  ["keyword-library", "Keyword library"], ["competitors", "Competitor overview"], ["audit", "Technical audit"],
  ["visibility", "AI visibility"], ["profile", "Site profile"], ["data-sources", "Data sources"],
  ["links", "Backlinks"], ["content", "Content generation"], ["kb", "Fact knowledge base"],
  ["answers", "Answer pages / reports"], ["artifacts", "Artifact center"], ["settings", "Settings"],
];

test.beforeEach(async ({ page }) => {
  await page.context().addCookies([{ name: "sf_ui_locale", value: "en", domain: "localhost", path: "/" }]);
  await installCriticalFlowApi(page);
});

test("every workbench page renders one data-wb-page-title h1 and its legacy links", async ({ page }) => {
  test.slow(); // 15 navigations under dev on-demand compilation; the 45 s mock timeout is too tight
  for (const [segment, title] of PAGES) {
    await page.goto(`/p/${E2E_PROJECT_ID}/${segment}`);
    await expect(page.locator("h1[data-wb-page-title]")).toHaveCount(1);
    await expect(page.locator("h1[data-wb-page-title]")).toHaveText(title);
    await expect(page.locator(`[data-wb-nav="${segment === "keyword-library" ? "keywordLibrary" : segment === "data-sources" ? "dataSources" : segment}"]`)).toHaveAttribute("aria-current", "page");
  }
  await page.goto(`/p/${E2E_PROJECT_ID}/audit`);
  await page.locator('[data-wb-legacy-link="growth-map"]').click();
  await expect(page).toHaveURL(new RegExp(`/p/${E2E_PROJECT_ID}/growth-map`));
});

test("english chrome carries no chinese and no untranslated key paths", async ({ page }) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/audit`);
  // Workbench-owned chrome only: LocaleSwitch shows "简体中文" by design and the
  // project switcher echoes fixture names, so both are excluded.
  const chrome = await page
    .locator("#wb-sidebar nav, [data-wb-site-card], [data-wb-drawer-button], [data-app-shell-topbar] kbd, h1[data-wb-page-title], [data-wb-legacy-link]")
    .allInnerTexts();
  const text = chrome.join("\n");
  expect(text).not.toMatch(/[一-鿿]/);
  expect(text).not.toMatch(/workbench\./);
});

test("shell markup carries no inline styles (production CSP has no unsafe-inline)", async ({ page }) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/audit`);
  await expect(page.locator("[data-app-shell] [style]")).toHaveCount(0);
  await expect(page.locator("[data-app-shell] style")).toHaveCount(0);
});

test("command palette: ⌘K opens, arrows + enter navigate, focus returns to the opener", async ({ page }) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/overview`);
  const opener = page.getByRole("button", { name: /Search \/ jump/ });
  await opener.focus();
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Search and jump" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox")).toBeFocused();
  await dialog.getByRole("textbox").fill("audit");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp("/audit$"));
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("dialog", { name: "Search and jump" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("artifact drawer traps focus and closes on Escape", async ({ page }) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/overview`);
  await page.locator("[data-wb-drawer-button]").click();
  const dialog = page.getByRole("dialog", { name: /Artifacts/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused(); // only focusable → wraps to itself
  await expect(page.locator("#wb-app")).toHaveAttribute("inert", "");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("#wb-app")).not.toHaveAttribute("inert", "");
});

test("mobile sidebar is inert while closed and opens from the menu button", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/p/${E2E_PROJECT_ID}/overview`);
  const sidebar = page.locator("#wb-sidebar");
  await expect(sidebar).toHaveAttribute("inert", "");
  // Locate the toggle by its aria-controls: once open, the backdrop button carries
  // the same "Close navigation" name and a role query would hit strict mode.
  const menu = page.locator('button[aria-controls="wb-sidebar"]');
  await expect(menu).toHaveAccessibleName("Open navigation");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await menu.click();
  await expect(sidebar).not.toHaveAttribute("inert", "");
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(menu).toHaveAccessibleName("Close navigation");
});

test("deleting the project clears its workbench storage key", async ({ page }) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/settings`);
  const key = `gg.workbench.v1.${E2E_PROJECT_ID}`;
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k) !== null, key)).toBe(true);
  await page.getByRole("button", { name: "Delete product" }).click();
  await page.getByRole("button", { name: "Confirm deletion" }).click();
  await expect(page).not.toHaveURL(/\/settings$/);
  expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBeNull();
});
```

- [ ] **Step 3b: mock API 兑现 `DELETE /api/mvp/projects/:id`（必做）**

`e2e/mock-api.ts` 目前没有任何 `DELETE` 分支；`installCriticalFlowApi` 对未匹配的 `/api/mvp/**` 回 501 `E2E_ROUTE_MISSING` problem（只有 `results` / `measurement-windows` 才 `route.fallback()`），mutation 报错，`forgetProject()` 不会执行，上面的删除用例必红。在 `installCriticalFlowApi` 的 `page.route("**/api/mvp/**", …)` 处理器里，紧跟 `const path = url.pathname;` 之后加：

```ts
    // Real project deletion (settings page): 204 with no body, like the API.
    if (method === "DELETE" && path === BASE) {
      await route.fulfill({ status: 204 });
      return;
    }
```

`BASE` 就是 `/api/mvp/projects/${E2E_PROJECT_ID}`，与 `deleteProjectRequest` 发出的 `DELETE /projects/:id` 一致。不加开关：没有别的 spec 会对保留项目发 DELETE。删除后 `router.replace("/")` 在 mock 环境落到 `/login` 或错误页，都不挂 `WorkbenchProvider`，所以 `localStorage` 断言成立；若日后根路由在 mock 下能重定向回 `/p/<id>/overview`，provider 重挂会把键写回来，届时该用例改为断言删除动作本身。

- [ ] **Step 4: 跑受影响 spec + 新 spec**

Run: `pnpm test:e2e:mock e2e/workbench-shell.mock.spec.ts e2e/critical-flows.mock.spec.ts e2e/mobile-shell.mock.spec.ts e2e/overview-read-model.mock.spec.ts e2e/frontend-error-states.mock.spec.ts e2e/legacy-style-parity.mock.spec.ts e2e/studio-workspace.mock.spec.ts e2e/product-profile.mock.spec.ts`
Expected: 全绿。`studio-workspace` 与 `product-profile` 是 `useProjectShellEffects` 的回归门，红了先怀疑 hook 抄漏，不要改 spec。

- [ ] **Step 5: 全量 mock e2e（后台跑，直接落文件）**

Run: `pnpm test:e2e:mock > "${SCRATCHPAD:-$TMPDIR}/wb-e2e-full.txt" 2>&1; tail -20 "${SCRATCHPAD:-$TMPDIR}/wb-e2e-full.txt"`
Expected: 与 Task 0 记录的既有红一致，无新红。

- [ ] **Step 6: Commit**

```bash
git add e2e
git commit -m "test(e2e): 工作台壳 spec，旧壳相关 spec 改指向 legacy / 新选择器"
```

---

### Task 13: 文档与权威声明

**Files:**
- Modify: `CLAUDE.md`（L23）
- Modify: `docs/PROGRESS.md`

- [ ] **Step 1: CLAUDE.md**

把 `Current authority: **v0.4 complete four-module workbench**` 改为：

`Current authority: **v0.4 contracts（API / schema / rules 不变）+ 工作台 15 项客户壳（2026-09-11 起，设计见 docs/plans/2026-09-11-workbench-ui-port-design.md；旧四模块页面作为过渡页保留可达）**`

并在下一段「“完成”表示…」后加一句：「客户壳自 2026-09-11 起以工作台 IA 为准，`components/app-shell/nav-model.ts` 的四模块清单仅供保留的旧页与其测试使用。」

- [ ] **Step 2: PROGRESS.md** 顶部加一条日期段落，写：PR-1 落地范围、旧页去向、未上生产（集成分支）、下一步 PR-2 / PR-3。

- [ ] **Step 2b: 仓库文档门**

Run: `pnpm verify:docs && pnpm verify:authority && pnpm verify:spec`
Expected: 全绿。**硬约束**：`scripts/verify-docs-consistency.test.mjs` L114–124 会对 `CLAUDE.md` 断言 `/authority\/implementation-spec-v0\.4|active v0\.4|Current authority: \*\*v0\.4/`，Step 1 的新句子必须保留 `Current authority: **v0.4` 这个前缀原文，否则 `verify:docs` 红。若任一红：先读脚本报的具体断言；只有当它断言的是被本 PR 有意改动的句子时才改脚本期望（同一 commit 内、注明原因），否则回滚文档改动重写。

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/PROGRESS.md
git commit -m "docs: 客户壳权威改为工作台 IA，记录 PR-1 落地"
```

---

### Task 14: 全量验证、评审、交付

- [ ] **Step 1: 本地全套**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm vitest run --project unit packages/i18n
pnpm verify:docs && pnpm verify:authority && pnpm verify:spec
pnpm --filter @sf/web build
```
Expected: 全绿；build 成功（这是唯一能暴露 client 拉到 `node:*` 的检查）。

- [ ] **Step 2: 覆盖率门**

先在 `feat/workbench-ui-port` 上跑一次同样的命令记下基线（`vitest.config.ts` 注明阈值按 unit+integration 合并统计，只跑 unit 可能本来就不到 80%），再在本分支跑：

Run: `pnpm vitest run --coverage --project unit 2>&1 | tail -15`
Expected: 四项数值不低于集成分支基线；若基线本身已 ≥ 80% 则四项阈值 ≥ 80%。若因 `components/workbench/**` 无单测而低于阈值：**不改阈值、不加 exclude**，为 `components/workbench/**` 加 jsdom 项目与组件测试（设计 §8），作为本 PR 的追加任务。

- [ ] **Step 3: 生产构建 CSP 冒烟**

`pnpm --filter @sf/web build` 后 `pnpm --filter @sf/web exec next start --port 3300`（`start` 脚本写死了 `--port 3000`，环境变量压不过 CLI 参数；用 Task 0 mock 配置里的占位环境变量），Playwright 打开 `http://localhost:3300/login`，断言 console 无 `Content Security Policy` 字样（登录页已加载 `workbench.css`）。壳本身在生产模式需要真实登录，留到 PR-3b 合 main 前用真实账号做一次。

- [ ] **Step 4: 自审 + 跨模型评审**

先 `superpowers:requesting-code-review`（对照本计划与设计稿 §4–§8），修完后按 `CLAUDE.md` 的 codex 约束跑一轮：`git diff feat/workbench-ui-port...HEAD > .review-tmp/pr1.diff`，prompt 限定「只读 diff + 设计稿 §4–§6 + `_nav.tsx` 原文 + `security-headers.ts`」，攻击面分两次：(a) 壳与 a11y / CSP；(b) store 与持久化。有 verdict 行才算跑成。

- [ ] **Step 5: 开 PR 到集成分支**

```bash
git push -u origin feat/workbench-pr1-foundation
gh pr create --base feat/workbench-ui-port --title "feat(workbench): PR-1 地基——新壳、15 条路由、store、i18n" --body-file .review-tmp/pr1-body.md
```

PR 描述含：设计稿链接、任务清单勾选状态、验证命令与结果、评审处置、已知未做（GSC 站点卡行、覆盖率补测若有）、**相对设计稿的偏离**（`audit` 的旧页链接指 `growth-map` 而非 `diagnosis`；样式基线屏从 `context` 换成 `sources`；`globals.css` 三条元素规则加了 `:where(:not(.wb-reset *))` 守卫；`postcss.config.mjs` 复刻 Next 默认链）与 Task 11 Step 5b 的两条复核结论。**不合 main**（D3）。
