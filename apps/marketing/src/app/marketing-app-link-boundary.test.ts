import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import en from "../i18n/messages/en.json" with { type: "json" };
import zh from "../i18n/messages/zh.json" with { type: "json" };

const OWNED_BLOG_ROOT = fileURLToPath(new URL("../../content/blog", import.meta.url));
const OWNED_BLOG_EXCLUSIONS = new Set([
  "9-best-marketing-attribution-tools-for-saas-in-2026.md",
  "ai-marketing-automation-for-saas.md",
  "best-ai-marketing-and-cmo-tools-for-saas-in-2026.md",
  "gengrowth-vs-blaze.md",
  "gengrowth-vs-cometly.md",
  "gengrowth-vs-improvado.md",
  "gengrowth-vs-okara.md",
  "astrologywiki-case-study.md",
]);

const FORBIDDEN_CTA_PATTERNS = [
  /\[Start(?: a| your)? free GenGrowth trial]/,
  /\[Book a free GenGrowth consultation]/,
  /\[Start your free GenGrowth trial at \[https:\/\/app\.gengrowth\.ai\/]\(https:\/\/app\.gengrowth\.ai\/\)\./,
];

function ownedBlogFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      results.push(...ownedBlogFiles(path));
      continue;
    }
    if (entry.endsWith(".md") && !OWNED_BLOG_EXCLUSIONS.has(entry)) {
      results.push(path);
    }
  }
  return results.sort();
}

describe("marketing app-link boundary", () => {
  it("keeps the Google sign-in fallback copy on the marketing waitlist", () => {
    expect(en.auth.continueOnApp).toMatch(/waitlist/i);
    expect(en.auth.continueOnApp).not.toContain("app.gengrowth.ai");
    expect(zh.auth.continueOnApp).toMatch(/候补|通知/);
    expect(zh.auth.continueOnApp).not.toContain("app.gengrowth.ai");
  });

  it("does not promise an open product in dormant comparison copy", () => {
    expect(en.compare.cta).toMatch(/waitlist/i);
    expect(en.compare.cta).not.toMatch(/free|trial/i);
    expect(zh.compare.cta).toMatch(/候补/);
    expect(zh.compare.cta).not.toMatch(/免费|试用/);
  });

  it("keeps owned marketing blog CTAs off app.gengrowth.ai and out of free-trial wording", () => {
    const files = ownedBlogFiles(OWNED_BLOG_ROOT);
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toContain("https://app.gengrowth.ai/");
      for (const pattern of FORBIDDEN_CTA_PATTERNS) {
        expect(source, `${file} matches ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
