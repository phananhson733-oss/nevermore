// @input  -- Daily Briefing route source and its shared connected-content contract
// @output -- request-bound metadata, JSON-LD, and scoped next-intl boundary guards
// @pos    -- server-page contract for both locale variants of the Daily Briefing

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("Daily Search Briefing page contract", () => {
  it("is request-bound and uses Next 16 async params", () => {
    expect(SOURCE).toContain('export const dynamic = "force-dynamic"');
    expect(SOURCE).toContain("params: Promise<{ locale: string }>");
    expect(SOURCE).toContain("const { locale } = await params");
  });

  it("loads the grant and catalog concurrently", () => {
    expect(SOURCE).toContain("getMessages");
    expect(SOURCE).toMatch(
      /const \[session, messages\] = await Promise\.all\(\[\s*readTrafficDropSession\(\),\s*getMessages\(\),?\s*\]\)/,
    );
  });

  it("uses one connected-content object for metadata, canonical, and all JSON-LD", () => {
    expect(SOURCE).toContain("title: content.title");
    expect(SOURCE).toContain("description: content.description");
    expect(SOURCE).toContain("path: content.path");
    expect(SOURCE).toContain("const canonical = localeUrl(locale, content.path)");
    expect(SOURCE).toContain("name={content.title}");
    expect(SOURCE).toContain("description={content.description}");
    expect(SOURCE).toContain("featureList={content.outputs.map");
    expect(SOURCE).toContain("<HowToJsonLd name={content.workflowTitle}");
    expect(SOURCE).toContain("faqs={content.faq.map");
    expect(SOURCE).toContain("{ name: content.title, url: canonical }");
  });

  it("sends only the Daily Briefing messages across the client boundary", () => {
    expect(SOURCE).toContain("NextIntlClientProvider");
    expect(SOURCE).toContain(
      "messages={{ tools: { dailyBriefing: messages.tools.dailyBriefing } }}",
    );
    expect(SOURCE).not.toContain("messages={messages}");
    expect(SOURCE).not.toContain("quickWins: messages.tools.quickWins");
  });
});
