// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it } from "vitest";

import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";
import { geoUnavailableReasonSchema } from "../../lib/geo-tools/kb-knowledge-shape.ts";
import {
  GeoKbEvidenceGroup,
  GeoKbModuleSection,
  geoKbModuleState,
  geoKbModuleValue,
  type GeoKbModulePresentation,
  type GeoKbModuleState,
} from "./geo-kb-module-section.tsx";

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const card = (locale: string) => (locale === "zh" ? zh : en).tools.geoKnowledgeBase.card;

async function renderModule(state: GeoKbModuleState, locale = "en", presentation: GeoKbModulePresentation = {}) {
  await act(async () => root.render(
    <NextIntlClientProvider locale={locale} timeZone="UTC" messages={locale === "zh" ? zh : en}>
      <GeoKbModuleSection title="Reliable facts" state={state} {...presentation}>
        <span data-module-children="">The module content</span>
      </GeoKbModuleSection>
    </NextIntlClientProvider>,
  ));
}

async function renderGroup(collected: boolean, count: number, locale = "en") {
  await act(async () => root.render(
    <NextIntlClientProvider locale={locale} timeZone="UTC" messages={locale === "zh" ? zh : en}>
      <GeoKbEvidenceGroup title="Press coverage" collected={collected} count={count}>
        <span data-group-children="">One press item</span>
      </GeoKbEvidenceGroup>
    </NextIntlClientProvider>,
  ));
}

it.each(["en", "zh"])("shows an available module with nothing added in %s", async (locale) => {
  await renderModule({ status: "available" }, locale);

  expect(host.querySelector("[data-geo-kb-module]")?.getAttribute("data-module-status")).toBe("available");
  expect(host.querySelector("[data-module-children]")).not.toBeNull();
  expect(host.querySelector("[data-module-limitation]")).toBeNull();
  expect(host.querySelector("[data-module-unavailable]")).toBeNull();
});

it.each(["en", "zh"])("keeps a partial module visible and states its limitation in %s", async (locale) => {
  await renderModule({ status: "partial", limitation: "Only published pages were read." }, locale);

  expect(host.querySelector("[data-geo-kb-module]")?.getAttribute("data-module-status")).toBe("partial");
  const note = host.querySelector("[data-module-limitation]")?.textContent ?? "";
  expect(note).toContain(card(locale).module.partial);
  expect(note).toContain("Only published pages were read.");
  expect(host.querySelector("[data-module-children]")).not.toBeNull();
});

it.each(["en", "zh"])("explains an unavailable module without leaking its reason code in %s", async (locale) => {
  await renderModule({ status: "unavailable", reason: "insufficient_evidence" }, locale);

  expect(host.querySelector("[data-geo-kb-module]")?.getAttribute("data-module-status")).toBe("unavailable");
  expect(host.querySelector("[data-module-unavailable]")?.textContent).toBe(card(locale).module.unavailable.insufficient_evidence);
  expect(host.textContent).not.toContain("insufficient_evidence");
  // Nothing partial is passed off as complete: the content is not drawn at all.
  expect(host.querySelector("[data-module-children]")).toBeNull();
});

/**
 * A section the owner emptied is not a section the evidence fell short on, and
 * the card is where that difference is finally said to a reader. Pinned to the
 * catalog value rather than to a phrase, and pinned in both locales, because a
 * missing key renders as the literal path `module.unavailable.owner_excluded_all`
 * instead of throwing.
 */
it.each(["en", "zh"])("tells an owner-emptied section apart from a shortfall in %s", async (locale) => {
  await renderModule({ status: "unavailable", reason: "owner_excluded_all" }, locale);
  const emptied = host.querySelector("[data-module-unavailable]")?.textContent;

  await renderModule({ status: "unavailable", reason: "owner_excluded_required" }, locale);
  const required = host.querySelector("[data-module-unavailable]")?.textContent;

  expect(emptied).toBe(card(locale).module.unavailable.owner_excluded_all);
  expect(required).toBe(card(locale).module.unavailable.owner_excluded_required);
  expect(emptied).not.toBe(card(locale).module.unavailable.insufficient_evidence);
  expect(required).not.toBe(emptied);
  expect(host.textContent).not.toContain("owner_excluded");
});

/**
 * next-intl renders the key path for a missing key rather than throwing, so a
 * reason the contract can carry but the catalog has no sentence for ships as
 * the literal `module.unavailable.<reason>` on a customer page. Driven through
 * the component and read from the schema, so a reason added tomorrow is covered
 * the day it is added -- comparing the two catalogs to each other would only
 * prove they agree, including on being wrong.
 */
