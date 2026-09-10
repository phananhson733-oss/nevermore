// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it } from "vitest";

import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";
import { GeoKnowledgePack } from "./geo-knowledge-pack.tsx";
import { geoKnowledgePackCopy } from "./geo-knowledge-pack-copy.ts";
import { useGeoKbCopy } from "./geo-kb-copy.ts";
import { geoKnowledgePackFixture } from "./geo-knowledge-pack.test-fixtures.ts";
import { geoKnowledgePackV2Fixture } from "./geo-knowledge-pack-v2.test-fixtures.ts";
import type { GeoKnowledgeModuleName } from "./geo-knowledge-pack-v2.tsx";
import { buildGeoKnowledgePackV2 } from "../../lib/geo-tools/kb-knowledge-pack-v2-contract.ts";
import { buildGeoKnowledgePackV3 } from "../../lib/geo-tools/kb-knowledge-pack-v3.ts";
import { GEO_ENTITY_FIELD_PATHS } from "../../lib/geo-tools/kb-knowledge-shape.ts";
import { geoItemKey } from "../../lib/geo-tools/kb-item-key.ts";
import { completePayloadV3 } from "../../lib/geo-tools/kb-v3.test-fixtures.ts";

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const card = (locale: string) => (locale === "zh" ? zh : en).tools.geoKnowledgeBase.card;

async function render(locale = "en", modules?: readonly GeoKnowledgeModuleName[], pack = geoKnowledgePackV2Fixture()) {
  await act(async () => root.render(
    <NextIntlClientProvider locale={locale} timeZone="UTC" messages={locale === "zh" ? zh : en}>
      <GeoKnowledgePack pack={pack} locale={locale} heading={3} modules={modules} />
    </NextIntlClientProvider>,
  ));
}

const chips = () => Array.from(host.querySelectorAll("[data-decision-chip]")).map((node) => node.textContent);
const groupState = (index: number) => Array.from(host.querySelectorAll("[data-geo-kb-group]"))[index]?.getAttribute("data-group-state");

it.each(["en", "zh"])("draws all eight modules in the shared section language in %s", async (locale) => {
  await render(locale);

  const copy = geoKnowledgePackCopy(locale);
  expect(Array.from(host.querySelectorAll("h3")).map((node) => node.textContent)).toEqual([
    copy.sections.entity, copy.sections.facts, copy.sections.qa, copy.sections.comparisons,
    copy.sections.scope, copy.sections.evidence, copy.sections.machine, copy.sections.coverage,
  ]);
  expect(host.querySelector("[data-pack-version]")?.getAttribute("data-pack-version")).toBe("v2");
});

it("draws only the modules the card asked for, in that order", async () => {
  await render("en", ["facts", "entity"]);

  const copy = geoKnowledgePackCopy("en");
  expect(Array.from(host.querySelectorAll("h3")).map((node) => node.textContent)).toEqual([copy.sections.facts, copy.sections.entity]);
});

/**
 * A published pack from before 2026-09-09: ten reviewable items, two accepted
 * one by one and eight carrying the retired `accepted_in_bulk` label. All ten
 * read as accepted now -- the Owner retired the distinction, and a version
 * already frozen cannot be re-decided, so the only alternative would be to
 * keep showing those eight in a state the screen no longer explains.
 */
it.each(["en", "zh"])("reads a legacy bulk acceptance as an acceptance in %s", async (locale) => {
  await render(locale);

  const copy = card(locale).decisions;
  expect(chips().filter((text) => text === copy.accepted)).toHaveLength(10);
  expect(chips()).toHaveLength(10);
});

it.each(["en", "zh"])("shows an owner correction as a declaration with what it replaced in %s", async (locale) => {
  await render(locale, ["facts"]);

  const owner = host.querySelector('[data-origin="declared_owner"]');
  expect(owner).not.toBeNull();
  expect(owner?.querySelector("[data-item-source]")?.textContent).toContain(card(locale).origins.declared_owner);
  expect(owner?.querySelector("[data-item-prior-source]")?.textContent).toContain(card(locale).item.priorBasis);
  expect(owner?.querySelector("[data-item-prior-source]")?.textContent).toContain(card(locale).origins.observed_own);
});

