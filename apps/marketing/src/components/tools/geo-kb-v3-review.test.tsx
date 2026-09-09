// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";
import { geoV2Digest } from "../../lib/geo-tools/kb-v2-digest.ts";
import { geoV3ItemContentHashes, geoV3RestatedItemKeys } from "../../lib/geo-tools/kb-v3-item-content.ts";
import { geoV3ItemKeys } from "../../lib/geo-tools/kb-v3-contract.ts";
import { completePayloadV3, FACT_KEY_PRO, FACT_KEY_TEAM, V3_KB_ID } from "../../lib/geo-tools/kb-v3.test-fixtures.ts";
import { geoItemKey } from "../../lib/geo-tools/kb-item-key.ts";
import { parseGeoKbPayloadV3 } from "../../lib/geo-tools/kb-v3-contract.ts";
import {
  GEO_ENTITY_REMOVABLE_PATHS,
  GEO_ENTITY_REQUIRED_PATHS,
} from "../../lib/geo-tools/kb-knowledge-shape.ts";
import type { GeoEntityCorrectablePathV3 } from "../../lib/geo-tools/kb-v3-contract.ts";
import { geoKbModuleValue } from "./geo-kb-module-section.tsx";
import { GEO_KB_V3_AUTOSAVE_MS } from "./use-geo-kb-v3-editor.ts";
import { GEO_KB_RUN_BUSY_BACKOFF_MS, GEO_KB_RUN_ENDPOINT } from "./geo-kb-run-continue.ts";
import { GEO_KB_RUN_BUSY_VOICE, GEO_KB_RUN_CHECK_MS } from "./geo-kb-v3-review.tsx";
import { GEO_KB_EDITOR_V3_SCHEMA_VERSION, parseGeoKbEditorViewV3 } from "./use-geo-kb-v3-editor.ts";
import {
  buildGeoKbV3Identity,
  createGeoKbDraftPayloadV3,
  GEO_ABSENT_EVIDENCE_CONTENT_HASH,
  lockGeoKbV3GenerationInput,
} from "../../lib/geo-tools/kb-v3-draft-create.ts";
import {
  emptyMarketingWebsiteProfile,
  type MarketingWebsiteProfileV1,
  type WebsiteProfileReferenceV1,
} from "../../lib/account-websites/contracts.ts";
import { GeoKnowledgeBaseV3 } from "./geo-kb-v3-review.tsx";
import type { GeoKbEditorViewV3 } from "./geo-kb-v3-wire.ts";

const PAYLOAD = completePayloadV3();
const ITEM_KEYS = geoV3ItemKeys(PAYLOAD.knowledge);
const card = (locale: string) => (locale === "zh" ? zh : en).tools.geoKnowledgeBase.card;

/**
 * One fetch stub, routed by endpoint.
 *
 * The card asks the run route on mount whether this knowledge base has an
 * unfinished update, so a single `mockResolvedValue` no longer works here for
 * two separate reasons: it answers the wrong route, and -- the one that cost
 * an afternoon -- a `Response` body may be read once, so the two callers would
 * fight over the same instance and the second would see a network error. Every
 * reply below is built fresh per call.
 */
const RUN_ID = "5f7cdd1e-9f6a-8c31-9a4b-7d2c9f1e0a55";
type Reply = (body: Record<string, unknown>) => Response | Promise<Response>;
/**
 * A route that accepts the request and never answers.
 *
 * `defaultGeoKbRunPost` passes no `AbortSignal` and `fetch` carries no deadline
 * of its own, so this is the real shape of a hung call rather than a slow one:
 * without a deadline in the card, nothing ever ends it.
 */
const hangs: Reply = () => new Promise<Response>(() => {});
const noRun: Reply = () => Response.json({ data: { status: "none", run: null, operations: [] } });
let runRead: Reply = noRun;
let runAdvance: Reply = () => Response.json({
  data: { status: "complete", run: { runId: RUN_ID }, operations: [], waiting: [], skipped: [], remaining: "0" },
});
let v3Reply: Reply = () => Response.json({ error: { code: "conflict" } }, { status: 409 });
/**
 * The create/re-lock route, kept apart from the review and publish routes it
 * shares a prefix with. A single `v3Reply` would answer a re-lock with a
 * review response, and every assertion about what was rebuilt would then be
 * about a body no route sends.
 */
const DRAFT_ENDPOINT = "/api/tools/geo-knowledge-base/v3/draft";
let draftReply: Reply = () => Response.json({ error: { code: "not_found" } }, { status: 404 });

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.useFakeTimers();
  runRead = noRun;
  runAdvance = () => Response.json({
    data: { status: "complete", run: { runId: RUN_ID }, operations: [], waiting: [], skipped: [], remaining: "0" },
  });
  v3Reply = () => Response.json({ error: { code: "conflict" } }, { status: 409 });
  draftReply = () => Response.json({ error: { code: "not_found" } }, { status: 404 });
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    if (String(url) === DRAFT_ENDPOINT) return draftReply(body);
    if (String(url) !== GEO_KB_RUN_ENDPOINT) return v3Reply(body);
    return body.action === "read" ? runRead(body) : runAdvance(body);
  }));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function view(overrides: Partial<GeoKbEditorViewV3> = {}): GeoKbEditorViewV3 {
  return {
    kbId: V3_KB_ID, host: "example.com", draftVersion: 4, draftHash: geoV2Digest(PAYLOAD),
    payload: PAYLOAD, published: null,
    // Derived from the payload rather than hardcoded to [], so a test that
    // builds a restated payload gets the flag the server would have sent.
    restated: geoV3RestatedItemKeys(PAYLOAD.knowledge, PAYLOAD.review), ...overrides,
  };
}

async function render(
  locale = "en",
  overrides: Partial<GeoKbEditorViewV3> = {},
  props: { readonly onReload?: () => void; readonly confirmedProfileRevision?: number } = {},
) {
  await act(async () => root.render(
    <NextIntlClientProvider locale={locale} timeZone="UTC" messages={locale === "zh" ? zh : en}>
      <GeoKnowledgeBaseV3 view={view(overrides)} locale={locale} {...props} />
    </NextIntlClientProvider>,
  ));
}

const rows = () => [...host.querySelectorAll("[data-geo-kb-item]")];
const chips = () => rows().map((row) => row.querySelector("[data-decision-chip]")?.textContent);
const allCalls = () => (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
/** Review and publish only: the run and draft routes have their own readers below. */
const calls = () => allCalls().filter(([url]) => String(url) !== GEO_KB_RUN_ENDPOINT && String(url) !== DRAFT_ENDPOINT);
const draftCalls = () => allCalls()
  .filter(([url]) => String(url) === DRAFT_ENDPOINT)
  .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);
const runCalls = () => allCalls()
  .filter(([url]) => String(url) === GEO_KB_RUN_ENDPOINT)
  .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);
const advanceCalls = () => runCalls().filter((body) => body.action === undefined);
const bodyOf = (index: number) => JSON.parse(String((calls()[index]![1] as RequestInit).body));
const text = (selector: string) => host.querySelector(selector)?.textContent ?? null;

/**
 * The unresolved-charge sentence, written out rather than filled from the
 * catalog.
 *
 * Filling it from `card(locale).run.chargeUnresolved` -- which is what these
 * tests did first -- compares the render with the very leaf it was rendered
 * from, so it passes for every possible wording. Executed proof: with that
 * assertion in place the leaf could be replaced by "{count} that were never
 * sent, so nothing was spent on them." and all 30 tests in this file stayed
 * green. The whole reason this bucket exists apart from `failed` and
 * `unsupported` is the sentence, not the number, so the sentence is what gets
 * pinned.
 *
 * What it has to keep saying is the conservative claim: `kb-run-advance.ts`
 * writes this row when the probe budget runs out, and the ledger's probe RPC
 * accepts the same write for an expired claim that provably dispatched
 * nothing. So "may already have been charged" is the strongest thing true of
 * every row landing here -- it may never say the operation WAS sent, and it
 * may never say nothing was spent.
 */
const chargeUnresolvedLine = (locale: string, count: number): string =>
  locale === "zh"
    ? `有 ${count} 项在弄清结果之前就被这次更新放弃了。它们可能已经产生了费用，因此不会再次尝试。`
    : `${count} that this update gave up on before it learned what happened. They may already have been charged, so they are not attempted again.`;

/**
 * Any wording that would tell the owner no money was spent on a run's
 * operations. That claim is true of exactly one bucket -- `unsupported`, the
 * kinds this deployment never sends -- and of nothing else.
 */
const UNSPENT_CLAIM: Readonly<Record<string, RegExp>> = {
  en: /nothing was spent|nothing has been spent|not been charged|was not charged|no charge|free of charge|at no cost/iu,
  zh: /没有[^。]{0,12}花费|未产生费用|不会产生费用|不计费|免费/u,
};

/**
 * The guard the round before this one thought it had.
 *
 * Its comment said "nothing on the page claims nothing was spent on it" while
 * its body asserted only that ONE leaf -- `run.unsupported` -- was absent. The
 * page could make exactly the forbidden claim through any other sentence in
 * the run panel, the new unresolved-charge one included, and it stayed green.
 * This reads the rendered panel instead of a leaf, so it does not care which
 * sentence carries the claim.
 *
 * Scoped to `[data-run-panel]` deliberately, and not to the whole card: the
 * card's own price sentences live outside it and legitimately talk about money
 * ("Publishing is free and makes no model call" is true of publishing). What
 * may never claim to be free is a sentence about an operation of this run.
 */
