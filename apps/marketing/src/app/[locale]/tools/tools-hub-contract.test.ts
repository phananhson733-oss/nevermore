// @input  -- active Tools hub source
// @output -- regression guard for six tool entries and their Agent execution boundary
// @pos    -- keeps the supporting-tools hub complete without reviving retired audit runners

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HUB_PAGE = fileURLToPath(new URL("./page.tsx", import.meta.url));

describe("Tools hub Agent boundary", () => {
  it("keeps all six tool entries in their established order", () => {
    const source = readFileSync(HUB_PAGE, "utf8");
    const slugs = [...source.matchAll(/slug: "([^"]+)"/g)].map(
      (match) => match[1],
    );

    expect(slugs).toEqual([
      "seo-quick-wins",
      "internal-link-audit",
      "traffic-drop-diagnosis",
      "on-page-seo-check",
      "seo-audit",
      "low-competition-keywords",
    ]);
    // Both entries open the same Agent; the technical one names a focus rather
    // than a second product.
    expect(source).toContain(
      'cta: { en: "Open the technical focus", zh: "打开技术焦点" }',
    );
    expect(source).toContain(
      'cta: { en: "Open SEO Agent", zh: "打开 SEO Agent" }',
    );
  });

  it("keeps the full-product CTA on the marketing waitlist rather than the app", () => {
    const source = readFileSync(HUB_PAGE, "utf8");

    expect(source).toContain('localePath(locale, "/waitlist")');
    expect(source).not.toContain("siteConfig.appUrl");
  });
});
