// @input -- one run's collected evidence and the model's synthesis v2 output
// @output -- a v3 knowledge body every item of which carries a content-derived key
// @pos -- pure assembly: no fetch, no clock, no model call, no store

/**
 * Step 2 and step 4 of section 5, joined: what was collected and what the model
 * made of it become one knowledge body.
 *
 * Three properties this file exists to hold:
 *
 *  - **Identity is content.** Every `itemKey` is the digest of the item's own
 *    subject/attribute/qualifiers, question, dimension or field name. The v1
 *    pack derived a fact id from the source that evidenced it, so re-crawling
 *    the same claim from a different page produced a new item and orphaned the
 *    owner's decision about it.
 *  - **Evidence labels are earned.** `cited_and_literals_match` is computed
 *    here and re-checked by the parser; anything whose numbers no cited excerpt
 *    carries is `not_applicable`, which is the honest label rather than a
 *    quieter version of the same claim.
 *  - **A failed model does not empty the page.** The observed modules and the
 *    site's own FAQ markup are assembled whether or not the narrative arrived,
 *    and the modules that genuinely depend on it say why they are missing.
 *
 * Deterministic in its arguments, including `generatedAt`: the same run
 * assembles to the same body every time it is retried.
 */
import { createHash } from "node:crypto";

import { normalizeAccountWebsiteUrl } from "../account-websites/contracts.ts";
import { assertGeoItemKeyIntegrity, geoItemKey } from "./kb-item-key.ts";
import { parseGeoKnowledgeEvidenceV1, type GeoKnowledgeEvidenceV1 } from "./kb-knowledge-evidence.ts";
import {
  parseGeoKnowledgeNarrativeV2,
  parseGeoKnowledgeSynthesisInputV2,
  type GeoKnowledgeNarrativeV2,
  type GeoKnowledgeSynthesisInputV2,
} from "./kb-knowledge-synthesis-v2-contract.ts";
import { GEO_KNOWLEDGE_LIMITS, type GeoUnavailableReason } from "./kb-knowledge-shape.ts";
import { normalizeGeoIdentityText } from "./kb-item-identity.ts";
import type { GeoOffsiteCollection } from "./kb-offsite-collect.ts";
import {
  geoV3Items,
  type GeoGenerationInputV3,
  type GeoKnowledgeBodyV3,
} from "./kb-v3-contract.ts";
import {
  geoEvidenceCheckFor,
  geoItemIsCitable,
  geoLatestObservedAt,
  buildGeoSourceCatalogue,
  type GeoAssemblyClaim,
  type GeoSourceIndex,
} from "./kb-knowledge-assemble-sources.ts";
import {
  geoCoverageModule,
  geoEvidenceModule,
  geoJoinLimitations,
  geoMachineModule,
  type GeoRobotsObservation,
} from "./kb-knowledge-assemble-observed.ts";
import { geoEntityModule } from "./kb-knowledge-assemble-entity.ts";

type FactsModule = GeoKnowledgeBodyV3["facts"];
type QaModule = GeoKnowledgeBodyV3["qa"];
type ComparisonsModule = GeoKnowledgeBodyV3["comparisons"];
type ScopeModule = GeoKnowledgeBodyV3["scope"];
type FactItem = Extract<FactsModule, { status: "available" }>["value"][number];
type QaItem = Extract<QaModule, { status: "available" }>["value"][number];
type ComparisonItem = Extract<ComparisonsModule, { status: "available" }>["value"][number];
type ScopeValue = Extract<ScopeModule, { status: "available" }>["value"];
type ScopeItem = ScopeValue["does"][number];

/** How the model step can fail without taking the rest of the update with it. */
export const GEO_NARRATIVE_FAILURE_REASONS = [
  "unsupported_language",
  "generation_unavailable",
  "outcome_unknown",
  "insufficient_evidence",
  "timeout",
] as const;
export type GeoNarrativeFailureReason = (typeof GEO_NARRATIVE_FAILURE_REASONS)[number];

/** D11: a claim is due for review 90 days after it was last observed. */
export const GEO_REVIEW_PERIOD_MS = 90 * 24 * 60 * 60 * 1000;