function expectNoUnspentClaim(locale: string): void {
  const panel = host.querySelector("[data-run-panel]");
  expect(panel).not.toBeNull();
  expect(panel?.textContent).not.toMatch(UNSPENT_CLAIM[locale]!);
}
const button = (selector: string) => host.querySelector(selector) as HTMLButtonElement | null;
async function click(selector: string): Promise<void> {
  const target = button(selector);
  if (target === null) throw new Error(`no element for ${selector}`);
  await act(async () => { target.click(); });
}
async function typeInto(field: Element | null, value: string): Promise<void> {
  if (!(field instanceof HTMLTextAreaElement)) throw new Error("expected a textarea");
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("draws one row per reviewable item, awaiting confirmation", async () => {
  await render();
  expect(rows()).toHaveLength(ITEM_KEYS.length);
  expect(new Set(chips())).toEqual(new Set([card("en").decisions.pending]));
  // This card passes no `costNote`, so the billing sentence an owner reads
  // here is the card's own default. That is the seam that made the wrong one
  // reach only v3: `geo-knowledge-base-v2.tsx` supplies its own. What the
  // default sentence says is pinned in `geo-kb-card.test.tsx`.
  expect(host.querySelector("[data-kb-cost]")).not.toBeNull();
  // Internal identity never reaches the DOM.
  expect(host.innerHTML).not.toContain(FACT_KEY_PRO);
});

it("puts 全部接受 inside the module it accepts, and labels what it writes", async () => {
  await render();
  const buttons = [...host.querySelectorAll("[data-accept-all]")];
  // One per reviewable module that still has pending items. The unavailable
  // comparisons module has none, so it offers no button.
  expect(buttons.length).toBeGreaterThanOrEqual(3);
  for (const button of buttons) {
    expect(button.closest("[data-geo-kb-module]")).not.toBeNull();
  }
  expect(host.textContent).toContain(card("en").review.acceptAllNote);
});

it("sends accept_all and shows accepted in bulk, never confirmed", async () => {
  await render();
  const facts = [...host.querySelectorAll("[data-geo-kb-module]")]
    .find((module) => module.querySelector("[data-accept-all]") !== null)!;
  await act(async () => { (facts.querySelector("[data-accept-all]") as HTMLButtonElement).click(); });
  const swept = chips().filter((label) => label === card("en").decisions.acceptedInBulk);
  expect(swept.length).toBeGreaterThan(0);
  // The one thing this button may never produce.
  expect(chips()).not.toContain(card("en").decisions.accepted);
  await act(async () => { await vi.advanceTimersByTimeAsync(GEO_KB_V3_AUTOSAVE_MS); });
  expect(bodyOf(0).actions[0].kind).toBe("accept_all");
});

it("marks one row confirmed when it is accepted on its own", async () => {
  await render();
  const first = rows()[0]!;
  await act(async () => { (first.querySelector('[data-item-action="accept"]') as HTMLButtonElement).click(); });
  expect(first.querySelector("[data-decision-chip]")?.textContent).toBe(card("en").decisions.accepted);
  expect(chips().filter((label) => label === card("en").decisions.accepted)).toHaveLength(1);
});

it("sends a correction as an acceptance of the corrected text", async () => {
  await render();
  const first = rows()[0]!;
  await act(async () => { (first.querySelector('[data-item-action="correct"]') as HTMLButtonElement).click(); });
  const form = host.querySelector("[data-item-correction]");
  expect(form).not.toBeNull();
  await act(async () => { (form!.querySelector("[data-correction-save]") as HTMLButtonElement).click(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(GEO_KB_V3_AUTOSAVE_MS); });
  expect(bodyOf(0).actions[0].kind).toBe("correct");
  // The row now reads as the owner's own claim rather than the page's.
  expect(rows()[0]!.getAttribute("data-origin")).toBe("declared_owner");
});

it("states how many items would publish unconfirmed, and that publishing is free", async () => {
  await render();
  expect(host.querySelector("[data-kb-publish-pending]")?.textContent)
    .toBe(card("en").publish.pending.replace("{count}", String(ITEM_KEYS.length)));
  expect(host.textContent).toContain(card("en").publishFree);
});

it("stops offering the gestures once the draft conflicts, and says why", async () => {
  v3Reply = () => Response.json({ error: { code: "conflict" }, draftVersion: 9 }, { status: 409 });
  await render();
  await act(async () => { (rows()[0]!.querySelector('[data-item-action="accept"]') as HTMLButtonElement).click(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(GEO_KB_V3_AUTOSAVE_MS); });
  expect(host.querySelector("[data-review-status]")?.textContent).toBe(card("en").review.conflict);
  expect((rows()[0]!.querySelector('[data-item-action="accept"]') as HTMLButtonElement).disabled).toBe(true);
  expect((host.querySelector('[data-publish-kb="box"]') as HTMLButtonElement).disabled).toBe(true);
});

it("renders in Chinese from the catalog rather than from inline literals", async () => {
  await render("zh");
  expect(new Set(chips())).toEqual(new Set([card("zh").decisions.pending]));
  expect(host.textContent).toContain(card("zh").review.acceptAllNote);
  // The one label the whole surface exists to keep separate, in both locales.
  expect(card("zh").decisions.acceptedInBulk).not.toBe(card("zh").decisions.accepted);
});

/**
 * The publish assembler withholds the entire identity section rather than
 * publish a required entity field the owner excluded. Offering Exclude there
 * and reporting the consequence only after publishing puts the surprise behind
 * the one action that is hard to take back, so the row refuses it and says why.
 *
 * Both lists are read from the shape layer, never restated here: a path that
 * changes side must move this test with it rather than leave it passing.
 */
it("refuses to offer an exclusion that would withhold the identity section", async () => {
  const required = GEO_ENTITY_REQUIRED_PATHS[0]!;
  const removable = GEO_ENTITY_REMOVABLE_PATHS.find((path) => path === "aliases")!;
  const base = completePayloadV3();
  const entity = base.knowledge!.entity;
  if (entity.status !== "available") throw new Error("fixture entity must be available");
  const provenance = entity.value.fields[0]!;
  const payload = parseGeoKbPayloadV3({
    ...base,
    knowledge: {
      ...base.knowledge!,
      entity: {
        ...entity,
        value: {
          ...entity.value,
          fields: [
            { ...provenance, field: required, itemKey: geoItemKey({ module: "entity", field: required }) },
            { ...provenance, field: removable, itemKey: geoItemKey({ module: "entity", field: removable }) },
          ],
        },
      },
    },
  });
  await render("en", { payload, draftHash: geoV2Digest(payload) });

  const entityRows = rows().slice(0, 2);
  const excludeOf = (row: Element) => row.querySelector<HTMLButtonElement>('[data-item-action="exclude"]')!;
  expect(excludeOf(entityRows[0]!).disabled).toBe(true);
  expect(entityRows[0]!.querySelector('[data-item-note="exclude-blocked"]')?.textContent)
    .toBe(card("en").review.excludeRequired);
  expect(excludeOf(entityRows[1]!).disabled).toBe(false);
  expect(entityRows[1]!.querySelector('[data-item-note="exclude-blocked"]')).toBeNull();

  // Blocked means blocked: no decision is written for the required field.
  await act(async () => excludeOf(entityRows[0]!).click());
  await act(async () => { await vi.advanceTimersByTimeAsync(GEO_KB_V3_AUTOSAVE_MS * 2); });
  expect(calls()).toHaveLength(0);
});

/* ---------------------------------------------------------------------------
 * Corrections the published entity cannot hold
 * ------------------------------------------------------------------------- */

/** A draft whose entity carries exactly the correctable paths named. */
function entityPayload(paths: readonly GeoEntityCorrectablePathV3[]) {
  const base = completePayloadV3();
  const entity = base.knowledge!.entity;
  if (entity.status !== "available") throw new Error("fixture entity must be available");
  const provenance = entity.value.fields[0]!;
  return parseGeoKbPayloadV3({
    ...base,
    knowledge: {
      ...base.knowledge!,
      entity: {
        ...entity,
        value: {
          ...entity.value,
          fields: paths.map((field) => ({ ...provenance, field, itemKey: geoItemKey({ module: "entity", field }) })),
        },
      },
    },
  });
}

async function openCorrection(index: number): Promise<HTMLElement> {
  const row = rows()[index]!;
  await act(async () => { (row.querySelector('[data-item-action="correct"]') as HTMLButtonElement).click(); });
  const form = host.querySelector("[data-item-correction]");
  if (!(form instanceof HTMLElement)) throw new Error("no correction form");
  return form;
}

/* ------------------------------------------------------------------ */
/* "Has a new observation" -- section 4.4's third rule at the card      */
/* ------------------------------------------------------------------ */

/**
 * The merge lets an owner's decision stand when the same page restates the same
 * item, rather than re-asking them everything on every update. The whole reason
 * that is acceptable is this chip: without it the row presents an approval of a
 * sentence nobody has read, and publish ships it as owner-confirmed.
 *
 * The row component has always been able to draw the chip. What was missing was
 * anything passing the flag -- `newObservation` had no caller in the app, and
 * `baseContentHash`, the field the merge leaves mismatched on purpose, had no
 * reader either. So these assert the WIRE, from the loader's `restated` to the
 * rendered chip, not the component in isolation.
 */
const flags = () => rows().map((row) => row.querySelector('[data-item-flag="new_observation"]')?.textContent ?? null);

it("says an item has a new observation when the update rewrote text the owner had decided", async () => {
  const factKey = ITEM_KEYS[1]!;
  await render("en", { restated: [factKey] });

  const flagged = flags().filter((text) => text !== null);
  expect(flagged).toEqual([en.tools.geoKnowledgeBase.card.item.newObservation]);
  expect(flagged[0]).not.toContain("[missing copy:");
});

/**
 * Counted rather than positional: the row order is the module walk order, not
 * the item-key order, so pinning an index would pass while the flag landed on
 * the wrong row. Each case gets its own render -- the editor hook takes the
 * view once, the way a page load hands it over, and does not re-read the prop.
 */
it.each([
  ["nothing the server named", [] as readonly string[], 0],
  ["one named item", [ITEM_KEYS[1]!], 1],
  ["two named items", [ITEM_KEYS[1]!, ITEM_KEYS[2]!], 2],
  ["a key this body does not carry", ["f".repeat(64)], 0],
])("marks the rows for %s", async (_why, restated, expected) => {
  await render("en", { restated });

  expect(rows().filter((row) => row.querySelector('[data-item-flag="new_observation"]') !== null)).toHaveLength(expected);
});

it("says nothing of the kind while every decision still stands against what it decided", async () => {
  await render("en", { restated: [] });

  expect(flags().every((text) => text === null)).toBe(true);
});

it("says it in the reader's language", async () => {
  await render("zh", { restated: [ITEM_KEYS[1]!] });

  const flagged = flags().filter((text) => text !== null);
  expect(flagged).toEqual([zh.tools.geoKnowledgeBase.card.item.newObservation]);
  expect(flagged[0]).not.toBe(en.tools.geoKnowledgeBase.card.item.newObservation);
});

async function renderEntity(paths: readonly GeoEntityCorrectablePathV3[], locale = "en") {
  const payload = entityPayload(paths);
  await render(locale, { payload, draftHash: geoV2Digest(payload) });
}

const correctionField = () => host.querySelector("[data-item-correction] textarea");
const saveButton = () => host.querySelector("[data-correction-save]") as HTMLButtonElement;

/**
 * `founded.year` is four digits, and that is a shape rather than a length. The
 * card refuses the correction where the owner can still read why, because the
 * alternative is the publish button answering 422 with nothing rendered.
 */
it("refuses a year the published entity cannot hold, and says what it wants", async () => {
  await renderEntity(["founded.year"]);
  const form = await openCorrection(0);
  // An empty box is not a broken rule; it explains itself.
  expect(form.querySelector("[data-correction-issue]")).toBeNull();
  expect(saveButton().disabled).toBe(true);

  await typeInto(correctionField(), "twenty nineteen");
  const note = host.querySelector('[data-correction-issue="fourDigitYear"]');
  expect(note?.textContent).toBe(card("en").review.correctionYear);
  expect(saveButton().disabled).toBe(true);
  // A real element, pointed at from the control and from the refused button --
  // never a tooltip, which a touch screen and a screen reader never see.
  expect(note?.id).toBeTruthy();
  expect(saveButton().getAttribute("aria-describedby")).toBe(note?.id);
  expect(correctionField()?.getAttribute("aria-describedby")).toBe(note?.id);
  expect(correctionField()?.getAttribute("aria-invalid")).toBe("true");

  await typeInto(correctionField(), "2019");
  expect(host.querySelector("[data-correction-issue]")).toBeNull();
  expect(saveButton().disabled).toBe(false);
});

/**
 * The plain-text sentence has to cover both ways a bounded field refuses. A
 * pasted control character is not long, and telling that owner "too long" sends
 * them to delete words that were never the problem -- so one sentence answers
 * both, and this test is what stops it from being split in two.
 */
it("gives one plain-text reason for an over-long value and for an unprintable one", async () => {
  await renderEntity(["name"]);
  const expected = card("en").review.correctionPlainText.replace("{max}", "200");

  await openCorrection(0);
  await typeInto(correctionField(), "x".repeat(201));
  expect(host.querySelector('[data-correction-issue="text"]')?.textContent).toBe(expected);
  expect(saveButton().disabled).toBe(true);

  // Short, and still impossible: a control character the published entity
  // cannot carry, with no visible symptom for the owner to act on.
  await typeInto(correctionField(), "Acme\u0007Ltd");
  expect(host.querySelector('[data-correction-issue="text"]')?.textContent).toBe(expected);
  expect(saveButton().disabled).toBe(true);

  await typeInto(correctionField(), "Acme Ltd");
  expect(host.querySelector("[data-correction-issue]")).toBeNull();
  expect(saveButton().disabled).toBe(false);
});

it("states the correction rule in Chinese from the catalog, not from the key path", async () => {
  await renderEntity(["founded.year"], "zh");
  await openCorrection(0);
  await typeInto(correctionField(), "二〇一九");
  expect(host.querySelector("[data-correction-issue]")?.textContent).toBe(card("zh").review.correctionYear);
  // next-intl renders a missing key as the key path, so "some text appeared"
  // proves nothing. Two locales that differ is what a real translation looks
  // like; a key path would read identically in both.
  expect(card("zh").review.correctionYear).not.toBe(card("en").review.correctionYear);
  expect(card("zh").review.correctionPlainText).not.toBe(card("en").review.correctionPlainText);
});

/* ---------------------------------------------------------------------------
 * The update run
 * ------------------------------------------------------------------------- */

it("drives an update and reports the ledger the server described", async () => {
  runAdvance = () => Response.json({
    data: {
      status: "complete",
      run: { runId: RUN_ID },
      operations: [
        { key: "fetch:own:https://acme.test/", kind: "fetch", state: "succeeded", reason: null },
        { key: "fetch:competitor:https://rival.test/", kind: "fetch", state: "dispatched", reason: null },
        { key: "model:knowledge", kind: "model", state: "failed_permanent", reason: "unsupported" },
      ],
      waiting: [],
      skipped: ["model:knowledge"],
      remaining: "0",
    },
  });
  await render();
  expect(button("[data-generate-kb]")?.disabled).toBe(false);
  await click("[data-generate-kb]");

  expect(advanceCalls()).toHaveLength(1);
  expect(advanceCalls()[0]!.idempotencyKey).toEqual(expect.any(String));
  expect(advanceCalls()[0]!.runId).toBeUndefined();
  expect(text('[data-run-status="complete"]')).toBe(card("en").run.complete);
  // The operation nothing can run is drawn as exactly that. Folding it into
  // "done" would read as two pages read; folding it into "could not be
  // completed" would invite the retry the executor exists to refuse.
  expect(text("[data-run-counts]")).toBe([
    card("en").run.done.replace("{count}", "1"),
    card("en").run.unknownOutcome.replace("{count}", "1"),
  ].join(" · "));
  expect(text("[data-run-unsupported]")).toBe(card("en").run.unsupported.replace("{count}", "1"));
  // A finished run is not a published version, and this card is still holding
  // the draft it was handed.
  expect(text("[data-run-reload]")).toBe(card("en").run.notReloaded);
  expect(host.querySelector("[data-publish-outcome]")).toBeNull();
});

it("offers to continue an unfinished run instead of opening a second one", async () => {
  runRead = () => Response.json({
    data: {
      status: "resumable",
      run: { runId: RUN_ID },
      operations: [
        { key: "fetch:own:https://acme.test/", kind: "fetch", state: "succeeded", reason: null },
        { key: "fetch:competitor:https://rival.test/", kind: "fetch", state: "not_started", reason: null },
      ],
    },
  });
  await render();
  // Written out rather than read from `card("en").run.resumable`: an assertion
  // filled from the very leaf the component rendered from passes for every
  // possible wording. Measured -- with `toBe(card("en").run.resumable)` here,
  // replacing that leaf with "ZZZ nothing was spent and everything is fine ZZZ"
  // left every test in this file green.
  expect(text('[data-run-status="resumable"]'))
    .toBe("An earlier update of this knowledge base was never finished.");
  // The label on the billed gesture gets the same treatment: it is the word
  // the owner presses, so it is pinned by content and not by identity.
  expect(button("[data-run-continue]")?.textContent).toBe("Continue the update");
  // An unfinished run has operations that were sent. Nothing here may say
  // otherwise.
  expectNoUnspentClaim("en");
  expect(text("[data-run-counts]")).toBe([
    card("en").run.done.replace("{count}", "1"),
    card("en").run.outstanding.replace("{count}", "1"),
  ].join(" · "));
  // A second run over the same site is what the run route answers `run_active`
  // to; the card does not offer the gesture at all.
  expect(button("[data-generate-kb]")?.disabled).toBe(true);

  await click("[data-run-continue]");
  expect(advanceCalls()).toHaveLength(1);
  expect(advanceCalls()[0]!.runId).toBe(RUN_ID);
  expect(advanceCalls()[0]!.idempotencyKey).toBeUndefined();
});

/**
 * `remaining` crosses the wire as a decimal string precisely so that nothing
 * hashes a JSON number. An unreadable one is unknown, and an unknown count
 * rendered as 0 says the update has nothing left to do -- the one thing it
 * does not know.
 */
it("never renders an unreadable step count as zero", async () => {
  runAdvance = () => Response.json({
    data: {
      status: "stalled",
      run: { runId: RUN_ID },
      operations: [{ key: "fetch:own:https://acme.test/", kind: "fetch", state: "not_started", reason: null }],
      waiting: [],
      skipped: [],
      remaining: "many",
    },
  });
  await render();
  await click("[data-generate-kb]");
  // First, and stated over the whole page rather than over one node: whatever
  // the card decides to draw, the sentence "0 steps left" is not in it.
  // Written out rather than filled from the catalog -- `remaining` is an ICU
  // plural now, so `.replace("{count}", "0")` matches nothing in it and the
  // assertion would hold no matter what the page said.
  // `\b` is useless here: `textContent` concatenates the panel's spans with no
  // separator, so a preceding "…to do" would put a word character right in
  // front of the zero and the boundary would never match. The lookbehind is
  // what keeps "10 steps left" out while still catching a bare zero.
  expect(host.textContent).not.toMatch(/(?<!\d)0 steps? left/u);
  expect(host.querySelector("[data-run-remaining]")).toBeNull();
  expect(text("[data-run-remaining-unknown]")).toBe(card("en").run.remainingUnknown);
  expect(text('[data-run-status="stalled"]')).toBe(card("en").run.stalled);
  // It is still open, so the way back in is a continuation.
  expect(button("[data-run-continue]")).not.toBeNull();
});

it("reports the run in Chinese from the catalog", async () => {
  await render("zh");
  await click("[data-generate-kb]");
  expect(text('[data-run-status="complete"]')).toBe(card("zh").run.complete);
  expect(card("zh").run.complete).not.toBe(card("en").run.complete);
  expect(card("zh").run.notReloaded).not.toBe(card("en").run.notReloaded);
});

/**
 * A count and a plural. `{count} steps left` read "1 steps left" for the
 * commonest case there is -- the last step of an update.
 */
it.each([["1", "1 step left"], ["2", "2 steps left"]])(
  "agrees with the number when %s step(s) are left",
  async (value, expected) => {
    runAdvance = () => Response.json({
      data: { status: "stalled", run: { runId: RUN_ID }, operations: [], waiting: [], skipped: [], remaining: value },
    });
    await render();
    await click("[data-generate-kb]");
    expect(text("[data-run-remaining]")).toBe(expected);
  },
);

/* ---------------------------------------------------------------------------
 * What a stopped run says, and what it offers
 * ------------------------------------------------------------------------- */

/**
 * `unsupported` is a claim that nothing was spent. It is true only of the
 * operations this deployment never sends; a `failed_permanent` row with any
 * other reason is one that was sent, and the executor's own comment on
 * `invalid_output` says the fetch behind it has already been spent.
 *
 * The direction that matters is this one. A run whose only permanent failure
 * is `unsupported` is covered above, and it passes just as happily against a
 * reader that ignores `reason` altogether.
 */
it("never says nothing was spent on an operation that was sent", async () => {
  runAdvance = () => Response.json({
    data: {
      status: "stalled",
      run: { runId: RUN_ID },
      operations: [
        { key: "fetch:own:https://acme.test/", kind: "fetch", state: "failed_permanent", reason: "invalid_output" },
      ],
      waiting: [], skipped: [], remaining: "0",
    },
  });
  await render();
  await click("[data-generate-kb]");

  expect(text("[data-run-counts]")).toBe(card("en").run.failedOps.replace("{count}", "1"));
  expect(host.querySelector("[data-run-unsupported]")).toBeNull();
  expectNoUnspentClaim("en");
});

/**
 * The pair the round before this one missed.
 *
 * `kb-run-advance.ts` writes `{state: "failed_permanent", reason:
 * "outcome_unknown"}` once the probe budget is spent: the run stopped trying
 * to find out what happened, and the charge behind that row is unresolved for
 * good. Read as `failed` it says "this step could not be completed", which an
 * owner hears as "nothing happened" over the one row that says something may
 * have been paid for and its result lost.
 *
 * The state `outcome_unknown` and the reason `outcome_unknown` are different
 * things: a reader that branches on state alone -- the shipped one did -- puts
 * this row in `failed` and reads perfectly green, because no fixture in this
 * file had ever produced the row. Producing it is the point of this test.
 */
it("counts a charge the run gave up on apart from a step that simply failed", async () => {
  runAdvance = () => Response.json({
    data: {
      status: "complete",
      run: { runId: RUN_ID },
      operations: [
        { key: "fetch:own:https://acme.test/", kind: "fetch", state: "failed_permanent", reason: "outcome_unknown" },
      ],
      waiting: [], skipped: ["fetch:own:https://acme.test/"], remaining: "0",
    },
  });
  await render();
  await click("[data-generate-kb]");

  expect(text("[data-run-charge-unresolved]")).toBe(chargeUnresolvedLine("en", 1));
  // Every other bucket puts a number into the counts strip, so the strip not
  // being drawn at all is what proves this row landed in none of them --
  // neither `failed` nor `unknownOutcome`, `outstanding` or `done`. Asserting
  // the strip's text instead would pass while the row sat in a bucket whose
  // sentence happens not to be checked.
  expect(host.querySelector("[data-run-counts]")).toBeNull();
  // And no sentence in the panel claims nothing was spent on it -- not the
  // `unsupported` one, and not the one this row actually rendered.
  expect(host.querySelector("[data-run-unsupported]")).toBeNull();
  expectNoUnspentClaim("en");
});

/**
 * One run holding every bucket at once, at six different sizes.
 *
 * The sizes are the assertion. Equal counts would let two rows swap buckets
 * and leave every rendered number unchanged; 1/2/3/4/5/6 means any row filed
 * in the wrong place changes a number this test reads.
 */
it("files each ledger row in one bucket, and counts them separately", async () => {
  const op = (index: number, state: string, reason: string | null) => ({
    key: `fetch:own:https://acme.test/${index}`, kind: "fetch", state, reason,
  });
  runAdvance = () => Response.json({
    data: {
      status: "stalled",
      run: { runId: RUN_ID },
      operations: [
        op(1, "succeeded", null),
        ...[2, 3].map((index) => op(index, "dispatched", null)),
        ...[4, 5, 6].map((index) => op(index, "failed_permanent", "not_found")),
        ...[7, 8, 9, 10].map((index) => op(index, "failed_permanent", "unsupported")),
        ...[11, 12, 13, 14, 15].map((index) => op(index, "failed_permanent", "outcome_unknown")),
        ...[16, 17, 18, 19, 20, 21].map((index) => op(index, "not_started", null)),
      ],
      waiting: [], skipped: [], remaining: "0",
    },
  });
  await render();
  await click("[data-generate-kb]");

  expect(text("[data-run-counts]")).toBe([
    card("en").run.done.replace("{count}", "1"),
    card("en").run.outstanding.replace("{count}", "6"),
    card("en").run.unknownOutcome.replace("{count}", "2"),
    card("en").run.failedOps.replace("{count}", "3"),
  ].join(" · "));
  expect(text("[data-run-charge-unresolved]")).toBe(chargeUnresolvedLine("en", 5));
  // The `unsupported` sentence is the ONE place "nothing was spent" is true,
  // and four rows here earn it -- so `expectNoUnspentClaim` deliberately does
  // not run in this test. Its own wording is pinned by the leaf comparison
  // below plus the catalog guard in `geo-kb-card.test.tsx`.
  expect(text("[data-run-unsupported]")).toBe(card("en").run.unsupported.replace("{count}", "4"));
  // The two sentences sit next to each other in the panel and must make
  // opposite claims, measured against the same vocabulary: this bucket is the
  // one place "nothing was spent" is true, and the bucket above it is about
  // rows that may already have been paid for. A leaf comparison cannot see
  // either half -- it agrees with whatever the catalog says.
  expect(text("[data-run-unsupported]")).toMatch(UNSPENT_CLAIM.en!);
  expect(text("[data-run-charge-unresolved]")).not.toMatch(UNSPENT_CLAIM.en!);
});

it("says the unresolved charge in Chinese, in its own words", async () => {
  runAdvance = () => Response.json({
    data: {
      status: "complete",
      run: { runId: RUN_ID },
      operations: [
        { key: "fetch:own:https://acme.test/", kind: "fetch", state: "failed_permanent", reason: "outcome_unknown" },
      ],
      waiting: [], skipped: [], remaining: "0",
    },
  });
  await render("zh");
  await click("[data-generate-kb]");

  // A missing key renders as its own path, identically in both locales, so
  // "some text appeared" would prove nothing -- and neither would comparing
  // the two catalog leaves with each other, which is what stood here before.
  // The literal is what separates a real translation from a key path.
  expect(text("[data-run-charge-unresolved]")).toBe(chargeUnresolvedLine("zh", 1));
  expectNoUnspentClaim("zh");
});

/**
 * The first call was refused before a run existed, so `driveGeoKbRun` returns
 * a view whose `runId` is still null. There is nothing to continue, and the
 * card must not print a sentence offering to continue it beside no button --
 * nor tell the owner to reload to see what an update wrote, when no update
 * ever started.
 *
 * An expired session needs its own sentence on top of that: pressing Update
 * again answers 401 forever, and "you can continue it" is advice that cannot
 * work.
 */
it("does not offer to continue an update it never got a run for", async () => {
  const refused: Reply = () => Response.json({ error: { code: "auth_required" } }, { status: 401 });
  runRead = refused;
  runAdvance = refused;
  await render();
  await click("[data-generate-kb]");

  expect(text('[data-run-status="failed"]')).toBe(card("en").run.failedAuth);
  expect(text("[data-run-next]")).toBe(card("en").run.nextSignIn);
  expect(button("[data-run-continue]")).toBeNull();
  expect(host.querySelector("[data-run-reload]")).toBeNull();
  expect(host.textContent).not.toContain(card("en").run.nextContinue);
  expect(host.textContent).not.toContain(card("en").run.notReloaded);
});

it("names an update that could not reach the server at all", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
  await render();
  await click("[data-generate-kb]");

  expect(text('[data-run-status="failed"]')).toBe(card("en").run.failedOffline);
  expect(text("[data-run-next]")).toBe(card("en").run.nextReload);
  expect(button("[data-run-continue]")).toBeNull();
  expect(host.querySelector("[data-run-reload]")).toBeNull();
});

/**
 * The other half of the same rule: once a run exists, the promise is kept.
 * The failure here lands on the second call, so the view the card is left
 * holding carries the run id the first call returned.
 */
it("offers the continuation it promises once a run exists", async () => {
  let call = 0;
  runAdvance = () => {
    call += 1;
    return call === 1
      ? Response.json({
        data: {
          status: "in_progress",
          run: { runId: RUN_ID },
          operations: [{ key: "fetch:own:https://acme.test/", kind: "fetch", state: "succeeded", reason: null }],
          waiting: [], skipped: [], remaining: "2",
        },
      })
      : Response.json({ error: { code: "store_unavailable" } }, { status: 503 });
  };
  await render();
  await click("[data-generate-kb]");

  expect(text('[data-run-status="failed"]')).toBe(card("en").run.failedUnavailable);
  expect(text("[data-run-next]")).toBe(card("en").run.nextContinue);
  expect(button("[data-run-continue]")).not.toBeNull();
  // A run that did work is a run whose writes a reload would show.
  expect(text("[data-run-reload]")).toBe(card("en").run.notReloaded);
  expect(text("[data-run-counts]")).toBe(card("en").run.done.replace("{count}", "1"));
});

/**
 * 409 `run_active`: the server refused to open a second run over the same
 * site. The sentence names the one continuation there is, and the button for
 * it is drawn from the same fact.
 */
it("reports an update that is already open, and offers that one", async () => {
  runAdvance = () => Response.json({
    data: {
      status: "run_active",
      run: { runId: RUN_ID },
      operations: [{ key: "fetch:own:https://acme.test/", kind: "fetch", state: "not_started", reason: null }],
      waiting: [], skipped: [], remaining: "1",
    },
  }, { status: 409 });
  await render();
  await click("[data-generate-kb]");

  expect(text('[data-run-status="runActive"]')).toBe(card("en").run.runActive);
  expect(text("[data-run-next]")).toBe(card("en").run.nextContinue);
  expect(button("[data-run-continue]")).not.toBeNull();
  // One call: a refused second run is not retried into a third.
  expect(advanceCalls()).toHaveLength(1);
});

/**
 * `blocked` is the one open state with no next step of its own: nothing the
 * owner does moves it, and its sentence already says to come back later.
 */
it("says an update is held by something else, and asks for nothing", async () => {
  runAdvance = () => Response.json({
    data: {
      status: "blocked",
      run: { runId: RUN_ID },
      operations: [{ key: "model:knowledge", kind: "model", state: "not_started", reason: null }],
      waiting: ["model:knowledge"], skipped: [], remaining: "1",
    },
  });
  await render();
  await click("[data-generate-kb]");

  expect(text('[data-run-status="blocked"]')).toBe(card("en").run.blocked);
  expect(host.querySelector("[data-run-next]")).toBeNull();
});

it("names a refused sign-in in Chinese, from the catalog", async () => {
  const refused: Reply = () => Response.json({ error: { code: "auth_required" } }, { status: 401 });
  runRead = refused;
  runAdvance = refused;
  await render("zh");
  await click("[data-generate-kb]");

  expect(text('[data-run-status="failed"]')).toBe(card("zh").run.failedAuth);
  expect(text("[data-run-next]")).toBe(card("zh").run.nextSignIn);
  // A missing key renders as its path, which reads identically in both locales.
  expect(card("zh").run.failedAuth).not.toBe(card("en").run.failedAuth);
  expect(card("zh").run.nextSignIn).not.toBe(card("en").run.nextSignIn);
  expect(card("zh").run.nextReload).not.toBe(card("en").run.nextReload);
});

/* ---------------------------------------------------------------------------
 * The question set a draft does not have
 * ------------------------------------------------------------------------- */

/**
 * The set is a published version's, made when the version is. A draft has
 * none, and `0` would say it has one with nothing in it.
 */
it.each(["en", "zh"])("never states a draft's question set as zero questions, in %s", async (locale) => {
  await render(locale);

  const line = host.querySelector('[data-kb-measurement-items="unavailable"]');
  expect(line?.textContent).toBe(card(locale).sections.measurement.itemsUnavailable);
  expect(line?.textContent).not.toMatch(/\d/u);
  expect(host.querySelector('[data-kb-measurement-items="count"]')).toBeNull();
  // The section itself is still offered; only its count is withheld.
  expect(host.querySelector("[data-kb-measurement-toggle]")).not.toBeNull();
});

/* ---------------------------------------------------------------------------
 * The sections this screen does not draw
 * ------------------------------------------------------------------------- */

/**
 * A note may not point at a surface that does not exist.
 *
 * Trust, reachability and measurement carry no per-item decisions, so the card
 * puts a sentence where the modules would be. That sentence used to say the
 * content was "shown in full on the published version" -- and nothing renders a
 * published v3 pack: `kb-editor-loader.ts` returns a published version's
 * revision, timestamp, content hash and decisions and never its body, and the
 * only pack renderer is reached from the v2 card's frozen view alone.
 *
 * The claims are pinned rather than the wording. Comparing the render with the
 * catalog leaf it rendered from would pass for any sentence at all, including
 * the one this test exists to keep out, so what is asserted is that the note
 * promises no other view and still says what it is standing in for.
 */
const PROMISES_A_VIEW = /published|shown in full|已发布|完整内容/u;

it.each(["en", "zh"])("promises no published view from the sections it does not draw, in %s", async (locale) => {
  await render(locale);

  const trust = host.querySelector('[data-kb-section="trust"] [data-knowledge-copy="compact"]')?.textContent ?? "";
  const reachability = host.querySelector('[data-kb-section="reachability"] [data-knowledge-copy="compact"]')?.textContent ?? "";
  expect(trust.length).toBeGreaterThan(0);
  // The same absence, so the same sentence.
  expect(reachability).toBe(trust);
  expect(trust).not.toMatch(PROMISES_A_VIEW);
  // A key next-intl cannot resolve renders as its own path, which is neither a
  // sentence nor locale-specific; both checks below refuse that outcome.
  expect(trust).not.toMatch(/^[\w.]+$/u);

  if (locale === "en") {
    expect(trust).toContain("nothing here for you to accept, correct or exclude");
    // It used to say the contents were "not shown here", which was true while
    // the section was empty and became a lie the moment the read-only modules
    // were drawn into it. A sentence promising a view is caught by
    // PROMISES_A_VIEW above; this catches the opposite one, denying a view the
    // owner is looking at.
    expect(trust).not.toContain("not shown here");
  } else {
    expect(trust).toContain("没有需要你接受、修正或排除的条目");
    expect(trust).not.toContain("不在这里展示");
  }
  // And the thing the sentence is about is on the screen underneath it.
  expect(host.querySelector('[data-kb-section="trust"] [data-geo-kb-module]')).not.toBeNull();
  expect(host.querySelector('[data-kb-section="reachability"] [data-geo-kb-module]')).not.toBeNull();
});

/**
 * And the third one is a different absence.
 *
 * Trust and reachability hold observations this screen does not draw. A draft
 * holds no question set at all -- `GeoKbPayloadV3` has no field for one, and
 * `runRef.questionsGenerationId` is null on every draft this deployment
 * produces. One shared sentence would collapse "there is content you cannot
 * see here" into "there is nothing", which is the same two-states-for-three
 * mistake `measurementCount: null` exists to avoid.
 */
it.each(["en", "zh"])("says a draft has no question set rather than reusing the other note, in %s", async (locale) => {
  await render(locale);
  await click("[data-kb-measurement-toggle]");

  const measurement = host.querySelector("[data-kb-measurement-body] [data-knowledge-copy='compact']")?.textContent ?? "";
  const trust = host.querySelector('[data-kb-section="trust"] [data-knowledge-copy="compact"]')?.textContent ?? "";
  expect(measurement.length).toBeGreaterThan(0);
  expect(measurement).not.toBe(trust);
  expect(measurement).not.toMatch(PROMISES_A_VIEW);
  // Not "0 questions": an absent set is never counted.
  expect(measurement).not.toMatch(/\d/u);

  if (locale === "en") expect(measurement).toContain("no question set");
  else expect(measurement).toContain("没有提问集");
});

/* ---------------------------------------------------------------------------
 * Getting unstuck
 *
 * The state these cover is not exotic. Confirming a new Product Profile
 * revision makes `marketing_geo_generation_input_current` false for the stored
 * draft, so every knowledge claim the update makes is refused `input_stale`;
 * that 409 is filed as retryable, `planGeoRun` re-starts a retryable operation
 * with no attempt cap, the run never rests, its row stays `running`, and the
 * single-active index then refuses every future run while the resume it
 * produces disables the Update button. Before this, neither exit the server
 * had built -- `intent: "relock"` and `action: "abandon"` -- had a single
 * non-test caller, so there was no way out of that from a browser at all.
 * ------------------------------------------------------------------------- */

const RELOCK_SHARED = {
  kbId: V3_KB_ID,
  draftVersion: 5,
  contentHash: "d".repeat(64),
  updatedAt: "2026-09-08T00:00:00.000Z",
  generationInputHash: "f".repeat(64),
  profileRef: { snapshotId: "44444444-4444-8444-8444-444444444441", snapshotRevision: "9" },
};
const REBUILT = {
  ...RELOCK_SHARED,
  relocked: true,
  blockers: [],
  discarded: { knowledge: true, decisions: 2, suppressions: 1, roles: 4, released: ["runId", "knowledgeGenerationId"] },
};
const ALREADY_CURRENT = { ...RELOCK_SHARED, relocked: false };

const abandonCalls = () => runCalls().filter((body) => body.action === "abandon");
/**
 * Every call this card made, in order, across both endpoints.
 *
 * Order is the whole safety property of the rebuild gesture: dropping the run
 * before knowing whether the draft was actually stale forfeits the run's key
 * -- and with it the knowledge step the next update has to buy again -- over a
 * draft that turned out to be current. Two per-endpoint assertions cannot see
 * that; one interleaved log can.
 */
const endpointOrder = () => allCalls().map(([url, init]) => {
  const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
  return String(url) === DRAFT_ENDPOINT
    ? `draft:${String(body.intent ?? "create")}`
    : `run:${String(body.action ?? "advance")}`;
});

/** A knowledge base pinned by a run nothing is driving: the bricked state. */
function pinnedRun(): void {
  runRead = () => Response.json({
    data: {
      status: "resumable",
      run: { runId: RUN_ID },
      operations: [{ key: "model:knowledge", kind: "model", state: "failed_retryable", reason: "store_unavailable" }],
    },
  });
}

/**
 * The shape the advance route really sends when a run lease is held.
 *
 * `kb-run-handler.ts` answers `privateJson({ data: publicResult(advanced) }, 409)`
 * -- a 409 with a `data` body and NO `error` key. The `{error:{code:"run_busy"}}`
 * body belongs to the `abandon` branch, and a test written against that shape
 * is green for something production never sends.
 */
const busyAnswer: Reply = () => Response.json(
  { data: { status: "busy", run: { runId: RUN_ID }, operations: [], waiting: [], skipped: [], remaining: "1" } },
  { status: 409 },
);
/** One backoff of the drive loop, so a streak can be counted in answers. */
async function nextBusyAnswer(): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(GEO_KB_RUN_BUSY_BACKOFF_MS); });
}