it("names the off-site domain and its independence verdict on the item that cites it", async () => {
  await render("en", ["facts"]);

  const offsite = host.querySelector('[data-origin="observed_third_party"] [data-item-source]')?.textContent ?? "";
  expect(offsite).toContain("press.example");
  expect(offsite).toContain(card("en").independence.independent);
  expect(offsite).toContain(card("en").evidenceChecks.cited_and_literals_match);
});

/**
 * The bug this redesign had to fix. Two of these groups were hard-coded empty
 * upstream and then omitted here, so a partial report rendered as a complete
 * one.
 */
it.each(["en", "zh"])("draws every evidence group and says which absence each one is, in %s", async (locale) => {
  await render(locale, ["evidence"]);

  expect(host.querySelectorAll("[data-geo-kb-group]")).toHaveLength(5);
  expect([0, 1, 2, 3, 4].map(groupState)).toEqual(["available", "collected_empty", "available", "not_collected", "not_collected"]);
  const notes = Array.from(host.querySelectorAll("[data-group-note]")).map((node) => node.textContent);
  expect(notes).toEqual([card(locale).groups.collectedEmpty, card(locale).groups.notCollected, card(locale).groups.notCollected]);
  for (const group of ["proof", "changelog", "press", "thirdPartyProfiles", "firstPartyProof"] as const) {
    expect(host.textContent, group).toContain(card(locale).groups[group]);
  }
});

it.each(["en", "zh"])("reports search-use and training-use crawler rules separately in %s", async (locale) => {
  await render(locale, ["machine"]);

  const search = host.querySelector('[data-crawler-use="search"]')?.textContent ?? "";
  const training = host.querySelector('[data-crawler-use="training"]')?.textContent ?? "";
  expect(search).toContain("OAI-SearchBot");
  expect(search).toContain(card(locale).machine.access.allowed);
  expect(training).toContain("GPTBot");
  expect(training).toContain(card(locale).machine.access.disallowed);
  expect(search).not.toContain("GPTBot");
  expect(host.querySelector('[data-machine-field="snippets"]')?.textContent).toContain(card(locale).machine.snippetStatuses.allowed);
});

it("keeps a partial module visible and states its limitation", async () => {
  await render("en", ["qa"]);

  expect(host.querySelector("[data-geo-kb-module]")?.getAttribute("data-module-status")).toBe("partial");
  expect(host.querySelector("[data-module-limitation]")?.textContent).toContain("Only questions supported by the published pages");
  expect(host.textContent).toContain("Does Example Cloud replace human approval?");
});

it("keeps every internal identity out of the customer page", async () => {
  const pack = geoKnowledgePackV2Fixture();
  await render("en", undefined, pack);

  const html = host.outerHTML;
  expect(html).not.toMatch(/[a-f0-9]{64}/u);
  for (const hidden of [
    pack.schemaVersion,
    pack.contentHash,
    pack.meta.generatedAt,
    ...pack.sourceCatalogue.map((source) => source.id),
    "fact:approval", "fact:price", "qa:approval", "comparison:rival", "row:approval", "evidence:press",
  ]) expect(html, hidden).not.toContain(hidden);
  expect(host.querySelector("details")).toBeNull();
});

it("keeps rendering a historical v1 pack through the renderer it was written for", async () => {
  await render("zh", undefined, geoKnowledgePackFixture() as never);

  expect(host.querySelector("[data-pack-version]")).toBeNull();
  expect(host.querySelector("[data-geo-knowledge-pack]")).not.toBeNull();
  expect(host.querySelector("[data-decision-chip]")).toBeNull();
  expect(host.textContent).toContain("Example Cloud gives small teams a shared workflow");
});

/**
 * The rendered half of the entity-exclusion rule.
 *
 * The entity block draws its values unconditionally -- aliases, definitions,
 * links -- and its provenance rows separately. So a publish that dropped only
 * the row for an excluded field left the rejected text on the page, now with
 * no origin and no decision chip beside it: the one value nobody vouched for
 * read as the least qualified thing there rather than as absent.
 */
