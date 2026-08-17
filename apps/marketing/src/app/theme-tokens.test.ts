// @input  -- globals.css 的两个主题块、组件源码树、lib/theme 常量
// @output -- 主题层的三条护栏：token 对位完整、组件不写死颜色、无闪脚本形状正确
// @pos    -- 浅色主题的回归防线；漏一个 token 的症状是「浅色页面上留一块深色」，
//            这种 bug 不会让任何别的测试变红，只能靠这里拦

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_THEME,
  THEME_ATTRIBUTE,
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
} from "../lib/theme";

const GLOBALS_CSS = fileURLToPath(new URL("./globals.css", import.meta.url));
const SRC_ROOT = fileURLToPath(new URL("..", import.meta.url));

const css = readFileSync(GLOBALS_CSS, "utf8");

/**
 * 取出一个规则块的内容。这里刻意用最笨的括号配对而不是正则：`:root` 块里有
 * `color-mix(...)`、`linear-gradient(...)` 这类嵌套括号，正则的 `[^}]*` 在
 * 遇到多行渐变时会切在半路上，测试就会对着半个块做断言并且看上去是绿的。
 */
function ruleBody(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `globals.css 里找不到 ${selector} 规则块`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(css.indexOf("{", start) + 1, i);
    }
  }
  throw new Error(`${selector} 规则块没有闭合`);
}

/** 只收顶层声明的 --sc-* 名字（嵌套块里的不算主题 token）。 */
function scTokens(body: string): ReadonlySet<string> {
  return new Set(
    [...body.matchAll(/^\s{2}(--sc-[a-z0-9-]+):/gm)].map((m) => m[1] as string),
  );
}

const darkTokens = scTokens(ruleBody(":root"));
const lightTokens = scTokens(ruleBody(':root[data-theme="light"]'));

describe("Signal Console 主题 token", () => {
  it("深色块定义了完整的一套 --sc-*", () => {
    // 不是为了钉死数量，而是为了让「选择器写错、匹配到空块」这种情况立刻暴露：
    // 空集合会让下面那条对位断言无条件通过。
    expect(darkTokens.size).toBeGreaterThan(30);
  });

  it("每个深色 token 都有浅色对位", () => {
    // 漏掉一个的后果不是报错，是那个角色在浅色主题下继续用深色值——一条深色
    // 分隔线、一块深色底、一个看不见的滚动条。全都不会有别的测试发现。
    const missing = [...darkTokens].filter((t) => !lightTokens.has(t));
    expect(missing, `浅色主题缺少这些 token 的对位值`).toEqual([]);
  });

  it("浅色块没有多出深色主题没有的 token", () => {
    // 反向也要拦：只在浅色里定义的变量，深色下会解析失败并静默落到初始值
    // （多数情况是完全透明），症状同样是「只有深色下才坏」。
    const extra = [...lightTokens].filter((t) => !darkTokens.has(t));
    expect(extra, `这些 token 只在浅色主题里定义`).toEqual([]);
  });

  it("两套主题给出不同的色值", () => {
    // 把浅色块整块复制成深色值也能让上面三条全绿。这条要求至少绝大多数角色
    // 真的换了值，挡住「对位齐了但其实没换色」。
    const valueOf = (body: string, token: string) =>
      body.match(new RegExp(`^\\s{2}${token}:\\s*([^;]+);`, "m"))?.[1]?.trim();
    const darkBody = ruleBody(":root");
    const lightBody = ruleBody(':root[data-theme="light"]');
    const identical = [...darkTokens].filter(
      (t) => valueOf(darkBody, t) === valueOf(lightBody, t),
    );
    // 只有品牌本体是刻意两套共用的：那条渐变，以及压在渐变按钮上的墨绿黑
    // （对渐变两端分别是 10.9:1 和 9.6:1，换到浅色页面上依然成立）。
    // 见 globals.css 里对应的注释。除这两个以外不该有别的。
    expect([...identical].sort()).toEqual([
      "--sc-gradient-brand",
      "--sc-on-accent",
    ]);
  });

  it("Tailwind 主题变量只做映射，不写字面色值", () => {
    // @theme inline 会把声明的值内联进 utility。只要这里出现一个 hex，那条
    // utility 就永远是那个颜色，主题切换对它无效——而且切换后其它元素都变了，
    // 只有它没变，排查起来极慢。
    const themeBlock = ruleBody("@theme inline");
    const literals = [
      ...themeBlock.matchAll(
        /^\s{2}(--color-[a-z0-9-]+):\s*(#[0-9a-f]{3,8}|rgba?\()/gim,
      ),
    ];
    expect(literals.map((m) => m[1])).toEqual([]);
  });
});

/**
 * 允许保留字面色值的地方，每一条都要说得出理由。
 */
const HARDCODED_COLOR_ALLOWLIST = new Map<string, string>([
  // 邮件 HTML 走的是收件端渲染器，读不到本站样式表，只能内联绝对色值。
  ["lib/email.ts", "邮件 HTML 不经过本站 CSS"],
  // 短链兜底页是一份自带 <style> 的独立 HTML 响应，同样在 token 层之外；
  // 它固定深色，与站点默认主题一致。
  ["app/go/[code]/route.ts", "独立 HTML 响应，不引入 globals.css"],
  // 打印样式：纸是白的，这与屏幕主题无关。
  ["components/ui/limitation-hint.tsx", "print: 变体，目标介质是纸"],
]);

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, acc);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

