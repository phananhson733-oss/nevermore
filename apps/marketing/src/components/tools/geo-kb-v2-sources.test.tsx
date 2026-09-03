// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { completePayloadV2, V2_KB_ID } from "../../lib/geo-tools/kb-v2.test-fixtures.ts";
import type { GeoKbSourceReportV2 } from "../../lib/geo-tools/kb-source-contract.ts";
import { GeoKbV2Sources } from "./geo-kb-v2-sources.tsx";

it("source receipt is only a proposal, explicit fact adoption remains pending, and conflicting identity is not adoptable", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const base = completePayloadV2(); let current = base;
  const receipt: GeoKbSourceReportV2 = { schemaVersion: "marketing-geo-kb-enrichment.v2", receiptId: "33333333-3333-4333-8333-333333333333", kbId: V2_KB_ID, targetHost: "example.com", draftVersion: 1, draftHash: "a".repeat(64), profileReference: null, createdAt: "2026-08-31T00:00:00.000Z", contentHash: "b".repeat(64),
    gsc: { status: "unavailable", reason: "not_connected", property: null, window: { startDate: "2026-06-01", endDate: "2026-08-29" }, queryCount: null, truncated: null, observedAt: null, queries: [] },
    facts: [{ evidenceId: "F1", key: "Seats", confirmed: false, source: "crawl", sourceUrl: "https://example.com/pricing", observedAt: "2026-08-31T00:00:00.000Z", bodyHash: "c".repeat(64), status: "available", reason: null, value: "3", excerpt: "The pricing page supports three seats." }],
    competitors: [{ evidenceId: "C1", domain: "rival.example", confirmed: false, source: "crawl", sourceUrl: "https://rival.example", observedAt: "2026-08-31T00:00:00.000Z", bodyHash: "d".repeat(64), signals: [], signalsTruncated: false, status: "conflict", reason: "identity_conflict", brandName: null, aliases: [], method: "conflicting_signals" }] };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  function Harness() { const [payload, setPayload] = useState(base); current = payload; return <GeoKbV2Sources receipt={receipt} baseline={base} payload={payload} stale={false} locale="en" onChange={setPayload} />; }
  try {
    await act(async () => root.render(<Harness />)); expect(current).toEqual(base);
    // Search Console gave nothing, and the panel says so without inventing a
    // count for it. The receipt id, the property, the window and the raw
    // queries describe how the refresh ran, and are not shown.
    expect(host.querySelector("[data-gsc-unavailable]")?.textContent).toContain("not_connected");
    expect(host.querySelector("[data-gsc-unavailable]")?.textContent).not.toMatch(/\b0\b/);
    expect(host.textContent).not.toContain(receipt.receiptId);
    expect(host.textContent).not.toContain(receipt.contentHash);
    expect(host.textContent).toContain("identity_conflict");
    expect(host.querySelector('[data-apply-competitor="C1"]')).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('[data-apply-fact="F1"]')?.click());
    expect(current.facts[0]).toMatchObject({ value: "3", review: "pending", supportRef: { receiptId: receipt.receiptId, evidenceId: "F1" } });
    expect(host.querySelector<HTMLButtonElement>('[data-apply-fact="F1"]')?.disabled).toBe(true);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
it("survives a partial adoption save but never overwrites a later saved fact claim or confirmed brand", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const base = completePayloadV2(), second = { ...base.facts[0]!, key: "Price", value: "$10", review: "pending" as const };
  let current = { ...base, facts: [base.facts[0]!, second] }, saved = current;
  const factCapture = { confirmed: false as const, source: "crawl" as const, sourceUrl: "https://example.com/pricing", observedAt: "2026-08-31T00:00:00.000Z", bodyHash: "c".repeat(64), status: "available" as const, reason: null };
  const receipt: GeoKbSourceReportV2 = { schemaVersion: "marketing-geo-kb-enrichment.v2", receiptId: "33333333-3333-4333-8333-333333333333", kbId: V2_KB_ID, targetHost: "example.com", draftVersion: 1, draftHash: "a".repeat(64), profileReference: null, createdAt: "2026-08-31T00:00:00.000Z", contentHash: "b".repeat(64),
    gsc: { status: "unavailable", reason: "not_connected", property: null, window: { startDate: "2026-06-01", endDate: "2026-08-29" }, queryCount: null, truncated: null, observedAt: null, queries: [] },
    facts: [{ ...factCapture, evidenceId: "F1", key: "Seats", value: "3", excerpt: "Three seats." }, { ...factCapture, evidenceId: "F2", key: "Price", value: "$10", excerpt: "Ten dollars." }],
    competitors: [{ ...factCapture, evidenceId: "C1", domain: "rival.example", sourceUrl: "https://rival.example", brandName: "Rival", aliases: ["Rival Analytics"], method: "json_ld", signals: [], signalsTruncated: false }] };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const render = () => root.render(<GeoKbV2Sources receipt={receipt} baseline={saved} payload={current} stale={false} locale="en" onChange={next => { current = { ...next, facts: [...next.facts] }; render(); }} />);
  try {
    await act(async () => render()); await act(async () => host.querySelector<HTMLButtonElement>('[data-apply-fact="F1"]')!.click()); saved = structuredClone(current); await act(async () => render());
    expect(host.querySelector<HTMLButtonElement>('[data-apply-fact="F2"]')!.disabled).toBe(false);
    current = { ...current, facts: [current.facts[0]!, { ...current.facts[1]!, value: "$99" }] }; saved = structuredClone(current); await act(async () => render());
    expect(host.querySelector<HTMLButtonElement>('[data-apply-fact="F2"]')!.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('[data-apply-competitor="C1"]')!.disabled).toBe(true);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
