// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GeoBriefSharedTool } from "./geo-brief-shared-tool.tsx";
vi.mock("next-intl", () => ({ useLocale: () => "en", useTranslations: () => (key: string) => key }));

const choice = {
  kbId: "fixture-kb", snapshotId: "fixture-snapshot", revision: 1, host: "fixture.example",
  frozenAt: "2026-08-31T00:00:00Z", contentHash: "a".repeat(64),
  promptsetRef: { schema: "marketing-geo-question-set.v1", registryVersion: "fixture", hash: "b".repeat(64) },
  market: { country: "US", language: "en" }, properNames: ["星图"],
  questions: [{ id: "q1", text: "Which tool fits?", layer: "discovery", roleId: null, role: null, qualityIssues: [] as string[] }],
};
const summary = { snapshotFacts: 0, contextFacts: null, usableFacts: 0, missingFacts: 0, profileAttached: false, contextAttached: false };
let root: Root; let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.sessionStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function load() {
  await act(async () => root.render(<GeoBriefSharedTool />));
  await act(async () => host.querySelector<HTMLElement>("[data-load-geo-brief]")?.click());
}
function mockRead(options: { failure?: boolean; issues?: string[] } = {}) {
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    const exact = JSON.parse(String(init?.body)).snapshotId !== undefined;
    if (exact && options.failure) return Response.json({ error: { code: "store_unavailable" } }, { status: 503 });
    return Response.json({ data: { choices: [{ ...choice,
      questions: [{ ...choice.questions[0], qualityIssues: options.issues ?? [] }],
      ...(exact ? { evidenceSummary: summary } : {}),
    }], providerConfigured: true, runsPerDay: 20 } });
  });
  vi.stubGlobal("fetch", fetch); return fetch;
}
it("reads exact evidence after the list and labels empty-fact generation as structure only", async () => {
  const fetch = mockRead(); await load();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(host.querySelector("[data-geo-input-evidence]")?.textContent).toContain("quality.inputNoFacts");
  expect(host.textContent).toContain("quality.inputNoProfile");
  expect(host.querySelector("[data-run-geo-brief]")?.textContent).toBe("quality.generateStructure");
  expect(host.querySelector("[data-geo-gap]")).toBeNull();
  expect(host.querySelector("[data-geo-role]")).toBeNull();
  expect(JSON.parse(host.querySelector("[data-geo-source-summary]")?.textContent ?? "null")).toEqual(summary);
});
it("keeps flawed old questions readable but blocks paid generation with a repair path", async () => {
  const fetch = mockRead({ issues: ["category_language_mismatch"] }); await load();
  expect(host.querySelector<HTMLButtonElement>("[data-run-geo-brief]")?.disabled).toBe(true);
  expect(host.textContent).toContain("quality.needsRevisionInput");
  expect(host.querySelector('a[href="/tools/geo-knowledge-base?repair=brief"]')).not.toBeNull();
  await act(async () => host.querySelector<HTMLElement>("[data-run-geo-brief]")?.click());
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("does not turn an exact context read failure into zero available facts", async () => {
  mockRead({ failure: true }); await load();
  expect(host.textContent).toContain("errors.store_unavailable");
  expect(host.querySelector("[data-geo-input-evidence]")).toBeNull();
  expect(host.querySelector("[data-geo-source-summary]")).toBeNull();
  expect(host.querySelector<HTMLButtonElement>("[data-run-geo-brief]")?.disabled).toBe(true);
});
