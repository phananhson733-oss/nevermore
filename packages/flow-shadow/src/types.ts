/**
 * Pure contracts for the pinned Content Shadow Flow adapter (Slice 2).
 *
 * Everything in this package is deterministic and dependency-free: no clock, no
 * randomness, no network, no database, and no runtime import of the sibling
 * `gengrowth-flow-mvp` repository (Slice 2 red line D). The adapter's job is
 * scaffolding + verification, not generation: the English draft itself is minted
 * by the pinned markdown LLM envelope in `@sf/artifacts` (Slice 2 decision D1).
 */

/**
 * The immutable tuple a Content Shadow run pins. `content_hash` is INPUT
 * addressing over this tuple (Slice 2 red line C) — exactly like
 * `audit_runs`/`diagnostic_runs` frozen inputs. It is deliberately NOT a
 * byte-hash of the model's output: "reproducible" means the run is a
 * well-defined, auditable function of frozen inputs plus a pinned adapter and
 * prompt-set version, not that an LLM emits identical bytes.
 */
/**
 * The cluster's aggregated existing-page decision. Four values, because one
 * cluster's keywords can legitimately disagree and `mixed` / `unassigned` are
 * the honest answers (decision O-3).
 */
export type ContentShadowPageAssignment =
  | "existing_page"
  | "new_asset"
  | "mixed"
  | "unassigned";

/**
 * The structured extraction of the pinned `content_brief` revision that makes
 * the draft a CHILD of the brief instead of its sibling (Slice 2 Task 4b).
 *
 * Declared here as a pure structural type — this package never imports
 * `@sf/artifacts` (or anything else at runtime); `@sf/artifacts` owns the
 * extractor, this package only carries the value through the frozen tuple.
 *
 * `briefSections` is a COVERAGE CHECKLIST, not a document structure: the draft's
 * structure stays the fixed `CONTENT_SHADOW_OUTLINE` scaffold (decision O-6).
 */
export interface ContentShadowBriefOutline {
  readonly briefSections: readonly string[];
  readonly targetKeywords: readonly string[];
  readonly pageAssignment: ContentShadowPageAssignment;
}

/**
 * The customer's own identity on the web, frozen at accept time.
 *
 * Without it the research pack held no URL at all, so EVERY link in a draft
 * resolved to nothing — including the drafting scaffold's own call to action.
 * `passed` was therefore reachable only by a draft that linked nowhere, which
 * made a correctly written draft score worse than an incomplete one and
 * collapsed the verdict to two usable values.
 *
 * It is frozen rather than read live for the same reason every other input is:
 * the QA gate's replay comparison treats differing claims for one run as a
 * data-integrity error, so an origin that could move between a run and its
 * re-delivery would turn that guard into a flake. An origin that DOES move
 * inside the accept -> claim window changes the content address and fails the
 * run as input drift, which is red line C working, not a defect.
 */
export interface ContentShadowFirstPartyIdentity {
  /** `sites.origin` for the run's site, e.g. `https://acme.example`. */
  readonly siteOrigin: string;
  /**
   * `icp.primaryConversion.targetUrl` from the ICP profile the frozen
   * diagnostic run already pinned. `null` when the profile carries none — never
   * a placeholder, because a fabricated conversion target would resolve links
   * that nothing in our records supports.
   */
  readonly icpPrimaryConversionUrl: string | null;
}

