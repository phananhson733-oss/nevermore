// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { geoBriefFixture, geoDraftFixture } from "@sf/public-tools/content-brief/geo-fixtures";
import { parseDraftResult } from "@sf/public-tools/content-brief/parse-draft";
import { HandoffBar } from "./content-draft-handoff-bar";
import { DraftDoc } from "./content-draft-doc";
import { DraftGeoProvenance } from "./content-draft-results";
import { draftExportJson, draftMarkdown } from "./content-draft-markdown";
import type { DraftTranslate } from "./content-draft-results-shared";
import { TOOL_HANDOFF_KEY } from "../../lib/tools/tool-handoff";

const t = Object.assign((key: string) => key, { has: () => true, rich: (key: string) => key, markup: (key: string) => key, raw: (key: string) => key }) as DraftTranslate;
let root: Root | null = null;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; window.sessionStorage.clear(); });
afterEach(async () => { await act(async () => root?.unmount()); root = null; document.body.replaceChildren(); });

describe("GEO in the shared Draft result surface", () => {
  it("keeps source labels separate from sentence bytes and preserves exact JSON/Markdown", async () => {
    const brief = await geoBriefFixture();
    const result = await geoDraftFixture(brief);
    expect((await parseDraftResult(result, brief)).ok).toBe(true);
    expect(result.verify_before_publish).toEqual([]);
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root?.render(<><DraftDoc result={result} annotate locale="en" t={t} rerun={{ used: 0, running: null, disabled: false, writable: new Set(brief.draft_readiness.writable), onRerun: () => undefined }} /><DraftGeoProvenance result={result} /></>));
    expect(host.querySelectorAll('[data-sentence-sources="kb"]')).toHaveLength(2);
    expect(host.querySelectorAll("[data-source-label]")[0]?.textContent).toBe("[kb]");
    expect(host.querySelector("[data-geo-provenance]")?.textContent).toContain(brief.geo_origin.kb_ref.snapshot_id);
    const sentence = host.querySelector("[data-sentence]")?.textContent;
    expect(sentence).toBe("The fixture tool supports three seats.");
    expect(draftMarkdown(result, { failed: reason => reason, skipped: "skipped" })).toContain(sentence);
    expect(draftMarkdown(result, { failed: reason => reason, skipped: "skipped" })).toContain(brief.geo_origin.kb_ref.snapshot_id);
    expect(draftMarkdown(result, { failed: reason => reason, skipped: "skipped" })).toContain(`question_id: ${brief.geo_origin.question.id} · role: ${brief.geo_origin.role}`);
    expect(draftMarkdown(result, { failed: reason => reason, skipped: "skipped" })).toContain(brief.evidence.facts[0]!.observed_at);
    expect(JSON.parse(draftExportJson(result))).toEqual(result);
  });
  it("hands a GEO draft published URL to T2, without turning the brief fingerprint into a run ID", async () => {
    const brief = await geoBriefFixture(); const result = await geoDraftFixture(brief);
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root?.render(<HandoffBar result={result} brief={brief} locale="en" t={t} />));
    const input = host.querySelector("input");
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "https://fixture.example/published"); input?.dispatchEvent(new Event("input", { bubbles: true })); });
    const link = host.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/tools/page-citability-check");
    await act(async () => link?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    const handoff = JSON.parse(window.sessionStorage.getItem(TOOL_HANDOFF_KEY) ?? "null") as Record<string, unknown> | null;
    expect(handoff).toMatchObject({ source: "content-draft", destination: "page-citability-check", query: brief.keyword.primary, page: "https://fixture.example/published", evidenceId: brief.run.fingerprint });
    expect(handoff).not.toHaveProperty("runId");
  });
});