it.each(["en", "zh"])("draws nothing at all for an entity field the owner excluded, in %s", async (locale) => {
  const at = "2026-09-03T00:00:00.000Z";
  const draft = structuredClone(completePayloadV3()) as any;
  const aliasKey = geoItemKey({ module: "entity", field: "aliases" });
  draft.knowledge.entity.value.aliases = ["Acme Inc", "Acme Analytics"];
  draft.knowledge.entity.value.fields.push({
    field: "aliases",
    itemKey: aliasKey,
    origin: "observed_own",
    sourceRefs: ["own:home"],
    evidenceChecks: "cited_and_literals_match",
    alternateObservations: [],
  });
  draft.review.decisions = [{
    itemKey: aliasKey,
    decision: "excluded",
    override: null,
    baseContentHash: "a".repeat(64),
    decidedAt: "2026-09-02T12:00:00.000Z",
    baseDraftVersion: "4",
  }];
  const pack = buildGeoKnowledgePackV3({ generatedAt: at, payload: draft, questionSet: null, bulkAcceptedAt: at });

  await render(locale, ["entity"], pack as never);

  expect(host.textContent).not.toContain("Acme Analytics");
  expect(host.textContent).not.toContain("Acme Inc");
  expect(host.querySelector('[data-entity-field="aliases"]')).toBeNull();
  // The kept field is still drawn, with its row: nothing here suppresses the
  // whole block, and the aliases label still says the value is now empty.
  expect(host.querySelector('[data-entity-field="name"]')).not.toBeNull();
  expect(host.textContent).toContain("Acme is a chart tool.");
  expect(host.textContent).toContain(geoKnowledgePackCopy(locale).none);
});

/**
 * Every entity field row is keyed by its dotted contract path -- `definitions.w25`,
 * `categories.primary`, `links.pricing`. Printing that path is printing an
 * internal identifier at the customer: it is the same bytes in both languages,
 * which is the tell. The labels already exist in the catalog because the review
 * screen reads them; the published pack has to read the same ones.
 */
function packWithEntityField(field: string) {
  const { contentHash: _contentHash, ...body } = structuredClone(geoKnowledgePackV2Fixture()) as Record<string, any>;
  body.entity.value.fields = [{ ...body.entity.value.fields[0], field }];
  return buildGeoKnowledgePackV2(body);
}

it.each(["en", "zh"])("names an entity field in the reader's language rather than by its path, in %s", async (locale) => {
  await render(locale, ["entity"], packWithEntityField("definitions.w25") as never);

  const row = host.querySelector('[data-entity-field="definitions.w25"]');
  expect(row).not.toBeNull();
  expect(row?.textContent).toContain(card(locale).entityFields.definitions.w25);
  expect(row?.textContent).not.toContain("definitions.w25");
});

async function entityFieldLabels(locale: string): Promise<Record<string, string>> {
  const seen: Record<string, string>[] = [];
  function Probe() {
    seen.push(useGeoKbCopy().entityFields);
    return null;
  }
  await act(async () => root.render(
    <NextIntlClientProvider locale={locale} timeZone="UTC" messages={locale === "zh" ? zh : en}>
      <Probe />
    </NextIntlClientProvider>,
  ));
  expect(seen).toHaveLength(1);
  return seen[0]!;
}

it("labels every entity field path in both languages", async () => {
  // Completeness, not spot checks: a path with no key does not throw under
  // next-intl, it renders the key path, so the assertion is that no label
  // still looks like one. And a label that is the same bytes in both languages
  // is the untranslated-path bug wearing a different shape.
  const [english, chinese] = [await entityFieldLabels("en"), await entityFieldLabels("zh")];

  for (const path of GEO_ENTITY_FIELD_PATHS) {
    expect(english[path], path).toBeTruthy();
    expect(english[path], path).not.toContain("entityFields");
    expect(english[path], path).not.toBe(path);
    expect(chinese[path], path).toBeTruthy();
    expect(chinese[path], path).not.toContain("entityFields");
    expect(chinese[path], path).not.toBe(english[path]);
  }
});
