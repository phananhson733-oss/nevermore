// @input  — proxy()、NextRequest
// @output — 默认语言、Agents / Resources 与短链保留路径的路由回归测试
// @pos    — i18n / 短链边界测试，锁住 as-needed 前缀与一级 IA 路径
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy.ts";
import { LEGACY_EN_MIGRATION_ENTRIES } from "./lib/legacy-en-migration.ts";

const zhBrowser = { "accept-language": "zh-CN,zh;q=0.9,en;q=0.8" };

function request(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`https://gengrowth.ai${path}`, { headers });
}

/**
 * `localePrefix: "as-needed"` serves English at the bare path, which puts every
 * unprefixed URL within reach of next-intl's locale detection. With detection
 * on, a Chinese browser asking for /pricing was answered with a 307 to
 * /zh/pricing — English articles that have no Chinese translation landed on a
 * 404, and the language switcher's push back to "/" was bounced to /zh, which
 * reads as a dead button. The locale now comes from the URL alone.
 */
describe("proxy locale routing", () => {
  it("serves the unprefixed default locale to a zh browser instead of redirecting", () => {
    expect(proxy(request("/", zhBrowser)).status).toBe(200);
  });

  it("keeps an unprefixed inner page on its own URL for a zh browser", () => {
    const response = proxy(request("/pricing", zhBrowser));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("keeps an English-only article on its own URL for a zh browser", () => {
    const response = proxy(request("/blog/best-ai-seo-tools", zhBrowser));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("ignores a stale NEXT_LOCALE cookie on unprefixed paths", () => {
    const response = proxy(request("/pricing", { cookie: "NEXT_LOCALE=zh" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("still serves the prefixed zh path to an en browser", () => {
    const response = proxy(
      request("/zh/pricing", { "accept-language": "en-US,en;q=0.9" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("still 308s a legacy /en URL onto the bare path", () => {
    const response = proxy(request("/en/pricing"));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://gengrowth.ai/pricing",
    );
  });

  it("still 308s the legacy /en root onto /", () => {
    const response = proxy(request("/en"));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://gengrowth.ai/");
  });
});

/**
 * The loop guard keys off `x-next-intl-locale`, a header next-intl stamps on the
 * request when it rewrites to the internal locale route — but request headers
 * are client-controlled. Trusting it on its own let anyone turn any page into a
 * 404: `curl -H 'x-next-intl-locale: en' /pricing` skipped locale routing, and
 * the bare path matches no route under `app/[locale]`.
 *
 * next-intl only ever stamps it on a path it has already prefixed, so the header
 * is meaningful only on a `/{locale}/…` pathname. On an unprefixed path it can
 * only have come from the client, and is ignored.
 */
describe("proxy internal-rewrite guard", () => {
  it("ignores a forged locale header on an unprefixed path", () => {
    const response = proxy(request("/pricing", { "x-next-intl-locale": "en" }));
    expect(response.status).toBe(200);
    // Locale routing still ran: the response carries next-intl's rewrite rather
    // than the bare pass-through that produced the 404.
    expect(response.headers.get("x-middleware-rewrite")).toContain(
      "/en/pricing",
    );
  });

  it("ignores a forged locale header on the unprefixed root", () => {
    const response = proxy(request("/", { "x-next-intl-locale": "en" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-rewrite")).toContain("/en");
  });

  it("still lets next-intl's own rewrite target through untouched", () => {
    const response = proxy(
      request("/en/pricing", { "x-next-intl-locale": "en" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    // Passed through, not re-routed — re-running next-intl here is the loop.
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("still lets a prefixed non-default locale rewrite target through", () => {
    const response = proxy(
      request("/zh/pricing", { "x-next-intl-locale": "zh" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("proxy primary-directory route reservation", () => {
  it.each([
    "/agents",
    "/agents/seo",
    "/prompts",
    "/resources",
    "/skills",
    "/tools",
    "/waitlist",
  ])("keeps %s in locale routing instead of the short-link handler", (path) => {
    const response = proxy(request(path));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-rewrite")).toContain(
      `/en${path}`,
    );
    expect(response.headers.get("x-middleware-rewrite")).not.toContain("/go/");
  });
});

describe("proxy retired marketing routes", () => {
  const frozenGonePaths = LEGACY_EN_MIGRATION_ENTRIES.filter(
    (entry) => entry.disposition === "gone",
  ).map((entry) => entry.legacyPath);

  it.each(frozenGonePaths)(
    "matches the frozen B1 gone disposition for %s",
    (path) => {
      const response = proxy(request(path));
      expect(response.status).toBe(410);
      expect(response.headers.get("location")).toBeNull();
    },
  );

  it.each([
    "/about",
    "/en/about",
    "/zh/about",
    "/features",
    "/en/features",
    "/zh/features",
    "/templates",
    "/en/templates",
    "/zh/templates",
    "/glossary",
    "/en/glossary/backlink-profile",
    "/zh/glossary/bounce-rate",
    "/playbooks",
    "/en/playbooks",
    "/zh/playbooks",
    "/playbooks/onboarding-plan",
    "/en/playbooks/onboarding-plan",
    "/zh/playbooks/onboarding-plan",
    "/use-cases",
    "/en/use-cases",
    "/zh/use-cases",
    "/use-cases/customer-onboarding",
    "/en/use-cases/customer-onboarding",
    "/zh/use-cases/customer-onboarding",
    "/compare/okara-ai-cmo",
    "/en/compare/okara-ai-cmo",
    "/zh/compare/okara-ai-cmo",
    "/tools/ab-test-calculator",
    "/en/tools/ab-test-calculator",
    "/zh/tools/ab-test-calculator",
    "/tools/growth-roi-calculator",
    "/en/tools/growth-roi-calculator",
    "/zh/tools/growth-roi-calculator",
    "/blog/gengrowth-vs-blaze",
    "/en/blog/gengrowth-vs-cometly",
    "/blog/gengrowth-vs-okara",
  ])("answers 410 for retired route %s", (path) => {
    const response = proxy(request(path));
    expect(response.status).toBe(410);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it.each([
    ["/compare", "https://gengrowth.ai/blog#comparisons"],
    ["/en/compare", "https://gengrowth.ai/blog#comparisons"],
    ["/zh/compare", "https://gengrowth.ai/zh/blog#comparisons"],
    ["/tools/seo-audit", "https://gengrowth.ai/agents/seo"],
    ["/en/tools/seo-audit", "https://gengrowth.ai/agents/seo"],
    ["/zh/tools/seo-audit", "https://gengrowth.ai/zh/agents/seo"],
    ["/tools/internal-link-audit", "https://gengrowth.ai/agents/tech"],
    ["/en/tools/internal-link-audit", "https://gengrowth.ai/agents/tech"],
    ["/zh/tools/internal-link-audit", "https://gengrowth.ai/zh/agents/tech"],
  ] as const)("keeps exact semantic redirect for %s", (path, location) => {
    const response = proxy(request(path));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(location);
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it.each(["/", "/contact", "/privacy", "/terms", "/cookies", "/copyright"])(
    "does not retire live route %s",
    (path) => {
      const response = proxy(request(path));
      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
    },
  );
});
