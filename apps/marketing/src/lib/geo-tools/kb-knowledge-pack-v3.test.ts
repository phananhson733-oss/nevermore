import { describe, expect, it } from "vitest";

import { geoItemKey } from "./kb-item-key.ts";
import {
  buildGeoKnowledgePackV3,
  GEO_ENTITY_REQUIRED_PATHS,
  GEO_FACTS_WITHOUT_MODEL_LIMITATION,
  type BuildGeoKnowledgePackV3Input,
} from "./kb-knowledge-pack-v3.ts";
import {
  geoEntityFieldClaim,
  type GeoEntityFieldPath,
} from "./kb-knowledge-shape.ts";
import { parseGeoKnowledgePackV2 } from "./kb-knowledge-pack-v2-contract.ts";
import { questionSetV2 } from "./kb-v2.test-fixtures.ts";
import {
  completePayloadV3,
  ENTITY_NAME_KEY,
  FACT_KEY_PRO,
  FACT_KEY_TEAM,
  HASH_A,
  HASH_B,
  OBSERVED_AT,
  QA_KEY,
  SCOPE_KEY,
} from "./kb-v3.test-fixtures.ts";

const PUBLISHED_AT = "2026-09-03T00:00:00.000Z";
const DECIDED_AT = "2026-09-02T12:00:00.000Z";
const PRICING_SOURCE = "own:pricing";
const COMPETITOR = {
  key: "astro.example",
  name: "Astro",
  confirmed: true,
} as const;
const ROW_PRICE_KEY = geoItemKey({
  module: "comparisons",
  competitorKey: "astro.example",
  dimension: "Pricing",
});
const ROW_CHARTS_KEY = geoItemKey({
  module: "comparisons",
  competitorKey: "astro.example",
  dimension: "Chart types",
});
const ENTITY_ALIAS_KEY = geoItemKey({ module: "entity", field: "aliases" });
const ENTITY_NOT_FOR_KEY = geoItemKey({ module: "entity", field: "audience.notFor" });
const ENTITY_DISAMBIGUATION_KEY = geoItemKey({ module: "entity", field: "disambiguation" });
const ENTITY_DEFINITION_KEY = geoItemKey({ module: "entity", field: "definitions.w25" });
const OWN_SOURCE = "own:home";
const ALIAS_KEPT = "Acme Inc";
const ALIAS_EXCLUDED = "Acme Analytics";
const NOT_FOR = "Enterprise finance teams";
const DISAMBIGUATION = "Acme is the astrology tool, not the accounting product.";

const entityRow = (field: GeoEntityFieldPath, itemKey: string) => ({
  field,
  itemKey,
  origin: "observed_own",
  sourceRefs: [OWN_SOURCE],
  evidenceChecks: "cited_and_literals_match",
  alternateObservations: [],
});

/**
 * The shared draft carries one entity field, so nothing in it can distinguish
 * "this field was excluded" from "the whole entity was". This one carries a
 * field of each shape the value can hold -- a list, two nullable scalars and a
 * required scalar -- so an exclusion has something to leave behind.
 */
function draftWithEntityFields(): any {
  const value = draft();
  const entity = value.knowledge.entity.value;
  entity.aliases = [ALIAS_KEPT, ALIAS_EXCLUDED];
  entity.audience.notFor = NOT_FOR;
  entity.disambiguation = DISAMBIGUATION;
  entity.fields.push(
    entityRow("aliases", ENTITY_ALIAS_KEY),
    entityRow("audience.notFor", ENTITY_NOT_FOR_KEY),
    entityRow("disambiguation", ENTITY_DISAMBIGUATION_KEY),
    entityRow("definitions.w25", ENTITY_DEFINITION_KEY),
  );
  return value;
}

function coverageFor(pack: any, id: string) {
  return (pack.coverage.value as readonly any[]).find((row) => row.id === id);
}


