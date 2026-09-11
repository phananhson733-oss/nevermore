// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";
import { GeoKbItemRow, type GeoKbItemActions, type GeoKbItemRowProps } from "./geo-kb-item-row.tsx";

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const card = (locale: string) => (locale === "zh" ? zh : en).tools.geoKnowledgeBase.card;

type RowOverrides = Partial<Omit<GeoKbItemRowProps, "children">>;

async function render(overrides: RowOverrides = {}, locale = "en") {
  const props: GeoKbItemRowProps = {
    typeLabel: "Feature",
    children: "Example Cloud keeps human approval in each workflow.",
    source: { origin: "observed_own", path: "/en/pricing" },
    decision: "pending",
    evidenceChecks: "not_applicable",
    ...overrides,
  };
  await act(async () => root.render(
    <NextIntlClientProvider locale={locale} timeZone="UTC" messages={locale === "zh" ? zh : en}>
      <GeoKbItemRow {...props} />
    </NextIntlClientProvider>,
  ));
}

const chip = () => host.querySelector("[data-decision-chip]")?.textContent ?? "";
const sourceLine = () => host.querySelector("[data-item-source]")?.textContent ?? "";

it.each(["en", "zh"])("names the type, the content and the observed page in %s", async (locale) => {
  await render({}, locale);

  expect(host.querySelector("[data-item-type]")?.textContent).toBe("Feature");
  expect(host.textContent).toContain("Example Cloud keeps human approval");
  expect(sourceLine()).toContain(card(locale).origins.observed_own);
  expect(sourceLine()).toContain("/en/pricing");
  expect(chip()).toBe(card(locale).decisions.pending);
});

/**
 * The source line says WHERE a claim came from and nothing else. It used to
 * carry the observation date, a "review by" date ninety days out and the
 * citation-check verdict as well, and the Owner read the review date as a
 * mistake ("is 9 December right?") and the rest as noise. The origin word is
 * the one part that must stay: an accepted model summary is still a model
 * summary, and this line is the only place that says so.
 */
it.each(["en", "zh"])("keeps the origin and drops every date and check from the source line in %s", async (locale) => {
  await render({ source: { origin: "synthesized", evidenceCount: 2 }, evidenceChecks: "cited_and_literals_match" }, locale);

  expect(sourceLine()).toBe(card(locale).originDetail.synthesized.replace("{count}", "2"));
  // The check's old label, in both languages, must not come back by any route.
  expect(host.textContent).not.toMatch(/引用核对|Citation check/u);
  expect(host.textContent).not.toMatch(/20\d\d/u);
});

/**
 * This assertion used to be the mutation guard for D12: it demanded that
 * `accepted_in_bulk` render with words of its own, so a batch gesture could
 * never claim a one-by-one confirmation. The RULE it guarded is what changed
 * -- the Owner ruled on 2026-09-09 that a batch acceptance is an acceptance --
 * so the guard is inverted rather than deleted: nothing writes
 * `accepted_in_bulk` any more, older drafts still carry it, and the one thing
 * that must stay true is that such a row reads as accepted instead of sitting
 * in a fourth state the owner has no button for.
 *
 * What did NOT change is the other half of D12: `origin` still says the claim
 * came from the model, and the decision label never overwrites it.
 */
it.each(["en", "zh"])("renders a legacy bulk acceptance as an acceptance in %s", async (locale) => {
  await render({ decision: "accepted_in_bulk", source: { origin: "synthesized", evidenceCount: 2 } }, locale);

  expect(chip()).toBe(card(locale).decisions.accepted);
  expect(sourceLine()).toContain(card(locale).originDetail.synthesized.replace("{count}", "2"));
});

it.each(["en", "zh"])("gives each decision the owner can reach its own words in %s", async (locale) => {
  const labels: string[] = [];
  for (const decision of ["pending", "accepted", "excluded"] as const) {
    await render({ decision }, locale);
    labels.push(chip());
  }
  const copy = card(locale).decisions;
  expect(labels).toEqual([copy.pending, copy.accepted, copy.excluded]);
  expect(new Set(labels).size).toBe(3);
});

/**
 * A passed citation check proves the cited page exists and that the numbers in
 * the claim occur in it. It is not a confirmation, and the row must never say
 * "accepted" over a row whose only distinction is that check.
 */
it.each(["en", "zh"])("never reads a citation check as an acceptance in %s", async (locale) => {
  await render({ evidenceChecks: "cited_and_literals_match", decision: "pending" }, locale);

  expect(host.textContent).not.toContain(card(locale).decisions.accepted);
  expect(chip()).toBe(card(locale).decisions.pending);
});

it("labels an off-site source with its domain and its independence verdict", async () => {
  await render({ source: { origin: "observed_third_party", domain: "press.example", independence: "undetermined" } });

  expect(sourceLine()).toContain(card("en").originDetail.thirdParty.replace("{domain}", "press.example"));
  expect(sourceLine()).toContain(card("en").independence.undetermined);
  expect(sourceLine()).not.toContain(card("en").independence.independent);
});

