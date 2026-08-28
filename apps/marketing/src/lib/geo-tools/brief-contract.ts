// @input  -- one frozen knowledge base, one question, and at most one sampled answer
// @output -- a brief a writer can work from, with every field carrying where it came from
// @pos    -- the shape of the GEO Brief; no i18n, no model, no network

import type { GeoKbFact, GeoKbPayload } from "./kb-contract.ts";
import type { GeoQuestionLayer } from "./kb-questions.ts";

export const GEO_BRIEF_SCHEMA_VERSION = "marketing-geo-brief.v1" as const;

/**
 * Where a value came from, ranked by what it entitles the brief to claim.
 *
 * `kb` and `crawl` are the only two a sentence-level fact may carry. `ai_sample`
 * decides what a page has to answer and never what is true about the product:
 * another company's model repeating something is not evidence, and a brief that
 * let it become one would launder a guess into a published claim. `model` is
 * for wording this tool generated - an outline heading, a phrasing - and never
 * for a number.
 */
export type GeoBriefSource =
  | "kb"
  | "crawl"
  | "ai_sample"
  | "model"
  | "unavailable";

/** Why a fact has no value. Required whenever the value is absent. */
export type GeoBriefFactReason =
  | "notPublished"
  | "fetchFailed"
  | "lowConfidence"
  | "conflicting";

/**
 * One cell of the fact table.
 *
 * `value: null` is the only way to express "we do not know this". There is no
 * empty string and no zero, because the writer reads this table to decide what
 * may appear in the copy, and a blank that looks like a value is how an
 * unverified number gets published.
 */
export interface GeoBriefFact {
  readonly key: string;
  readonly value: string | null;
  readonly reason: GeoBriefFactReason | null;
  readonly source: Extract<GeoBriefSource, "kb" | "crawl">;
  readonly sourceUrl: string | null;
  readonly observedAt: string | null;
}

/**
 * What the first two hundred words have to do.
 *
 * Its entities come from the frozen knowledge base rather than from the model,
 * because this is the one requirement the brief states as an obligation. An
 * obligation whose contents a model invented is not a requirement, it is a
 * suggestion wearing the wrong label.
 */
export interface GeoBriefLeadAnswer {
  readonly requirement: string;
  readonly requiredEntities: readonly string[];
  readonly source: Extract<GeoBriefSource, "kb" | "model">;
}

/**
 * One thing the page has to answer.
 *
 * `observedInSample` marks the items that came from reading one real answer to
 * this question. One answer is not a consensus, and the count is deliberately
 * absent: with a single sample any "3 of 5" would be manufactured. The brief
 * says where the item came from and lets the writer weigh it.
 */
export interface GeoBriefMustAnswer {
  readonly id: string;
  readonly text: string;
  readonly source: Extract<GeoBriefSource, "kb" | "ai_sample" | "model">;
}

export interface GeoBriefOutlineItem {
  readonly id: string;
  readonly heading: string;
  /** Ids of the must-answer items this section is responsible for. */
  readonly answers: readonly string[];
  readonly source: Extract<GeoBriefSource, "model">;
}

/**
 * A domain that answered this question when it was asked.
 *
 * Not a ranking and not a backlink target. It is the set of pages a model
 * reached for, which tells a writer what the question currently gets answered
 * with - and, when the list is all competitors, that the answer exists and is
 * simply not theirs.
 */
export interface GeoBriefCitedDomain {
  readonly domain: string;
  readonly isOwn: boolean;
  readonly isCompetitor: boolean;
  readonly urls: readonly string[];
}

/** What triggered this brief, and what was observed about it. */
export interface GeoBriefOrigin {
  readonly kbId: string;
  readonly snapshotId: string;
  readonly revision: number;
  /** Null when the visitor typed the question instead of picking a frozen one. */
  readonly questionId: string | null;
  readonly questionText: string;
  readonly layer: GeoQuestionLayer;
  readonly roleId: string | null;
}

/*
 * There is deliberately no `observed` field here yet.
 *
 * The obvious one - what a visibility run saw for this question - would have to
 * be read from the stored run server-side, because counts accepted from the
 * browser are a caller's claim printed as an observation. That needs a handoff
 * carrying the run id and a store read keyed on it, and neither exists. A field
 * declared now would be null on every brief this tool can currently produce,
 * which is the shape of defect this file exists to avoid: something declared,
 * typed, tested, and never actually passed.
 */

export interface GeoBrief {
  readonly schemaVersion: typeof GEO_BRIEF_SCHEMA_VERSION;
  readonly origin: GeoBriefOrigin;
  readonly officialName: string;
  readonly market: { readonly country: string; readonly language: string };
  readonly leadAnswer: GeoBriefLeadAnswer;
  readonly mustAnswer: readonly GeoBriefMustAnswer[];
  readonly outline: readonly GeoBriefOutlineItem[];
  readonly facts: readonly GeoBriefFact[];
  /**
   * The dimensions the copy may not put a number on.
   *
   * Derived from the fact table rather than written separately: a "won't say"
   * list maintained by hand drifts from the table it describes, and the drift
   * always goes the same way - the list gets shorter than the truth.
   */
  readonly wontSay: readonly string[];
  readonly citedDomains: readonly GeoBriefCitedDomain[];
  /** Message keys under `tools.geoBrief.limits`. */
  readonly limits: readonly string[];
  readonly generatedAt: string;
}