it("does not call a run blocked on one busy answer, which is an ordinary hand-off", async () => {
  pinnedRun();
  let answered = 0;
  runAdvance = (body) => {
    answered += 1;
    return answered === 1
      ? busyAnswer(body)
      : Response.json({ data: { status: "complete", run: { runId: RUN_ID }, operations: [], waiting: [], skipped: [], remaining: "0" } });
  };

  await render();
  await click("[data-run-continue]");
  // Mid-backoff, after the one busy answer: still the tab's own word, not a
  // sentence telling the owner to retry by hand while the tab is retrying.
  expect(host.querySelector('[data-run-status="blocked"]')).toBeNull();
  expect(text('[data-run-status="driving"]')).toBe(card("en").run.driving);

  await nextBusyAnswer();
  expect(text('[data-run-status="complete"]')).toBe(card("en").run.complete);
  expect(host.querySelector('[data-run-status="blocked"]')).toBeNull();
});

it("says what the server actually answered once the refusal is sustained, and keeps retrying", async () => {
  pinnedRun();
  runAdvance = busyAnswer;

  await render();
  await click("[data-run-continue]");
  const afterFirst = advanceCalls().length;
  for (let i = 1; i < GEO_KB_RUN_BUSY_VOICE; i += 1) await nextBusyAnswer();

  expect(text('[data-run-status="blocked"]')).toBe(card("en").run.blocked);
  // The wording changed; the loop did not. It is still calling, because the
  // lease it is waiting out expires on its own and the next call after that
  // claims the run with no gesture from anyone.
  expect(advanceCalls().length).toBeGreaterThan(afterFirst);
  const afterVoice = advanceCalls().length;
  await nextBusyAnswer();
  expect(advanceCalls().length).toBeGreaterThan(afterVoice);
});

