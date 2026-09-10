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

/** The fixture's machine module, which is `available` and must stay that way. */
function machineOf(pack: ReturnType<typeof geoKnowledgePackV2Fixture>) {
  if (pack.machine.status !== "available") throw new Error("The machine fixture is no longer available");
  return pack.machine.value;
}

/** A fixture with one module rewritten, put back through the real contract. */
function rebuilt(pack: ReturnType<typeof geoKnowledgePackV2Fixture>) {
  const { contentHash: _contentHash, ...body } = pack;
  return buildGeoKnowledgePackV2(body);
}

/**
 * The production complaint of 2026-09-10, in four assertions.
 *
 * The owner looked at these cards and asked the one question they could not
 * answer from them: is this signal genuinely absent from my site, did the fetch
 * fail, or did nobody check? Every one of these rendered as a bare verdict.
 */
it.each(["en", "zh"])("says WHY a machine signal is not present, in %s", async (locale) => {
  const pack = geoKnowledgePackV2Fixture();
  const machine = machineOf(pack);
  // astrologywiki.com's actual shape: /llms.txt answers 200 with the site's own
  // SPA shell. The source reason is `invalid_response`, and the card said
  // 无法访问 -- which tells the owner to check their network when what they
  // need to know is that they publish no llms.txt.
  const withLlmsHtml = {
    ...pack,
    machine: { ...pack.machine, value: { ...machine, llms: { status: "unreachable" as const, sourceRefs: ["source:llms"] } } },
    sourceCatalogue: pack.sourceCatalogue.map((source) => source.id === "source:llms"
      ? { ...source, availability: "unavailable" as const, reason: "invalid_response" as const, observedAt: null, bodyHash: null, excerpts: [] }
      : source),
  };
  await render(locale, ["machine"], rebuilt(withLlmsHtml));

  const copy = geoKnowledgePackCopy(locale);
  const llms = host.querySelector('[data-machine-field="llms"]')?.textContent ?? "";
  expect(llms).toContain(copy.machineStatuses.unreachable);
  expect(llms).toContain(copy.machineReasons.invalid_response);
  // The label itself no longer asserts that nobody could reach the address.
  expect(copy.machineStatuses.unreachable).not.toContain(locale === "zh" ? "无法访问" : "Could not be reached");
});

it.each(["en", "zh"])("scopes a page-level negative to the pages it read, in %s", async (locale) => {
  const pack = geoKnowledgePackV2Fixture();
  const machine = machineOf(pack);
  // astrologywiki.com declares hreflang on /zh/ and not on its home page. This
  // run read the home page. "Not detected" alone is a statement about one page
  // published as a verdict about a 558-URL site.
  const noHreflang = {
    ...pack,
    machine: { ...pack.machine, value: { ...machine, hreflang: { status: "absent" as const, locales: [], sourceRefs: ["source:home"] } } },
  };
  await render(locale, ["machine"], rebuilt(noHreflang));

  const copy = geoKnowledgePackCopy(locale);
  const hreflang = host.querySelector('[data-machine-field="hreflang"]')?.textContent ?? "";
  expect(hreflang).toContain(copy.machineStatuses.absent);
  expect(hreflang).toContain(copy.machineSampled.replace("{count}", "1"));
  // The count is the number of own pages actually READ, so it can never claim
  // more reading than happened.
  expect(hreflang).toContain("1");
});

it.each(["en", "zh"])("does not call an undetermined crawler analysis an observed absence, in %s", async (locale) => {
  const pack = geoKnowledgePackV2Fixture();
  const machine = machineOf(pack);
  // Empty arrays mean the assembly had no verifiable complete rule set, never
  // that the file was read and carried no rule for that use.
  const undetermined = {
    ...pack,
    machine: { ...pack.machine, value: { ...machine, aiCrawlers: { search: [], training: [], sourceRefs: ["source:robots"] } } },
  };
  await render(locale, ["machine"], rebuilt(undetermined));

  const text = host.querySelector('[data-crawler-use="search"]')?.textContent ?? "";
  expect(text).toContain(card(locale).machine.crawlerNone);
  expect(card(locale).machine.crawlerNone).not.toContain(locale === "zh" ? "没有观察到" : "No rule was observed");
});

it.each(["en", "zh"])("separates a check nobody ran from a check that found nothing, in %s", async (locale) => {
  const pack = geoKnowledgePackV2Fixture();
  const machine = machineOf(pack);
  // Both deployed assembly branches always pass `null` for snippets, so every
  // owner sees this state. In Chinese it read 未检测 beside cards reading
  // 未检测到 -- one character apart, and the two mean opposite things.
  const unchecked = {
    ...pack,
    machine: { ...pack.machine, value: { ...machine, snippets: { status: "not_checked" as const, sourceRefs: ["source:home"] } } },
  };
  await render(locale, ["machine"], rebuilt(unchecked));

  const copy = geoKnowledgePackCopy(locale);
  const text = host.querySelector('[data-machine-field="snippets"]')?.textContent ?? "";
  expect(text).toContain(card(locale).machine.snippetStatuses.not_checked);
  // The point of the change: it can no longer be mistaken for the observed
  // negative rendered on every neighbouring card.
  expect(card(locale).machine.snippetStatuses.not_checked).not.toBe(copy.machineStatuses.absent);
  expect(copy.machineStatuses.absent.startsWith(card(locale).machine.snippetStatuses.not_checked)).toBe(false);
});

it.each(["en", "zh"])("names a coverage row in the reader's language and does not invent its cause, in %s", async (locale) => {
  const pack = geoKnowledgePackV2Fixture();
  // The stored row is the server's English, and the same sentence for every
  // reason a section produced nothing.
  const missing = {
    ...pack,
    coverage: { status: "available" as const, value: [{
      id: "coverage:comparisons", label: "Comparisons", status: "missing" as const,
      summary: "This content is currently unavailable.",
      nextAction: "Review available evidence before relying on this section.",
      sourceRefs: [],
    }] },
  };
  await render(locale, ["coverage"], rebuilt(missing));

  const copy = geoKnowledgePackCopy(locale);
  const text = host.textContent ?? "";
  expect(text).toContain(copy.coverageLabels.comparisons);
  expect(text).toContain(copy.coverageMissing);
  expect(text).not.toContain("This content is currently unavailable.");
  if (locale === "zh") expect(text).not.toContain("Comparisons");
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
