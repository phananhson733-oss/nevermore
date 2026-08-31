// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../i18n/messages/en.json";
import { emptyGeoKbPayload } from "../../lib/geo-tools/kb-contract.ts";
import { extractCompetitorIdentity, finalizeGeoEnrichmentReport } from "../../lib/geo-tools/kb-enrichment.ts";
import { GeoKbEnrichment } from "./geo-kb-enrichment.tsx";

const KB = "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6";
const AT = "2026-08-31T00:00:00.000Z";
const payload = { ...emptyGeoKbPayload("https://example.com"), competitors: [{ domain: "rival.example", brandName: "", confirmed: false }] };
const report = finalizeGeoEnrichmentReport({ schemaVersion: "marketing-geo-kb-enrichment.v1", receiptId: "b920cd2e-c645-4df6-a80e-4f434dd09266", kbId: KB, targetHost: "example.com", draftVersion: 4, draftHash: "a".repeat(64), profileReference: null, createdAt: AT,
  competitors: [extractCompetitorIdentity("rival.example", { kind: "ok", url: "https://rival.example/", observedAt: AT, body: '<meta property="og:site_name" content="Actual Rival">' }, "C1")], facts: [],
  gsc: { status: "unavailable", reason: "not_connected", property: null, window: { startDate: "2026-05-31", endDate: "2026-08-28" }, queryCount: null, truncated: null, observedAt: null, roles: [] }, skippedLayers: ["problem", "evaluation"],
});
const M = { title: "Source evidence", body: "Read sources", action: "Read source evidence", loading: "Reading source evidence…", saveFirst: "Save this draft first.", review: "Review first", captured: "Captured {time}", window: "GSC {start} to {end}", queryCount: "{count} queries", truncated: "Bounded read", gscUnavailable: "GSC unavailable: {reason}. Problem and evaluation layers skipped.", noRoles: "No roles invented", competitors: "Competitors", roles: "GSC roles", facts: "Fact checks", unavailable: "Unavailable: {reason}", apply: "Use suggestion", used: "Applied", conflict: "Your edit was preserved.", stale: "Earlier draft", confirmCompetitor: "Confirm names separately", source: "Source: {url}", roleQueries: "{count} queries", error: "Could not read evidence.", identityMismatch: "Wrong connected account.", aliases: "Aliases: {aliases}", reasons: { not_connected: "Not connected" } };
let root: Root;
let container: HTMLDivElement;
const originalFetch = globalThis.fetch;
const apply = vi.fn();
async function render(current = payload, dirty = false): Promise<void> {
  await act(async () => root.render(<NextIntlClientProvider locale="en" messages={{ tools: { geoKnowledgeBase: { ...en.tools.geoKnowledgeBase, enrichment: M } } }}><GeoKbEnrichment kbId={KB} targetHost="example.com" draftVersion={4} payload={current} dirty={dirty} onApply={apply} /></NextIntlClientProvider>));
}
function button(label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((entry) => entry.textContent === label);
  if (button === undefined) throw new Error(`button missing: ${label}`);
  return button;
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  apply.mockReset(); globalThis.fetch = vi.fn(async () => Response.json({ data: report }));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); globalThis.fetch = originalFetch; });

describe("review-only KB source evidence", () => {
  it("does no automatic network work and applies only an explicitly reviewed candidate", async () => {
    await render(); expect(fetch).not.toHaveBeenCalled();
    await act(async () => button(M.action).click());
    expect(fetch).toHaveBeenCalledWith("/api/tools/geo-knowledge-base/enrich", expect.objectContaining({ method: "POST", body: JSON.stringify({ kbId: KB }) }));
    expect(apply).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Actual Rival");
    expect(container.textContent).toContain("https://rival.example/");
    expect(container.textContent).toContain("Problem and evaluation layers skipped");
    await act(async () => button(M.apply).click());
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ competitors: [{ domain: "rival.example", brandName: "Actual Rival", aliases: [], confirmed: false }] }));
  });
  it("cannot start from an unsaved draft and preserves a changed field when a request returns", async () => {
    await render(payload, true);
    expect(button(M.action).disabled).toBe(true);
    expect(container.textContent).toContain(M.saveFirst);
    await render();
    await act(async () => button(M.action).click());
    await render({ ...payload, competitors: [{ domain: "rival.example", brandName: "Unsaved name", confirmed: false }] }, true);
    await act(async () => button(M.apply).click());
    expect(apply).not.toHaveBeenCalled();
    expect(container.textContent).toContain(M.conflict);
  });
  it("does not render malformed or foreign receipt data", async () => {
    globalThis.fetch = vi.fn(async () => Response.json({ data: { ...report, kbId: "a53f4ddb-7cd6-42da-af53-88cc68b41987" } }));
    await render(); await act(async () => button(M.action).click());
    expect(container.textContent).toContain(M.error);
    expect(container.textContent).not.toContain("Actual Rival");
  });
});