export interface ContentShadowFrozenInput {
  readonly primaryFindingId: string;
  readonly sourceActionId: string;
  readonly sourceDiagnosticRunId: string;
  readonly contentBriefArtifactId: string;
  readonly contentBriefRevision: number;
  readonly competitorEntityIds: readonly string[];
  readonly searchCluster: FrozenSearchCluster;
  readonly generativeQueryEntityIds: readonly string[];
  /**
   * Frozen because the gate resolves the draft's links against it. Both values
   * come from rows the run already pins: the site the frozen diagnosis ran
   * against, and the immutable `icp_profiles` version that diagnosis froze.
   */
  readonly firstParty: ContentShadowFirstPartyIdentity;
  /**
   * Frozen because it is what actually shapes the draft: an auditor must be
   * able to see what the model was told about the brief WITHOUT re-running the
   * extractor, and a mapping decision that moves between accept and claim is a
   * real input change that the existing hash guard must catch (decision O-2).
   */
  readonly contentBriefOutline: ContentShadowBriefOutline;
  readonly flowAdapterVersion: string;
  readonly promptSetVersion: string;
  readonly projectionVersion: string;
  readonly outputLocale: string;
}

/**
 * The frozen SearchQuery cluster. Search observation keeps its own shape and
 * its own identity set; it is never merged with generative observation into a
 * shared "volume" (invariant 8).
 */
export interface FrozenSearchCluster {
  readonly clusterKey: string;
  readonly keywordEntityIds: readonly string[];
}

/**
 * The canonical, `undefined`-free manifest persisted as
 * `flow_shadow_runs.frozen_input_manifest` and hashed into `content_hash`.
 * Identity collections are sorted and de-duplicated so an equivalent request
 * always produces the identical hash.
 */
export interface ContentShadowInputManifest {
  readonly primaryFindingId: string;
  readonly sourceActionId: string;
  readonly sourceDiagnosticRunId: string;
  readonly contentBriefArtifactId: string;
  readonly contentBriefRevision: number;
  readonly competitorEntityIds: readonly string[];
  readonly searchCluster: {
    readonly clusterKey: string;
    readonly keywordEntityIds: readonly string[];
  };
  readonly generativeQueryEntityIds: readonly string[];
  readonly firstParty: ContentShadowFirstPartyIdentity;
  readonly contentBriefOutline: ContentShadowBriefOutline;
  readonly flowAdapterVersion: string;
  readonly promptSetVersion: string;
  readonly projectionVersion: string;
  readonly outputLocale: string;
}

/**
 * Disclosure counts for the brief-outline projection. Deliberately NOT part of
 * the frozen manifest: `mapping_review_state` does not shape the draft, so it
 * must not be able to fail an already queued run — it only has to be visible.
 */
export interface BriefOutlineProjectionStats {
  /**
   * DISTINCT `## ` section labels the pinned brief carried, before the outline
   * cap. Without it the section channel could truncate in silence while the
   * keyword channel disclosed its own truncation — a partial break of the
   * brief -> draft causal chain that read as a clean pass.
   */
  readonly briefSectionCount: number;
  /** Section labels that survived the outline cap and reached the prompt. */
  readonly projectedSectionCount: number;
  readonly clusterKeywordCount: number;
  readonly projectedKeywordCount: number;
  readonly unconfirmedMappingCount: number;
}

/**
 * Authority grading. `A`/`B`/`C` are IDENTICAL to the existing `EvidenceGrade`
 * (`@sf/db`), which the 0012 triggers pin from provider + origin — reusing them
 * keeps one authoritative definition of "how good is this source" instead of
 * two that drift apart under the same letters.
 *
 * `D` is ASYMMETRIC and the asymmetry is deliberate (Slice 2 decision Q1):
 * `A`/`B`/`C` describe where a source came from, while `D` is not a source
 * property at all — it is the QA gate's OUTPUT for "this reference in the draft
 * resolves to no source we hold". A research pack must therefore never emit `D`:
 * it is assembled only from database rows, and a row with no provenance has
 * nowhere to have come from. If pack assembly ever produces `D`, that is a bug
 * meaning it invented a source, not a new tier to support.
 *
 * Slice 2's deterministic pack emits only `A`: every source in it is a
 * first-party SignalFrame record the customer already confirmed.
 */
export type AuthorityTier = "A" | "B" | "C" | "D";