const SCOPE_KINDS = ["does", "doesNot", "needsHuman", "misconceptions"] as const;

export interface GeoAssemblyDrop {
  readonly module: string;
  readonly id: string;
  readonly reason: string;
}

export interface AssembleGeoKnowledgeV3Input {
  /** Passed in, never read from a clock, so a retry assembles the same body. */
  readonly generatedAt: string;
  /** The locked generation identity this body belongs to. */
  readonly identity: GeoGenerationInputV3["identity"];
  /** `marketing-geo-knowledge-evidence.v1`, parsed here rather than trusted. */
  readonly evidence: unknown;
  readonly offsite: GeoOffsiteCollection | null;
  /** `marketing-geo-knowledge-synthesis-input.v2`; required when a narrative is given. */
  readonly synthesisInput: unknown | null;
  /** `marketing-geo-knowledge-narrative.v2`, or null when the model step failed. */
  readonly narrative: unknown | null;
  readonly narrativeFailureReason: GeoNarrativeFailureReason | null;
  readonly robots?: GeoRobotsObservation | null;
  readonly snippetsBlocked?: boolean | null;
}

export interface GeoKnowledgeAssemblyV3 {
  readonly knowledge: GeoKnowledgeBodyV3;
  /** Everything collected that could not be shown, and why. Never silent. */
  readonly dropped: readonly GeoAssemblyDrop[];
}

function canonicalTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function sameText(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

interface ParsedInputs {
  readonly evidence: GeoKnowledgeEvidenceV1;
  readonly narrative: GeoKnowledgeNarrativeV2 | null;
  readonly failure: GeoUnavailableReason;
}

/**
 * The narrative is re-validated against the very input it was bought with,
 * rather than accepted because a generation record says it succeeded. That
 * re-check is what stops a stored result from a different evidence set being
 * assembled into this run's body.
 */
function parseInputs(input: AssembleGeoKnowledgeV3Input): ParsedInputs {
  if (!canonicalTimestamp(input.generatedAt)) throw new Error("Invalid assembly time");
  const evidence = parseGeoKnowledgeEvidenceV1(input.evidence);
  if (input.generatedAt < evidence.collectedAt) throw new Error("Assembly predates the evidence it assembles");
  const target = normalizeAccountWebsiteUrl(input.identity.targetUrl)?.submittedUrl;
  if (target === undefined || target !== normalizeAccountWebsiteUrl(evidence.targetUrl)?.submittedUrl) {
    throw new Error("Assembly evidence target mismatch");
  }
  const hasNarrative = input.narrative !== null;
  if (hasNarrative === (input.narrativeFailureReason !== null)) throw new Error("Invalid narrative result pairing");
  if (!hasNarrative) {
    const failure = input.narrativeFailureReason as GeoNarrativeFailureReason;
    if (!GEO_NARRATIVE_FAILURE_REASONS.includes(failure)) throw new Error("Invalid narrative failure reason");
    return { evidence, narrative: null, failure };
  }
  if (input.synthesisInput === null) throw new Error("Narrative requires the synthesis input it was generated from");
  const synthesisInput: GeoKnowledgeSynthesisInputV2 = parseGeoKnowledgeSynthesisInputV2(input.synthesisInput);
  assertSynthesisIdentity(synthesisInput, evidence, input.identity);
  return { evidence, narrative: parseGeoKnowledgeNarrativeV2(input.narrative, synthesisInput), failure: "generation_unavailable" };
}

function assertSynthesisIdentity(
  synthesisInput: GeoKnowledgeSynthesisInputV2,
  evidence: GeoKnowledgeEvidenceV1,
  identity: AssembleGeoKnowledgeV3Input["identity"],
): void {
  if (synthesisInput.evidenceContentHash !== evidence.contentHash) throw new Error("Narrative evidence hash mismatch");
  if (synthesisInput.targetUrl !== evidence.targetUrl) throw new Error("Narrative evidence target mismatch");
  if (synthesisInput.officialName !== identity.officialName
    || !sameText(synthesisInput.aliases, identity.aliases)
    || !sameText(synthesisInput.categoryTerms, identity.categoryTerms)) {
    throw new Error("Narrative identity differs from the locked generation input");
  }
}

function nextReviewAt(observedAt: string | null): string | null {
  return observedAt === null ? null : new Date(Date.parse(observedAt) + GEO_REVIEW_PERIOD_MS).toISOString();
}

function factsModule(
  narrative: GeoKnowledgeNarrativeV2 | null,
  index: GeoSourceIndex,
  failure: GeoUnavailableReason,
  dropped: GeoAssemblyDrop[],
): FactsModule {
  if (narrative === null) return { status: "unavailable", reason: failure };
  const value: FactItem[] = [];
  for (const fact of narrative.facts) {
    const claims: GeoAssemblyClaim[] = [
      { text: fact.statement, sourceRefs: fact.sourceRefs },
      ...(fact.value === null ? [] : [{ text: fact.value, sourceRefs: fact.sourceRefs }]),
    ];
    // A generated fact cannot declare itself conflicting: a conflict is
    // something the merge discovers between two observations, and the contract
    // requires the competing observations to be carried beside the claim.
    if (fact.reason === "conflicting" || !geoItemIsCitable(fact.sourceRefs, claims, index)) {
      dropped.push({ module: "facts", id: fact.id, reason: fact.reason === "conflicting" ? "generated_conflict" : "literals_unsupported" });
      continue;
    }
    const observedAt = geoLatestObservedAt(fact.sourceRefs, index);
    value.push({
      id: fact.id,
      type: fact.type,
      statement: fact.statement,
      label: fact.label,
      value: fact.value,
      reason: fact.reason,
      subject: fact.subject,
      attribute: fact.attribute,
      qualifiers: [...fact.qualifiers],
      observedAt,
      nextReviewAt: nextReviewAt(observedAt),
      itemKey: geoItemKey({ module: "facts", type: fact.type, subject: fact.subject, attribute: fact.attribute, qualifiers: fact.qualifiers }),
      origin: "synthesized",
      sourceRefs: [...fact.sourceRefs],
      evidenceChecks: geoEvidenceCheckFor(fact.sourceRefs, claims, index),
      alternateObservations: [],
    });
  }
  if (value.length === 0) return { status: "unavailable", reason: "insufficient_evidence" };
  const lost = dropped.filter((entry) => entry.module === "facts").length;
  return lost === 0
    ? { status: "available", value }
    : { status: "partial", limitation: geoJoinLimitations([`${lost} generated fact(s) were withheld because their evidence did not support them.`]), value };
}

/** Question-and-answer markup the site publishes about itself, as observed items. */
function faqItems(
  evidence: GeoKnowledgeEvidenceV1,
  index: GeoSourceIndex,
  taken: ReadonlySet<string>,
  room: number,
  dropped: GeoAssemblyDrop[],
): readonly QaItem[] {
  const value: QaItem[] = [];
  const keys = new Set(taken);
  for (const page of evidence.pages) {
    const source = index.catalogue.find((entry) => entry.kind === "own_page" && entry.url === page.url && entry.availability !== "unavailable");
    if (source === undefined) continue;
    for (const pair of page.faq) {
      const id = `qa:faq-${createHash("sha256").update(`${page.url} ${pair.question}`, "utf8").digest("hex").slice(0, 20)}`;
      if (value.length >= room) {
        dropped.push({ module: "qa", id, reason: "module_full" });
        continue;
      }
      const refs = [source.id];
      const claims: GeoAssemblyClaim[] = [
        { text: pair.question, sourceRefs: refs },
        { text: pair.answer, sourceRefs: refs },
      ];
      // Quoted markup is never shortened to fit: a truncated answer is a
      // different answer. It is left out and counted instead.
      const tooLong = Array.from(pair.question).length > 800 || Array.from(pair.answer).length > 800;
      const key = geoItemKey({ module: "qa", intent: "other", canonicalQuestion: pair.question });
      if (tooLong || normalizeGeoIdentityText(pair.question) === "" || keys.has(key) || !geoItemIsCitable(refs, claims, index)) {
        dropped.push({ module: "qa", id, reason: tooLong ? "text_too_long" : keys.has(key) ? "duplicate_item_key" : "literals_unsupported" });
        continue;
      }
      keys.add(key);
      value.push({
        id,
        intent: "other",
        question: pair.question,
        canonicalQuestion: pair.question,
        variants: [],
        directAnswer: pair.answer,
        expansion: null,
        itemKey: key,
        origin: "observed_own",
        sourceRefs: refs,
        evidenceChecks: geoEvidenceCheckFor(refs, claims, index),
        alternateObservations: [],
      });
    }
  }
  return value;
}

function qaModule(
  narrative: GeoKnowledgeNarrativeV2 | null,
  evidence: GeoKnowledgeEvidenceV1,
  index: GeoSourceIndex,
  failure: GeoUnavailableReason,
  dropped: GeoAssemblyDrop[],
): QaModule {
  const generated: QaItem[] = (narrative?.qa ?? []).map((qa) => {
    const claims: GeoAssemblyClaim[] = [
      { text: qa.directAnswer, sourceRefs: qa.sourceRefs },
      ...(qa.expansion === null ? [] : [{ text: qa.expansion, sourceRefs: qa.sourceRefs }]),
    ];
    return {
      id: qa.id,
      intent: qa.intent,
      question: qa.question,
      canonicalQuestion: qa.canonicalQuestion,
      variants: [...qa.variants],
      directAnswer: qa.directAnswer,
      expansion: qa.expansion,
      itemKey: geoItemKey({ module: "qa", intent: qa.intent, canonicalQuestion: qa.canonicalQuestion }),
      origin: "synthesized" as const,
      sourceRefs: [...qa.sourceRefs],
      evidenceChecks: geoEvidenceCheckFor(qa.sourceRefs, claims, index),
      alternateObservations: [],
    };
  });
  const room = GEO_KNOWLEDGE_LIMITS.qa - generated.length;
  const observed = faqItems(evidence, index, new Set(generated.map((item) => item.itemKey)), room, dropped);
  const value = [...generated, ...observed];
  if (value.length === 0) return { status: "unavailable", reason: narrative === null ? failure : "insufficient_evidence" };
  if (narrative !== null) return { status: "available", value };
  return {
    status: "partial",
    limitation: geoJoinLimitations(["Model-synthesized questions are missing: this section contains only question-and-answer markup observed on the site."]),
    value,
  };
}

function comparisonsModule(
  narrative: GeoKnowledgeNarrativeV2 | null,
  evidence: GeoKnowledgeEvidenceV1,
  index: GeoSourceIndex,
  failure: GeoUnavailableReason,
): ComparisonsModule {
  if (narrative === null) return { status: "unavailable", reason: failure };
  if (narrative.comparisons.length === 0) {
    return { status: "unavailable", reason: evidence.confirmedCompetitors.length === 0 ? "not_applicable" : "insufficient_evidence" };
  }
  const value: ComparisonItem[] = narrative.comparisons.map((comparison) => ({
    id: comparison.id,
    competitor: comparison.competitor,
    // The whole comparison was checked when the evidence was collected, which
    // is never earlier than any page it cites.
    checkedAt: evidence.collectedAt,
    rows: comparison.rows.map((row) => {
      const claims: GeoAssemblyClaim[] = [
        ...(row.product === null ? [] : [{ text: row.product, sourceRefs: row.sourceRefs }]),
        ...(row.competitor === null ? [] : [{ text: row.competitor, sourceRefs: row.sourceRefs }]),
      ];
      return {
        id: row.id,
        dimension: row.dimension,
        product: row.product,
        competitor: row.competitor,
        availability: row.availability,
        itemKey: geoItemKey({ module: "comparisons", competitorKey: comparison.competitor.key, dimension: row.dimension }),
        origin: "synthesized" as const,
        sourceRefs: [...row.sourceRefs],
        evidenceChecks: geoEvidenceCheckFor(row.sourceRefs, claims, index),
        alternateObservations: [],
      };
    }),
    verdict: comparison.verdict,
    sourceRefs: [...comparison.sourceRefs],
  }));
  return { status: "available", value };
}

function scopeModule(narrative: GeoKnowledgeNarrativeV2 | null, index: GeoSourceIndex, failure: GeoUnavailableReason): ScopeModule {
  if (narrative === null) return { status: "unavailable", reason: failure };
  const item = (kind: string, statement: { id: string; text: string; sourceRefs: readonly string[] }): ScopeItem => ({
    id: statement.id,
    text: statement.text,
    itemKey: geoItemKey({ module: "scope", kind, statement: statement.text }),
    origin: "synthesized",
    sourceRefs: [...statement.sourceRefs],
    evidenceChecks: geoEvidenceCheckFor(statement.sourceRefs, [{ text: statement.text, sourceRefs: statement.sourceRefs }], index),
    alternateObservations: [],
  });
  const value: ScopeValue = {
    does: narrative.scope.does.map((statement) => item("does", statement)),
    doesNot: narrative.scope.doesNot.map((statement) => item("doesNot", statement)),
    needsHuman: narrative.scope.needsHuman.map((statement) => item("needsHuman", statement)),
    misconceptions: narrative.scope.misconceptions.map((statement) => item("misconceptions", statement)),
  };
  return SCOPE_KINDS.some((kind) => value[kind].length > 0)
    ? { status: "available", value }
    : { status: "unavailable", reason: "insufficient_evidence" };
}

function moduleRefs(module: { readonly status: string; readonly value?: unknown }): readonly string[] {
  const value = "value" in module ? module.value : null;
  const refs: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (Array.isArray(record.sourceRefs)) refs.push(...record.sourceRefs.filter((ref): ref is string => typeof ref === "string"));
    for (const nested of Object.values(record)) walk(nested);
  };
  walk(value);
  return refs;
}

