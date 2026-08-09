import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  new URL("./_measurement-results.tsx", import.meta.url),
  "utf8",
);
const SUMMARY_SOURCE = readFileSync(
  new URL("./_results-summary.tsx", import.meta.url),
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

  it("implements the Artifact tab contract with roving keyboard focus", () => {
    expect(SOURCE).toContain('role="tablist"');
    expect(SOURCE).toContain('role="tab"');
    expect(SOURCE).toContain('role="tabpanel"');
    expect(SOURCE).toContain("aria-selected={active}");
    expect(SOURCE).toContain("tabIndex={active ? 0 : -1}");
    for (const key of [
      "ArrowRight",
      "ArrowDown",
      "ArrowLeft",
      "ArrowUp",
      "Home",
      "End",
    ]) {
      expect(SOURCE).toContain(`event.key === "${key}"`);
    }
  });

  it("keeps timeline column headings directly below the timeline h2", () => {
    expect(SUMMARY_SOURCE).toContain(
      '<h3>{tSummary("actionTimelineTitle")}</h3>',
    );
    expect(SUMMARY_SOURCE).toContain(
      '<h3>{tSummary("resultTimelineTitle")}</h3>',
    );
    expect(SUMMARY_SOURCE).not.toContain("<h4>");
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
    expect(CSS).toMatch(/\.heroLead\s*\{[\s\S]*?font-size:\s*17px;/u);
    expect(CSS).toMatch(
      /@media \(max-width:\s*760px\)[\s\S]*?\.heroLead\s*\{[\s\S]*?font-size:\s*16px;/u,
    );
  });
});