it.each(["en", "zh"])("renders a sentence for every reason the contract can carry, in %s", async (locale) => {
  const sentences = card(locale).module.unavailable as Record<string, string | undefined>;

  for (const reason of geoUnavailableReasonSchema.options) {
    await renderModule({ status: "unavailable", reason }, locale);
    const rendered = host.querySelector("[data-module-unavailable]")?.textContent;

    expect(rendered, reason).toEqual(expect.any(String));
    expect(rendered, reason).toBe(sentences[reason]);
    expect(rendered, reason).not.toContain("module.unavailable");
  }
});

/**
 * The two absences v1 could not tell apart. A group that was never looked for
 * and a group that was looked for and found nothing both used to render as
 * nothing at all, which reads as a complete report.
 */
it.each(["en", "zh"])("says an uncollected group was never looked for, in %s", async (locale) => {
  await renderGroup(false, 0, locale);

  expect(host.querySelector("[data-geo-kb-group]")?.getAttribute("data-group-state")).toBe("not_collected");
  expect(host.querySelector("[data-group-note]")?.textContent).toBe(card(locale).groups.notCollected);
  expect(host.textContent).toContain("Press coverage");
  expect(host.querySelector("[data-group-children]")).toBeNull();
});

it.each(["en", "zh"])("says a collected group found nothing, in %s", async (locale) => {
  await renderGroup(true, 0, locale);

  expect(host.querySelector("[data-geo-kb-group]")?.getAttribute("data-group-state")).toBe("collected_empty");
  expect(host.querySelector("[data-group-note]")?.textContent).toBe(card(locale).groups.collectedEmpty);
  expect(host.querySelector("[data-group-note]")?.textContent).not.toBe(card(locale).groups.notCollected);
});

it("draws the items of a group that found some", async () => {
  await renderGroup(true, 1);

  expect(host.querySelector("[data-geo-kb-group]")?.getAttribute("data-group-state")).toBe("available");
  expect(host.querySelector("[data-group-children]")).not.toBeNull();
  expect(host.querySelector("[data-group-note]")).toBeNull();
});

it("drops the value and keeps the state, without inventing a reason", () => {
  expect(geoKbModuleState({ status: "available", value: [1] })).toEqual({ status: "available" });
  expect(geoKbModuleState({ status: "partial", limitation: "some", value: [1] })).toEqual({ status: "partial", limitation: "some" });
  expect(geoKbModuleState({ status: "unavailable", reason: "timeout" })).toEqual({ status: "unavailable", reason: "timeout" });
  expect(geoKbModuleValue({ status: "unavailable", reason: "timeout" })).toBeNull();
  expect(geoKbModuleValue({ status: "partial", limitation: "some", value: [1] })).toEqual([1]);
});

it("carries a limitation's clause keys through with its sentence", () => {
  const keys = [{ key: "snippets_not_checked" }];
  expect(geoKbModuleState({ status: "partial", limitation: "some", limitationKeys: keys, value: [1] }))
    .toEqual({ status: "partial", limitation: "some", limitationKeys: keys });
});

/**
 * The production complaint of 2026-09-10.
 *
 * The machine-readable card on the Chinese account page said, under a Chinese
 * 「当前限制:」 label: "Some machine-readable visibility signals were absent or
 * unavailable. Snippet permission was not checked." Both halves came from the
 * server as English prose and were rendered verbatim.
 *
 * The required phrases are written here rather than read from the catalog: an
 * assertion against `card(locale).limitations.clause.*` is satisfied by ANY
 * wording, the English included, which is exactly the bug.
 */
const LOCALIZED = {
  en: { required: ["machine-readable", "Snippet permission"], forbidden: ["limitations.clause", "snippets_not_checked"] },
  zh: { required: ["机器可读信号", "本次没有检查摘要许可"], forbidden: ["machine-readable", "Snippet permission", "limitations.clause", "snippets_not_checked"] },
} as const;

