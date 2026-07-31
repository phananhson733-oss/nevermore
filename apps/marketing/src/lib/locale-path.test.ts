// @input  — locale-path.ts
// @output — localePath()/localeUrl() 的 as-needed 前缀规则回归测试
// @pos    — 防止默认语言重新带上 /en 前缀（该前缀由 proxy.ts 以 308 重定向收敛）
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { describe, expect, it } from "vitest";
import { localePath, localeUrl, stripLocalePrefix } from "./locale-path";

describe("localePath", () => {
  it("serves the default locale without a prefix", () => {
    expect(localePath("en", "/pricing")).toBe("/pricing");
    expect(localePath("en", "/tools/seo-audit")).toBe("/tools/seo-audit");
  });

  it("keeps the prefix for non-default locales", () => {
    expect(localePath("zh", "/pricing")).toBe("/zh/pricing");
    expect(localePath("zh", "/tools/seo-audit")).toBe("/zh/tools/seo-audit");
  });

  it("resolves the locale home", () => {
    expect(localePath("en")).toBe("/");
    expect(localePath("en", "")).toBe("/");
    expect(localePath("en", "/")).toBe("/");
    expect(localePath("zh")).toBe("/zh");
    expect(localePath("zh", "/")).toBe("/zh");
  });

  it("never emits the legacy /en prefix that proxy.ts redirects away", () => {
    for (const path of ["", "/", "/pricing", "/blog/some-post"]) {
      expect(localePath("en", path).startsWith("/en")).toBe(false);
    }
  });
});

describe("stripLocalePrefix", () => {
  it("removes a prefixed locale segment", () => {
    expect(stripLocalePrefix("/zh/pricing")).toBe("/pricing");
    expect(stripLocalePrefix("/zh")).toBe("");
    expect(stripLocalePrefix("/en/pricing")).toBe("/pricing");
  });

  it("leaves unprefixed default-locale paths untouched", () => {
    expect(stripLocalePrefix("/pricing")).toBe("/pricing");
    expect(stripLocalePrefix("/")).toBe("/");
  });

  it("only strips whole segments", () => {
    expect(stripLocalePrefix("/enterprise")).toBe("/enterprise");
    expect(stripLocalePrefix("/zhuanti")).toBe("/zhuanti");
  });

  it("round-trips a page into the other locale", () => {
    expect(localePath("zh", stripLocalePrefix("/pricing"))).toBe("/zh/pricing");
    expect(localePath("en", stripLocalePrefix("/zh/pricing"))).toBe("/pricing");
    expect(localePath("zh", stripLocalePrefix("/"))).toBe("/zh");
    expect(localePath("en", stripLocalePrefix("/zh"))).toBe("/");
  });
});

describe("localeUrl", () => {
  it("builds absolute canonical URLs", () => {
    expect(localeUrl("en", "/pricing")).toBe("https://gengrowth.ai/pricing");
    expect(localeUrl("zh", "/pricing")).toBe("https://gengrowth.ai/zh/pricing");
    expect(localeUrl("en")).toBe("https://gengrowth.ai/");
    expect(localeUrl("zh")).toBe("https://gengrowth.ai/zh");
  });
});