/**
 * Assemble one v3 knowledge body.
 *
 * Throws only when its inputs disagree about which run they belong to -- a
 * narrative bought against different evidence, an assembly dated before the
 * collection it describes. Everything else resolves: an item that cannot be
 * shown with its evidence is dropped and reported, because the alternative is
 * a version that cannot be published at all.
 */
export function assembleGeoKnowledgeBodyV3(input: AssembleGeoKnowledgeV3Input): GeoKnowledgeAssemblyV3 {
  const { evidence, narrative, failure } = parseInputs(input);
  const index = buildGeoSourceCatalogue(evidence, input.offsite);
  const dropped: GeoAssemblyDrop[] = [];
  const entityAssembly = narrative === null
    ? null
    : geoEntityModule({ identity: input.identity, evidence, narrative, offsite: input.offsite, index });
  const entity = entityAssembly?.module ?? { status: "unavailable" as const, reason: failure };
  for (const entry of entityAssembly?.dropped ?? []) {
    dropped.push({ module: "entity", id: entry.field, reason: entry.reason });
  }
  const facts = factsModule(narrative, index, failure, dropped);
  const qa = qaModule(narrative, evidence, index, failure, dropped);
  const comparisons = comparisonsModule(narrative, evidence, index, failure);
  const scope = scopeModule(narrative, index, failure);
  const evidenceAssembly = geoEvidenceModule({ evidence, offsite: input.offsite, index });
  for (const entry of evidenceAssembly.dropped) dropped.push({ module: "evidence", id: entry.id, reason: entry.reason });
  const machine = geoMachineModule({ evidence, index, robots: input.robots ?? null, snippetsBlocked: input.snippetsBlocked ?? null });
  const modules = { entity, facts, qa, comparisons, scope, evidence: evidenceAssembly.module, machine };
  const coverage = geoCoverageModule(modules, {
    entity: moduleRefs(entity),
    facts: moduleRefs(facts),
    qa: moduleRefs(qa),
    comparisons: moduleRefs(comparisons),
    scope: moduleRefs(scope),
    evidence: moduleRefs(evidenceAssembly.module),
    machine: moduleRefs(machine),
  });
  const knowledge: GeoKnowledgeBodyV3 = {
    ...modules,
    coverage,
    sourceCatalogue: [...index.catalogue],
    collectedAt: evidence.collectedAt,
    generatedAt: input.generatedAt,
  };
  // Cheap here, and the difference between a bug found in assembly and a draft
  // whose keys point at content they were not derived from.
  assertGeoItemKeyIntegrity(geoV3Items(knowledge));
  return { knowledge, dropped };
}