it.each(["en", "zh"] as const)("says a limitation's clauses in %s rather than in the server's English", async (locale) => {
  await renderModule({
    status: "partial",
    limitation: "Some machine-readable visibility signals were absent or unavailable. Snippet permission was not checked.",
    limitationKeys: [{ key: "machine_signals_absent" }, { key: "snippets_not_checked" }],
  }, locale);

  const note = host.querySelector("[data-module-limitation]");
  expect(note?.getAttribute("data-module-limitation")).toBe("localized");
  const text = note?.textContent ?? "";
  expect(text).toContain(card(locale).module.partial);
  for (const phrase of LOCALIZED[locale].required) expect(text, phrase).toContain(phrase);
  for (const phrase of LOCALIZED[locale].forbidden) expect(text, phrase).not.toContain(phrase);
});

it("fills a clause's numbers and names from its parameters", async () => {
  await renderModule({
    status: "partial",
    limitation: "stored",
    limitationKeys: [
      { key: "evidence_groups_not_collected", params: { groups: "press,thirdPartyProfiles" } },
      { key: "offsite_stage_stopped", params: { stage: "landing_pages", reason: "rate_limited", count: 5 } },
    ],
  }, "zh");

  // Literals, not `zh.tools...card.groups.press`: the resolver reads that key,
  // so an assertion against it passes for whatever the key holds.
  const text = host.querySelector("[data-module-limitation]")?.textContent ?? "";
  expect(text).toContain("本次没有采集：媒体报道、第三方档案。");
  expect(text).toContain("落地页抓取");
  expect(text).toContain("受到频率限制");
  expect(text).toContain("5");
  // No contract token reaches the page, and the stored English is not shown
  // beside the Chinese it was replaced by.
  expect(text).not.toContain("thirdPartyProfiles");
  expect(text).not.toContain("landing_pages");
  expect(text).not.toContain("rate_limited");
  expect(text).not.toContain("stored");
});

/**
 * A pack published before 2026-09-10 carries only the server's sentence. It is
 * rendered as it always was: English on a Chinese page is worse than Chinese,
 * and better than a blank where a limitation used to be.
 */
it.each(["en", "zh"])("renders a stored sentence unchanged when the payload carries no keys, in %s", async (locale) => {
  await renderModule({ status: "partial", limitation: "Only published pages were read." }, locale);

  const note = host.querySelector("[data-module-limitation]");
  expect(note?.getAttribute("data-module-limitation")).toBe("stored");
  expect(note?.textContent).toContain("Only published pages were read.");
});

/**
 * All-or-nothing, and this is why.
 *
 * A payload written by a newer build can carry a clause this build has never
 * heard of, and a clause whose parameters are not what it needs. Rendering the
 * clauses this build DOES know would publish a limitation shorter than the one
 * the payload claims -- the reader told about one problem out of two, with no
 * way to know a second existed. The stored sentence has both.
 */
it.each([
  ["an unknown key", [{ key: "machine_signals_absent" }, { key: "a_clause_from_next_year" }]],
  ["a parameter the clause cannot use", [{ key: "evidence_items_unshowable", params: { count: "many" } }]],
  ["a group name that is not a group", [{ key: "evidence_groups_not_collected", params: { groups: "press,__proto__" } }]],
  ["a reason that is not a reason", [{ key: "offsite_pages_unread", params: { count: 1, reason: "toString" } }]],
  // `constructor` and `toString` pass the contract's key rule -- they are
  // ordinary lowercase words -- and a plain index on the clause table would
  // reach `Object.prototype` through them and call what it found.
  ["a key that names a prototype member", [{ key: "constructor" }]],
  ["a key that names a prototype method", [{ key: "machine_signals_absent" }, { key: "toString" }]],
  // A known key with an EXTRA parameter is a clause a newer build wrote with
  // more to say. Rendering this build's parameterless sentence would drop the
  // reason and the recovery action while still claiming to be the limitation.
  ["a known key carrying a parameter this build cannot render", [{ key: "snippets_not_checked", params: { reason: "unauthenticated" } }]],
  ["a known key missing the parameter it needs", [{ key: "evidence_items_unshowable" }]],
] as const)("falls back to the whole stored sentence for %s", async (_case, limitationKeys) => {
  await renderModule({
    status: "partial",
    limitation: "One clause. And a second clause the reader must not lose.",
    limitationKeys: [...limitationKeys],
  }, "zh");

  const note = host.querySelector("[data-module-limitation]");
  expect(note?.getAttribute("data-module-limitation")).toBe("stored");
  expect(note?.textContent).toContain("One clause. And a second clause the reader must not lose.");
  expect(note?.textContent).not.toContain("[object Object]");
  expect(note?.textContent).not.toContain("limitations.clause");
});

