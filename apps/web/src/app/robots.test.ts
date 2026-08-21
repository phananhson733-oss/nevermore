import { describe, expect, it } from "vitest";

import robots from "./robots.ts";

function ruleFor(userAgent: string) {
  const { rules } = robots();
  const list = Array.isArray(rules) ? rules : [rules];
  const rule = list.find((entry) => entry.userAgent === userAgent);
  if (!rule) {
    throw new Error(`no robots rule for ${userAgent}`);
  }
  return rule;
}

function disallowList(userAgent: string): string[] {
  const { disallow } = ruleFor(userAgent);
  if (disallow === undefined) {
    return [];
  }
  return Array.isArray(disallow) ? disallow : [disallow];
}

describe("app subdomain robots directives", () => {
  it("blocks build assets so they stop filling the crawled-not-indexed report", () => {
    // Googlebot discovers /_next/static/*.js|css|woff2 through the public
    // /login HTML. Those assets are not pages, so every one of them lands in
    // Search Console as "crawled - currently not indexed" and hides the real
    // content gaps behind hundreds of rows.
    expect(disallowList("*")).toContain("/_next/");
  });

  it("blocks the API surface from crawl budget", () => {
    expect(disallowList("*")).toContain("/api/");
  });

  it("still allows pages to be crawled so the noindex header is readable", () => {
    // A blanket "Disallow: /" would stop Googlebot from ever fetching /login
    // again, and a page it cannot fetch is a page whose X-Robots-Tag noindex
    // it can never see - already-indexed URLs would linger instead of dropping
    // out. Crawlable + noindex is the combination that actually deindexes.
    const rule = ruleFor("*");
    expect(rule.allow).toBe("/");
    expect(disallowList("*")).not.toContain("/");
  });
});
