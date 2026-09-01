// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { geoBriefFixture } from "@sf/public-tools/content-brief/geo-fixtures";
import { GeoBriefSharedTool } from "./geo-brief-shared-tool.tsx";
import { writeGeoGapHandoff } from "../../lib/geo-tools/gap-handoff.ts";

vi.mock("next-intl", () => ({ useLocale: () => "en", useTranslations: () => (key: string) => key }));

const choice = {
  kbId: "11111111-1111-4111-8111-111111111111",
  snapshotId: "11111111-1111-4111-8111-111111111112",
  revision: 3, host: "fixture.example", frozenAt: "2026-08-31T00:00:00Z", contentHash: "a".repeat(64),
  promptsetRef: { schema: "marketing-geo-question-set.v1", registryVersion: "registry-3", hash: "b".repeat(64) },
  market: { country: "US", language: "en" }, properNames: [],
  evidenceSummary: { snapshotFacts: 0, contextFacts: null, usableFacts: 0, missingFacts: 0, profileAttached: false, contextAttached: false },
  questions: [
    { id: "q1", text: "Which tool fits a small team?", layer: "comparison", qualityIssues: [], roleId: "buyer", role: { id: "buyer", label: "Small-team buyer", segment: "Teams of three" } },
    { id: "q2", text: "How does it work?", layer: "problem", qualityIssues: [], roleId: null, role: null },
  ],
};
const pointer = { destination: "geo-brief" as const, kbId: choice.kbId, snapshotId: choice.snapshotId, runId: "11111111-1111-4111-8111-111111111113", questionId: "q1", gapId: "gap-q1", pageUrl: null, questionText: null };
const context = { gap: "D", runRef: { id: pointer.runId, fingerprint: "c".repeat(64) }, samples: [{ id: "S1", engine: "chatgpt", status: "answered", collectedAt: "2026-08-31T00:00:00Z" }] };
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.sessionStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function click(selector: string) { await act(async () => host.querySelector<HTMLElement>(selector)?.click()); }
async function select(selector: string, value: string) {
  await act(async () => { const input = host.querySelector<HTMLSelectElement>(selector); if (!input) throw new Error(`Missing ${selector}`); input.value = value; input.dispatchEvent(new Event("change", { bubbles: true })); });
}
function setupFetch(brief: Awaited<ReturnType<typeof geoBriefFixture>>, withContext = false) {
  const fetch = vi.fn(async (url: string, _init?: RequestInit) => url.endsWith("/load")
    ? Response.json({ data: { choices: [choice], runsPerDay: 20, providerConfigured: true, ...(withContext ? { context } : {}) } })
    : Response.json({ data: { brief } }));
  vi.stubGlobal("fetch", fetch); return fetch;
}

describe("GEO Brief input and result views", () => {
  it("shows frozen role and prompt-set context, keeps a result across view switches without another request", async () => {
    const fetch = setupFetch(await geoBriefFixture());
    await act(async () => root.render(<GeoBriefSharedTool />));
    await click("[data-load-geo-brief]");
    expect(host.querySelector("[data-geo-gap]")).toBeNull();
    expect(host.querySelector("[data-geo-role]")?.textContent).toContain("Small-team buyer");
    expect(host.textContent).toContain("registry-3");
    expect(host.querySelector<HTMLButtonElement>('[data-geo-view="result"]')?.disabled).toBe(true);
    await click("[data-run-geo-brief]");
    await vi.waitFor(() => expect(host.querySelector("[data-shared-geo-result]")).not.toBeNull());
    expect(host.querySelector('[data-geo-view="result"]')?.getAttribute("aria-pressed")).toBe("true");
    await click('[data-geo-view="input"]');
    expect(host.querySelector("[data-shared-geo-result]")).toBeNull();
    await click('[data-geo-view="result"]');
    expect(host.querySelector("[data-shared-geo-result]")).not.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("loads verified gap context before generation and discards it permanently when the question changes", async () => {
    expect(writeGeoGapHandoff(window.sessionStorage, pointer)).toBe(true);
    const fetch = setupFetch(await geoBriefFixture(), true);
    await act(async () => root.render(<GeoBriefSharedTool />));
    await vi.waitFor(() => expect(host.querySelector("[data-run-geo-brief]")).not.toBeNull());
    expect(host.querySelector("[data-geo-gap]")?.textContent).toContain("D");
    expect(host.querySelector("[data-geo-role]")?.textContent).toContain("Small-team buyer");
    expect(host.textContent).toContain("artifact.writingTaskHelp");
    expect(host.textContent).toContain(pointer.runId);
    expect(host.textContent).toContain(context.samples[0]!.id);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1] && (fetch.mock.calls[0][1] as RequestInit).body))).toMatchObject({ runId: pointer.runId, gapId: pointer.gapId, questionId: "q1" });
    await select("#geo-brief-question", "q2");
    expect(host.querySelector("[data-geo-gap]")).toBeNull();
    expect(host.querySelector("[data-geo-role]")).toBeNull();
    await select("#geo-brief-question", "q1");
    expect(host.querySelector("[data-geo-gap]")).toBeNull();
    expect(host.querySelector("[data-geo-role]")?.textContent).toContain("Small-team buyer");
    await click("[data-run-geo-brief]");
    const request = fetch.mock.calls.find(call => call[0].endsWith("/run"));
    expect(JSON.parse(String((request?.[1] as RequestInit)?.body))).toMatchObject({ runId: null, gapId: null, questionId: "q1" });
  });

  it("invalidates the result on manual selection and never presents a guessed role", async () => {
    setupFetch(await geoBriefFixture());
    await act(async () => root.render(<GeoBriefSharedTool />));
    await click("[data-load-geo-brief]"); await click("[data-run-geo-brief]");
    await vi.waitFor(() => expect(host.querySelector("[data-shared-geo-result]")).not.toBeNull());
    await click('[data-geo-view="input"]'); await select("#geo-brief-question", "");
    expect(host.querySelector<HTMLButtonElement>('[data-geo-view="result"]')?.disabled).toBe(true);
    expect(host.querySelector("[data-geo-role]")).toBeNull();
    expect(host.querySelector<HTMLButtonElement>("[data-run-geo-brief]")?.disabled).toBe(true);
  });
});