/**
 * The shared v3 draft. Its machine observations already cite sources of the kind
 * the pack requires -- "the sitemap says so" has to be backed by the sitemap --
 * because the draft contract now enforces the same rule the pack does, so a
 * draft that saves is a draft that can be published.
 */
function draft(): any {
  return structuredClone(completePayloadV3()) as any;
}

/** The same draft with a two-row comparison, which the shared fixture leaves unavailable. */
function draftWithComparison(): any {
  const value = draft();
  value.knowledge.sourceCatalogue.push({
    id: "comp:astro",
    kind: "competitor_page",
    label: "Astro pricing",
    url: "https://astro.example/",
    competitor: { ...COMPETITOR },
    availability: "available",
    reason: null,
    observedAt: OBSERVED_AT,
    bodyHash: HASH_B,
    excerpts: ["Astro costs 19 per month and draws natal charts."],
    independence: null,
  });
  const provenance = {
    origin: "synthesized",
    sourceRefs: [PRICING_SOURCE, "comp:astro"],
    evidenceChecks: "cited_and_literals_match",
    alternateObservations: [],
  };
  value.knowledge.comparisons = {
    status: "available",
    value: [
      {
        id: "comparison:astro",
        competitor: { ...COMPETITOR },
        checkedAt: OBSERVED_AT,
        verdict: "Acme costs less than Astro.",
        sourceRefs: [PRICING_SOURCE, "comp:astro"],
        rows: [
          {
            id: "row:price",
            dimension: "Pricing",
            product: "9 per month",
            competitor: "19 per month",
            availability: "available",
            itemKey: ROW_PRICE_KEY,
            ...provenance,
          },
          {
            id: "row:charts",
            dimension: "Chart types",
            product: "Natal charts",
            competitor: "Natal charts",
            availability: "available",
            itemKey: ROW_CHARTS_KEY,
            ...provenance,
          },
        ],
      },
    ],
  };
  return value;
}

function decision(itemKey: string, verdict: string, override: unknown = null) {
  return {
    itemKey,
    decision: verdict,
    override,
    baseContentHash: HASH_A,
    decidedAt: DECIDED_AT,
    baseDraftVersion: "4",
  };
}

/**
 * Returns the pack untyped on purpose: the assertions below reach into module
 * unions field by field, and narrowing every one of them would bury what each
 * test is actually saying. The pack's own types are exercised by the assembler.
 */
function publish(
  payload: unknown,
  overrides: Partial<BuildGeoKnowledgePackV3Input> = {},
): any {
  return buildGeoKnowledgePackV3({
    generatedAt: PUBLISHED_AT,
    payload,
    questionSet: null,
    bulkAcceptedAt: PUBLISHED_AT,
    ...overrides,
  });
}

function moduleItems(module: {
  status: string;
  value?: unknown;
}): readonly any[] {
  return module.status === "unavailable"
    ? []
    : (module as { value: readonly any[] }).value;
}

/** Every published item that carries a decision, in the order the pack counts them. */
function publishedItems(pack: any): readonly any[] {
  const entity =
    pack.entity.status === "unavailable" ? [] : pack.entity.value.fields;
  const scope =
    pack.scope.status === "unavailable"
      ? []
      : Object.values(pack.scope.value).flat();
  return [
    ...entity,
    ...moduleItems(pack.facts),
    ...moduleItems(pack.qa),
    ...moduleItems(pack.comparisons).flatMap(
      (comparison: any) => comparison.rows,
    ),
    ...(scope as readonly any[]),
  ];
}

function factNamed(pack: any, itemKey: string) {
  return moduleItems(pack.facts).find((fact) => fact.itemKey === itemKey);
}

