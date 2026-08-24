// @input  -- source for the canonical public Internal Link Audit route
// @output -- proof that the route renders the dedicated tool with SEO metadata
// @pos    -- regression guard against retiring the public tool into an Agent redirect

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("Internal Link Audit page contract", () => {
  it("imports and renders the dedicated Internal Link Audit tool", () => {
    expect(SOURCE).toContain(
      'import { InternalLinkAuditTool } from "@/components/tools/internal-link-audit-tool"',
    );
    expect(SOURCE).toContain("<InternalLinkAuditTool locale={locale} />");
  });

  it("exposes localized route metadata", () => {
    expect(SOURCE).toContain("export async function generateMetadata");
    expect(SOURCE).toContain("getInternalLinkAuditContent(locale)");
    expect(SOURCE).toContain("generatePageMetadata({");
  });

  it("gives the final structured-data breadcrumb its canonical page URL", () => {
    expect(SOURCE).toContain(
      "{ name: content.breadcrumb, url: localeUrl(locale, PATH) }",
    );
  });

  it("uses the locale-aware Marketing waitlist for the bottom CTA", () => {
    expect(SOURCE).toContain('href={localePath(locale, "/waitlist")}');
    expect(SOURCE).not.toContain("siteConfig.appUrl");
    expect(SOURCE).not.toContain('import { siteConfig } from "@/config/site"');
  });

  it("links the related website health map directly to the SEO Agent", () => {
    expect(SOURCE).toContain('href={localePath(locale, "/agents/seo")}');
    expect(SOURCE).not.toContain(
      'href={localePath(locale, "/tools/seo-audit")}',
    );
  });

  it("does not redirect the canonical public tool to an Agent", () => {
    expect(SOURCE).not.toContain("permanentRedirect");
  });
});