/**
 * What this brief does not do, printed with it.
 *
 * `singleSample` is the important one. The must-answer items that came from a
 * sampled answer were read once, on one surface, at one moment - the same
 * question asked again returns a different answer, and the tool that measures
 * that is the visibility check, not this one.
 */
export const GEO_BRIEF_LIMITS = [
  "singleSample",
  "oneSurface",
  "factsAreYours",
  "notADraft",
] as const;

/** Limits a particular brief adds: things that went wrong in this run. */
export const GEO_BRIEF_RUN_LIMITS = [
  "sampleUnavailable",
  "modelUnavailable",
  "manualQuestion",
] as const;

/** Briefs one account may generate per day. A loop stop, not a price. */
export const GEO_BRIEF_RUNS_PER_DAY = 20;
export const GEO_BRIEF_DAILY_WINDOW_SECONDS = 24 * 60 * 60;

/** Provider calls one brief makes: one sample, one assembly. */
export const GEO_BRIEF_SAMPLE_CALLS = 1;

/** Bounds on what the model may return, so one bad response cannot flood a page. */
export const GEO_BRIEF_LIMITS_MAX = {
  mustAnswer: 12,
  outline: 10,
  answersPerSection: 6,
  headingChars: 120,
  mustAnswerChars: 200,
  requirementChars: 300,
} as const;

export type GeoBriefErrorCode =
  | "auth_required"
  | "invalid_request"
  | "not_found"
  | "no_frozen_version"
  | "daily_limit"
  | "provider_unconfigured"
  | "store_unavailable"
  | "brief_unavailable"
  | "internal_error";

/* ------------------------------------------------------------------ */
/* Derivations                                                         */
/* ------------------------------------------------------------------ */

/**
 * The fact table, projected from the frozen knowledge base.
 *
 * A knowledge-base fact carries an empty string for "unverified" because that
 * payload bans nulls - the digest both sides recompute has to serialize
 * identically in TypeScript and in Postgres, and number and null formatting is
 * where those two legitimately disagree. The brief has no such constraint, so
 * the empty string becomes a real null here, once, at the boundary. Leaving it
 * as `""` further in is how "we did not verify this" ends up rendered as a
 * blank cell that reads like a value.
 */
export function geoBriefFacts(
  facts: readonly GeoKbFact[],
): readonly GeoBriefFact[] {
  return facts.map((fact) => {
    const verified = fact.value.length > 0;
    return {
      key: fact.key,
      value: verified ? fact.value : null,
      // A verified value has no reason; an unverified one always does. The
      // knowledge base's own validator enforces the second half, so a `""`
      // reaching here with no reason is a payload that should not have parsed.
      reason: verified ? null : ((fact.reason || "lowConfidence") as GeoBriefFactReason),
      source: fact.sourceUrl.length > 0 ? "crawl" : "kb",
      sourceUrl: fact.sourceUrl.length > 0 ? fact.sourceUrl : null,
      observedAt: fact.observedAt.length > 0 ? fact.observedAt : null,
    };
  });
}

/** The dimensions with no verified value. Derived, never maintained by hand. */
export function geoBriefWontSay(
  facts: readonly GeoBriefFact[],
): readonly string[] {
  return facts.filter((fact) => fact.value === null).map((fact) => fact.key);
}

/**
 * What a correct answer to this question has to name.
 *
 * The same rule the question set used to decide what it was asking about, read
 * back out of the frozen payload rather than recomputed - a brief that required
 * different entities than the question was scored on would send a writer after
 * the wrong words.
 */
export function geoBriefRequiredEntities(
  payload: GeoKbPayload,
  layer: GeoQuestionLayer,
  roleId: string | null,
): readonly string[] {
  const role = payload.roles.find((entry) => entry.id === roleId) ?? null;
  const confirmedRivals = payload.competitors
    .filter((entry) => entry.confirmed && entry.brandName.length > 0)
    .map((entry) => entry.brandName);

  switch (layer) {
    case "problem":
      return [...(role?.painPoints ?? []), ...payload.categoryTerms].slice(0, 8);
    case "discovery":
      return [...payload.categoryTerms, ...(role?.vocabulary ?? [])].slice(0, 8);
    case "comparison":
      return [...confirmedRivals, ...payload.categoryTerms].slice(0, 8);
    case "evaluation":
      return [
        ...(role?.decisionCriteria ?? []),
        ...payload.categoryTerms,
      ].slice(0, 8);
    case "branded":
      return [payload.officialName, ...payload.aliases].slice(0, 8);
  }
}
