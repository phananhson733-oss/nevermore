// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { completePayloadV2 } from "../../lib/geo-tools/kb-v2.test-fixtures.ts";
import { geoFactV2Schema, type GeoKbPayloadV2 } from "../../lib/geo-tools/kb-v2-contract.ts";
import { GeoKbV2Fields } from "./geo-kb-v2-fields.tsx";
import { geoKbV2EditorCopy } from "./geo-kb-v2-editor-copy.ts";

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
  // A list is edited a row at a time now, as it is in the Profile editor: one
  // input per entry with its own remove control, and one add control below.
  const list = () => host.querySelector('[data-role-field="alternatives"]')!;
  const rows = () => [...list().querySelectorAll("input")];
  expect(rows()).toHaveLength(base.roles[0]!.alternatives.length);
  await fill('[data-role-field="alternatives"] input', "A local bookkeeper");
  expect(current.roles[0]).toMatchObject({ alternatives: ["A local bookkeeper"], review: "pending", source });
  const buttons = () => [...list().querySelectorAll("button")];
  await act(async () => buttons()[buttons().length - 1]!.click());
  expect(current.roles[0]?.alternatives).toEqual(["A local bookkeeper", ""]);
  await act(async () => buttons()[0]!.click());
  expect(current.roles[0]?.alternatives).toEqual([""]);
  expect(rows()).toHaveLength(1);
  // A blank entry is not acceptable, so it is refilled before acceptance.
  expect(host.querySelector<HTMLButtonElement>('[data-review-role="accepted"]')?.disabled).toBe(true);
  await fill('[data-role-field="alternatives"] input', "Spreadsheets");
  await click('[data-review-role="accepted"]');
  expect(current.roles[0]?.review).toBe("accepted");
  // The lineage is retained in the value, asserted above. It is no longer
  // displayed: which generation produced a role is how it was made, not
  // whether it fits the product.
  expect(current.roles[0]?.source).toEqual(source);
  expect(host.textContent).not.toContain(source.generationId);
});
it("reads a role out instead of asking for it back, with hand editing one disclosure away", async () => {
  await render();
  const card = host.querySelector('[data-edit-role="r1"]')!;
  // The values are legible without opening anything.
  expect(card.textContent).toContain("Finance teams");
  expect(card.textContent).toContain("late invoices");
  // And every control that could change them sits inside a closed disclosure,
  // so seven fields per role are not the first thing on screen.
  const controls = [...card.querySelectorAll("input, textarea, select")];
  expect(controls.length).toBeGreaterThan(0);
  expect(controls.every(control => control.closest("details")?.open === false)).toBe(true);
});

it("does not call a filled fact verified and refuses acceptance without source/time", async () => {
  await render(); await fill('[data-fact-field="value"]', "Seven seats");
  expect(current.facts[0]).toMatchObject({ value: "Seven seats", review: "pending", supportRef: null });
  await fill('[data-fact-field="observedAt"]', "");
  expect(host.querySelector<HTMLButtonElement>('[data-review-fact="accepted"]')?.disabled).toBe(true);
  // The panel still says filling a value in is not verification -- in its own
  // words now, not the frozen view's two-column framing.
  expect(host.textContent).toContain(geoKbV2EditorCopy("en").factsHelp);
  expect(geoKbV2EditorCopy("en").factsHelp).toMatch(/not crawl verification/u);
  await fill('[data-fact-field="observedAt"]', "2026-08-31T00:00:00.000Z");
  await click('[data-review-fact="accepted"]'); expect(current.facts[0]?.review).toBe("accepted");
});

it("keys a fact by its claim and stops printing the dimension twice", async () => {
  const base = completePayloadV2();
  // A fact whose dimension is the claim itself: one row, not the same sentence
  // above itself. The dimension stays editable in the disclosure, because it is
  // the other half of what `inspectGeoFact` looks for on the page.
  await render({ ...base, facts: [{ ...base.facts[0]!, key: "Seats included", value: "Seats included" }] });
  const card = host.querySelector('[data-edit-fact="0"]')!;
  // One input for the dimension, and it never moves: it lives in the
  // disclosure whether or not the dimension is the claim, so the first
  // keystroke that makes the two differ cannot unmount the field being typed
  // into. Where a distinct dimension exists it is read out above, not retyped.
  expect(card.querySelectorAll('[data-fact-field="key"]')).toHaveLength(1);
  expect(card.querySelector('[data-fact-field="key"]')?.closest("details")?.open).toBe(false);
  expect(card.querySelector("[data-fact-dimension]")).toBeNull();
  // Editing the claim carries the mirrored dimension with it: a stale copy of
  // an earlier claim would be searched for on the page and never found.
  await fill('[data-fact-field="value"]', "Nine seats included");
  expect(current.facts[0]).toMatchObject({ key: "Nine seats included", value: "Nine seats included" });
  // Clearing the claim does not clear the key with it: a fact with no value is
  // legal (it carries a reason instead), a fact with no key is not, and the
  // schema refuses the whole payload over it.
  await fill('[data-fact-field="value"]', "");
  expect(current.facts[0]).toMatchObject({ key: "Nine seats included", value: "" });
  expect(geoFactV2Schema.safeParse({ ...current.facts[0]!, reason: "notPublished" }).success).toBe(true);
  // A dimension of its own is shown, and then edited on its own.
  await render({ ...base, facts: [{ ...base.facts[0]!, key: "Seats", value: "Nine" }] });
  expect(host.querySelector('[data-edit-fact="0"] [data-fact-dimension]')?.textContent).toBe("Seats");
  expect(host.querySelectorAll('[data-edit-fact="0"] [data-fact-field="key"]')).toHaveLength(1);
  await fill('[data-fact-field="value"]', "Ten");
  expect(current.facts[0]).toMatchObject({ key: "Seats", value: "Ten" });
});

it("stamps a new fact with the capture time instead of asking for an ISO string", async () => {
  await render();
  const before = new Date().toISOString();
  await click("[data-add-fact]");
  const added = current.facts.at(-1)!;
  expect(added.observedAt >= before).toBe(true);
  expect(new Date(added.observedAt).toISOString()).toBe(added.observedAt);
  // And it is read out where the row is read, not offered as an empty box.
  const rows = host.querySelectorAll("[data-fact-observed-at]");
  expect(rows).toHaveLength(current.facts.length);
  expect(rows[rows.length - 1]?.textContent).toBe(added.observedAt);
});
it("keeps a non-default market and raw in-progress text without truncating it", async () => {
  const base = completePayloadV2(); await render({ ...base, market: { country: "CA", language: "en-ca" } });
  await fill('[data-base-field="officialName"]', "A".repeat(201) + " ");
  expect(current.officialName).toHaveLength(202); expect(current.market.country).toBe("CA");
});
