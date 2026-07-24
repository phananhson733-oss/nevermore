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
export interface ContentShadowFrozenInput {
  readonly primaryFindingId: string;
  readonly sourceActionId: string;
  readonly sourceDiagnosticRunId: string;
  readonly contentBriefArtifactId: string;
  readonly contentBriefRevision: number;
  readonly competitorEntityIds: readonly string[];
  readonly searchCluster: FrozenSearchCluster;
  readonly generativeQueryEntityIds: readonly string[];
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
  readonly flowAdapterVersion: string;
  readonly promptSetVersion: string;
  readonly projectionVersion: string;
  readonly outputLocale: string;
}

/**
 * Evidence authority grading. Slice 2 Task 4 emits only `A` — every source in
 * the deterministic pack is a first-party SignalFrame record the customer has
 * already confirmed. External authority grading (`B`/`C`/`D`) arrives with the
 * real QA judgement in Task 6; inventing tiers now would be a fabricated claim.
 */
export type AuthorityTier = "A" | "B" | "C" | "D";

export type ResearchSourceKind =
  | "content_brief"
  | "search_query"
  | "generative_query"
  | "competitor";

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
  readonly searchObservation: ResearchSearchObservation;
  readonly generativeObservation: ResearchGenerativeObservation;
  readonly competitorEntityIds: readonly string[];
  readonly sources: readonly ResearchSource[];
  readonly limitations: readonly string[];
}

/** SEO/GEO + factual review verdict for one evaluated draft revision. */
export type QaVerdict = "passed" | "needs_review" | "blocked";

export type QaClaimKind =
  | "red_line"
  | "structure"
  | "citability"
  | "coverage";

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
  readonly pack: ResearchPack;
}
