import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const globals = readFileSync(
  new URL("../../globals.css", import.meta.url),
  "utf8",
);

const pageTitleSources = [
  new URL("../../new-project/page.tsx", import.meta.url),
  new URL("./overview/_overview.tsx", import.meta.url),
  new URL("./growth-map/_growth-map.tsx", import.meta.url),
  new URL("./studio/_studio.tsx", import.meta.url),
  new URL("./results/_results.tsx", import.meta.url),
  new URL("./sources/_sources.tsx", import.meta.url),
  new URL("./setup-sources/_setup-sources.tsx", import.meta.url),
  new URL("./context/_context-form.tsx", import.meta.url),
  new URL("./context/_product-profile.tsx", import.meta.url),
  new URL("./diagnosis/_diagnosis.tsx", import.meta.url),
  new URL("./plan/_plan.tsx", import.meta.url),
  new URL("./settings/_settings.tsx", import.meta.url),
] as const;

describe("shared customer page-title typography", () => {
  it("marks every customer-facing page heading with the shared contract", () => {
    for (const sourceUrl of pageTitleSources) {
      const source = readFileSync(sourceUrl, "utf8");
      expect(source, sourceUrl.pathname).toContain('data-app-page-title=""');
    }
  });

  it("caps display size and lets headings wrap naturally", () => {
    const rule = globals.match(
      /\[data-app-page-title\]\s*\{(?<declarations>[^}]+)\}/,
    )?.groups?.declarations;

    expect(rule).toBeDefined();
    expect(rule).toContain("font-size: clamp(32px, 3vw, 48px) !important");
    expect(rule).toContain("max-inline-size: min(100%, 30ch) !important");
    expect(rule).toContain("text-wrap: pretty !important");
    expect(rule).not.toContain("text-wrap: balance");
  });
});