/**
 * The review card turns the limitation sentence off. Every absence it would
 * name is already said on the rows underneath -- an uncollected group says
 * "not collected", an absent signal says "not detected" -- and the Owner read
 * the sentence above them as one more thing to skip (2026-09-11). The published
 * pack keeps it: a customer reading one section has no rows to fall back on.
 * `data-module-status` stays `partial` either way, because the state is a fact
 * about the module and the sentence was only one way of saying it.
 */
it.each(["en", "zh"])("can leave a partial module's limitation unsaid while keeping its state, in %s", async (locale) => {
  await renderModule({ status: "partial", limitation: "Only published pages were read." }, locale, { limitation: false });

  expect(host.querySelector("[data-geo-kb-module]")?.getAttribute("data-module-status")).toBe("partial");
  expect(host.querySelector("[data-module-limitation]")).toBeNull();
  expect(host.textContent).not.toContain("Only published pages were read.");
  expect(host.querySelector("[data-module-children]")).not.toBeNull();
});

/**
 * One module can say why it is unavailable in its own words. The generic
 * sentence for `not_applicable` is "this section does not apply this time",
 * which is true of the comparisons module and tells the Owner nothing about
 * why ("why is comparative knowledge empty?", 2026-09-11). The override is a
 * sentence, not a reason code: the caller knows which module it is drawing and
 * what that module's reason means there.
 */
it.each(["en", "zh"])("lets the caller replace the unavailable sentence for a reason it understands better, in %s", async (locale) => {
  await renderModule({ status: "unavailable", reason: "not_applicable" }, locale, { unavailableNote: "No competitor site is confirmed yet." });

  const note = host.querySelector("[data-module-unavailable]")?.textContent ?? "";
  expect(note).toBe("No competitor site is confirmed yet.");
  expect(note).not.toContain(card(locale).module.unavailable.not_applicable);
});

it.each(["en", "zh"])("keeps the generic unavailable sentence when no override is given, in %s", async (locale) => {
  await renderModule({ status: "unavailable", reason: "not_applicable" }, locale);

  expect(host.querySelector("[data-module-unavailable]")?.textContent).toBe(card(locale).module.unavailable.not_applicable);
});

/**
 * The three read-only modules fold to their header on the review card. They
 * report observations rather than ask for decisions, and drawn open they put
 * a screen of cards between the Owner and the next thing to decide. Folded is
 * the resting state; opening is one press on the header; the body is not in
 * the DOM while folded, so a test that finds a card inside a folded module has
 * found a bug and not a hidden element.
 *
 * A button, not a `details` element: the frozen customer view is
 * contractually free of disclosure widgets, and only the review card asks for
 * this. A module that does not ask keeps a plain heading.
 */
it.each(["en", "zh"])("folds a collapsible module to its header until opened, in %s", async (locale) => {
  await renderModule({ status: "available" }, locale, { collapsible: true });

  const toggle = host.querySelector<HTMLButtonElement>("[data-section-toggle]")!;
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(toggle.textContent).toContain("Reliable facts");
  expect(host.querySelector("[data-module-children]")).toBeNull();
  expect(host.querySelector("[data-geo-kb-module]")).toBeNull();

  await act(async () => toggle.click());
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(host.querySelector("[data-module-children]")).not.toBeNull();
  expect(toggle.getAttribute("aria-controls")).toBe(host.querySelector("[data-section-body]")?.id);

  await act(async () => toggle.click());
  expect(host.querySelector("[data-module-children]")).toBeNull();
});

it("draws a plain heading and an open body when nothing asked it to fold", async () => {
  await renderModule({ status: "available" });

  expect(host.querySelector("[data-section-toggle]")).toBeNull();
  expect(host.querySelector("button")).toBeNull();
  expect(host.querySelector("[data-module-children]")).not.toBeNull();
});

/**
 * An unavailable module folded away is a module whose one sentence ("not
 * collected", "this section does not apply") nobody reads. It still folds --
 * the Owner asked for the resting state to be closed -- but the sentence is
 * the whole body, so it is drawn as the body the moment the module opens.
 */
it("folds an unavailable module the same way and shows its sentence on opening", async () => {
  await renderModule({ status: "unavailable", reason: "not_collected" }, "en", { collapsible: true });

  expect(host.querySelector("[data-module-unavailable]")).toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>("[data-section-toggle]")!.click());
  expect(host.querySelector("[data-module-unavailable]")?.textContent).toBe(card("en").module.unavailable.not_collected);
});
