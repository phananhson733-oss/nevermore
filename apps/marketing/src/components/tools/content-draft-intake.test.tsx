// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { geoBriefFixture } from "@sf/public-tools/content-brief/geo-fixtures";
import { contentBriefFixture } from "@sf/public-tools/content-brief/fixtures";
import type { SharedContentBrief } from "@sf/public-tools/content-brief/geo-contract";
import { ContentDraftIntake } from "./content-draft-intake.tsx";
import type { DraftTranslate } from "./content-draft-results-shared.ts";

const t = ((key: string, values?: Record<string, unknown>) => `${key}${values ? JSON.stringify(values) : ""}`) as DraftTranslate;
let root: Root | null = null;
let host: HTMLDivElement;

async function render(brief: SharedContentBrief) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<ContentDraftIntake intake={{ phase: "loaded", brief, source: "upload" }} onSubmit={() => undefined} onUpload={() => undefined} onReplace={() => undefined} disabled={false} t={t} />));
  return host;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("GEO Draft intake evidence status", () => {
  it("labels a legacy factless outline as structure-only even when its old readiness says writable and no gaps", async () => {
    const brief = await geoBriefFixture();
    brief.fact_table = [];
    brief.evidence.facts = [];
    brief.draft_readiness = { writable: ["O1", "O2"], gaps: [] };
    const original = JSON.stringify(brief);
    const host = await render(brief);
    expect(host.querySelector('[data-geo-evidence-status="structure_only"]')?.textContent).toBe("intake.geoStructureOnly");
    expect(host.querySelector("[data-brief-writable]")).toBeNull();
    expect(host.textContent).not.toContain("intake.gaps");
    expect(host.textContent).toContain('intake.geoEvidenceSummary{"facts":0,"samples":2}');
    expect(host.textContent).toContain("intake.geoEvidenceCheck");
    expect(JSON.stringify(brief)).toBe(original);
  });

  it("uses real fact receipts and observed samples without guessing a Unicode brand is bad English", async () => {
    const brief = await geoBriefFixture();
    brief.keyword.primary = "What is 星图 and who is it for?";
    const host = await render(brief);
    expect(host.querySelector('[data-geo-evidence-status="limited"]')?.textContent).toBe("intake.geoLimited");
    expect(host.textContent).toContain('intake.geoEvidenceSummary{"facts":1,"samples":2}');
    expect(host.textContent).not.toContain("question_needs_review");
    expect(host.textContent).toContain("What is 星图 and who is it for?");
  });

  it("preserves SEO's existing readiness badges", async () => {
    const brief = contentBriefFixture({ connected: true });
    const host = await render(brief);
    expect(host.querySelector("[data-brief-writable]")?.textContent).toContain("intake.writable");
    expect(host.textContent).toContain("intake.gaps");
    expect(host.querySelector("[data-geo-evidence-status]")).toBeNull();
  });
});
