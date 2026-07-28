import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  new URL("./_measurement-results.tsx", import.meta.url),
  "utf8",
);
const CSS = readFileSync(
  new URL("./results.module.css", import.meta.url),
  "utf8",
);

describe("Measurement Results customer surface", () => {
  it("keeps multiple URL selection semantic and keyboard operable", () => {
    expect(SOURCE).toContain("<aside");
    expect(SOURCE).toContain("aria-label={t(\"selectorLabel\")}");
    expect(SOURCE).toContain("aria-pressed={active}");
    expect(SOURCE).toContain("setSelectedId(window.measurementWindowId)");
  });

  it("renders before, after, and delta as real table columns", () => {
    expect(SOURCE).toContain('<th scope="col">{t("table.before")}</th>');
    expect(SOURCE).toContain('<th scope="col">{t("table.after")}</th>');
    expect(SOURCE).toContain('<th scope="col">{t("table.change")}</th>');
    expect(SOURCE).toContain('<th scope="row">{t(`metric.${metric.key}`)}</th>');
  });

  it("keeps external evidence links isolated and preserves the non-causal notice", () => {
    expect(SOURCE.match(/rel="noreferrer noopener"/gu)).toHaveLength(2);
    expect(SOURCE).toContain('t("nonCausal")');
    expect(SOURCE).not.toMatch(/lift|attribut(?:e|ed|ion)/iu);
  });

  it("provides responsive URL and metric layouts without shrinking text below customer reading size", () => {
    expect(CSS).toContain("@media (max-width: 1100px)");
    expect(CSS).toContain("@media (max-width: 760px)");
    expect(CSS).toMatch(
      /\.measurementHeader p\s*\{[\s\S]*?font-size:\s*15px;/u,
    );
  });
});
