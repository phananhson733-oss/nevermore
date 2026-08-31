// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeoBriefSharedTool } from "./geo-brief-shared-tool.tsx";
import { SHARED_FROZEN } from "../../lib/geo-tools/brief-shared-fixtures.ts";
import { assembleSharedGeoBrief, sharedGeoBriefBasis } from "../../lib/geo-tools/brief-shared.ts";
import { CONTENT_BRIEF_HANDOFF_KEY } from "@sf/public-tools/content-brief/contract";
import { sharedGeoBriefMarkdown } from "../../lib/geo-tools/brief-shared-export.ts";
import { writeGeoGapHandoff } from "../../lib/geo-tools/gap-handoff.ts";
vi.mock("next-intl", () => ({ useLocale: () => "en", useTranslations: () => Object.assign((key: string, values?: unknown) => values ? `${key} ${JSON.stringify(values)}` : key, { has: () => true }) }));
let root: Root | null = null; const originalFetch = globalThis.fetch;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; window.sessionStorage.clear(); });
afterEach(async () => { await act(async () => root?.unmount()); root = null; document.body.replaceChildren(); globalThis.fetch = originalFetch; vi.restoreAllMocks(); });
async function click(host: Element, selector: string) { await act(async () => host.querySelector<HTMLElement>(selector)?.click()); }
describe("shared GEO Brief browser chain", () => {
  it("selects immutable snapshot identity when one KB has several frozen versions", async () => {
    const choices = [1, 2].map(revision => ({ kbId: "same-kb", snapshotId: `snapshot-${revision}`, revision, host: "fixture.example", frozenAt: SHARED_FROZEN.frozenAt, questions: [{ ...SHARED_FROZEN.questionSet.questions[0], id: `q${revision}`, text: `Frozen question ${revision}` }] }));
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/load")) return Response.json({ data: { choices, runsPerDay: 20, providerConfigured: true } });
      expect(JSON.parse(String(init?.body))).toMatchObject({ kbId: "same-kb", snapshotId: "snapshot-2", questionId: "q2", manualQuestion: null });
      return Response.json({ error: { code: "brief_unavailable" } }, { status: 503 });
    }); globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host); await act(async () => root?.render(<GeoBriefSharedTool />));
    await click(host, "[data-load-geo-brief]");
    const select = host.querySelector<HTMLSelectElement>("#geo-brief-version");
    await act(async () => { if (select) { select.value = "snapshot-2"; select.dispatchEvent(new Event("change", { bubbles: true })); } });
    await click(host, "[data-run-geo-brief]");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("uses selection IDs, renders Artifact sections, exports one result and stages the same Brief for Draft", async () => {
    const basis = sharedGeoBriefBasis({ frozen: SHARED_FROZEN, context: null, questionId: "q1", questionText: "", runEvidence: null, runId: "fixture-brief", now: "2026-08-31T00:00:01Z" });
    const brief = await assembleSharedGeoBrief(basis, { ok: true, outline: [{ id: "O1", h2: "Direct answer", h3: [], answers: basis.must_answer.items.map(item => item.id), provenance: { method: "model", derived_from: ["kb"] } }] });
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/load")) return Response.json({ data: { choices: [{ kbId: SHARED_FROZEN.kbId, snapshotId: SHARED_FROZEN.snapshotId, revision: 1, host: "fixture.example", frozenAt: SHARED_FROZEN.frozenAt, questions: SHARED_FROZEN.questionSet.questions }], runsPerDay: 20, providerConfigured: true } });
      expect(JSON.parse(String(init?.body))).toEqual({ schema: brief.schema, kbId: SHARED_FROZEN.kbId, snapshotId: SHARED_FROZEN.snapshotId, questionId: "q1", manualQuestion: null, runId: null, gapId: null });
      return Response.json({ data: { brief } });
    }); globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host); await act(async () => root?.render(<GeoBriefSharedTool />));
    await click(host, "[data-load-geo-brief]"); await click(host, "[data-run-geo-brief]");
    await vi.waitFor(() => expect(host.querySelector("[data-shared-geo-result]")).not.toBeNull());
    expect(Array.from(host.querySelectorAll("[data-brief-section]")).map(node => node.getAttribute("data-brief-section"))).toEqual(["geo_origin", "lead_answer", "must_answer", "fact_table", "outline", "fields", "internal_links"]);
    expect(host.textContent).toContain("Three seats"); expect(host.textContent).toContain("notPublished");
    expect(host.querySelector("[data-geo-market-language]")?.textContent).toBe("market: US · language: en");
    const markdown = sharedGeoBriefMarkdown(brief); expect(markdown).toContain(SHARED_FROZEN.snapshotId); expect(markdown).toContain("2026-08-30T00:00:00Z"); expect(markdown).toContain("market: US · language: en");
    await act(async () => host.querySelector("[data-geo-to-draft]")?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    const stored = JSON.parse(window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY) ?? "null"); expect(stored.brief).toEqual(brief);
    await click(host, "[data-copy-geo-brief]"); expect(host.textContent).toContain("actions.copyFailed");
  });
  it("consumes an owned-gap selector once, loads the exact archived version, and sends only its IDs", async () => {
    const frozen = { ...SHARED_FROZEN, kbId: "11111111-1111-4111-8111-111111111111", snapshotId: "11111111-1111-4111-8111-111111111112" };
    const pointer = { destination: "geo-brief" as const, kbId: frozen.kbId, snapshotId: frozen.snapshotId, runId: "11111111-1111-4111-8111-111111111113", questionId: "q1", gapId: "gap-q1", pageUrl: null, questionText: null };
    expect(writeGeoGapHandoff(window.sessionStorage, pointer)).toBe(true);
    const basis = sharedGeoBriefBasis({ frozen, context: null, questionId: "q1", questionText: "", runEvidence: { runId: pointer.runId, fingerprint: "e".repeat(64), gap: "D", siteIndex: [], samples: [{ id: "S1", run_id: pointer.runId, question_id: "q1", engine: "chatgpt", collected_at: "2026-08-31T00:00:00Z", status: "answered", search_enabled: null, excerpt: "Actual fixture answer", topics: ["Pricing"] }] }, runId: "fixture-brief", now: "2026-08-31T00:00:01Z" });
    const brief = await assembleSharedGeoBrief(basis, { ok: true, outline: [{ id: "O1", h2: "Direct answer", h3: [], answers: basis.must_answer.items.map(item => item.id), provenance: { method: "model", derived_from: ["kb", "ai_sample"] } }] });
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/load")) { expect(JSON.parse(String(init?.body))).toEqual({ schema: brief.schema, kbId: frozen.kbId, snapshotId: frozen.snapshotId, questionId: pointer.questionId, runId: pointer.runId, gapId: pointer.gapId }); return Response.json({ data: { context: { gap: "D", runRef: { id: pointer.runId, fingerprint: "e".repeat(64) }, samples: brief.evidence.samples.map(sample => ({ id: sample.id, engine: sample.engine, status: sample.status, collectedAt: sample.collected_at })) }, choices: [{ kbId: frozen.kbId, snapshotId: frozen.snapshotId, revision: 1, host: "fixture.example", frozenAt: frozen.frozenAt, questions: frozen.questionSet.questions }], runsPerDay: 20, providerConfigured: true } }); }
      expect(JSON.parse(String(init?.body))).toEqual({ schema: brief.schema, kbId: frozen.kbId, snapshotId: frozen.snapshotId, questionId: "q1", manualQuestion: null, runId: pointer.runId, gapId: pointer.gapId });
      return Response.json({ data: { brief } });
    }); globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host); await act(async () => root?.render(<GeoBriefSharedTool />));
    await vi.waitFor(() => expect(host.querySelector("[data-run-geo-brief]")).not.toBeNull());
    await click(host, "[data-run-geo-brief]");
    await vi.waitFor(() => expect(host.querySelector("[data-shared-geo-result]")).not.toBeNull());
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain(pointer.runId);
  });
});
