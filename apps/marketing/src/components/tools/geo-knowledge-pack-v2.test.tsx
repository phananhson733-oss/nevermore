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

/**
 * A stored field name that is also a member of `Object.prototype`.
 *
 * The pack contract types an entity field as bounded SHORT TEXT, not as the
 * path enum, so `__proto__` is a value it accepts. `copy.entityFields[field]`
 * with a `??` fallback returns `Object.prototype` for it -- not nullish, so the
 * fallback never fires -- and React refuses to render an object, taking the
 * whole account page down rather than one row.
 */
it("renders an entity field named after a prototype member instead of taking the page down", async () => {
  const pack = geoKnowledgePackV2Fixture();
  if (pack.entity.status === "unavailable") throw new Error("entity fixture required");
  const hostile = {
    ...pack,
    entity: {
      ...pack.entity,
      value: {
        ...pack.entity.value,
        fields: pack.entity.value.fields.map((field) => ({ ...field, field: "__proto__" })),
      },
    },
  };

  await render("zh", ["entity"], rebuilt(hostile));

  expect(host.querySelector("[data-geo-knowledge-pack]")).not.toBeNull();
  expect(host.textContent).toContain("__proto__");
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
 * What each state must and must not say, written down independently.
 *
 * Every assertion below that compares rendered text against `copy.*` is
 * satisfied by ANY string, because the component reads the same object: a
 * review replaced `machineSampled` with "We read {count} whole pages in this
 * run; this signal is absent from your site." and the tests stayed green. So
 * the meaning is pinned here, as literals, and the copy tables have to agree
 * with it. `required` is a phrase the string must carry; `forbidden` are the
 * claims the code cannot support.
 */
const WORDING = {
  sampled: {
    en: { required: "other pages remain unknown", forbidden: ["your site", "whole page", "read from"] },
    zh: { required: "其他页面仍然未知", forbidden: ["整站", "全站", "本次读取了"] },
  },
  invalidResponse: {
    en: { required: "could not be validated", forbidden: ["HTML", "404"] },
    zh: { required: "无法确认", forbidden: ["HTML", "404", "不是这个文件"] },
  },
  crawlerNone: {
    en: { required: "not determined", forbidden: ["No rule was observed", "was read", "contains no"] },
    zh: { required: "未判定", forbidden: ["没有观察到", "读取了完整", "没有拿到完整"] },
  },
  snippetsUnchecked: {
    en: { required: "this run", forbidden: ["detected", "No snippet permission"] },
    zh: { required: "本次", forbidden: ["未检测到", "没有检测"] },
  },
} as const;

function assertWording(actual: string, spec: { readonly required: string; readonly forbidden: readonly string[] }) {
  expect(actual).toContain(spec.required);
  for (const claim of spec.forbidden) expect(actual, claim).not.toContain(claim);
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
  // `invalid_response` covers a missing Content-Type as well as an HTML body,
  // so the clause may not name either one.
  assertWording(copy.machineReasons.invalid_response, WORDING.invalidResponse[locale as "en" | "zh"]);
});

/**
 * The sitemap is the one resource whose `insufficient_evidence` is not about
 * what was read.
 *
 * A `<sitemapindex>` is read whole and is perfectly legible; it simply lists
 * sitemaps rather than pages, and the collector does not open them (that is
 * more of the owner's crawl allowance). The shared clause -- "what was read was
 * not enough to decide" -- would send the owner looking for a broken or
 * truncated file that does not exist.
 */
it.each(["en", "zh"])("says a sitemap yielded no URL list rather than blaming what it read, in %s", async (locale) => {
  const pack = geoKnowledgePackV2Fixture();
  const machine = machineOf(pack);
  const indexed = {
    ...pack,
    machine: { ...pack.machine, value: { ...machine, sitemap: { status: "unreachable" as const, urlCount: null, knowledgePagesListed: null, sourceRefs: ["source:sitemap"] } } },
    sourceCatalogue: pack.sourceCatalogue.map((source) => source.id === "source:sitemap"
      ? { ...source, availability: "unavailable" as const, reason: "insufficient_evidence" as const, observedAt: null, bodyHash: null, excerpts: [] }
      : source),
  };
  await render(locale, ["machine"], rebuilt(indexed));

  const copy = geoKnowledgePackCopy(locale);
  const sitemap = host.querySelector('[data-machine-field="sitemap"]')?.textContent ?? "";
  expect(sitemap).toContain(copy.machineNoUrlList);
  expect(sitemap).not.toContain(copy.machineReasons.insufficient_evidence);
  // Written out rather than read from the leaf the card renders: the sentence
  // has to name the index, and may not claim the file was unreadable.
  expect(copy.machineNoUrlList).toContain(locale === "zh" ? "索引" : "index");
  for (const forbidden of locale === "zh" ? ["不足", "读不到", "无法读取"] : ["not enough", "could not be read", "unreadable"]) {
    expect(copy.machineNoUrlList).not.toContain(forbidden);
  }
});

it.each(["en", "zh"])("scopes a page-level negative to the pages it cites, in %s", async (locale) => {
  const pack = geoKnowledgePackV2Fixture();
  const machine = machineOf(pack);
  // astrologywiki.com declares hreflang on /zh/ and not on its home page. This
  // run cited two own pages against a 558-URL sitemap: "not detected" alone is
  // a statement about two pages published as a verdict about the site.
  const second = { ...pack.sourceCatalogue.find((source) => source.id === "source:home")!, id: "source:about", url: "https://example.com/about" };
  const twoPages = {
    ...pack,
    machine: { ...pack.machine, value: { ...machine, hreflang: { status: "absent" as const, locales: [], sourceRefs: ["source:home", "source:about"] } } },
    sourceCatalogue: [...pack.sourceCatalogue, second],
  };
  await render(locale, ["machine"], rebuilt(twoPages));

  const copy = geoKnowledgePackCopy(locale);
  const hreflang = host.querySelector('[data-machine-field="hreflang"]')?.textContent ?? "";
  expect(hreflang).toContain(copy.machineStatuses.absent);
  expect(hreflang).toContain(copy.machineSampled.replace("{count}", "2"));
  assertWording(copy.machineSampled, WORDING.sampled[locale as "en" | "zh"]);
});

it("counts addresses, not source records", async () => {
  const pack = geoKnowledgePackV2Fixture();
  const machine = machineOf(pack);
  // The final v2 contract accepts two source records for one URL even though
  // the collector deduplicates. Counting records would say "2 pages" about one.
  const twice = { ...pack.sourceCatalogue.find((source) => source.id === "source:home")!, id: "source:home-again" };
  const duplicated = {
    ...pack,
    machine: { ...pack.machine, value: { ...machine, hreflang: { status: "absent" as const, locales: [], sourceRefs: ["source:home", "source:home-again"] } } },
    sourceCatalogue: [...pack.sourceCatalogue, twice],
  };
  await render("en", ["machine"], rebuilt(duplicated));

  const copy = geoKnowledgePackCopy("en");
  expect(host.querySelector('[data-machine-field="hreflang"]')?.textContent).toContain(copy.machineSampled.replace("{count}", "1"));
});

it("leaves out an address whose evidence is unavailable", async () => {
  const pack = geoKnowledgePackV2Fixture();
  const machine = machineOf(pack);
  const home = pack.sourceCatalogue.find((source) => source.id === "source:home")!;
  // Available home, partial /about, the home cited a second time, and an
  // address nobody could read. Two addresses carry usable evidence; the
  // unreadable one is not a page this signal looked at.
  const mixedSources = [
    ...pack.sourceCatalogue,
    { ...home, id: "source:about", url: "https://example.com/about", availability: "partial" as const, reason: "partial_body" as const },
    { ...home, id: "source:home-again" },
    { ...home, id: "source:unread", url: "https://example.com/unread", availability: "unavailable" as const, reason: "timeout" as const, observedAt: null, bodyHash: null, excerpts: [] },
  ];
  const mixed = {
    ...pack,
    machine: { ...pack.machine, value: { ...machine, hreflang: { status: "absent" as const, locales: [],
      sourceRefs: ["source:home", "source:about", "source:home-again", "source:unread"] } } },
    sourceCatalogue: mixedSources,
  };
  await render("en", ["machine"], rebuilt(mixed));

  const copy = geoKnowledgePackCopy("en");
  expect(host.querySelector('[data-machine-field="hreflang"]')?.textContent).toContain(copy.machineSampled.replace("{count}", "2"));
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
  assertWording(card(locale).machine.crawlerNone, WORDING.crawlerNone[locale as "en" | "zh"]);
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
  // The point of the change: it names the RUN, so it cannot be read as a
  // finding about the site the way the neighbouring `absent` cards are. The
  // old zh string was 未检测, one character off the 未检测到 beside it.
  assertWording(card(locale).machine.snippetStatuses.not_checked, WORDING.snippetsUnchecked[locale as "en" | "zh"]);
  expect(copy.machineStatuses.absent.startsWith(card(locale).machine.snippetStatuses.not_checked)).toBe(false);
});

it.each(["en", "zh"])("names a coverage row in the reader's language and keeps what the row knows, in %s", async (locale) => {
  const pack = geoKnowledgePackV2Fixture();
  // The v3 publisher writes a specific summary and a specific recovery action
  // for an owner who excluded every item in a section. An earlier draft of this
  // change replaced both with one localized sentence and cost the owner the
  // only thing the row knew.
  const excluded = {
    ...pack,
    coverage: { status: "available" as const, value: [{
      id: "coverage:qa", label: "Q&A", status: "missing" as const,
      summary: "You excluded every item in this section, so it is not published.",
      nextAction: "Restore an excluded item to publish this section.",
      sourceRefs: [],
    }] },
  };
  await render(locale, ["coverage"], rebuilt(excluded));

  const copy = geoKnowledgePackCopy(locale);
  const text = host.textContent ?? "";
  expect(text).toContain(copy.coverageLabels.qa);
  expect(text).toContain("You excluded every item in this section");
  expect(text).toContain("Restore an excluded item");
  if (locale === "zh") expect(text).not.toContain("Q&A");
  // "缺失" reads as a failure. Content the owner deliberately removed is not
  // missing, and this badge covers both.
  // Neither a failure ("缺失") nor a claim about generation: this content was
  // generated and then removed by its owner.
  expect(copy.coverageStatuses.missing).toBe(locale === "zh" ? "未收录" : "Not included");
});

it("names the questions row, which has no module of its own", async () => {
  const pack = geoKnowledgePackV2Fixture();
  const questions = {
    ...pack,
    coverage: { status: "available" as const, value: [{
      id: "coverage:questions", label: "Question set", status: "missing" as const,
      summary: "This version has no question set.", nextAction: null, sourceRefs: [],
    }] },
  };
  await render("zh", ["coverage"], rebuilt(questions));

  expect(host.textContent).toContain("问题集");
  expect(host.textContent).not.toContain("Question set");
});

it("renders a stored coverage id that names a prototype member", async () => {
  const pack = geoKnowledgePackV2Fixture();
  // `coverage:__proto__` passes the contract. A plain dictionary index returns
  // `Object.prototype`, which React refuses to render -- the whole card, and
  // everything after it, disappears with "Objects are not valid as a React
  // child". The stored label is the right answer for an id nobody knows.
  const hostile = {
    ...pack,
    coverage: { status: "available" as const, value: [
      { id: "coverage:__proto__", label: "Custom coverage", status: "missing" as const, summary: "Unavailable.", nextAction: null, sourceRefs: [] },
      { id: "coverage:constructor", label: "Another row", status: "missing" as const, summary: "Unavailable.", nextAction: null, sourceRefs: [] },
      { id: "entity", label: "Bare id", status: "missing" as const, summary: "Unavailable.", nextAction: null, sourceRefs: [] },
    ] },
  };
  await render("zh", ["coverage"], rebuilt(hostile));

  const text = host.textContent ?? "";
  expect(text).toContain("Custom coverage");
  expect(text).toContain("Another row");
  // A bare `entity` is not a coverage key and must not acquire that name.
  expect(text).toContain("Bare id");
  expect(text).not.toContain(geoKnowledgePackCopy("zh").coverageLabels.entity);
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

/**
 * `crawlerAccess` in `kb-knowledge-assemble-observed.ts` asks
 * `matchRobotsRule(groups, agent, "/")` -- the home address. The card printed
 * "GPTBot: Allowed" with nothing saying what was asked, so a site allowing `/`
 * and disallowing `/docs/` read as an unqualified site-wide permission.
 *
 * The needle is written out here rather than filled from the catalog the card
 * renders from: comparing the render against its own leaf passes for every
 * possible wording, including a wording that drops the qualification again.
 */
it("says where the crawler verdicts were decided", async () => {
  for (const locale of ["zh", "en"] as const) {
    await render(locale);
    const field = host.querySelector('[data-machine-field="aiCrawlers"]')?.textContent ?? "";
    const needle = locale === "zh" ? "首页" : "home address";
    expect(field).toContain(needle);
    // And it says why one address is not the whole site.
    expect(field).toContain(locale === "zh" ? "按路径" : "per path");
  }
});

/**
 * gpt-6-astra's P3: with both uses empty the rows read "Crawler permissions
 * were not determined in this run", and the scope sentence followed with a
 * statement about where a verdict was reached. Empty rows are a real upstream
 * outcome -- it is what the assembler produces when the full robots rules were
 * not read -- so the card said, in two consecutive lines, that nothing was
 * determined and that something was decided at the home address.
 */
it.each(["en", "zh"])("does not say where a verdict was reached when there is none, in %s", async (locale) => {
  const pack = geoKnowledgePackV2Fixture();
  const machine = machineOf(pack);
  const undetermined = {
    ...pack,
    machine: { ...pack.machine, value: { ...machine, aiCrawlers: { search: [], training: [], sourceRefs: ["source:robots"] } } },
  };
  await render(locale, ["machine"], rebuilt(undetermined));

  const field = host.querySelector('[data-machine-field="aiCrawlers"]')?.textContent ?? "";
  // The rows still say what happened...
  expect(field).toContain(locale === "zh" ? "本次未判定" : "were not determined");
  // ...and nothing after them claims a verdict was reached anywhere.
  expect(field).not.toContain(locale === "zh" ? "首页地址" : "home address");
});

/**
 * The other mutation gpt-6-astra found alive: `&&` widened to `||`, which drops
 * the qualifier as soon as EITHER use is empty.
 *
 * One use empty and the other populated is the ordinary shape -- a site with no
 * training-crawler rules still has search ones -- and the permissions that ARE
 * reported still need their scope said.
 */
it.each([
  ["search", { search: [], training: [{ agent: "GPTBot", access: "allowed" as const }] }],
  ["training", { search: [{ agent: "OAI-SearchBot", access: "allowed" as const }], training: [] }],
])("still scopes the permissions it does report when only %s is empty", async (_empty, rows) => {
  const pack = geoKnowledgePackV2Fixture();
  const machine = machineOf(pack);
  const mixed = {
    ...pack,
    machine: { ...pack.machine, value: { ...machine, aiCrawlers: { ...rows, sourceRefs: ["source:robots"] } } },
  };
  await render("zh", ["machine"], rebuilt(mixed));

  const field = host.querySelector('[data-machine-field="aiCrawlers"]')?.textContent ?? "";
  expect(field).toContain("首页地址");
});

/**
 * The mutation gpt-6-astra found alive: dropping `reason === "insufficient_evidence"`
 * from the sitemap branch left all 4,772 tests green while telling the owner
 * "This sitemap was read" about a sitemap that was blocked, failed to fetch, or
 * was never checked at all.
 */
it.each(["blocked", "fetch_failed", "not_found"] as const)("keeps the index explanation off a sitemap that was %s", async (reason) => {
  const pack = geoKnowledgePackV2Fixture();
  const machine = machineOf(pack);
  const refused = {
    ...pack,
    machine: { ...pack.machine, value: { ...machine, sitemap: { status: "unreachable" as const, urlCount: null, knowledgePagesListed: null, sourceRefs: ["source:sitemap"] } } },
    sourceCatalogue: pack.sourceCatalogue.map((source) => source.id === "source:sitemap"
      ? { ...source, availability: "unavailable" as const, reason, observedAt: null, bodyHash: null, excerpts: [] }
      : source),
  };
  await render("zh", ["machine"], rebuilt(refused));

  const copy = geoKnowledgePackCopy("zh");
  const sitemap = host.querySelector('[data-machine-field="sitemap"]')?.textContent ?? "";
  expect(sitemap).toContain(copy.machineReasons[reason]);
  expect(sitemap).not.toContain(copy.machineNoUrlList);
});