it("takes the word back as soon as the run moves", async () => {
  pinnedRun();
  runAdvance = busyAnswer;

  await render();
  await click("[data-run-continue]");
  for (let i = 1; i < GEO_KB_RUN_BUSY_VOICE; i += 1) await nextBusyAnswer();
  expect(text('[data-run-status="blocked"]')).toBe(card("en").run.blocked);

  // The lease expired and the loop -- still running, because nothing capped it
  // -- claimed the run. One non-busy answer is enough to end the streak: the
  // sentence is about a refusal that is still happening, not about one that
  // happened.
  runAdvance = () => Response.json({
    data: { status: "stalled", run: { runId: RUN_ID }, operations: [], waiting: [], skipped: [], remaining: "1" },
  });
  await nextBusyAnswer();
  expect(host.querySelector('[data-run-status="blocked"]')).toBeNull();
  expect(text('[data-run-status="stalled"]')).toBe(card("en").run.stalled);

});

it("counts a refusal that is still happening, not refusals that have happened", async () => {
  pinnedRun();
  // One drive, no second press: within a single drive the only thing that can
  // end a streak is a non-busy answer. Four busies, then the run moves, then
  // one more busy -- five busy answers in all, and none of them a sustained
  // refusal. A count that never reset would speak on the fifth.
  const running = () => Response.json({
    data: { status: "running", run: { runId: RUN_ID }, operations: [], waiting: [], skipped: [], remaining: "1" },
  });
  let answered = 0;
  runAdvance = (body) => {
    answered += 1;
    if (answered === GEO_KB_RUN_BUSY_VOICE) return running();
    if (answered > GEO_KB_RUN_BUSY_VOICE + 1) return hangs(body);
    return busyAnswer(body);
  };

  await render();
  await click("[data-run-continue]");
  for (let i = 1; i < GEO_KB_RUN_BUSY_VOICE + 1; i += 1) await nextBusyAnswer();

  expect(answered).toBeGreaterThan(GEO_KB_RUN_BUSY_VOICE);
  expect(host.querySelector('[data-run-status="blocked"]')).toBeNull();
});

