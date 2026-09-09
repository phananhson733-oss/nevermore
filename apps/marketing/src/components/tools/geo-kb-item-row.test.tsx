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
    locale,
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
  await render({ observedAt: "2026-09-04T00:00:00.000Z", nextReviewAt: "2026-12-03T00:00:00.000Z" }, locale);

  expect(host.querySelector("[data-item-type]")?.textContent).toBe("Feature");
  expect(host.textContent).toContain("Example Cloud keeps human approval");
  expect(sourceLine()).toContain(card(locale).origins.observed_own);
  expect(sourceLine()).toContain("/en/pricing");
  expect(sourceLine()).toContain(card(locale).item.review.replace("{date}", locale === "zh" ? "2026年12月3日" : "Dec 3, 2026"));
  expect(chip()).toBe(card(locale).decisions.pending);
});

/**
 * The mutation guard for D12. Rendering `accepted_in_bulk` with the `accepted`
 * label -- the one change that lets a batch gesture claim a one-by-one
 * confirmation -- fails both assertions here, in both locales.
 */
it.each(["en", "zh"])("never renders a bulk acceptance as a confirmation in %s", async (locale) => {
  await render({ decision: "accepted_in_bulk", source: { origin: "synthesized", evidenceCount: 2 } }, locale);

  expect(chip()).toBe(card(locale).decisions.acceptedInBulk);
  expect(chip()).not.toBe(card(locale).decisions.accepted);
  expect(host.textContent).not.toContain(card(locale).decisions.accepted);
  expect(sourceLine()).toContain(card(locale).originDetail.synthesized.replace("{count}", "2"));
});

it.each(["en", "zh"])("gives each decision its own words in %s", async (locale) => {
  const labels: string[] = [];
  for (const decision of ["pending", "accepted", "accepted_in_bulk", "excluded"] as const) {
    await render({ decision }, locale);
    labels.push(chip());
  }
  const copy = card(locale).decisions;
  expect(labels).toEqual([copy.pending, copy.accepted, copy.acceptedInBulk, copy.excluded]);
  expect(new Set(labels).size).toBe(4);
});

/**
 * A passed citation check proves the cited page exists and that the numbers in
 * the claim occur in it. It is not a confirmation, and it must never borrow the
 * word that belongs to one.
 */
it.each(["en", "zh"])("calls a passed citation check exactly that in %s", async (locale) => {
  await render({ evidenceChecks: "cited_and_literals_match", decision: "pending" }, locale);

  expect(sourceLine()).toContain(card(locale).evidenceChecks.cited_and_literals_match);
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
    ownerDeclaredAt: "2026-09-07T00:00:00.000Z",
    priorSource: { origin: "observed_own", path: "/en/pricing" },
    priorObservedAt: "2026-09-04T00:00:00.000Z",
    actions,
  });

  expect(sourceLine()).toContain(card("en").item.correctedAt.replace("{date}", "Sep 7, 2026"));
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
 * identity section rather than publish a field the owner rejected, so the row
 * has to say that before the owner presses it, not after publishing.
 */
it.each(["en", "zh"])("blocks and explains an exclusion that would withhold the section in %s", async (locale) => {
  const actions = {
    onAccept: vi.fn(), onCorrect: vi.fn(), onExclude: vi.fn(), onRevert: vi.fn(),
    excludeBlockedReason: card(locale).review.excludeRequired,
  } satisfies GeoKbItemActions;
  await render({ actions }, locale);

  const exclude = host.querySelector<HTMLButtonElement>('[data-item-action="exclude"]')!;
  expect(exclude.disabled).toBe(true);
  const note = host.querySelector('[data-item-note="exclude-blocked"]')!;
  expect(note.textContent).toBe(card(locale).review.excludeRequired);
  // The explanation is a real element the button points at, not a title
  // attribute: a tooltip is invisible on touch and to a reader that never
  // hovers, which is every reader who most needs the sentence.
  expect(exclude.getAttribute("aria-describedby")).toBe(note.id);
  expect(note.id).not.toBe("");

  await act(async () => exclude.click());
  expect(actions.onExclude).not.toHaveBeenCalled();
  // The other two gestures are untouched -- the field can still be corrected.
  for (const [selector, spy] of [["accept", actions.onAccept], ["correct", actions.onCorrect]] as const) {
    await act(async () => host.querySelector<HTMLElement>(`[data-item-action="${selector}"]`)!.click());
    expect(spy).toHaveBeenCalledTimes(1);
  }
});

it("leaves the exclude gesture alone on a field that can be excluded", async () => {
  const actions = { onAccept: vi.fn(), onCorrect: vi.fn(), onExclude: vi.fn(), onRevert: vi.fn() } satisfies GeoKbItemActions;
  await render({ actions });

  const exclude = host.querySelector<HTMLButtonElement>('[data-item-action="exclude"]')!;
  expect(exclude.disabled).toBe(false);
  expect(exclude.getAttribute("aria-describedby")).toBeNull();
  expect(host.querySelector('[data-item-note="exclude-blocked"]')).toBeNull();
  await act(async () => exclude.click());
  expect(actions.onExclude).toHaveBeenCalledTimes(1);
});

