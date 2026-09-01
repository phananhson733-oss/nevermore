// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { completePayloadV2 } from "../../lib/geo-tools/kb-v2.test-fixtures.ts";
import type { GeoKbPayloadV2 } from "../../lib/geo-tools/kb-v2-contract.ts";
import { GeoKbV2Fields } from "./geo-kb-v2-fields.tsx";

let host: HTMLDivElement, root: Root, current: GeoKbPayloadV2;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(payload = completePayloadV2()) {
  function Harness() { const [value, setValue] = useState(payload); current = value; return <GeoKbV2Fields payload={value} locale="en" onChange={setValue} />; }
  await act(async () => root.render(<Harness />));
}
async function fill(selector: string, value: string) { const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector); if (!input) throw new Error(selector); await act(async () => { Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); }
async function click(selector: string) { const button = host.querySelector<HTMLButtonElement>(selector); if (!button) throw new Error(selector); await act(async () => button.click()); }

it("edits real role detail, resets acceptance and retains original model lineage", async () => {
  const base = completePayloadV2(); const source = { kind: "model" as const, generationId: "11111111-1111-4111-8111-111111111112", itemId: "r1", evidenceRefs: ["profile:primaryIcp"] };
  await render({ ...base, roles: [{ ...base.roles[0]!, source }] });
  expect(host.textContent).toContain("Existing alternatives");
  await fill('[data-role-field="alternatives"]', "A local bookkeeper\nSpreadsheets");
  expect(current.roles[0]).toMatchObject({ alternatives: ["A local bookkeeper", "Spreadsheets"], review: "pending", source });
  await click('[data-review-role="accepted"]');
  expect(current.roles[0]?.review).toBe("accepted");
  expect(host.textContent).toContain(source.generationId);
});
it("does not call a filled fact verified and refuses acceptance without source/time", async () => {
  await render(); await fill('[data-fact-field="value"]', "Seven seats");
  expect(current.facts[0]).toMatchObject({ value: "Seven seats", review: "pending", supportRef: null });
  await fill('[data-fact-field="observedAt"]', "");
  expect(host.querySelector<HTMLButtonElement>('[data-review-fact="accepted"]')?.disabled).toBe(true);
  expect(host.textContent).toContain("not proof of crawl verification");
  await fill('[data-fact-field="observedAt"]', "2026-08-31T00:00:00.000Z");
  await click('[data-review-fact="accepted"]'); expect(current.facts[0]?.review).toBe("accepted");
});
it("keeps a non-default market and raw in-progress text without truncating it", async () => {
  const base = completePayloadV2(); await render({ ...base, market: { country: "CA", language: "en-ca" } });
  await fill('[data-base-field="officialName"]', "A".repeat(201) + " ");
  expect(current.officialName).toHaveLength(202); expect(current.market.country).toBe("CA");
});