describe("publishing a v3 draft as a v2 knowledge pack", () => {
  it("assembles a parseable pack whose content hash depends only on its arguments", () => {
    const first = publish(draft());
    const second = publish(draft());

    expect(first.schemaVersion).toBe("marketing-geo-knowledge-pack.v2");
    expect(first.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(second.contentHash).toBe(first.contentHash);
    expect(parseGeoKnowledgePackV2(first)).toEqual(first);
    expect(first.meta.lastScanAt).toBe(OBSERVED_AT);
    expect(first.meta.market).toBe("US");
  });

  it("publishes what nobody reviewed as accepted_in_bulk and never as accepted", () => {
    const pack = publish(draft());
    const decisions = publishedItems(pack).map((item) => item.decision);

    // MUTATION GUARD. This is the one assertion that must go red if the bulk
    // fallback is ever changed to write `accepted`: publishing accepts what is
    // left of `pending`, but a batch gesture may not hand a model's output the
    // label that only a one-by-one confirmation earns (design D12).
    expect(decisions).toEqual([
      "accepted_in_bulk",
      "accepted_in_bulk",
      "accepted_in_bulk",
      "accepted_in_bulk",
      "accepted_in_bulk",
    ]);
    expect(decisions).not.toContain("accepted");
    expect(pack.meta.counts.accepted).toBe(0);
    expect(pack.meta.counts.acceptedInBulk).toBe(5);
  });

  it("counts a one-by-one acceptance apart from the bulk remainder", () => {
    const value = draft();
    value.review.decisions = [decision(FACT_KEY_PRO, "accepted")];
    const pack = publish(value);

    expect(factNamed(pack, FACT_KEY_PRO).decision).toBe("accepted");
    expect(factNamed(pack, FACT_KEY_TEAM).decision).toBe("accepted_in_bulk");
    expect(pack.meta.counts.accepted).toBe(1);
    expect(pack.meta.counts.acceptedInBulk).toBe(4);
  });

  it("treats an explicit pending exactly like no record at all", () => {
    const value = draft();
    value.review.decisions = [decision(QA_KEY, "pending")];

    expect(moduleItems(publish(value).qa)[0].decision).toBe("accepted_in_bulk");
  });

  it("keeps an excluded item out of the pack and leaves the module status alone", () => {
    const value = draft();
    value.review.decisions = [decision(FACT_KEY_PRO, "excluded")];
    const pack = publish(value);

    expect(pack.facts.status).toBe("available");
    expect(moduleItems(pack.facts).map((fact) => fact.itemKey)).toEqual([
      FACT_KEY_TEAM,
    ]);
    expect(pack.meta.counts.facts).toBe(1);
    expect(pack.meta.counts.acceptedInBulk).toBe(4);
  });

  it("says the owner emptied a module, not that the evidence fell short", () => {
    const value = draft();
    value.review.decisions = [
      decision(QA_KEY, "excluded"),
      decision(SCOPE_KEY, "excluded"),
    ];
    const pack = publish(value);

    // This branch is reachable only through an exclusion or a suppression: a
    // run that genuinely found nothing arrives already unavailable and is
    // returned untouched. `insufficient_evidence` here said the collection run
    // came up short about a section the run supported and a person emptied.
    expect(pack.qa).toEqual({
      status: "unavailable",
      reason: "owner_excluded_all",
    });
    expect(pack.scope).toEqual({
      status: "unavailable",
      reason: "owner_excluded_all",
    });
    expect(pack.meta.counts.qa).toBe(0);
    // Only the entity field and the two facts are left to count.
    expect(pack.meta.counts.acceptedInBulk).toBe(3);
  });

  it("keeps a suppressed key out even when a decision says to accept it", () => {
    const value = draft();
    value.review.decisions = [decision(FACT_KEY_TEAM, "accepted")];
    value.review.suppressions = [
      { itemKey: FACT_KEY_TEAM, suppressedAt: DECIDED_AT },
    ];
    const pack = publish(value);

    expect(moduleItems(pack.facts).map((fact) => fact.itemKey)).toEqual([
      FACT_KEY_PRO,
    ]);
    expect(pack.meta.counts.accepted).toBe(0);
  });
});

describe("owner corrections", () => {
  const correctedPrice = {
    module: "facts",
    statement: "The Pro plan costs 12 per month.",
    label: "Pro plan monthly price",
    value: "12",
    reason: "",
  };

  it("republishes a corrected fact as the owner's own claim", () => {
    const value = draft();
    value.review.decisions = [
      decision(FACT_KEY_PRO, "accepted", correctedPrice),
    ];
    const fact = factNamed(publish(value), FACT_KEY_PRO);

    expect(fact.value).toBe("12");
    expect(fact.statement).toBe("The Pro plan costs 12 per month.");
    expect(fact.origin).toBe("declared_owner");
    expect(fact.decision).toBe("accepted");
    expect(fact.evidenceChecks).toBe("owner_declared");
    expect(fact.ownerDeclaredAt).toBe(DECIDED_AT);
    // The page that carried the old price is kept, but only as what this
    // replaced: it is not a source for the new number, and `observedAt` goes
    // with it because nobody observed 12 on that date.
    expect(fact.sourceRefs).toEqual([]);
    expect(fact.priorSourceRefs).toEqual([PRICING_SOURCE]);
    expect(fact.observedAt).toBeNull();
  });

  it("publishes an owner-declared number that appears in no cited excerpt", () => {
    const value = draft();
    value.review.decisions = [
      decision(FACT_KEY_PRO, "accepted", correctedPrice),
    ];

    // "12" occurs in no source excerpt. A synthesized or observed claim with
    // that number is refused by the pack's literal check; an owner declaration
    // is its own authority, so publishing must still succeed.
    expect(() => publish(value)).not.toThrow();
  });

  it("leaves the other qualifier's price untouched", () => {
    const value = draft();
    value.review.decisions = [
      decision(FACT_KEY_PRO, "accepted", correctedPrice),
    ];
    const team = factNamed(publish(value), FACT_KEY_TEAM);

    expect(FACT_KEY_PRO).not.toBe(FACT_KEY_TEAM);
    expect(team.value).toBe("29");
    expect(team.origin).toBe("observed_own");
    expect(team.sourceRefs).toEqual([PRICING_SOURCE]);
    expect(team.priorSourceRefs).toEqual([]);
  });

  it("corrects the entity field the correction names", () => {
    const value = draft();
    value.review.decisions = [
      decision(ENTITY_NAME_KEY, "accepted", {
        module: "entity",
        field: "name",
        value: "Acme Charts",
      }),
    ];
    const pack = publish(value);

    expect(pack.entity.value.name).toBe("Acme Charts");
    expect(pack.entity.value.fields[0].origin).toBe("declared_owner");
    expect(pack.entity.value.fields[0].priorSourceRefs).toEqual(["own:home"]);
  });

  it("refuses a correction to an entity field it cannot apply", () => {
    const value = draft();
    value.knowledge.entity.value.fields.push({
      field: "aliases",
      itemKey: ENTITY_ALIAS_KEY,
      origin: "observed_own",
      sourceRefs: ["own:home"],
      evidenceChecks: "cited_and_literals_match",
      alternateObservations: [],
    });
    value.review.decisions = [
      decision(ENTITY_ALIAS_KEY, "accepted", {
        module: "entity",
        field: "aliases",
        value: "Acme Inc",
      }),
    ];

    // Failing closed is the point: stamping the row `declared_owner` while the
    // generated value stayed put would publish a claim nobody made.
    expect(() => publish(value)).toThrow(/Invalid option/u);
  });

  it("refuses a correction filed against another module", () => {
    const value = draft();
    value.review.decisions = [
      decision(FACT_KEY_PRO, "accepted", {
        module: "qa",
        directAnswer: "Free.",
        expansion: null,
      }),
    ];

    expect(() => publish(value)).toThrow(/does not match the item/u);
  });

  it("refuses an entity correction that introduces an unsupported number", () => {
    const value = draft();
    value.review.decisions = [
      decision(ENTITY_NAME_KEY, "accepted", {
        module: "entity",
        field: "name",
        value: "Acme 7",
      }),
    ];

    // Known limitation of the v2 contract, pinned so a change is deliberate:
    // the entity module checks numeric literals across the whole entity value,
    // which carries no origin, so an owner-declared entity number cannot be
    // published at all rather than being published unsupported.
    expect(() => publish(value)).toThrow(/Unsupported numeric claim/u);
  });
});

/**
 * Every entity field an exclusion is able to remove, and the value it removes.
 * Written as a sweep rather than three examples: a path that gains a value but
 * no removal falls through to "required", and only a sweep says which is which.
 */
const REMOVABLE_FIELDS: [GeoEntityFieldPath, string][] = [
  ["aliases", "Removable Alias"],
  ["categories.secondary", "Removable Category"],
  ["sameAs", "https://profiles.example/acme"],
  ["disambiguation", "A removable clarification."],
  ["audience.notFor", "A removable audience."],
  ["founded.year", "2019"],
  ["founded.team", "Two founders"],
  ["founded.location", "Berlin"],
  ["links.pricing", "https://example.com/pricing"],
  ["links.docs", "https://example.com/docs"],
  ["links.about", "https://example.com/about"],
  ["links.changelog", "https://example.com/changelog"],
  ["links.faq", "https://example.com/faq"],
];

function setEntityField(entity: any, path: GeoEntityFieldPath, marker: string): void {
  const segments = path.split(".");
  const parent = segments.slice(0, -1).reduce((node: any, key) => node[key], entity);
  const leaf = segments[segments.length - 1]!;
  parent[leaf] = Array.isArray(parent[leaf]) ? [marker] : marker;
}

/** The shared draft with one removable field filled in and reviewable. */
function draftWithRemovable(path: GeoEntityFieldPath, marker: string): any {
  const value = draft();
  setEntityField(value.knowledge.entity.value, path, marker);
  // A year is a numeric claim, and the pack refuses one no cited excerpt
  // carries. Widening the entity's own basis keeps the sweep uniform instead of
  // making one row a special case.
  const home = value.knowledge.sourceCatalogue.find((source: any) => source.id === OWN_SOURCE);
  home.excerpts = [`${home.excerpts[0]} Acme was founded in 2019.`];
  value.knowledge.entity.value.fields.push(entityRow(path, geoItemKey({ module: "entity", field: path })));
  return value;
}

describe("excluding an entity field", () => {
  it("removes the field's value and not only its provenance row", () => {
    const value = draftWithEntityFields();
    value.review.decisions = [
      decision(ENTITY_ALIAS_KEY, "excluded"),
      decision(ENTITY_NOT_FOR_KEY, "excluded"),
      decision(ENTITY_DISAMBIGUATION_KEY, "excluded"),
    ];
    const pack = publish(value);
    const published = JSON.stringify(pack);

    // Dropping only the rows published exactly the text the owner rejected --
    // and published it with no origin and no decision chip beside it, so the
    // rejected value read as less qualified than the accepted ones, not absent.
    expect(pack.entity.value.aliases).toEqual([]);
    expect(pack.entity.value.audience.notFor).toBeNull();
    expect(pack.entity.value.disambiguation).toBeNull();
    expect(published).not.toContain(ALIAS_EXCLUDED);
    expect(published).not.toContain(ALIAS_KEPT);
    expect(published).not.toContain(NOT_FOR);
    expect(published).not.toContain(DISAMBIGUATION);
  });

  it("leaves every field nobody excluded exactly as it was", () => {
    const value = draftWithEntityFields();
    value.review.decisions = [decision(ENTITY_ALIAS_KEY, "excluded")];
    const pack = publish(value);

    expect(pack.entity.status).toBe("available");
    expect(pack.entity.value.fields.map((field: any) => field.field)).toEqual([
      "name",
      "audience.notFor",
      "disambiguation",
      "definitions.w25",
    ]);
    expect(pack.entity.value.audience.notFor).toBe(NOT_FOR);
    expect(pack.entity.value.disambiguation).toBe(DISAMBIGUATION);
    expect(pack.entity.value.definitions.w25).toBe("Acme is a chart tool.");
    expect(pack.entity.value.name).toBe("Acme");
  });

  it.each(REMOVABLE_FIELDS)("publishes %s until it is excluded, and then not at all", (path, marker) => {
    const before = publish(draftWithRemovable(path, marker));
    const value = draftWithRemovable(path, marker);
    value.review.decisions = [decision(geoItemKey({ module: "entity", field: path }), "excluded")];
    const after = publish(value);

    // Both halves matter: without the first, a field the assembler never
    // published would pass the second for the wrong reason.
    expect(geoEntityFieldClaim(before.entity.value, path)).toContain(marker);
    expect(geoEntityFieldClaim(after.entity.value, path)).toBe("");
    expect(JSON.stringify(after.entity)).not.toContain(marker);
  });

  it("treats exactly the fields the pack cannot omit as required", () => {
    // Derived from the removal table, so this list is the one the assembler
    // acts on rather than a second copy of it.
    expect([...GEO_ENTITY_REQUIRED_PATHS]).toEqual([
      "name",
      "categories.primary",
      "definitions.w25",
      "definitions.w55",
      "definitions.w120",
      "audience.who",
      "links.home",
    ]);
  });

  it("withholds the whole section when a required field was excluded", () => {
    const value = draftWithEntityFields();
    value.review.decisions = [decision(ENTITY_DEFINITION_KEY, "excluded")];
    const pack = publish(value);

    // A definition is not a field the entity contract has a shape for without a
    // value, so it cannot be dropped and the rest published. Publishing it
    // anyway would state exactly what the owner rejected.
    expect(pack.entity).toEqual({ status: "unavailable", reason: "owner_excluded_required" });
    expect(pack.entity.value).toBeUndefined();
    expect(JSON.stringify(pack)).not.toContain(DISAMBIGUATION);
  });

  it("says the owner emptied the section when every field was excluded", () => {
    const value = draft();
    value.review.decisions = [decision(ENTITY_NAME_KEY, "excluded")];

    // `name` is required, so this also proves the order of the two checks:
    // when nothing survived, "you excluded all of it" is the whole story.
    expect(publish(value).entity).toEqual({ status: "unavailable", reason: "owner_excluded_all" });
  });
});

describe("a section the owner emptied", () => {
  it("says so on the module and in coverage, and blames no evidence for it", () => {
    const value = draft();
    value.review.decisions = [decision(QA_KEY, "excluded")];
    const pack = publish(value);
    const row = coverageFor(pack, "coverage:qa");

    expect(pack.qa).toEqual({ status: "unavailable", reason: "owner_excluded_all" });
    expect(row.status).toBe("missing");
    expect(row.summary).toBe("You excluded every item in this section, so it is not published.");
    expect(row.nextAction).toBe("Restore an excluded item to publish this section.");
    // The two sentences this replaces. Both were statements about the
    // collection run, and the run collected what the owner then removed.
    expect(row.summary).not.toBe("This content is currently unavailable.");
    expect(row.nextAction).not.toMatch(/evidence/u);
  });

  it("reads a suppression the same way as an exclusion", () => {
    const value = draft();
    value.review.suppressions = [{ itemKey: QA_KEY, suppressedAt: DECIDED_AT }];

    expect(publish(value).qa).toEqual({ status: "unavailable", reason: "owner_excluded_all" });
  });

  it("leaves a genuine evidence shortfall saying exactly that", () => {
    const value = draft();
    value.knowledge.qa = { status: "unavailable", reason: "insufficient_evidence" };
    const pack = publish(value);
    const row = coverageFor(pack, "coverage:qa");

    // The new reason must not swallow the real one. A module that arrives
    // unavailable is returned untouched, and its coverage row keeps the generic
    // sentence rather than accusing the owner of a decision they never made.
    expect(pack.qa).toEqual({ status: "unavailable", reason: "insufficient_evidence" });
    expect(row.summary).toBe("This content is currently unavailable.");
    expect(row.nextAction).toBe("Review available evidence before relying on this section.");
  });

  it("says which kind of decision withheld an entity section", () => {
    const value = draftWithEntityFields();
    value.review.decisions = [decision(ENTITY_DEFINITION_KEY, "excluded")];
    const row = coverageFor(publish(value), "coverage:entity");

    expect(row.summary).toBe("You excluded a field this section cannot be published without, so it is not published.");
    expect(row.nextAction).toBe("Restore that field to publish this section.");
  });
});

describe("comparison rows", () => {
  it("keeps a comparison that still has a row", () => {
    const value = draftWithComparison();
    value.review.decisions = [decision(ROW_PRICE_KEY, "excluded")];
    const pack = publish(value);

    expect(pack.comparisons.status).toBe("available");
    expect(
      moduleItems(pack.comparisons)[0].rows.map((row: any) => row.itemKey),
    ).toEqual([ROW_CHARTS_KEY]);
    expect(pack.meta.counts.comparisons).toBe(1);
  });

  it("drops a comparison whose every row was excluded", () => {
    const value = draftWithComparison();
    value.review.decisions = [
      decision(ROW_PRICE_KEY, "excluded"),
      decision(ROW_CHARTS_KEY, "excluded"),
    ];
    const pack = publish(value);

    expect(pack.comparisons).toEqual({
      status: "unavailable",
      reason: "owner_excluded_all",
    });
    expect(pack.meta.counts.comparisons).toBe(0);
  });

  it("counts comparison rows among the published decisions", () => {
    const pack = publish(draftWithComparison());

    expect(pack.meta.counts.acceptedInBulk).toBe(7);
  });
});

describe("module states without a model", () => {
  function withoutModelOutput(): any {
    const value = draft();
    value.knowledge.entity = {
      status: "unavailable",
      reason: "generation_unavailable",
    };
    value.knowledge.qa = {
      status: "unavailable",
      reason: "generation_unavailable",
    };
    value.knowledge.scope = {
      status: "unavailable",
      reason: "generation_unavailable",
    };
    value.knowledge.comparisons = {
      status: "unavailable",
      reason: "generation_unavailable",
    };
    for (const fact of value.knowledge.facts.value)
      fact.origin = "declared_profile";
    return value;
  }

  it("says the facts section is missing the model's contribution", () => {
    const pack = publish(withoutModelOutput());

    expect(pack.facts.status).toBe("partial");
    expect(pack.facts.limitation).toBe(GEO_FACTS_WITHOUT_MODEL_LIMITATION);
    expect(pack.entity).toEqual({
      status: "unavailable",
      reason: "generation_unavailable",
    });
    expect(pack.qa).toEqual({
      status: "unavailable",
      reason: "generation_unavailable",
    });
    expect(pack.meta.counts.facts).toBe(2);
  });

  it("keeps the collected sections visible, because they never needed a model", () => {
    const pack = publish(withoutModelOutput());

    expect(pack.machine.status).toBe("partial");
    expect(pack.machine.value.robots.status).toBe("present");
    expect(pack.evidence.status).toBe("partial");
    expect(pack.evidence.value.proof).toHaveLength(1);
    expect(pack.coverage.value.map((row: any) => row.id)).toContain(
      "coverage:machine",
    );
  });

  it("does not claim the model is missing while a synthesized fact is still published", () => {
    const value = withoutModelOutput();
    value.knowledge.facts.value[0].origin = "synthesized";
    const pack = publish(value);

    expect(pack.facts.status).toBe("available");
  });

  it("refuses to publish a draft that collected nothing at all", () => {
    const value = draft();
    value.knowledge = null;

    // There is no evidence catalogue, no scan time and no item: eight
    // unavailable modules would still be a published version claiming a
    // knowledge base exists.
    expect(() => publish(value)).toThrow(/without collected knowledge/u);
  });
});

describe("evidence groups", () => {
  it("passes the collected list through so an uncollected group stays uncollected", () => {
    const pack = publish(draft());

    // The v1 assembler hard-coded press and thirdPartyProfiles to [] and the UI
    // omitted empty groups, so "never looked for" rendered as "nothing there".
    expect(pack.evidence.value.collected).toEqual(["proof", "changelog"]);
    expect(pack.evidence.value.collected).not.toContain("press");
    expect(pack.evidence.value.changelog).toEqual([]);
    expect(pack.evidence.value.press).toEqual([]);
    expect(pack.evidence.value.thirdPartyProfiles).toEqual([]);
    expect(pack.evidence.value.proof).toHaveLength(1);
  });
});

describe("coverage", () => {
  it("reports the seven knowledge sections plus the question set", () => {
    const pack = publish(draft());

    expect(pack.coverage.value.map((row: any) => row.id)).toEqual([
      "coverage:entity",
      "coverage:facts",
      "coverage:qa",
      "coverage:comparisons",
      "coverage:scope",
      "coverage:evidence",
      "coverage:machine",
      "coverage:questions",
    ]);
    expect(pack.coverage.status).toBe("partial");
  });

  it("says a version without a question set has none", () => {
    const row = publish(draft()).coverage.value.at(-1) as any;

    expect(row.status).toBe("missing");
    expect(row.summary).toMatch(/no question set/u);
    expect(row.nextAction).toMatch(/Update the knowledge base/u);
  });

  it("marks the question set covered when one is published with the pack", () => {
    const row = publish(draft(), {
      questionSet: questionSetV2(),
    }).coverage.value.at(-1) as any;

    expect(row.status).toBe("covered");
    expect(row.nextAction).toBeNull();
  });

  it("carries a module's own limitation into its coverage row", () => {
    const rows = publish(draft()).coverage.value as any[];

    expect(rows.find((row) => row.id === "coverage:evidence").summary).toBe(
      "Off-site sources were not collected in this run.",
    );
    expect(rows.find((row) => row.id === "coverage:comparisons").status).toBe(
      "missing",
    );
    expect(rows.find((row) => row.id === "coverage:facts").sourceRefs).toEqual([
      PRICING_SOURCE,
    ]);
  });
});

describe("the question set is optional, not ignored", () => {
  it("publishes without one, and without any question-set check", () => {
    expect(() => publish(draft(), { questionSet: null })).not.toThrow();
  });

  it("rejects a question set about another market", () => {
    const foreign = { ...questionSetV2(), country: "GB" };

    expect(() => publish(draft(), { questionSet: foreign })).toThrow(
      /market differs/u,
    );
  });

  it("rejects a question set that is not a valid v2 set", () => {
    expect(() =>
      publish(draft(), {
        questionSet: { schemaVersion: "marketing-geo-question-set.v2" },
      }),
    ).toThrow();
  });
});

describe("time is an argument, never a clock", () => {
  it("rejects timestamps that are not canonical", () => {
    expect(() => publish(draft(), { generatedAt: "2026-09-03" })).toThrow(
      /generation time/u,
    );
    expect(() => publish(draft(), { bulkAcceptedAt: "2026-09-03" })).toThrow(
      /bulk acceptance time/u,
    );
  });

  it("rejects a bulk acceptance booked after the pack that carries it", () => {
    expect(() =>
      publish(draft(), { bulkAcceptedAt: "2026-09-04T00:00:00.000Z" }),
    ).toThrow(/Bulk acceptance follows/u);
  });

  it("rejects a scan that happened after the pack was generated", () => {
    const before = "2026-08-30T00:00:00.000Z";

    // Both times move, or the bulk-acceptance ordering check fires first and
    // this would pass for the wrong reason.
    expect(() =>
      publish(draft(), { generatedAt: before, bulkAcceptedAt: before }),
    ).toThrow(/scan time exceeds generation time/u);
  });
});