/** The abandon answer, alongside whatever `runAdvance` was already doing. */
function abandonAnswers(reply: Reply): void {
  const advance = runAdvance;
  runAdvance = (body) => (body.action === "abandon" ? reply(body) : advance(body));
}

/** A locked input the billed update provably cannot build a synthesis input from. */
function withIdentity(overrides: Record<string, unknown>): Partial<GeoKbEditorViewV3> {
  const payload = {
    ...PAYLOAD,
    generationInput: {
      ...PAYLOAD.generationInput,
      identity: { ...PAYLOAD.generationInput.identity, ...overrides },
    },
  } as typeof PAYLOAD;
  return { payload, draftHash: geoV2Digest(payload) };
}

it.each([
  ["en",
    "This update is stopped, and a new one cannot start while it is still open. If you confirmed a new Product Profile version after this draft was locked, no update can run until the draft is rebuilt against it.",
    "Rebuild this draft from the confirmed Profile"],
  ["zh",
    "这次更新已经停下，而且只要它还开着，就无法开始新的更新。如果你在这份草稿锁定之后确认了新的产品档案版本，那么在草稿按新版本重建之前，任何更新都跑不起来。",
    "按已确认的产品档案重建这份草稿"],
])("names the cause it cannot rule out, in %s, rather than an outage", async (locale, stuck, rebuild) => {
  pinnedRun();

  await render(locale);

  expect(button("[data-generate-kb]")?.disabled).toBe(true);
  // Written out rather than read from the catalog: an assertion filled from
  // the same leaf the component rendered from passes for every wording,
  // including one that goes back to claiming an outage.
  expect(text("[data-kb-stuck]")).toBe(stuck);
  expect(button("[data-kb-rebuild]")?.textContent).toBe(rebuild);
  expect(button("[data-kb-discard-run]")).not.toBeNull();
  // Drawing the way out spends nothing and changes nothing.
  expect(endpointOrder()).toEqual(["run:read"]);
});

it("rebuilds the draft first and clears the run it pinned second", async () => {
  pinnedRun();
  draftReply = () => Response.json({ data: REBUILT });
  abandonAnswers(() => Response.json({ data: { status: "abandoned" } }));

  await render();
  await click("[data-kb-rebuild]");

  expect(endpointOrder()).toEqual(["run:read", "draft:relock", "run:abandon"]);
  // The route needs the version and the digest of the exact draft being
  // discarded; sending anything else is asking it to discard a draft this card
  // never showed anybody.
  expect(draftCalls()).toEqual([{
    kbId: V3_KB_ID, intent: "relock", baseVersion: 4, draftHash: geoV2Digest(PAYLOAD),
  }]);
  expect(abandonCalls()).toEqual([{ kbId: V3_KB_ID, runId: RUN_ID, action: "abandon" }]);

  // What it cost, on the screen, in the owner's words.
  expect(text('[data-kb-discarded="knowledge"]'))
    .toBe("The knowledge this draft held was discarded, so the next update generates and pays for it again.");
  // Decisions and suppressions counted together: 2 + 1.
  expect(text('[data-kb-discarded="review"]')).toBe("3 records of what you decided went with it.");
  expect(text('[data-kb-discarded="roles"]'))
    .toBe("4 audience roles an earlier update had proposed went with it.");
  expect(host.querySelector('[data-kb-discarded="none"]')).toBeNull();
  expect(host.querySelector("[data-kb-run-cleared]")?.getAttribute("data-kb-run-cleared")).toBe("cleared");
  expect(text("[data-kb-run-cleared]")).toBe("The stopped update is no longer open, so a new one can start.");

  // The draft on this screen no longer exists, so none of it is drawn as
  // current and neither of the two things that act on it is offered.
  expect(rows()).toHaveLength(0);
  expect(host.querySelector("[data-kb-section]")).toBeNull();
  expect(host.querySelector("[data-kb-publish-box]")).toBeNull();
  expect(host.querySelector("[data-publish-kb]")).toBeNull();
  expect(host.querySelector("[data-run-panel]")).toBeNull();
  expect(button("[data-generate-kb]")?.disabled).toBe(true);
  expect(host.querySelector("[data-kb-state]")?.getAttribute("data-kb-state")).toBe("rebuilt");
  expect(text("[data-kb-state]"))
    .toBe("Reload the page to see the rebuilt draft. Until then this card is showing the one that was replaced.");
  expect(host.textContent).not.toContain("A draft is ready for you to publish.");
});

/**
 * The fallback, tested because it is the only one anything uses today.
 *
 * `website-geo-editor.tsx` renders this card without `onReload`, so a dead
 * default would leave an owner looking at a draft the server has replaced,
 * with a button that does nothing. jsdom has no navigation, so `reload` is
 * stubbed the way `sign-out-action.test.ts` stubs it.
 */
it.each([
  ["a lease that is still live", 409, { error: { code: "run_busy" } }, "busy",
    "The stopped update could not be cleared yet because something is still holding it. Reload the page and discard it there in a moment."],
  ["a store that could not answer", 503, { error: { code: "store_unavailable" } }, "failed",
    "The stopped update could not be cleared. Reload the page and discard it there."],
])("says the rebuild landed but %s left the run pinned", async (_, status, body, marker, sentence) => {
  pinnedRun();
  draftReply = () => Response.json({ data: REBUILT });
  abandonAnswers(() => Response.json(body, { status }));

  await render();
  await click("[data-kb-rebuild]");

  // The rebuild itself did happen, and its cost is still reported.
  expect(host.querySelector('[data-kb-discarded="knowledge"]')).not.toBeNull();
  // What did not happen is the part that gives the Update button back. Saying
  // it did would send the owner to a button that is still disabled, over a run
  // the route would still answer `run_active` for.
  expect(host.querySelector("[data-kb-run-cleared]")?.getAttribute("data-kb-run-cleared")).toBe(marker);
  expect(text("[data-kb-run-cleared]")).toBe(sentence);
  expect(host.textContent).not.toContain("The stopped update is no longer open, so a new one can start.");
  expect(button("[data-generate-kb]")?.disabled).toBe(true);
});

it("stops repeating what the replaced draft blocked on", async () => {
  draftReply = () => Response.json({ data: REBUILT });

  await render("en", withIdentity({ categoryTerms: [] }));
  expect(text('[data-kb-blocker="category_terms_missing"]')).toBe("Add at least one category word.");
  await click("[data-kb-rebuild]");

  // The list was read off the draft the re-lock just replaced. Repeating it
  // tells an owner who has already added a category to add one, over a rebuild
  // they made because they did.
  expect(host.querySelector("[data-kb-blockers]")).toBeNull();
  expect(host.textContent).not.toContain("Add at least one category word.");
  expect(text('[data-kb-recovery-status="rebuilt"]')).not.toBeNull();
});

it("reloads the page itself when no caller owns a re-read", async () => {
  pinnedRun();
  draftReply = () => Response.json({ data: REBUILT });
  abandonAnswers(() => Response.json({ data: { status: "abandoned" } }));
  const original = Object.getOwnPropertyDescriptor(window, "location");
  const reload = vi.fn();
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, reload } });
  try {
    await render();
    await click("[data-kb-rebuild]");
    await click("[data-kb-reload]");

    expect(reload).toHaveBeenCalledTimes(1);
  } finally {
    if (original !== undefined) Object.defineProperty(window, "location", original);
  }
});

it("hands the reload to the caller that owns one", async () => {
  pinnedRun();
  draftReply = () => Response.json({ data: REBUILT });
  abandonAnswers(() => Response.json({ data: { status: "abandoned" } }));
  const onReload = vi.fn();

  await render("en", {}, { onReload });
  await click("[data-kb-rebuild]");
  await click("[data-kb-reload]");

  expect(onReload).toHaveBeenCalledTimes(1);
});

it("leaves the run alone when the draft turns out to be current", async () => {
  pinnedRun();
  draftReply = () => Response.json({ data: ALREADY_CURRENT });
  abandonAnswers(() => Response.json({ data: { status: "abandoned" } }));

  await render();
  await click("[data-kb-rebuild]");

  // The re-lock wrote nothing and minted no version, so there is nothing to
  // clean up after -- and dropping the run here would forfeit its key, and the
  // knowledge step the next update would have to buy again, for nothing.
  expect(endpointOrder()).toEqual(["run:read", "draft:relock"]);
  expect(abandonCalls()).toEqual([]);
  expect(text('[data-kb-recovery-status="current"]'))
    .toBe("This draft already names the confirmed Product Profile version, so nothing was rebuilt and nothing was discarded.");
  // Nothing was destroyed, so the draft is still drawn and still publishable.
  expect(rows()).toHaveLength(ITEM_KEYS.length);
  expect(host.querySelector("[data-kb-publish-box]")).not.toBeNull();
  // And the run is still pinned, so the exit that drops it is still offered.
  expect(button("[data-run-continue]")).not.toBeNull();
  expect(button("[data-kb-discard-run]")).not.toBeNull();
  expect(button("[data-generate-kb]")?.disabled).toBe(true);
});

it.each([
  ["auth_required", 401,
    "This was refused because you are not signed in. Nothing was changed. Sign in again and try once more."],
  ["rate_limited", 429,
    "This knowledge base has been asked to rebuild too many times in the last hour. Nothing was changed. Try again later."],
  ["conflict", 409,
    "This knowledge base changed somewhere else, so nothing was changed here. Reload the page and try again."],
  ["legacy_draft", 409,
    "This knowledge base changed somewhere else, so nothing was changed here. Reload the page and try again."],
  ["generation_running", 409,
    "Something this draft already paid for is still running. Nothing was changed. Try again once it has finished."],
  ["profile_not_confirmed", 409,
    "The Product Profile cannot be used to rebuild this draft. Nothing was changed. Check and confirm the Profile, then try again."],
  ["profile_unusable", 422,
    "The Product Profile cannot be used to rebuild this draft. Nothing was changed. Check and confirm the Profile, then try again."],
  ["store_unavailable", 503,
    "The rebuild did not complete, and this page cannot tell whether the draft was changed. Reload the page to see where it stands."],
  ["not_found", 404,
    "The rebuild did not complete, and this page cannot tell whether the draft was changed. Reload the page to see where it stands."],
])("says what a rebuild refused with %s did and did not do", async (code, status, sentence) => {
  pinnedRun();
  draftReply = () => Response.json({ error: { code } }, { status });
  abandonAnswers(() => Response.json({ data: { status: "abandoned" } }));

  await render();
  await click("[data-kb-rebuild]");

  expect(text('[data-kb-recovery-status="rebuildFailed"]')).toBe(sentence);
  // A rebuild that did not happen must not take the run with it: the run is
  // still the owner's only record of what that update did.
  expect(abandonCalls()).toEqual([]);
  expect(button("[data-run-continue]")).not.toBeNull();
  // The draft is untouched, so it is still drawn.
  expect(rows()).toHaveLength(ITEM_KEYS.length);
});

it("refuses to claim nothing was changed when it cannot tell", async () => {
  pinnedRun();
  // The one refusal a *successful* write also produces: the store saved the
  // draft and returned a digest that was not ours. Saying "nothing was
  // changed" over it would be a claim about the owner's paid work that this
  // page has no evidence for.
  draftReply = () => Response.json({ error: { code: "store_unavailable" } }, { status: 503 });

  await render();
  await click("[data-kb-rebuild]");

  expect(text('[data-kb-recovery-status="rebuildFailed"]')).not.toContain("Nothing was changed");
});

it.each([
  ["abandoned", 200, { data: { status: "abandoned" } }, "The stopped update was discarded. You can start a new one.", "discarded", false],
  ["finished", 200, { data: { status: "finished" } }, "There is no stopped update left to discard. You can start a new one.", "discarded", false],
  ["not_found", 404, { error: { code: "not_found" } }, "There is no stopped update left to discard. You can start a new one.", "discarded", false],
  ["run_busy", 409, { error: { code: "run_busy" } }, "Something is still working on this update, so it was not discarded. Try again in a moment.", "discardBusy", true],
  ["store_unavailable", 503, { error: { code: "store_unavailable" } }, "The stopped update could not be discarded. Reload the page to see whether it is still open.", "discardFailed", true],
])("reports discarding a stopped update answered %s", async (_, status, body, sentence, marker, stillPinned) => {
  pinnedRun();
  abandonAnswers(() => Response.json(body, { status }));

  await render();
  await click("[data-kb-discard-run]");

  expect(abandonCalls()).toEqual([{ kbId: V3_KB_ID, runId: RUN_ID, action: "abandon" }]);
  expect(text(`[data-kb-recovery-status="${marker}"]`)).toBe(sentence);
  // The Update button comes back only when nothing is pinned any more. A
  // refusal that left the run in place must leave it disabled, or the owner
  // presses it and the route answers `run_active`.
  expect(button("[data-generate-kb]")?.disabled).toBe(stillPinned);
  expect(button("[data-run-continue]") === null).toBe(!stillPinned);
  // Nothing about the draft itself was touched either way.
  expect(rows()).toHaveLength(ITEM_KEYS.length);
});