describe("组件层不得写死颜色", () => {
  const scanned = sourceFiles(SRC_ROOT).map((file) => ({
    rel: file.slice(SRC_ROOT.length),
    body: readFileSync(file, "utf8"),
  }));

  it("扫到了整棵源码树", () => {
    // 一条空扫描会让下面那条断言无条件通过。用豁免名单当探针：这三个文件是
    // 已知含字面色值的，扫不到它们就说明路径拼错了、整条护栏是摆设。
    const seen = new Set(scanned.map((f) => f.rel));
    for (const allowed of HARDCODED_COLOR_ALLOWLIST.keys()) {
      expect(seen, `豁免名单里的 ${allowed} 没被扫到`).toContain(allowed);
    }
    expect(scanned.length).toBeGreaterThan(100);
  });

  const offenders = scanned
    .filter(({ rel }) => !HARDCODED_COLOR_ALLOWLIST.has(rel))
    .flatMap(({ rel, body }) => {
      const hits = [
        ...body.matchAll(/#[0-9a-fA-F]{6}\b/g),
        // 白/黑的半透明遮罩：在深色底上是「提亮」，搬到浅色底上等于没画。
        ...body.matchAll(/\b(?:bg|text|border)-(?:white|black)(?:\/\S+)?/g),
        ...body.matchAll(/rgba?\(\s*\d/g),
      ];
      return hits.map((h) => `${rel}: ${h[0]}`);
    });

  it("没有裸 hex / 裸 rgba / bg-white 遮罩", () => {
    // 这条拦的是「新写的组件在深色下看着没问题就合了」。颜色一旦写进组件，
    // 浅色主题就再也管不到它。
    expect(offenders).toEqual([]);
  });
});

describe("首屏无闪脚本", () => {
  it("用的是 lib/theme 里的键名和属性名", () => {
    // 脚本是手写的字符串，最容易的错法是改了常量却忘了改脚本，症状是刷新后
    // 主题丢失——而这在开发时几乎注意不到（每次都是默认主题看着也正常）。
    expect(THEME_INIT_SCRIPT).toContain(JSON.stringify(THEME_STORAGE_KEY));
    expect(THEME_INIT_SCRIPT).toContain(JSON.stringify(THEME_ATTRIBUTE));
  });

  it("包住 localStorage 访问", () => {
    // Safari 无痕下读 localStorage 直接抛。这段是页面第一个执行的脚本，
    // 它抛了，后面所有 JS 都不再执行。
    expect(THEME_INIT_SCRIPT).toMatch(/try\{/);
    expect(THEME_INIT_SCRIPT).toMatch(/catch/);
  });

  it("被 layout 注入在 <head> 里", () => {
    const layout = readFileSync(
      fileURLToPath(new URL("./[locale]/layout.tsx", import.meta.url)),
      "utf8",
    );
    expect(layout).toContain("THEME_INIT_SCRIPT");
    // 属性在客户端才写上去，服务端 HTML 上没有它——没有这个开关 React 会报
    // hydration 不匹配。
    expect(layout).toContain("suppressHydrationWarning");
  });

  it("默认主题就是 CSS 里 :root 的那一套", () => {
    // 默认值改了就必须同时改 globals.css 的默认块，否则首帧和脚本各说各话。
    expect(DEFAULT_THEME).toBe("dark");
    expect(css).toContain("color-scheme: dark");
  });
});
