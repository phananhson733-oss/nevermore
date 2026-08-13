import { describe, expect, it } from "vitest";

import { getRetiredMarketingRouteDisposition } from "./retired-marketing-routes";

describe("getRetiredMarketingRouteDisposition", () => {
  it.each([
    ["/about", { kind: "gone" }],
    ["/en/about", { kind: "gone" }],
    ["/zh/about", { kind: "gone" }],
    ["/glossary", { kind: "gone" }],
    ["/en/glossary/backlink-profile", { kind: "gone" }],
    ["/zh/glossary/bounce-rate", { kind: "gone" }],
    ["/playbooks", { kind: "gone" }],
    ["/playbooks/onboarding-plan", { kind: "gone" }],
    ["/compare/okara-ai-cmo", { kind: "gone" }],
    ["/blog/gengrowth-vs-blaze", { kind: "gone" }],
    ["/en/blog/gengrowth-vs-cometly", { kind: "gone" }],
    ["/blog/gengrowth-vs-okara", { kind: "gone" }],
    ["/tools/ab-test-calculator", { kind: "gone" }],
  ] as const)("marks %s as retired", (pathname, expected) => {
    expect(getRetiredMarketingRouteDisposition(pathname)).toEqual(expected);
  });

  it.each([
    ["/compare", { kind: "redirect", location: "/blog#comparisons" }],
    ["/en/compare", { kind: "redirect", location: "/blog#comparisons" }],
    ["/zh/compare", { kind: "redirect", location: "/zh/blog#comparisons" }],
    ["/tools/seo-audit", { kind: "redirect", location: "/agents/seo" }],
    ["/zh/tools/internal-link-audit", { kind: "redirect", location: "/zh/agents/tech" }],
  ] as const)("keeps exact redirect semantics for %s", (pathname, expected) => {
    expect(getRetiredMarketingRouteDisposition(pathname)).toEqual(expected);
  });

  it.each(["/", "/contact", "/privacy", "/terms"])(
    "leaves active route %s alone",
    (pathname) => {
      expect(getRetiredMarketingRouteDisposition(pathname)).toBeNull();
    },
  );
});
