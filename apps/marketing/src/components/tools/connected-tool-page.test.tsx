// @input  -- each connected tool's content rendered without a session
// @output -- a failing test when the hero CTA stops starting the Google grant
// @pos    -- the guard on the first-screen connect entry for GSC-backed tools
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  getConnectedToolContent,
  type ConnectedTool,
} from "./connected-tool-content.ts";
import { ConnectedToolPage } from "./connected-tool-page.tsx";

function render(
  locale: string,
  tool: ConnectedTool,
  connected = false,
): string {
  return renderToStaticMarkup(
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

  it("leaves the non-GSC tool pointing at the product", () => {
    // hidden-keywords needs a keyword data source inside the product; a GSC
    // OAuth URL would request a grant that tool cannot use.
    const markup = render("en", "hidden-keywords");
    expect(markup).toContain('href="https://app.gengrowth.ai"');
    expect(markup).not.toContain("/api/auth/google/start");
  });

  it("renders no connect CTA once the visitor is connected", () => {
    const markup = render("en", "seo-quick-wins", true);
    expect(markup).not.toContain("/api/auth/google/start");
    expect(markup).not.toContain("https://app.gengrowth.ai");
  });

  // The aside addresses visitors who have not connected ("run first"); a
  // connected report carries its own exit card, so both at once would give
  // one page two exits (交办 5b was a move, not a copy).
  it("drops the run-first aside once the visitor is connected", () => {
    const before = render("en", "traffic-drop-diagnosis");
    expect(before).toContain("Public tools you can run first");

    const after = render("en", "traffic-drop-diagnosis", true);
    expect(after).not.toContain("Public tools you can run first");
  });
});
