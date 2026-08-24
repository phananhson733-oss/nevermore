// @input  -- each connected tool's content rendered without a session
// @output -- CTA, return-path, and signed-out supporting-Agent assertions
// @pos    -- the guard on the first-screen connect entry for GSC-backed tools
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";
import {
  getConnectedToolContent,
  type ConnectedTool,
  type ConnectedToolContent,
} from "./connected-tool-content.ts";
import { ConnectedToolPage } from "./connected-tool-page.tsx";

/**
 * The page carries the free-during-testing notice, which reads its copy from
 * the catalog. On the site that context comes from the locale shell; here it
 * has to be supplied, or the notice would render the key path.
 */
function withIntl(locale: string, node: React.ReactNode): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "zh" ? zh : en}
    >
      {node}
    </NextIntlClientProvider>,
  );
}

function render(
  locale: string,
  tool: ConnectedTool,
  connected = false,
): string {
  return withIntl(
    locale,
    <ConnectedToolPage
      locale={locale}
      content={getConnectedToolContent(locale, tool)}
      connected={connected}
    />,
  );
}

/** The OAuth start URL as it appears in HTML, where `&` is `&amp;`. */
function oauthStart(next: string): string {
  return `href="/api/auth/google/start?scope=gsc&amp;next=${encodeURIComponent(
    next,
  )}"`;
}

describe("ConnectedToolPage hero CTA", () => {
  // The first screen is where connect intent is highest. A CTA that lands on
  // the app home drops both the requested scope and the way back to the tool.
  it("starts the Google grant for SEO Quick Wins and returns to the tool", () => {
    const markup = render("en", "seo-quick-wins");
    expect(markup).toContain(oauthStart("/tools/seo-quick-wins"));
    expect(markup).not.toContain("https://app.gengrowth.ai");
  });

  it("returns the Daily Briefing to its own localized route", () => {
    const enMarkup = render("en", "daily-search-briefing");
    const zhMarkup = render("zh", "daily-search-briefing");

    expect(enMarkup).toContain(oauthStart("/tools/daily-search-briefing"));
    expect(zhMarkup).toContain(oauthStart("/zh/tools/daily-search-briefing"));
    expect(enMarkup).not.toContain("https://app.gengrowth.ai");
    expect(zhMarkup).not.toContain("https://app.gengrowth.ai");
  });

  it("keeps the zh locale prefix in the return path", () => {
    const markup = render("zh", "seo-quick-wins");
    expect(markup).toContain(oauthStart("/zh/tools/seo-quick-wins"));
    expect(markup).not.toContain("https://app.gengrowth.ai");
  });

  it("returns Traffic Drop Diagnosis to its own page, not to Quick Wins", () => {
    const markup = render("en", "traffic-drop-diagnosis");
    expect(markup).toContain(oauthStart("/tools/traffic-drop-diagnosis"));
    expect(markup).not.toContain("https://app.gengrowth.ai");
  });

  it("starts the Google grant for the keyword map too", () => {
    // This used to assert the opposite, and was right to: the keyword map ran
    // inside the product against a keyword data source, so a GSC OAuth URL
    // would have requested a grant it could not use. It now runs on this page
    // and reads the visitor's own Search Console queries to decide which terms
    // their site already serves, so the product hand-off would strand them.
    const markup = render("en", "low-competition-keywords");
    expect(markup).toContain(oauthStart("/tools/low-competition-keywords"));
    expect(markup).not.toContain("https://app.gengrowth.ai");
  });

  it("sends a tool with no Google grant to the marketing waitlist", () => {
    // Every tool in the union is GSC-backed now, so the hand-off branch has no
    // live case and would rot unseen. Rendered from a synthetic path to keep
    // the branch exercised for whichever tool arrives next.
    const markup = withIntl(
      "en",
      <ConnectedToolPage
        locale="en"
        content={{
          ...getConnectedToolContent("en", "low-competition-keywords"),
          path: "/tools/not-a-google-tool" as ConnectedToolContent["path"],
        }}
      />,
    );
    expect(markup).toContain('href="/waitlist"');
    expect(markup).not.toContain("/api/auth/google/start");
  });

  it("renders no connect CTA once the visitor is connected", () => {
    const markup = render("en", "seo-quick-wins", true);
    expect(markup).not.toContain("/api/auth/google/start");
    expect(markup).not.toContain("https://app.gengrowth.ai");
  });

  // The aside addresses visitors who have not connected; a connected report
  // carries its own exit card, so both at once would give one page two exits.
  it("drops the supporting-Agent aside once the visitor is connected", () => {
    const before = render("en", "traffic-drop-diagnosis");
    expect(before).toContain("URL Agents to use next");
    expect(before).toContain("Account verification is required");

    const after = render("en", "traffic-drop-diagnosis", true);
    expect(after).not.toContain("URL Agents to use next");
  });
});