/* ---------------------------------------------------------------------------
 * A recovery button either works or says why it cannot
 *
 * Both handlers returned early while a run was being checked for or driven,
 * and both buttons were `disabled={working}` alone -- so a press in either
 * window produced no request, no message and no reason. Measured on the two
 * windows an owner actually reaches: a blocked draft during the mount check
 * ({rendered: true, disabled: false, relockPosts: 0, status: "NONE"}) and a
 * pinned run the server keeps answering `run_busy`, which never increments the
 * loop's stall counter and so backs off for up to twenty minutes of
 * `driving`.
 * ------------------------------------------------------------------------- */

it.each([
  ["en", "Checking whether an earlier update is still open…"],
  ["zh", "正在检查是否还有没结束的更新…"],
])("holds the recovery gestures while the run check is still out, in %s", async (locale, sentence) => {
  runRead = hangs;

  await render(locale, withIdentity({ categoryTerms: [] }));

  // The panel is painted from the draft alone, so on a blocked draft the one
  // way out is on screen for the whole of this window.
  expect(host.querySelector("[data-kb-recovery]")).not.toBeNull();
  expect(button("[data-kb-rebuild]")).not.toBeNull();
  expect(button("[data-kb-rebuild]")?.disabled).toBe(true);
  expect(host.querySelector("[data-kb-recovery-hold]")?.getAttribute("data-kb-recovery-hold")).toBe("checking");
  expect(text("[data-kb-recovery-hold]")).toBe(sentence);

  await click("[data-kb-rebuild]");
  expect(draftCalls()).toEqual([]);
});

it("gives the recovery gestures back when the run check never answers", async () => {
  runRead = hangs;
  draftReply = () => Response.json({ data: ALREADY_CURRENT });

  await render("en", withIdentity({ categoryTerms: [] }));
  expect(button("[data-kb-rebuild]")?.disabled).toBe(true);

  // Half the deadline first, so this proves a deadline and not merely "some
  // timer somewhere". The fraction is taken from the constant on purpose: the
  // property is "not before it, released at it", which cannot be stated
  // without it -- and shrinking the constant to zero turns this line red.
  await act(async () => { vi.advanceTimersByTime(Math.floor(GEO_KB_RUN_CHECK_MS / 2)); });
  expect(button("[data-kb-rebuild]")?.disabled).toBe(true);

  await act(async () => { vi.advanceTimersByTime(GEO_KB_RUN_CHECK_MS); });

  // A read that never answers says exactly what a refused one says: this page
  // knows of no run to continue. Waiting on it forever instead would leave the
  // only exit disabled under an ellipsis promising an answer that is not
  // coming, with nothing suggesting a reload.
  expect(button("[data-kb-rebuild]")?.disabled).toBe(false);
  expect(host.querySelector("[data-kb-recovery-hold]")).toBeNull();

  await click("[data-kb-rebuild]");
  expect(draftCalls()).toHaveLength(1);
  expect(text('[data-kb-recovery-status="current"]'))
    .toBe("This draft already names the confirmed Product Profile version, so nothing was rebuilt and nothing was discarded.");
});

/**
 * The deadline above may hand the card back, and it may not touch anything
 * else.
 *
 * Once the owner has started an update, a check that finally answers is
 * describing the world from before that press. Releasing the phase outright
 * would report a running update as idle -- re-enabling the billed button over
 * a run whose loop is still calling -- and adopting the run it names would
 * point the next continuation at the wrong one.
 */
it("does not cancel an update the owner started while the check was still out", async () => {
  let answer: ((value: Response) => void) | null = null;
  runRead = () => new Promise<Response>((resolve) => { answer = resolve; });
  runAdvance = hangs;

  await render();
  await act(async () => { vi.advanceTimersByTime(GEO_KB_RUN_CHECK_MS); });
  expect(button("[data-generate-kb]")?.disabled).toBe(false);

  await click("[data-generate-kb]");
  expect(text('[data-run-status="driving"]')).toBe("Updating…");

  await act(async () => {
    answer?.(Response.json({ data: { status: "resumable", run: { runId: RUN_ID }, operations: [] } }));
  });

  expect(text('[data-run-status="driving"]')).toBe("Updating…");
  expect(button("[data-generate-kb]")?.disabled).toBe(true);
  // And the run the late read named was not adopted: this tab already has one.
  expect(button("[data-run-continue]")).toBeNull();
});

it("holds both recovery gestures while an update is running, and says why", async () => {
  pinnedRun();
  runAdvance = hangs;

  await render();
  // Before the press they are live, so what follows is a change of state and
  // not a panel that is disabled from birth.
  expect(button("[data-kb-rebuild]")?.disabled).toBe(false);
  expect(button("[data-kb-discard-run]")?.disabled).toBe(false);

  await click("[data-run-continue]");

  expect(button("[data-kb-rebuild]")?.disabled).toBe(true);
  expect(button("[data-kb-discard-run]")?.disabled).toBe(true);
  expect(host.querySelector("[data-kb-recovery-hold]")?.getAttribute("data-kb-recovery-hold")).toBe("driving");
  expect(text("[data-kb-recovery-hold]")).toBe("Updating…");

  await click("[data-kb-rebuild]");
  await click("[data-kb-discard-run]");
  expect(draftCalls()).toEqual([]);
  expect(abandonCalls()).toEqual([]);
});

/**
 * `rebuild` already refused while the editor was writing, and said nothing.
 *
 * The rule is the one the `gesture` latch states: one server-changing gesture
 * at a time. Discarding a run touches nothing the editor writes, so holding it
 * here is stricter than it has to be -- and it is the same rule, stated once,
 * which is what stops the rendered gate and the handler's gate from drifting
 * apart again.
 */