/**
 * `first_party_site` / `first_party_conversion` are the customer's OWN web
 * identity, and they are the only pack sources that carry a resolvable URL in
 * Slice 2. They are first-party records like every other source here, so they
 * grade `A`; they are deliberately NOT counted as external evidence, because a
 * draft cannot cite the customer's own site as proof of an outside claim.
 */
export type ResearchSourceKind =
  | "content_brief"
  | "search_query"
  | "generative_query"
  | "competitor"
  | "first_party_site"
  | "first_party_conversion";

export interface ResearchSource {
  readonly kind: ResearchSourceKind;
  /** The canonical SignalFrame id this source resolves to. */
  readonly ref: string;
  readonly authorityTier: AuthorityTier;
  /** Honest statement of what this source does NOT yet prove; never null-padded. */
  readonly limitation: string | null;
}

/**
 * Search observation for the frozen cluster. Carries identities only: Task 4
 * asserts no demand metric, because no metric was read. Search and generative
 * observation stay in two separate shapes (invariant 8).
 */
export interface ResearchSearchObservation {
  readonly clusterKey: string;
  readonly keywordEntityIds: readonly string[];
}

/** Generative (AI answer) observation for the frozen query set. */
export interface ResearchGenerativeObservation {
  readonly generativeQueryEntityIds: readonly string[];
}

/** The deterministic research pack persisted in `flow_shadow_research_packs`. */
export interface ResearchPack {
  readonly adapterVersion: string;
  readonly projectionVersion: string;
  readonly outputLocale: string;
  readonly brief: {
    readonly artifactId: string;
    readonly revision: number;
  };
  /** Deterministic drafting scaffold; the model fills it, the adapter fixes it. */
  readonly outline: readonly string[];
  /**
   * The brief-derived COVERAGE CHECKLIST. Distinct from `outline` above, which
   * is the fixed document scaffold — the two are orthogonal on purpose
   * (decision O-6) and must never be asserted against each other.
   */
  readonly briefOutline: ContentShadowBriefOutline;
  readonly searchObservation: ResearchSearchObservation;
  readonly generativeObservation: ResearchGenerativeObservation;
  readonly competitorEntityIds: readonly string[];
  readonly sources: readonly ResearchSource[];
  readonly limitations: readonly string[];
}

/** SEO/GEO + factual review verdict for one evaluated draft revision. */
export type QaVerdict = "passed" | "needs_review" | "blocked";

export type QaClaimKind = "red_line" | "structure" | "citability" | "coverage";

/**
 * `unevaluated` is an honest third state: the check exists in the contract but
 * has not been implemented yet. It is never rendered as a pass.
 */
export type QaClaimStatus = "passed" | "failed" | "unevaluated";

export interface QaClaim {
  readonly claimId: string;
  readonly kind: QaClaimKind;
  readonly status: QaClaimStatus;
  readonly detail: string;
}

export interface QaEvaluation {
  readonly verdict: QaVerdict;
  readonly claims: readonly QaClaim[];
}

export interface QaEvaluationInput {
  readonly draftMarkdown: string;
  /**
   * The pinned content brief revision's body.
   *
   * Every QA input is drawn from something frozen or immutable — the evaluated
   * artifact revision, the hash-verified manifest projection, and this pinned
   * revision — because the QA gate's replay comparison treats differing claims
   * for the same run as a data-integrity error. An input that could move
   * between a run and its re-delivery would turn that guard into a flake.
   *
   * The brief body never enters the draft PROMPT (only the extracted coverage
   * checklist does); it is read here purely to detect a draft that restates it.
   */
  readonly briefMarkdown: string;
  readonly pack: ResearchPack;
  /**
   * Required, not optional: the QA claim is where a reviewer reads what the
   * brief contributed, so a caller that cannot supply the projection counts
   * must fail to compile rather than quietly emit a claim that reports only
   * the survivors of the cap.
   */
  readonly briefOutlineStats: BriefOutlineProjectionStats;
}