it("shows an owner correction as a declaration, with what it replaced and one way back", async () => {
  const actions = { onAccept: vi.fn(), onCorrect: vi.fn(), onExclude: vi.fn(), onRevert: vi.fn() } satisfies GeoKbItemActions;
  await render({
    source: { origin: "declared_owner" },
    decision: "accepted",
    evidenceChecks: "owner_declared",
    priorSource: { origin: "observed_own", path: "/en/pricing" },
    actions,
  });

  expect(sourceLine()).toBe(card("en").origins.declared_owner);
  const prior = host.querySelector("[data-item-prior-source]")?.textContent ?? "";
  expect(prior).toContain(card("en").item.priorBasis);
  expect(prior).toContain("/en/pricing");
  expect(host.querySelector('[data-item-action="revert"]')).not.toBeNull();
  for (const gone of ["accept", "correct", "exclude"]) {
    expect(host.querySelector(`[data-item-action="${gone}"]`), gone).toBeNull();
  }
});

it("reports the three review gestures and marks which one is in force", async () => {
  const actions = { onAccept: vi.fn(), onCorrect: vi.fn(), onExclude: vi.fn(), onRevert: vi.fn() } satisfies GeoKbItemActions;
  await render({ decision: "excluded", actions });

  expect(host.querySelector('[data-item-action="exclude"]')?.getAttribute("aria-pressed")).toBe("true");
  expect(host.querySelector('[data-item-action="accept"]')?.getAttribute("aria-pressed")).toBe("false");
  for (const [selector, spy] of [["accept", actions.onAccept], ["correct", actions.onCorrect], ["exclude", actions.onExclude]] as const) {
    await act(async () => host.querySelector<HTMLElement>(`[data-item-action="${selector}"]`)!.click());
    expect(spy).toHaveBeenCalledTimes(1);
  }
  expect(actions.onRevert).not.toHaveBeenCalled();
});

it("shows a decision without an action surface on a published version", async () => {
  await render({ decision: "accepted_in_bulk" });
  expect(host.querySelector("[data-item-action]")).toBeNull();
  expect(host.querySelector("[data-decision-chip]")).not.toBeNull();
});

it("carries no item key, hash or other internal identity into the DOM", async () => {
  await render({
    decision: "accepted_in_bulk",
    source: { origin: "synthesized", evidenceCount: 3 },
    newObservation: true,
    conflict: true,
  });

  expect(host.outerHTML).not.toMatch(/[a-f0-9]{64}/u);
  expect(host.querySelector('[data-item-flag="new_observation"]')?.textContent).toBe(card("en").item.newObservation);
  expect(host.querySelector('[data-item-flag="conflict"]')?.textContent).toBe(card("en").item.conflict);
});

/**
 * A required entity field cannot be excluded: the assembler withholds the whole
 * identity section rather than publish a field the owner rejected. The first
 * version of this row kept the button, disabled, with a sentence beside it
 * saying why. The Owner's ruling: if it cannot be excluded, do not offer the
 * gesture -- the button goes, and so does the sentence explaining a button that
 * is not there.
 */
it.each(["en", "zh"])("offers no exclude gesture on a field the section cannot lose, in %s", async (locale) => {
  const actions = { onAccept: vi.fn(), onCorrect: vi.fn(), onExclude: vi.fn(), onRevert: vi.fn(), required: true } satisfies GeoKbItemActions;
  await render({ actions }, locale);

  expect(host.querySelector('[data-item-action="exclude"]')).toBeNull();
  expect(host.querySelector("[data-item-note]")).toBeNull();
  expect(host.textContent).not.toContain(card(locale).item.exclude);
  // The other two gestures are untouched -- the field can still be corrected.
  for (const [selector, spy] of [["accept", actions.onAccept], ["correct", actions.onCorrect]] as const) {
    await act(async () => host.querySelector<HTMLElement>(`[data-item-action="${selector}"]`)!.click());
    expect(spy).toHaveBeenCalledTimes(1);
  }
  expect(actions.onExclude).not.toHaveBeenCalled();
});

it("offers the exclude gesture on a field that can be excluded", async () => {
  const actions = { onAccept: vi.fn(), onCorrect: vi.fn(), onExclude: vi.fn(), onRevert: vi.fn() } satisfies GeoKbItemActions;
  await render({ actions });

  const exclude = host.querySelector<HTMLButtonElement>('[data-item-action="exclude"]')!;
  expect(exclude.disabled).toBe(false);
  await act(async () => exclude.click());
  expect(actions.onExclude).toHaveBeenCalledTimes(1);
});

/**
 * The chips are labels, not footnotes. Drawn as an outline in secondary grey
 * they read as part of the source line; the Owner asked for them to stand out
 * ("tint the background or make them bold"). The two flags a reader must not
 * miss -- a new observation, a possible conflict -- carry a warning tone on
 * top of that, because a flag in the same grey as everything else is a flag
 * nobody sees.
 */
it("gives every chip a tone, and the flags a louder one", async () => {
  await render({ newObservation: true, conflict: true });

  expect(host.querySelector("[data-item-type]")?.getAttribute("data-chip-tone")).toBe("label");
  expect(host.querySelector("[data-decision-chip]")?.getAttribute("data-chip-tone")).toBe("label");
  expect(host.querySelector('[data-item-flag="new_observation"]')?.getAttribute("data-chip-tone")).toBe("flag");
  expect(host.querySelector('[data-item-flag="conflict"]')?.getAttribute("data-chip-tone")).toBe("flag");
});