it("holds the recovery gestures while a decision is still being saved, and says why", async () => {
  pinnedRun();
  v3Reply = hangs;

  await render();
  await act(async () => { (rows()[0]!.querySelector('[data-item-action="accept"]') as HTMLButtonElement).click(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(GEO_KB_V3_AUTOSAVE_MS); });

  expect(text("[data-review-status]")).toBe("Saving…");
  expect(host.querySelector("[data-kb-recovery-hold]")?.getAttribute("data-kb-recovery-hold")).toBe("saving");
  expect(text("[data-kb-recovery-hold]")).toBe("Saving…");
  expect(button("[data-kb-rebuild]")?.disabled).toBe(true);
  expect(button("[data-kb-discard-run]")?.disabled).toBe(true);

  await click("[data-kb-rebuild]");
  expect(draftCalls()).toEqual([]);
});

/**
 * The third reason a recovery button is disabled, and the sentence that goes
 * with it.
 *
 * `held` is `working || hold !== null`, so every disabled state has to carry a
 * reason: `hold` gets the line beside the buttons, and a gesture already in
 * flight gets the working line below them. A disabled button with no sentence
 * anywhere is the same dead end as a live one that does nothing.
 */
it.each([
  ["[data-kb-rebuild]", "Rebuilding this draft…"],
  ["[data-kb-discard-run]", "Discarding the stopped update…"],
])("disables both recovery buttons and names the gesture already running, from %s", async (pressed, sentence) => {
  pinnedRun();
  draftReply = hangs;
  abandonAnswers(hangs);

  await render();
  await click(pressed);

  expect(button("[data-kb-rebuild]")?.disabled).toBe(true);
  expect(button("[data-kb-discard-run]")?.disabled).toBe(true);
  expect(text('[data-kb-recovery-status="working"]')).toBe(sentence);
  // And the third button that shares the same latch. `drive` refuses while
  // either recovery gesture holds it, so a live Continue here is a press that
  // starts nothing and says nothing.
  expect(button("[data-run-continue]")?.disabled).toBe(true);
});

/* ---------------------------------------------------------------------------
 * One press is one request
 *
 * Two clicks inside one task run the same handler closure, so a guard reading
 * this render's state still reads "idle" in the second one. The latch is a
 * ref for that reason, and it was load-bearing and unverified: with the latch
 * removed from `rebuild`, a double press sent two `intent: "relock"` POSTs --
 * two attempts at the destructive route, against a bucket of four an hour.
 * ------------------------------------------------------------------------- */

it("sends one rebuild for a double press, not two", async () => {
  pinnedRun();
  draftReply = () => Response.json({ data: REBUILT });
  abandonAnswers(() => Response.json({ data: { status: "abandoned" } }));

  await render();
  const target = button("[data-kb-rebuild]")!;
  await act(async () => { target.click(); target.click(); });

  expect(draftCalls()).toHaveLength(1);
  expect(abandonCalls()).toHaveLength(1);
  expect(endpointOrder()).toEqual(["run:read", "draft:relock", "run:abandon"]);
});

it("sends one abandon for a double press, not two", async () => {
  pinnedRun();
  abandonAnswers(() => Response.json({ data: { status: "abandoned" } }));

  await render();
  const target = button("[data-kb-discard-run]")!;
  await act(async () => { target.click(); target.click(); });

  expect(abandonCalls()).toHaveLength(1);
});

it("opens one update call for a double press on continue, not two", async () => {
  pinnedRun();

  await render();
  const target = button("[data-run-continue]")!;
  await act(async () => { target.click(); target.click(); });

  expect(advanceCalls()).toHaveLength(1);
  expect(advanceCalls()[0]!.runId).toBe(RUN_ID);
});

it("opens one update call for a double press on the update button, not two", async () => {
  await render();
  const target = button("[data-generate-kb]")!;
  await act(async () => { target.click(); target.click(); });

  expect(advanceCalls()).toHaveLength(1);
  expect(advanceCalls()[0]!.idempotencyKey).toEqual(expect.any(String));
});

/* ---------------------------------------------------------------------------
 * What the owner is told before pressing
 *
 * Every *outcome* sentence in this file was already written out. The *consent*
 * ones were pinned by nothing: measured before this, each of the three below
 * could be replaced with an empty string and the whole suite stayed green --
 * including the one that says a rebuild "discards the knowledge it holds …and
 * the next update generates and pays for that knowledge again", which is the
 * only thing that makes the button legitimate.
 * ------------------------------------------------------------------------- */

/** The claim each note may not lose to a rewrite: this costs money again. */
const REBILLS: Readonly<Record<string, RegExp>> = {
  en: /pays for [^.]*again/iu,
  zh: /重新计费/u,
};
/** And the one the blocked note may not lose: where the owner has to go. */
const NAMES_THE_PROFILE: Readonly<Record<string, RegExp>> = {
  en: /Product Profile/u,
  zh: /产品档案/u,
};

it.each([
  ["en",
    "Fix this in the Product Profile and confirm it, then rebuild this draft below. Until then an update would stop before it produced anything.",
    "If this draft is out of date, rebuilding it discards the knowledge it holds and everything recorded about it, and the next update generates and pays for that knowledge again. If it is already up to date, nothing is written and nothing is discarded. Rebuilding itself makes no model call and reads no page.",
    "The stopped update is dropped so a new one can start. Nothing it already sent is undone, and anything it sent without learning the outcome stays unresolved; the next update starts from the beginning and pays for the knowledge again."],
  ["zh",
    "请在产品档案里补齐并确认，然后在下方重建这份草稿。在那之前，更新会在产出任何内容之前就停下。",
    "如果这份草稿已经过期，重建会丢弃它持有的知识内容和你在上面留下的全部记录，下一次更新会重新生成并重新计费。如果它本来就是最新的，则什么都不会写入，也不会丢弃任何东西。重建本身不调用模型，也不抓取任何页面。",
    "丢弃后就能开始新的更新。它已经发出的请求不会被撤销，其中结果未知的那些仍然结果未知；下一次更新会从头开始，并为知识内容重新计费。"],
])("says what each recovery button costs before it is pressed, in %s", async (locale, blocked, rebuild, discard) => {
  pinnedRun();

  await render(locale, withIdentity({ categoryTerms: [] }));

  // Written out, never read from the catalog: an assertion filled from the
  // leaf the component rendered from is satisfied by any wording at all,
  // the empty string included.
  expect(text("[data-kb-blocked-note]")).toBe(blocked);
  expect(text("[data-kb-rebuild-note]")).toBe(rebuild);
  expect(text("[data-kb-discard-note]")).toBe(discard);
  // And the claims those sentences carry, so that a legitimate rewrite still
  // has to keep them. Read off the render, not off the literals above.
  expect(text("[data-kb-blocked-note]") ?? "").toMatch(NAMES_THE_PROFILE[locale]!);
  expect(text("[data-kb-rebuild-note]") ?? "").toMatch(REBILLS[locale]!);
  expect(text("[data-kb-discard-note]") ?? "").toMatch(REBILLS[locale]!);
});

it("says nothing about a stopped update over a blocked draft that has no run", async () => {
  await render("en", withIdentity({ categoryTerms: [] }));

  expect(host.querySelector("[data-kb-recovery]")).not.toBeNull();
  // Three states, not two: blocked with no run is neither "fine" nor
  // "stopped", and the stopped sentence over a draft with no run at all sends
  // the owner looking for an update that was never started.
  expect(host.querySelector("[data-kb-stuck]")).toBeNull();
  expect(host.textContent).not.toContain("This update is stopped");
  expect(host.querySelector("[data-kb-discard-run]")).toBeNull();
  expect(host.querySelector("[data-kb-discard-note]")).toBeNull();
  expect(host.textContent).not.toContain("The stopped update is dropped so a new one can start.");
  // The rebuild is the exit here, and it is offered and live.
  expect(button("[data-kb-rebuild]")?.disabled).toBe(false);
});

/* ---------------------------------------------------------------------------
 * What a rebuild discarded, counted rather than assumed
 * ------------------------------------------------------------------------- */

const relockDiscarding = (discarded: Record<string, unknown>) => () => Response.json({
  data: { ...RELOCK_SHARED, relocked: true, blockers: [], discarded: { released: [], ...discarded } },
});

it("says nothing was discarded only when the rebuild discarded nothing", async () => {
  draftReply = relockDiscarding({ knowledge: false, decisions: 0, suppressions: 0, roles: 0 });

  await render("en", withIdentity({ categoryTerms: [] }));
  await click("[data-kb-rebuild]");

  expect(text('[data-kb-discarded="none"]'))
    .toBe("It held nothing an update had produced, so nothing was discarded.");
  expect(host.querySelector('[data-kb-discarded="knowledge"]')).toBeNull();
  expect(host.querySelector('[data-kb-discarded="review"]')).toBeNull();
  expect(host.querySelector('[data-kb-discarded="roles"]')).toBeNull();
});

it.each([
  ["a suppression", { knowledge: false, decisions: 0, suppressions: 1, roles: 0 }],
  ["a decision", { knowledge: false, decisions: 1, suppressions: 0, roles: 0 }],
  ["a proposed role", { knowledge: false, decisions: 0, suppressions: 0, roles: 1 }],
  ["the knowledge itself", { knowledge: true, decisions: 0, suppressions: 0, roles: 0 }],
])("refuses to say nothing was discarded when the rebuild discarded %s", async (_, discarded) => {
  draftReply = relockDiscarding(discarded);

  await render("en", withIdentity({ categoryTerms: [] }));
  await click("[data-kb-rebuild]");

  expect(text('[data-kb-recovery-status="rebuilt"]')).not.toBeNull();
  expect(host.querySelector('[data-kb-discarded="none"]')).toBeNull();
  expect(host.textContent).not.toContain("nothing was discarded");
});

it.each([
  ["finished", 200, { data: { status: "finished" } }],
  ["not_found", 404, { error: { code: "not_found" } }],
])("calls the pinned run cleared when the abandon after a rebuild answered %s", async (_, status, body) => {
  pinnedRun();
  draftReply = () => Response.json({ data: REBUILT });
  abandonAnswers(() => Response.json(body, { status }));

  await render();
  await click("[data-kb-rebuild]");

  // Both mean the run is no longer open, which is the whole of what
  // `recovery.rebuildCleared` claims -- it never says this call closed it.
  // Filing them as failures would send an owner to reload and discard a run
  // that is already gone.
  expect(host.querySelector("[data-kb-run-cleared]")?.getAttribute("data-kb-run-cleared")).toBe("cleared");
  expect(text("[data-kb-run-cleared]")).toBe("The stopped update is no longer open, so a new one can start.");
  expect(host.textContent).not.toContain("The stopped update could not be cleared");
});

/* ---------------------------------------------------------------------------
 * A draft a normal Profile can reach, and the sentence it must never get
 *
 * `categories` is not in `REQUIRED_PROFILE_FIELDS`, so a Profile confirms
 * without one; the create route files `category_terms_missing` on the draft it
 * makes, and the card that pressed the button drops it. The billed update can
 * then never build its input at all -- `buildGeoKnowledgeSynthesisInputV2`
 * requires at least one category term -- so "a draft is ready for you to
 * publish" is false in a way the owner cannot see.
 * ------------------------------------------------------------------------- */

it.each([
  ["en",
    "This draft cannot be updated yet.",
    "Add at least one category word.",
    "A draft is ready for you to publish."],
  ["zh",
    "这份草稿还不能更新。",
    "至少填一个品类词。",
    "草稿已就绪，等你发布。"],
])("refuses to call a blocked draft ready to publish, in %s", async (locale, status, blocker, ready) => {
  await render(locale, withIdentity({ categoryTerms: [] }));

  expect(host.querySelector("[data-kb-state]")?.getAttribute("data-kb-state")).toBe("blocked");
  expect(text("[data-kb-state]")).toBe(status);
  expect(host.textContent).not.toContain(ready);
  expect(text('[data-kb-blocker="category_terms_missing"]')).toBe(blocker);
  // The billed gesture is not merely discouraged: the run it starts cannot
  // build its input, so every press ends in the same stopped update.
  expect(button("[data-generate-kb]")?.disabled).toBe(true);
  // The way out is the rebuild, once the Profile has been fixed and confirmed.
  expect(button("[data-kb-rebuild]")).not.toBeNull();
  // There is no run here, so there is nothing to discard.
  expect(button("[data-kb-discard-run]")).toBeNull();
});

/**
 * D8: the knowledge body follows the site's own language.
 *
 * This used to show "the question registry does not support the selected
 * language" and DISABLE the update button. The English registry governs the
 * question set, which a v3 draft never has, so the sentence disabled a Chinese
 * site's only working gesture over a step that was never going to run for
 * anybody. What the owner is told instead is stated at publish time: this
 * version has no question set, and why.
 */
it("lets a site the question registry has no templates for run its update", async () => {
  await render("en", withIdentity({ market: { country: "CN", language: "zh-cn" } }));

  expect(host.querySelector('[data-kb-blocker="unsupported_language"]')).toBeNull();
  expect(host.querySelector('[data-kb-blocker="category_terms_missing"]')).toBeNull();
  expect(button("[data-generate-kb]")?.disabled).toBe(false);
  // Nothing sent by rendering: the button is enabled, not pressed.
  expect(calls()).toEqual([]);
});

it("keeps a published version's line when the draft over it is blocked", async () => {
  await render("en", {
    ...withIdentity({ categoryTerms: [] }),
    published: {
      kind: "comparable",
      revision: 2,
      frozenAt: "2026-09-01T00:00:00.000Z",
      contentHash: "b".repeat(64),
      decisions: {},
    },
  });

  // Three states, not two: something is published, the draft over it cannot be
  // updated, and neither fact erases the other.
  expect(host.querySelector("[data-kb-state]")?.getAttribute("data-kb-state")).toBe("published");
  expect(text("[data-kb-state]")).toContain("Published kb@v2");
  expect(text('[data-kb-blocker="category_terms_missing"]')).toBe("Add at least one category word.");
  expect(button("[data-generate-kb]")?.disabled).toBe(true);
});

it("draws none of this over a draft that can be updated", async () => {
  await render();

  // The guard above has to be a guard, not a permanent banner: an ordinary
  // draft keeps its own status line and gets no recovery panel at all.
  expect(host.querySelector("[data-kb-recovery]")).toBeNull();
  expect(host.querySelector("[data-kb-blockers]")).toBeNull();
  expect(text("[data-kb-state]")).toBe("A draft is ready for you to publish.");
  expect(button("[data-generate-kb]")?.disabled).toBe(false);
});

/**
 * The blocked draft the product actually makes, built by the route's own
 * functions and read back through the browser's own parser.
 *
 * The blocked-draft tests above start from a complete fixture with its
 * categories removed, which is a draft no route ever writes: a real one has
 * `knowledge: null` and an empty review, because nothing has run yet. That
 * shape is the whole scenario -- confirm a Profile with no categories, press
 * start, reload -- and a card that threw on it, or a wire parser that refused
 * it, would make every assertion above true of a surface nobody can reach.
 */
const CREATED_REFERENCE: WebsiteProfileReferenceV1 = {
  schemaVersion: "website-profile-reference.v1",
  websiteId: "55555555-5555-8555-8555-555555555551",
  snapshotId: "55555555-5555-8555-8555-555555555552",
  snapshotRevision: 4,
  profileSchemaVersion: "marketing-website-profile.v1",
  profileHash: "c".repeat(64),
};

function createdDraft(overrides: Partial<MarketingWebsiteProfileV1>) {
  const built = buildGeoKbV3Identity({
    targetUrl: "https://example.com/",
    reference: CREATED_REFERENCE,
    profile: {
      ...emptyMarketingWebsiteProfile(),
      productName: "AstrologyWiki",
      oneLinePositioning: "Charts for astrologers.",
      coreFeatures: ["birth charts"],
      categories: ["astrology software"],
      directCompetitors: ["astro.example"],
      country: "US",
      locale: "en",
      ...overrides,
    },
  });
  if (built.kind !== "ok") throw new Error(`expected a usable Profile, got ${built.fields.join(",")}`);
  return { payload: createGeoKbDraftPayloadV3(lockGeoKbV3GenerationInput(built, GEO_ABSENT_EVIDENCE_CONTENT_HASH)), blockers: built.blockers };
}

it("refuses to call the draft a category-less Profile actually produces ready to publish", async () => {
  const created = createdDraft({ categories: [] });
  // The route files the blocker on the draft it makes; the start card drops
  // that answer on the floor, so this is the only surface that can say it.
  expect([...created.blockers]).toEqual(["category_terms_missing"]);
  // Through the wire parser the website GEO response is read with, so this is
  // a view the loader can actually hand over rather than one only a test can
  // build.
  const parsed = parseGeoKbEditorViewV3({
    schemaVersion: GEO_KB_EDITOR_V3_SCHEMA_VERSION,
    kbId: V3_KB_ID,
    origin: "https://example.com",
    host: "example.com",
    draftVersion: 1,
    draftHash: geoV2Digest(created.payload),
    payload: created.payload,
    restated: geoV3RestatedItemKeys(created.payload.knowledge, created.payload.review),
    published: null,
  });
  if (parsed === null) throw new Error("the created draft did not survive the wire parser");

  await act(async () => root.render(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={en}>
      <GeoKnowledgeBaseV3 view={parsed} locale="en" />
    </NextIntlClientProvider>,
  ));

  expect(host.querySelector("[data-geo-kb-v3]")).not.toBeNull();
  expect(host.querySelector("[data-kb-state]")?.getAttribute("data-kb-state")).toBe("blocked");
  expect(text("[data-kb-state]")).toBe("This draft cannot be updated yet.");
  expect(host.textContent).not.toContain("A draft is ready for you to publish.");
  expect(text('[data-kb-blocker="category_terms_missing"]')).toBe("Add at least one category word.");
  expect(button("[data-generate-kb]")?.disabled).toBe(true);
  // Nothing has run, so there is nothing to review and no run to continue.
  expect(rows()).toHaveLength(0);
  expect(button("[data-run-continue]")).toBeNull();
  // The way out of it is here, and it is the only gesture that is.
  expect(button("[data-kb-rebuild]")).not.toBeNull();
});

it("leaves the same freshly created draft alone when the Profile did give it a category", async () => {
  const created = createdDraft({});
  expect([...created.blockers]).toEqual([]);
  const parsed = parseGeoKbEditorViewV3({
    schemaVersion: GEO_KB_EDITOR_V3_SCHEMA_VERSION,
    kbId: V3_KB_ID,
    origin: "https://example.com",
    host: "example.com",
    draftVersion: 1,
    draftHash: geoV2Digest(created.payload),
    payload: created.payload,
    restated: geoV3RestatedItemKeys(created.payload.knowledge, created.payload.review),
    published: null,
  });
  if (parsed === null) throw new Error("the created draft did not survive the wire parser");

  await act(async () => root.render(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={en}>
      <GeoKnowledgeBaseV3 view={parsed} locale="en" />
    </NextIntlClientProvider>,
  ));

  // Same shape, no blocker: the update is the next thing to press, and nothing
  // above it is a permanent banner.
  expect(host.querySelector("[data-kb-recovery]")).toBeNull();
  expect(text("[data-kb-state]")).toBe("A draft is ready for you to publish.");
  expect(button("[data-generate-kb]")?.disabled).toBe(false);
});


/* ---------------------------------------------------------------------------
 * The three modules nobody reviews
 *
 * D3 makes evidence, machine-readable status and coverage read-only, and that
 * was implemented as not drawing them at all: sections C and D held one
 * sentence saying there was nothing to decide, and the owner could never see
 * what the run had observed about their own site. Read-only means shown
 * without controls, not withheld.
 * ------------------------------------------------------------------------- */

const groupsIn = (selector: string) => [...host.querySelectorAll(`${selector} [data-geo-kb-group]`)]
  .map((group) => ({
    title: group.querySelector("h4, h5")?.textContent ?? "",
    state: group.getAttribute("data-group-state"),
  }));

it("shows what the run observed about the site, not just what there is to decide", async () => {
  await render();

  const trust = host.querySelector('[data-kb-section="trust"]');
  const reachability = host.querySelector('[data-kb-section="reachability"]');
  // The read-only note stays -- it explains the missing controls -- but it is
  // no longer the whole section.
  expect(trust?.textContent).toContain(card("en").review.noDecisions);
  expect(trust?.querySelector("[data-geo-kb-module]")).not.toBeNull();
  // Evidence in C; machine-readable status and coverage in D, which is the
  // section split the design lays out.
  expect(trust?.querySelectorAll("[data-geo-kb-module]")).toHaveLength(1);
  expect(reachability?.querySelectorAll("[data-geo-kb-module]")).toHaveLength(2);
  // The observations themselves, not just the frames: the fixture's robots
  // observation says GPTBot is disallowed for training while OAI-SearchBot is
  // allowed for search, and those are separate permissions.
  expect(reachability?.querySelector('[data-crawler-use="search"]')?.textContent).toContain("OAI-SearchBot");
  expect(reachability?.querySelector('[data-crawler-use="training"]')?.textContent).toContain("GPTBot");
  expect(reachability?.querySelector('[data-machine-field="robots"]')).not.toBeNull();
  // Coverage rows carry their own status, so "covered" is readable as a word.
  expect(reachability?.textContent).toContain("Supported content is available.");
});

it("keeps 'looked and found nothing' apart from 'never looked' on the v3 card", async () => {
  await render();

  // The fixture collected proof and changelog only. Reading them as one state
  // would tell an owner their press coverage was searched for.
  expect(groupsIn('[data-kb-section="trust"]')).toEqual([
    { title: "Product proof", state: "available" },
    { title: "Product changes", state: "collected_empty" },
    { title: "Press coverage", state: "not_collected" },
    { title: "Third-party profiles", state: "not_collected" },
    { title: "First-party proof", state: "not_collected" },
  ]);
  const notes = [...host.querySelectorAll('[data-kb-section="trust"] [data-group-note]')].map((note) => note.textContent);
  expect(notes).toEqual(["Collected · nothing found", "Not collected", "Not collected", "Not collected"]);
});

it("names a boundary group with nothing in it instead of dropping it", async () => {
  await render();

  // The four groups answer four different questions. Flattened into one list,
  // the three empty ones vanished, and an owner reading "what it does not do"
  // as absent cannot tell it from unmeasured.
  expect(groupsIn('[data-kb-section="identity"]')).toEqual([
    { title: "What it does", state: "collected_empty" },
    { title: "What it does not do", state: "available" },
    { title: "Where people are still needed", state: "collected_empty" },
    { title: "Common misconceptions", state: "collected_empty" },
  ]);
  // And the one populated group still renders its item, with its controls.
  expect(host.querySelector('[data-kb-section="identity"] [data-geo-kb-group][data-group-state="available"]')?.textContent)
    .toContain("Acme does not run on Android.");
});

/**
 * The whole-DOM sweep the internal-identifier rule needs.
 *
 * The rule was one needle -- the Pro fact's item key -- and an audit proved it:
 * rendering the draft hash and the knowledge base id straight onto the card
 * root left 192 tests green. Every identifier the card holds is checked here,
 * against the served HTML rather than against a list of places to look.
 */
it("puts no internal identifier in the DOM", async () => {
  await render();

  const html = host.innerHTML;
  const identifiers: readonly (readonly [string, string])[] = [
    ["kbId", V3_KB_ID],
    ["draftHash", geoV2Digest(PAYLOAD)],
    ...ITEM_KEYS.map((key) => ["itemKey", key] as const),
    ...PAYLOAD.knowledge!.sourceCatalogue.map((source) => ["sourceId", source.id] as const),
  ];
  for (const [what, value] of identifiers) expect(html, `${what}: ${value}`).not.toContain(value);
  // A digest is 64 hex characters and a UUID has its own shape. Both are
  // checked as patterns too, so an identifier this list does not name still
  // fails rather than passing for being unlisted.
  expect(html).not.toMatch(/[0-9a-f]{64}/);
  expect(html).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
});


/* ---------------------------------------------------------------------------
 * Folding away once there is nothing left to review (§4.1)
 * ------------------------------------------------------------------------- */

/** The published version this draft IS: the freeze copies the draft's own hash. */
const publishedAsIs = (overrides: Record<string, unknown> = {}) => ({
  kind: "comparable" as const,
  revision: 3,
  frozenAt: "2026-09-01T00:00:00.000Z",
  contentHash: geoV2Digest(PAYLOAD),
  decisions: {},
  ...overrides,
});

it("folds to a summary once the draft on screen is the published version", async () => {
  await render("en", { published: publishedAsIs() });

  expect(host.querySelector("[data-geo-kb-collapsed]")).not.toBeNull();
  // Written out, not filled from the catalog: filling it compares the render
  // with the leaf it was rendered from, which passes for any wording.
  expect(text("[data-kb-published-version]")).toBe("Published kb@v3");
  // The counts are read off the body that was published, and "confirmed"
  // counts one-by-one acceptances only.
  // No comparisons clause: this fixture's module is `unavailable`, and the line
  // that used to say "Comparisons 0/0" was claiming a comparison nobody ran.
  expect(text("[data-kb-published-counts]")).toBe("Facts 2 (confirmed 0) · Q&A 1 · Sep 1, 2026");
  // Folded means folded: no review rows, no publish box, no update button
  // underneath pretending there is still work here.
  expect(rows()).toHaveLength(0);
  expect(host.querySelector("[data-publish-kb]")).toBeNull();
  // The card still asks the run route whether an update is open -- that is how
  // it knows it may fold at all -- but it writes nothing.
  expect(calls()).toEqual([]);
});

it("counts only one-by-one acceptances as confirmed", async () => {
  const hashes = geoV3ItemContentHashes(PAYLOAD.knowledge);
  const decided = (itemKey: string, decision: "accepted" | "accepted_in_bulk") => ({
    itemKey, decision, override: null,
    baseContentHash: hashes.get(itemKey)!, decidedAt: "2026-09-01T00:00:00.000Z", baseDraftVersion: "4",
  });
  // One fact read and accepted; the other swept up by a batch gesture. D12
  // reserves "confirmed" for the first kind, and this line is where the
  // difference reaches a person.
  const payload = completePayloadV3({ review: {
    decisions: [decided(FACT_KEY_PRO, "accepted"), decided(FACT_KEY_TEAM, "accepted_in_bulk")],
    suppressions: [],
  } });
  const contentHash = geoV2Digest(payload);

  await render("en", { payload, draftHash: contentHash, published: publishedAsIs({ contentHash }) });

  expect(text("[data-kb-published-counts]")).toBe("Facts 2 (confirmed 1) · Q&A 1 · Sep 1, 2026");
});

it("opens again on Edit, and stays open", async () => {
  await render("en", { published: publishedAsIs() });

  await act(async () => host.querySelector<HTMLElement>("[data-kb-edit]")!.click());

  expect(host.querySelector("[data-geo-kb-collapsed]")).toBeNull();
  expect(rows().length).toBeGreaterThan(0);
});

it.each([
  ["an older published version", { published: publishedAsIs({ contentHash: "b".repeat(64) }) }],
  ["a version published by the previous format", { published: { kind: "opaque" as const, revision: 2, frozenAt: "2026-09-01T00:00:00.000Z", contentHash: "b".repeat(64) } }],
  ["nothing published yet", { published: null }],
])("stays open over %s", async (_case, overrides) => {
  await render("en", overrides);

  // Each of these leaves the owner something to do -- review the changes since
  // the published version, or publish for the first time. A summary line over
  // any of them says the opposite.
  expect(host.querySelector("[data-geo-kb-collapsed]")).toBeNull();
  expect(rows().length).toBeGreaterThan(0);
});


/**
 * The three modules the folded sentence counts. A module that was never
 * measured reads back as an empty list, and every count it feeds renders `0`.
 */
/** The fixture's body, non-null: `completePayloadV3` always builds one. */
const KNOWLEDGE = PAYLOAD.knowledge!;

const unmeasured: readonly (readonly [string, Partial<typeof KNOWLEDGE>, string])[] = [
  ["facts", { facts: { status: "unavailable", reason: "not_collected" } }, "Facts"],
  ["Q&A", { qa: { status: "unavailable", reason: "not_collected" } }, "Q&A"],
  ["comparisons", { comparisons: { status: "unavailable", reason: "not_collected" } }, "Comparisons"],
];

it.each(unmeasured)("says nothing about the %s module when it was never measured", async (_case, module, word) => {
  const payload = completePayloadV3({ knowledge: { ...KNOWLEDGE, ...module } });
  const contentHash = geoV2Digest(payload);

  await render("en", { payload, draftHash: contentHash, published: publishedAsIs({ contentHash }) });

  // It still folds -- an unmeasured module leaves nothing to review -- but the
  // clause is gone rather than rendered as `0`. "Facts 0 (confirmed 0)" about a
  // module nobody looked at reads as "we looked and found none", the exact
  // claim `GeoKbPublishedSummary.counts` refuses to make for off-site sources.
  expect(host.querySelector("[data-geo-kb-collapsed]")).not.toBeNull();
  const line = text("[data-kb-published-counts]") ?? "";
  expect(line).toContain("Sep 1, 2026");
  // The module is not named at all, so no number is attached to it. A zero
  // elsewhere on the line is a real one: "confirmed 0" counts decisions about
  // facts that were measured.
  expect(line).not.toContain(word);
  expect(line.length).toBeGreaterThan("Sep 1, 2026".length);
});

it("stays open while a counted module is only partial", async () => {
  // `partial` carries a limitation sentence and the folded summary has nowhere
  // to say it, so the card keeps the section on screen instead.
  const payload = completePayloadV3({ knowledge: {
    ...KNOWLEDGE,
    qa: { status: "partial", limitation: "Only the first page of questions was read.", value: geoKbModuleValue(KNOWLEDGE.qa)! },
  } });
  const contentHash = geoV2Digest(payload);

  await render("en", { payload, draftHash: contentHash, published: publishedAsIs({ contentHash }) });

  expect(host.querySelector("[data-geo-kb-collapsed]")).toBeNull();
});


/* ---------------------------------------------------------------------------
 * Two prompts that act on nothing (§12, D11)
 * ------------------------------------------------------------------------- */

it("says a published version can be updated when the Profile has moved on", async () => {
  const locked = Number(PAYLOAD.generationInput.profileRef.snapshotRevision);

  await render("en", { published: publishedAsIs() }, { confirmedProfileRevision: locked + 1 });

  // Written out. The catalog leaf is what is under test.
  expect(text("[data-kb-state]")?.trim()).toBe("Published kb@v3 · Sep 1, 2026 · the Product Profile has a newer version, so you can update");
  // Nothing was synced: §12 is explicit that confirming a Profile revision
  // changes nothing about the published knowledge base.
  expect(calls()).toEqual([]);
  // And the card does not fold away over a sentence it then cannot show.
  expect(host.querySelector("[data-geo-kb-collapsed]")).toBeNull();
});

/** A published version this draft has since been edited past, so the card stays open. */
const publishedEarlier = () => publishedAsIs({ revision: 2, contentHash: "b".repeat(64) });

it.each([
  ["the same revision", 0],
  ["an older Profile revision than the draft", -1],
  ["a revision the caller does not know", null],
])("keeps the plain published line for %s", async (_case, delta) => {
  const locked = Number(PAYLOAD.generationInput.profileRef.snapshotRevision);

  // An absent number is not a match: a card that guessed would tell every
  // caller without the revision that their knowledge base is out of date.
  await render("en", { published: publishedEarlier() }, delta === null ? {} : { confirmedProfileRevision: locked + delta });

  expect(text("[data-kb-state]")?.trim()).toBe("Published kb@v2 · Sep 1, 2026");
});

it("prompts once a fact passes its review date, and re-checks nothing", async () => {
  const knowledge = structuredClone(PAYLOAD.knowledge!);
  // D11: the date is set ninety days out when the fact is observed, and passing
  // it is a prompt. Two facts, one due, so the count is the due ones and not
  // the module size.
  if (knowledge.facts.status === "unavailable") throw new Error("fixture has no facts");
  knowledge.facts.value[0]!.nextReviewAt = "2026-01-01T00:00:00.000Z";
  const payload = completePayloadV3({ knowledge });

  await render("en", { payload, draftHash: geoV2Digest(payload), published: publishedAsIs({ contentHash: geoV2Digest(payload) }) });

  expect(text("[data-review-due]")).toBe("1 fact has passed the review date set when they were observed. Nothing is re-checked on its own; run an update when you want them looked at again.");
  expect(calls()).toEqual([]);
  expect(runCalls().filter((body) => body.action === undefined)).toHaveLength(0);
});

it("says nothing while every fact is still inside its review window", async () => {
  const knowledge = structuredClone(PAYLOAD.knowledge!);
  if (knowledge.facts.status === "unavailable") throw new Error("fixture has no facts");
  knowledge.facts.value[0]!.nextReviewAt = "2099-01-01T00:00:00.000Z";
  const payload = completePayloadV3({ knowledge });

  await render("en", { payload, draftHash: geoV2Digest(payload) });

  expect(host.querySelector("[data-review-due]")).toBeNull();
});
