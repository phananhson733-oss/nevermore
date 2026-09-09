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

async function renderModule(state: GeoKbModuleState, locale = "en") {
  await act(async () => root.render(
    <NextIntlClientProvider locale={locale} timeZone="UTC" messages={locale === "zh" ? zh : en}>
      <GeoKbModuleSection title="Reliable facts" state={state}>
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
